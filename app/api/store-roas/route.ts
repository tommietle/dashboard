import { NextRequest, NextResponse } from 'next/server';
import { fetchStoreMetrics, isShopifyConfigured, STORES } from '@/lib/shopify';
import { fetchAdsMetrics, isAdsConfigured } from '@/lib/googleAds';
import { getConnection } from '@/lib/adsConnections';
import { getEurConverter } from '@/lib/fx';

type ShopStore = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

const _generic = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const ENV_FALLBACK: Record<ShopStore, string | undefined> = {
  luhvia:      process.env.LUHVIA_GOOGLE_ADS_REFRESH_TOKEN      || _generic,
  cecole:      process.env.CECOLE_GOOGLE_ADS_REFRESH_TOKEN      || _generic,
  luvande:     process.env.LUVANDE_GOOGLE_ADS_REFRESH_TOKEN     || _generic,
  modemeister: process.env.MODEMEISTER_GOOGLE_ADS_REFRESH_TOKEN || _generic,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store   = searchParams.get('store') || 'all';
  const endDate = searchParams.get('end') || new Date().toISOString().slice(0, 10);
  const startDate = searchParams.get('start') || (() => {
    const d = new Date(endDate + 'T12:00:00');
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  })();

  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const keys: ShopStore[] = store === 'all'
    ? (['luhvia', 'cecole', 'luvande', 'modemeister'] as ShopStore[]).filter(k => isShopifyConfigured(k) && isAdsConfigured(k))
    : ((['luhvia', 'cecole', 'luvande', 'modemeister'] as ShopStore[]).includes(store as ShopStore) ? [store as ShopStore] : []);

  if (!keys.length) return NextResponse.json({ shopifyRevenue: 0, adsSpend: 0, roas: 0 });

  try {
    const toEur = await getEurConverter();
    const r2 = (v: number) => Math.round(v * 100) / 100;

    const results = await Promise.allSettled(keys.map(async k => {
      const [shopify, conn] = await Promise.all([
        fetchStoreMetrics(k, startDate, endDate),
        getConnection(k),
      ]);
      const token = conn?.refreshToken || ENV_FALLBACK[k];
      if (!token) return { shopifyRevenue: 0, adsSpend: 0 };

      const ads = await fetchAdsMetrics(k, startDate, endDate, token);
      const shopCurrency = STORES[k].currency;

      return {
        shopifyRevenue: r2(toEur(shopify.totalRevenue, shopCurrency)),
        adsSpend: r2(toEur(ads.spend, ads.currency)),
      };
    }));

    let totalShopify = 0;
    let totalSpend = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalShopify += r.value.shopifyRevenue;
        totalSpend   += r.value.adsSpend;
      }
    }

    const roas = totalSpend > 0 ? r2(totalShopify / totalSpend) : 0;
    return NextResponse.json({ shopifyRevenue: r2(totalShopify), adsSpend: r2(totalSpend), roas });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
