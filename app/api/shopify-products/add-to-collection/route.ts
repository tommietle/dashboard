import { NextRequest, NextResponse } from 'next/server';
import { STORES, getShopifyAccessToken, isShopifyConfigured } from '@/lib/shopify';

export const maxDuration = 60;

type ShopKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

async function addOne(
  url: string, token: string, productId: string, collectionId: string, attempt = 0
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ collect: { product_id: productId, collection_id: collectionId } }),
  });
  if (res.status === 429) {
    if (attempt >= 4) throw new Error(`Rate limited: ${productId}`);
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    return addOne(url, token, productId, collectionId, attempt + 1);
  }
  // 422 = already in collection → treat as success.
  if (!res.ok && res.status !== 422) throw new Error(`${productId}: ${res.status}`);
}

export async function POST(req: NextRequest) {
  const { store, productIds, collectionId } = await req.json() as {
    store: ShopKey; productIds: string[]; collectionId: string;
  };

  if (!store || !['luhvia', 'cecole', 'luvande', 'modemeister'].includes(store))
    return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
  if (!isShopifyConfigured(store))
    return NextResponse.json({ error: 'Store not configured' }, { status: 400 });
  if (!collectionId)
    return NextResponse.json({ error: 'collectionId is required' }, { status: 400 });
  if (!productIds?.length)
    return NextResponse.json({ error: 'No product IDs' }, { status: 400 });

  const cfg   = STORES[store];
  const token = await getShopifyAccessToken(store);
  const url   = `https://${cfg.store}/admin/api/2024-04/collects.json`;

  // Process in batches of 5 with 500 ms between batches to stay under Shopify's rate limit.
  const BATCH = 5;
  const DELAY = 500;
  let added = 0, failed = 0;

  for (let i = 0; i < productIds.length; i += BATCH) {
    const batch = productIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(id => addOne(url, token, id, collectionId))
    );
    added  += results.filter(r => r.status === 'fulfilled').length;
    failed += results.filter(r => r.status === 'rejected').length;
    if (i + BATCH < productIds.length) await new Promise(r => setTimeout(r, DELAY));
  }

  return NextResponse.json({ added, failed });
}
