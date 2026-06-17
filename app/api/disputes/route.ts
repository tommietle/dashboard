import { NextRequest, NextResponse } from 'next/server';
import { fetchDisputes } from '@/lib/shopifyDisputes';
import { isShopifyConfigured } from '@/lib/shopify';

type ShopStore = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

function today()       { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store     = searchParams.get('store') || 'all';
  const startDate = searchParams.get('start') || daysAgo(29);
  const endDate   = searchParams.get('end')   || today();

  try {
    if (store === 'all') {
      const keys: ShopStore[] = (['luhvia', 'cecole', 'luvande', 'modemeister'] as ShopStore[]).filter(isShopifyConfigured);
      const results = await Promise.all(keys.map(k => fetchDisputes(k, startDate, endDate)));
      const disputes = results.flat().sort(
        (a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime(),
      );
      return NextResponse.json({ disputes });
    } else if (store === 'luhvia' || store === 'cecole' || store === 'luvande' || store === 'modemeister') {
      if (!isShopifyConfigured(store)) {
        return NextResponse.json({ error: `${store} is nog niet geconfigureerd` }, { status: 400 });
      }
      const disputes = await fetchDisputes(store, startDate, endDate);
      return NextResponse.json({ disputes });
    } else {
      return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Disputes API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
