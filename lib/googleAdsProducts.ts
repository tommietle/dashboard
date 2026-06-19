import { cached } from './cache';

export type AdsStoreKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

const ADS_ACCOUNTS: Record<AdsStoreKey, { customerId: string; currency: string }> = {
  luhvia:      { customerId: process.env.LUHVIA_GOOGLE_ADS_CUSTOMER_ID      || '', currency: 'EUR' },
  cecole:      { customerId: process.env.CECOLE_GOOGLE_ADS_CUSTOMER_ID      || '', currency: 'EUR' },
  luvande:     { customerId: process.env.LUVANDE_GOOGLE_ADS_CUSTOMER_ID     || '', currency: 'EUR' },
  modemeister: { customerId: process.env.MODEMEISTER_GOOGLE_ADS_CUSTOMER_ID || '', currency: 'EUR' },
};

export function isAdsProductsConfigured(storeKey: AdsStoreKey): boolean {
  return !!ADS_ACCOUNTS[storeKey].customerId;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(refreshToken: string): Promise<string> {
  const hit = tokenCache.get(refreshToken);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`OAuth token error: ${res.status}`);
  const json = await res.json();
  const token = json.access_token as string;
  tokenCache.set(refreshToken, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
  return token;
}

export interface ProductPeriodMetrics {
  spend: number;
  revenue: number;
  // Google Ads' eigen conversion value (wordt apart bewaard zodat de page de
  // hoofd-`revenue` kan overschrijven met Shopify-omzet zonder de Ads-waarde te verliezen).
  adsRevenue?: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roas: number;
  ctr: number;
  cpc: number;
  cpa: number;
}

export interface ProductRoas {
  productId: string;
  title: string;
  currency: string;
  store: AdsStoreKey;
  status: 'active' | 'archived' | 'draft' | 'unknown';
  variantCount: number;
  imageUrl?: string;
  brandName?: string;
  activeDays?: number;
  d90: ProductPeriodMetrics;
  d30: ProductPeriodMetrics;
  d14: ProductPeriodMetrics;
  d7: ProductPeriodMetrics;
  // Aanwezig wanneer caller een custom date range meegeeft.
  custom?: ProductPeriodMetrics;
}

interface DailyRow {
  date: string;
  costMicros: number;
  conversionsValue: number;
  conversions: number;
  clicks: number;
  impressions: number;
}

function extractProductId(itemId: string): string {
  // Handles shopify_CA_PRODUCTID_VARIANTID and shopify_CA_en_PRODUCTID_VARIANTID
  // (and similar multi-locale feed formats). The product ID is always the first
  // purely-numeric segment.
  for (const part of itemId.split('_')) {
    if (/^\d+$/.test(part)) return part;
  }
  return itemId;
}

function calcMetrics(rows: DailyRow[], cutoffDays: number, today: Date): ProductPeriodMetrics {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - (cutoffDays - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return calcMetricsByRange(rows, cutoffStr, today.toISOString().slice(0, 10));
}

function calcMetricsByRange(rows: DailyRow[], startStr: string, endStr: string): ProductPeriodMetrics {
  let spend = 0, revenue = 0, conversions = 0, clicks = 0, impressions = 0;
  for (const r of rows) {
    if (r.date >= startStr && r.date <= endStr) {
      spend       += r.costMicros / 1_000_000;
      revenue     += r.conversionsValue;
      conversions += r.conversions;
      clicks      += r.clicks;
      impressions += r.impressions;
    }
  }

  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    spend:       r(spend),
    revenue:     r(revenue),
    conversions: r(conversions),
    clicks,
    impressions,
    roas:        spend > 0 ? r(revenue / spend) : 0,
    ctr:         impressions > 0 ? r((clicks / impressions) * 100) : 0,
    cpc:         clicks > 0 ? r(spend / clicks) : 0,
    cpa:         conversions > 0 ? r(spend / conversions) : 0,
  };
}

// Haalt per-product ROAS-data uit Google Ads voor één store.
// De refresh token (de Google-login) komt van buiten, uit de in-dashboard koppeling.
// Het account wordt direct uitgelezen — geen MCC-koppeling.
export function fetchProductRoas(
  storeKey: AdsStoreKey,
  endDate: string,
  refreshToken: string,
  customRange?: { start: string; end: string },
  include90 = false,
): Promise<ProductRoas[]> {
  const cacheKey = customRange
    ? `google-ads:product-roas:v7:${storeKey}:${endDate}:${customRange.start}:${customRange.end}`
    : `google-ads:product-roas:v7:${storeKey}:${endDate}:${include90 ? '90' : '30'}`;
  return cached(cacheKey, 600, () => fetchProductRoasUncached(storeKey, endDate, refreshToken, customRange, include90));
}

async function fetchProductRoasUncached(
  storeKey: AdsStoreKey,
  endDate: string,
  refreshToken: string,
  customRange?: { start: string; end: string },
  include90 = false,
): Promise<ProductRoas[]> {
  const account = ADS_ACCOUNTS[storeKey];
  if (!account.customerId) {
    throw new Error(`Geen Google Ads customer-ID ingesteld voor ${storeKey}.`);
  }

  const end = new Date(endDate + 'T12:00:00');
  const start = new Date(end);
  start.setDate(start.getDate() - (include90 ? 89 : 29));
  let startStr = start.toISOString().slice(0, 10);
  let queryEnd = endDate;

  // Window verbreden zodat een custom range buiten de 30d ook gedekt wordt.
  if (customRange) {
    if (customRange.start < startStr) startStr = customRange.start;
    if (customRange.end > queryEnd) queryEnd = customRange.end;
  }

  const accessToken = await getAccessToken(refreshToken);
  const customerId = account.customerId.replace(/-/g, '');

  const query = `
    SELECT
      segments.product_item_id,
      segments.product_title,
      segments.date,
      metrics.cost_micros,
      metrics.conversions_value,
      metrics.conversions,
      metrics.clicks,
      metrics.impressions
    FROM shopping_performance_view
    WHERE segments.date BETWEEN '${startStr}' AND '${queryEnd}'
      AND metrics.impressions > 0
    ORDER BY metrics.cost_micros DESC
  `;

  const results: any[] = [];
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
      throw new Error(`Google Ads ${storeKey}: ${res.status} ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    results.push(...(data.results || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  const productMap = new Map<string, { title: string; rows: DailyRow[] }>();

  for (const row of results) {
    const itemId: string = row.segments?.productItemId ?? '';
    const title: string = row.segments?.productTitle ?? 'Unknown';
    const date: string  = row.segments?.date ?? '';
    const productId = extractProductId(itemId);

    if (!productMap.has(productId)) productMap.set(productId, { title, rows: [] });
    productMap.get(productId)!.rows.push({
      date,
      costMicros:       Number(row.metrics?.costMicros ?? 0),
      conversionsValue: Number(row.metrics?.conversionsValue ?? 0),
      conversions:      Number(row.metrics?.conversions ?? 0),
      clicks:           Number(row.metrics?.clicks ?? 0),
      impressions:      Number(row.metrics?.impressions ?? 0),
    });
  }

  const today = new Date(endDate + 'T12:00:00');
  const products: ProductRoas[] = [];

  for (const [productId, { title, rows }] of productMap.entries()) {
    const zero: ProductPeriodMetrics = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0, roas: 0, ctr: 0, cpc: 0, cpa: 0 };
    const p: ProductRoas = {
      productId,
      title,
      currency: account.currency,
      store: storeKey,
      status: 'unknown',
      variantCount: 0,
      d90: include90 ? calcMetrics(rows, 90, today) : zero,
      d30: calcMetrics(rows, 30, today),
      d14: calcMetrics(rows, 14, today),
      d7:  calcMetrics(rows, 7,  today),
    };
    if (customRange) {
      p.custom = calcMetricsByRange(rows, customRange.start, customRange.end);
    }
    products.push(p);
  }

  return products.sort((a, b) => b.d30.spend - a.d30.spend);
}

// ─── Shopify-first architecture ──────────────────────────────────────────────
// Returns a Map<productId, spend-per-period> so the caller (route) can join
// it with Shopify products as the source of truth.

export interface SpendEntry {
  title: string;
  d90: ProductPeriodMetrics;
  d30: ProductPeriodMetrics;
  d14: ProductPeriodMetrics;
  d7: ProductPeriodMetrics;
  custom?: ProductPeriodMetrics;
}

export function fetchProductSpendMap(
  storeKey: AdsStoreKey,
  endDate: string,
  refreshToken: string,
  customRange?: { start: string; end: string },
  include90 = false,
): Promise<Record<string, SpendEntry>> {
  const cacheKey = customRange
    ? `google-ads:spend-map:v4:${storeKey}:${endDate}:${customRange.start}:${customRange.end}`
    : `google-ads:spend-map:v4:${storeKey}:${endDate}:${include90 ? '90' : '30'}`;
  return cached(cacheKey, 600, () => fetchProductSpendMapUncached(storeKey, endDate, refreshToken, customRange, include90));
}

function adsMonthChunks(startStr: string, endStr: string): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  let cur = new Date(startStr + 'T12:00:00Z');
  const last = new Date(endStr + 'T12:00:00Z');
  while (cur <= last) {
    const chunkStart = cur.toISOString().slice(0, 10);
    const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const chunkEnd = new Date(Math.min(nextMonth.getTime() - 1, last.getTime() + 43200000)).toISOString().slice(0, 10);
    chunks.push({ start: chunkStart, end: chunkEnd });
    cur = nextMonth;
  }
  return chunks;
}

async function fetchAdsRows(
  customerId: string,
  accessToken: string,
  query: string,
  storeKey: string,
): Promise<any[]> {
  const results: any[] = [];
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
      throw new Error(`Google Ads ${storeKey}: ${res.status} ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    results.push(...(data.results || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}

async function fetchProductSpendMapUncached(
  storeKey: AdsStoreKey,
  endDate: string,
  refreshToken: string,
  customRange?: { start: string; end: string },
  include90 = false,
): Promise<Record<string, SpendEntry>> {
  const account = ADS_ACCOUNTS[storeKey];
  if (!account.customerId) return {};

  const end = new Date(endDate + 'T12:00:00');
  const start = new Date(end);
  start.setDate(start.getDate() - (include90 ? 89 : 29));
  const startStr = start.toISOString().slice(0, 10);

  const accessToken = await getAccessToken(refreshToken);
  const customerId = account.customerId.replace(/-/g, '');

  // Main query: standard window with segments.date for d7/d14/d30/d90 calculations.
  const mainQuery = `
    SELECT
      segments.product_item_id,
      segments.product_title,
      segments.date,
      metrics.cost_micros,
      metrics.conversions_value,
      metrics.conversions,
      metrics.clicks,
      metrics.impressions
    FROM shopping_performance_view
    WHERE segments.date BETWEEN '${startStr}' AND '${endDate}'
      AND metrics.impressions > 0
  `;

  // Custom range: parallel maandelijkse queries (elk geaggregeerd per product, geen date-segment).
  // Dit vermijdt sequentieel pagineren over 17+ maanden aan dagelijkse rijen.
  type AggRow = { productId: string; title: string; costMicros: number; convValue: number; conversions: number; clicks: number; impressions: number };

  async function fetchCustomMonthly(start: string, end: string): Promise<AggRow[]> {
    const q = `
      SELECT
        segments.product_item_id,
        segments.product_title,
        metrics.cost_micros,
        metrics.conversions_value,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND metrics.impressions > 0
    `;
    const rows = await fetchAdsRows(customerId, accessToken, q, storeKey);
    return rows.flatMap(row => {
      const itemId = row.segments?.productItemId ?? '';
      const productId = extractProductId(itemId);
      if (!productId) return [];
      return [{
        productId,
        title:        row.segments?.productTitle ?? '',
        costMicros:   Number(row.metrics?.costMicros ?? 0),
        convValue:    Number(row.metrics?.conversionsValue ?? 0),
        conversions:  Number(row.metrics?.conversions ?? 0),
        clicks:       Number(row.metrics?.clicks ?? 0),
        impressions:  Number(row.metrics?.impressions ?? 0),
      }];
    });
  }

  // Splits een datumrange in maandchunks en fetcht parallel.
  async function fetchCustomRangeAgg(start: string, end: string): Promise<Map<string, AggRow>> {
    const chunks = adsMonthChunks(start, end);
    const allRows = (await Promise.all(chunks.map((c: { start: string; end: string }) => fetchCustomMonthly(c.start, c.end)))).flat();
    const map = new Map<string, AggRow>();
    for (const r of allRows) {
      const existing = map.get(r.productId);
      if (existing) {
        existing.costMicros  += r.costMicros;
        existing.convValue   += r.convValue;
        existing.conversions += r.conversions;
        existing.clicks      += r.clicks;
        existing.impressions += r.impressions;
      } else {
        map.set(r.productId, { ...r });
      }
    }
    return map;
  }

  const [mainResults, customAggMap] = await Promise.all([
    fetchAdsRows(customerId, accessToken, mainQuery, storeKey),
    customRange ? fetchCustomRangeAgg(customRange.start, customRange.end) : Promise.resolve(new Map<string, AggRow>()),
  ]);

  const productMap = new Map<string, { title: string; rows: DailyRow[] }>();
  for (const row of mainResults) {
    const itemId: string = row.segments?.productItemId ?? '';
    const title: string = row.segments?.productTitle ?? '';
    const date: string  = row.segments?.date ?? '';
    const productId = extractProductId(itemId);
    if (!productId) continue;
    if (!productMap.has(productId)) productMap.set(productId, { title, rows: [] });
    productMap.get(productId)!.rows.push({
      date,
      costMicros:       Number(row.metrics?.costMicros ?? 0),
      conversionsValue: Number(row.metrics?.conversionsValue ?? 0),
      conversions:      Number(row.metrics?.conversions ?? 0),
      clicks:           Number(row.metrics?.clicks ?? 0),
      impressions:      Number(row.metrics?.impressions ?? 0),
    });
  }

  // Zorg dat producten die alleen in de custom range actief waren ook in de output komen.
  for (const [productId, agg] of customAggMap.entries()) {
    if (!productMap.has(productId)) productMap.set(productId, { title: agg.title, rows: [] });
  }

  const customMap = new Map<string, ProductPeriodMetrics>();
  if (customRange) {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    for (const [productId, agg] of customAggMap.entries()) {
      const spend       = agg.costMicros / 1_000_000;
      const convValue   = agg.convValue;
      const { clicks, impressions, conversions } = agg;
      customMap.set(productId, {
        spend:       r2(spend),
        revenue:     r2(convValue),
        conversions,
        clicks,
        impressions,
        roas:        spend > 0 ? r2(convValue / spend) : 0,
        ctr:         impressions > 0 ? r2((clicks / impressions) * 100) : 0,
        cpc:         clicks > 0 ? r2(spend / clicks) : 0,
        cpa:         conversions > 0 ? r2(spend / conversions) : 0,
      });
    }
  }

  console.log(`[spend-map] ${storeKey}: main=${mainResults.length}rows customProducts=${customAggMap.size} products=${productMap.size}`);
  const today = new Date(endDate + 'T12:00:00');
  const zero: ProductPeriodMetrics = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0, roas: 0, ctr: 0, cpc: 0, cpa: 0 };
  const record: Record<string, SpendEntry> = {};

  for (const [productId, { title, rows }] of productMap.entries()) {
    const entry: SpendEntry = {
      title,
      d90: include90 ? calcMetrics(rows, 90, today) : zero,
      d30: calcMetrics(rows, 30, today),
      d14: calcMetrics(rows, 14, today),
      d7:  calcMetrics(rows, 7,  today),
    };
    if (customRange) entry.custom = customMap.get(productId) ?? zero;
    record[productId] = entry;
  }

  return record;
}
