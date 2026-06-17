import { NextRequest, NextResponse } from 'next/server';
import { fetchTopProducts } from '@/lib/shopifyProducts';
import { isShopifyConfigured } from '@/lib/shopify';

type ShopStore = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store     = searchParams.get('store') || 'all';
  const startDate = searchParams.get('start') || daysAgo(29);
  const endDate   = searchParams.get('end')   || today();

  try {
    if (store === 'all') {
      const keys: ShopStore[] = (['luhvia', 'cecole', 'luvande', 'modemeister'] as ShopStore[]).filter(isShopifyConfigured);
      const results = await Promise.all(keys.map(k => fetchTopProducts(k, startDate, endDate)));
      const merged = results.flat().sort((a, b) => b.revenue - a.revenue);
      return NextResponse.json({ products: merged });
    } else if (store === 'luhvia' || store === 'cecole' || store === 'luvande' || store === 'modemeister') {
      if (!isShopifyConfigured(store)) {
        return NextResponse.json({ error: `${store} is nog niet geconfigureerd` }, { status: 400 });
      }
      const products = await fetchTopProducts(store, startDate, endDate);
      return NextResponse.json({ products });
    } else {
      return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Shopify products error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function today()       { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
