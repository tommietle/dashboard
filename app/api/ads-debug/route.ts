import { NextRequest, NextResponse } from 'next/server';
import { getConnection } from '@/lib/adsConnections';
import { STORES, getShopifyAccessToken } from '@/lib/shopify';

const _generic = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const ENV_FALLBACK: Record<string, string | undefined> = {
  luhvia:  process.env.LUHVIA_GOOGLE_ADS_REFRESH_TOKEN  || _generic,
  cecole:  process.env.CECOLE_GOOGLE_ADS_REFRESH_TOKEN  || _generic,
  luvande: process.env.LUVANDE_GOOGLE_ADS_REFRESH_TOKEN || _generic,
};

const CUSTOMER_IDS: Record<string, string> = {
  luhvia:  process.env.LUHVIA_GOOGLE_ADS_CUSTOMER_ID  || '',
  cecole:  process.env.CECOLE_GOOGLE_ADS_CUSTOMER_ID  || '',
  luvande: process.env.LUVANDE_GOOGLE_ADS_CUSTOMER_ID || '',
};

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`OAuth error: ${res.status}`);
  const d = await res.json();
  return d.access_token;
}

function extractProductId(itemId: string): string {
  for (const part of itemId.split('_')) {
    if (/^\d+$/.test(part)) return part;
  }
  return itemId;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store = searchParams.get('store') || 'cecole';
  const endDate = searchParams.get('end') || new Date().toISOString().slice(0, 10);
  const start = new Date(endDate + 'T12:00:00');
  start.setDate(start.getDate() - 29);
  const startDate = start.toISOString().slice(0, 10);

  const conn = await getConnection(store as any);
  const refreshToken = conn?.refreshToken || ENV_FALLBACK[store];
  if (!refreshToken) return NextResponse.json({ error: 'No token' }, { status: 400 });
  const customerId = CUSTOMER_IDS[store]?.replace(/-/g, '');
  if (!customerId) return NextResponse.json({ error: 'No customer ID' }, { status: 400 });

  const accessToken = await getAccessToken(refreshToken);

  const query = `
    SELECT
      segments.product_item_id,
      segments.product_title,
      metrics.cost_micros
    FROM shopping_performance_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND metrics.impressions > 0
  `;

  const allResults: any[] = [];
  let pageToken: string | undefined;
  do {
    const body: Record<string, unknown> = { query };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(
      `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `${res.status} ${err.slice(0, 300)}` }, { status: 500 });
    }
    const data = await res.json();
    allResults.push(...(data.results || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Group by extracted product ID, collect all raw item IDs seen
  const byProductId = new Map<string, {
    title: string;
    totalCostMicros: number;
    rawItemIds: Set<string>;
  }>();

  for (const row of allResults) {
    const itemId: string = row.segments?.productItemId ?? '';
    const title: string = row.segments?.productTitle ?? '';
    const cost = Number(row.metrics?.costMicros ?? 0);
    const productId = extractProductId(itemId);

    if (!byProductId.has(productId)) byProductId.set(productId, { title, totalCostMicros: 0, rawItemIds: new Set() });
    const e = byProductId.get(productId)!;
    e.totalCostMicros += cost;
    e.rawItemIds.add(itemId);
  }

  // Top 60 by spend
  const top60 = Array.from(byProductId.entries())
    .sort((a, b) => b[1].totalCostMicros - a[1].totalCostMicros)
    .slice(0, 60);

  // Cross-reference with Shopify: look up all numeric product IDs
  const numericIds = top60.map(([id]) => id).filter(id => /^\d+$/.test(id));
  const shopifyFound = new Set<string>();

  if (numericIds.length > 0) {
    try {
      const cfg = STORES[store as 'luhvia' | 'cecole' | 'luvande' | 'modemeister'];
      const token = await getShopifyAccessToken(store as 'luhvia' | 'cecole' | 'luvande' | 'modemeister');
      // Fetch in batches of 250
      for (let i = 0; i < numericIds.length; i += 250) {
        const batch = numericIds.slice(i, i + 250);
        const url = `https://${cfg.store}/admin/api/2024-04/products.json?ids=${batch.join(',')}&limit=250&fields=id`;
        const res = await fetch(url, {
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          for (const p of data.products || []) shopifyFound.add(String(p.id));
        }
      }
    } catch (e: any) {
      // shopify lookup failed, continue without it
    }
  }

  const rows = top60.map(([productId, d]) => ({
    productId,
    title: d.title,
    spend: Math.round(d.totalCostMicros / 1_000_000 * 100) / 100,
    rawItemIds: Array.from(d.rawItemIds),
    inShopify: /^\d+$/.test(productId) ? shopifyFound.has(productId) : null,
  }));

  // Summary
  const foundCount   = rows.filter(r => r.inShopify === true).length;
  const missingCount = rows.filter(r => r.inShopify === false).length;

  return NextResponse.json({
    store,
    startDate,
    endDate,
    totalAdsRows: allResults.length,
    topProducts: rows.length,
    shopifyFound: foundCount,
    shopifyMissing: missingCount,
    rows,
  });
}
