import { NextRequest, NextResponse } from 'next/server';
import { fetchStoreMetrics, isShopifyConfigured } from '@/lib/shopify';

type ShopStore = 'luhvia' | 'cecole' | 'luvande';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store = searchParams.get('store') || 'all';
  const startDate = searchParams.get('start') || getDefaultStart();
  const endDate = searchParams.get('end') || getDefaultEnd();

  try {
    if (store === 'all') {
      const keys: ShopStore[] = (['luhvia', 'cecole', 'luvande'] as ShopStore[]).filter(isShopifyConfigured);
      const stores = await Promise.all(keys.map(k => fetchStoreMetrics(k, startDate, endDate)));
      return NextResponse.json({ stores, startDate, endDate });
    } else if (store === 'luhvia' || store === 'cecole' || store === 'luvande') {
      if (!isShopifyConfigured(store)) {
        return NextResponse.json({ error: `${store} is nog niet geconfigureerd` }, { status: 400 });
      }
      const data = await fetchStoreMetrics(store, startDate, endDate);
      return NextResponse.json({ stores: [data], startDate, endDate });
    } else {
      return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function getDefaultStart() {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

function getDefaultEnd() {
  return new Date().toISOString().slice(0, 10);
}
