import { NextRequest, NextResponse } from 'next/server';
import { fetchReturns } from '@/lib/shopifyReturns';
import { fetchDisputes, buildDisputeProductMap } from '@/lib/shopifyDisputes';
import { isShopifyConfigured } from '@/lib/shopify';

type ShopStore = 'luhvia' | 'cecole' | 'luvande';

function today()       { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function getStoreData(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
  startDate: string,
  endDate: string,
) {
  const [returns, disputes] = await Promise.all([
    fetchReturns(storeKey, startDate, endDate),
    fetchDisputes(storeKey, startDate, endDate),
  ]);

  // Merge dispute counts into product rows
  const disputeMap = buildDisputeProductMap(disputes);
  returns.products = returns.products.map(p => {
    const d = disputeMap.get(p.productId);
    return d ? { ...p, disputeCount: d.count, disputeAmount: d.amount } : p;
  });

  return { returns, disputes };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store     = searchParams.get('store') || 'all';
  const startDate = searchParams.get('start') || daysAgo(29);
  const endDate   = searchParams.get('end')   || today();

  try {
    if (store === 'all') {
      const keys: ShopStore[] = (['luhvia', 'cecole', 'luvande'] as ShopStore[]).filter(isShopifyConfigured);
      const results = await Promise.all(keys.map(k => getStoreData(k, startDate, endDate)));
      return NextResponse.json({
        returns: results.map(r => r.returns),
        disputes: results.flatMap(r => r.disputes).sort(
          (a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime(),
        ),
      });
    } else if (store === 'luhvia' || store === 'cecole' || store === 'luvande') {
      if (!isShopifyConfigured(store)) {
        return NextResponse.json({ error: `${store} is nog niet geconfigureerd` }, { status: 400 });
      }
      const { returns, disputes } = await getStoreData(store, startDate, endDate);
      return NextResponse.json({ returns: [returns], disputes });
    } else {
      return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Returns API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
