import { NextRequest, NextResponse } from 'next/server';
import { STORES, getShopifyAccessToken, isShopifyConfigured } from '@/lib/shopify';

export const maxDuration = 60;

type ShopKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

async function tagOne(
  store: string, token: string, id: string, cleanTag: string, attempt = 0
): Promise<'updated' | 'skipped'> {
  const base = `https://${store}/admin/api/2024-04/products/${id}.json`;

  const getRes = await fetch(`${base}?fields=id,tags`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  if (getRes.status === 429) {
    if (attempt >= 4) throw new Error(`Rate limited GET ${id}`);
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    return tagOne(store, token, id, cleanTag, attempt + 1);
  }
  if (!getRes.ok) throw new Error(`GET ${id}: ${getRes.status}`);

  const { product } = await getRes.json();
  const existing: string[] = (product.tags as string)
    .split(',').map((t: string) => t.trim()).filter(Boolean);

  if (existing.includes(cleanTag)) return 'skipped';

  const putRes = await fetch(base, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: { id, tags: [...existing, cleanTag].join(', ') } }),
  });
  if (putRes.status === 429) {
    if (attempt >= 4) throw new Error(`Rate limited PUT ${id}`);
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    return tagOne(store, token, id, cleanTag, attempt + 1);
  }
  if (!putRes.ok) throw new Error(`PUT ${id}: ${putRes.status}`);
  return 'updated';
}

export async function POST(req: NextRequest) {
  const { store, productIds, tag } = await req.json() as { store: ShopKey; productIds: string[]; tag: string };

  if (!store || !['luhvia', 'cecole', 'luvande', 'modemeister'].includes(store))
    return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
  if (!isShopifyConfigured(store))
    return NextResponse.json({ error: 'Store not configured' }, { status: 400 });
  if (!tag?.trim())
    return NextResponse.json({ error: 'Tag is required' }, { status: 400 });
  if (!productIds?.length)
    return NextResponse.json({ error: 'No product IDs' }, { status: 400 });

  const cfg      = STORES[store];
  const token    = await getShopifyAccessToken(store);
  const cleanTag = tag.trim();

  // 3 products per batch (each uses 2 API calls: GET + PUT) → stays within rate limit.
  const BATCH = 3;
  const DELAY = 600;
  let updated = 0, skipped = 0, failed = 0;

  for (let i = 0; i < productIds.length; i += BATCH) {
    const batch = productIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(id => tagOne(cfg.store, token, id, cleanTag))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') r.value === 'updated' ? updated++ : skipped++;
      else failed++;
    }
    if (i + BATCH < productIds.length) await new Promise(r => setTimeout(r, DELAY));
  }

  return NextResponse.json({ updated, skipped, failed });
}
