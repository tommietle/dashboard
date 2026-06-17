import { NextRequest, NextResponse } from 'next/server';
import { STORES, getShopifyAccessToken, isShopifyConfigured } from '@/lib/shopify';

type ShopKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

async function shopifyGet(storeKey: ShopKey, endpoint: string) {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);
  const url = `https://${cfg.store}/admin/api/2024-04/${endpoint}`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Shopify ${storeKey}: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store = searchParams.get('store') as ShopKey | null;
  const collectionId = searchParams.get('collectionId');

  if (!store || !['luhvia', 'cecole', 'luvande', 'modemeister'].includes(store)) {
    return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
  }
  if (!isShopifyConfigured(store)) {
    return NextResponse.json({ error: 'Store not configured' }, { status: 400 });
  }

  try {
    if (collectionId) {
      // Return product IDs for this collection (paginated)
      const cfg = STORES[store];
      const token = await getShopifyAccessToken(store);
      const productIds: string[] = [];
      let pageInfo: string | null = null;
      let isFirst = true;

      while (true) {
        let url: string;
        if (isFirst) {
          url = `https://${cfg.store}/admin/api/2024-04/products.json?collection_id=${collectionId}&limit=250&fields=id`;
          isFirst = false;
        } else if (pageInfo) {
          url = `https://${cfg.store}/admin/api/2024-04/products.json?page_info=${pageInfo}&limit=250&fields=id`;
        } else break;

        const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
        if (!res.ok) throw new Error(`Shopify ${store}: ${res.status}`);
        const data = await res.json();
        productIds.push(...(data.products || []).map((p: any) => String(p.id)));

        const link = res.headers.get('Link');
        const next = link?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        pageInfo = next ? next[1] : null;
        if (!pageInfo) break;
      }

      return NextResponse.json({ productIds });
    } else {
      // Return all collections for this store
      const [custom, smart] = await Promise.all([
        shopifyGet(store, 'custom_collections.json?limit=250&fields=id,title'),
        shopifyGet(store, 'smart_collections.json?limit=250&fields=id,title'),
      ]);
      const collections: { id: string; title: string }[] = [
        ...(custom.custom_collections || []).map((c: any) => ({ id: String(c.id), title: c.title })),
        ...(smart.smart_collections || []).map((c: any) => ({ id: String(c.id), title: c.title })),
      ].sort((a, b) => a.title.localeCompare(b.title));
      return NextResponse.json({ collections });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
