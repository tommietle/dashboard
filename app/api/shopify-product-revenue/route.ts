import { NextRequest, NextResponse } from 'next/server';
import { fetchProductRevenueByPeriod, ProductRevenuePeriods } from '@/lib/shopifyProducts';
import { isShopifyConfigured } from '@/lib/shopify';
import { getEurConverter } from '@/lib/fx';

type ShopStore = 'luhvia' | 'cecole' | 'luvande';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store   = searchParams.get('store') || 'all';
  const endDate = searchParams.get('end') || new Date().toISOString().slice(0, 10);
  const customStart = searchParams.get('customStart') || '';
  const customEnd   = searchParams.get('customEnd')   || '';
  const customRange = DATE_RE.test(customStart) && DATE_RE.test(customEnd) && customStart <= customEnd
    ? { start: customStart, end: customEnd }
    : undefined;
  const include90 = searchParams.get('d90') === '1';

  try {
    let products: ProductRevenuePeriods[];
    if (store === 'all') {
      const keys: ShopStore[] = (['luhvia', 'cecole', 'luvande'] as ShopStore[]).filter(isShopifyConfigured);
      const results = await Promise.all(keys.map(k => fetchProductRevenueByPeriod(k, endDate, customRange, include90)));
      products = results.flat();
    } else if (store === 'luhvia' || store === 'cecole' || store === 'luvande') {
      if (!isShopifyConfigured(store)) {
        return NextResponse.json({ error: `${store} is nog niet geconfigureerd` }, { status: 400 });
      }
      products = await fetchProductRevenueByPeriod(store, endDate, customRange, include90);
    } else {
      return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
    }

    // Omzet omrekenen naar EUR voor eerlijke cross-store vergelijking.
    const toEur = await getEurConverter();
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const productsEur = products.map(p => ({
      ...p,
      d90: r2(toEur(p.d90, p.currency)),
      d30: r2(toEur(p.d30, p.currency)),
      d14: r2(toEur(p.d14, p.currency)),
      d7:  r2(toEur(p.d7,  p.currency)),
      ...(p.custom !== undefined ? { custom: r2(toEur(p.custom, p.currency)) } : {}),
      currency: 'EUR',
    }));

    return NextResponse.json({ products: productsEur });
  } catch (err: any) {
    console.error('Shopify product revenue error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
