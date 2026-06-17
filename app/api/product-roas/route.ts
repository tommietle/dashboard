import { NextRequest, NextResponse } from 'next/server';
import { AdsStoreKey, ProductPeriodMetrics, ProductRoas, SpendEntry, isAdsProductsConfigured, fetchProductSpendMap } from '@/lib/googleAdsProducts';
import { fetchAllShopifyProducts } from '@/lib/shopifyAllProducts';
import { fetchProductRevenueByPeriod } from '@/lib/shopifyProducts';
import { getConnection } from '@/lib/adsConnections';
import { getEurConverter } from '@/lib/fx';
import { STORES, isShopifyConfigured } from '@/lib/shopify';

const _generic = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const ENV_FALLBACK: Record<AdsStoreKey, string | undefined> = {
  luhvia:      process.env.LUHVIA_GOOGLE_ADS_REFRESH_TOKEN      || _generic,
  cecole:      process.env.CECOLE_GOOGLE_ADS_REFRESH_TOKEN      || _generic,
  luvande:     process.env.LUVANDE_GOOGLE_ADS_REFRESH_TOKEN     || _generic,
  modemeister: process.env.MODEMEISTER_GOOGLE_ADS_REFRESH_TOKEN || _generic,
};

const STORE_KEYS: AdsStoreKey[] = ['luhvia', 'cecole', 'luvande', 'modemeister'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ZERO: ProductPeriodMetrics = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0, roas: 0, ctr: 0, cpc: 0, cpa: 0 };

function mergeMetrics(a: ProductPeriodMetrics, b: ProductPeriodMetrics): ProductPeriodMetrics {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const spend       = a.spend + b.spend;
  const revenue     = a.revenue + b.revenue;
  const conversions = a.conversions + b.conversions;
  const clicks      = a.clicks + b.clicks;
  const impressions = a.impressions + b.impressions;
  return {
    spend:       r2(spend),
    revenue:     r2(revenue),
    conversions: r2(conversions),
    clicks, impressions,
    roas:        spend > 0 ? r2(revenue / spend) : 0,
    ctr:         impressions > 0 ? r2((clicks / impressions) * 100) : 0,
    cpc:         clicks > 0 ? r2(spend / clicks) : 0,
    cpa:         conversions > 0 ? r2(spend / conversions) : 0,
  };
}

function mergeSpendEntries(a: SpendEntry, b: SpendEntry): SpendEntry {
  return {
    title: a.title || b.title,
    d90:    mergeMetrics(a.d90,  b.d90),
    d30:    mergeMetrics(a.d30,  b.d30),
    d14:    mergeMetrics(a.d14,  b.d14),
    d7:     mergeMetrics(a.d7,   b.d7),
    ...(a.custom || b.custom ? { custom: mergeMetrics(a.custom ?? ZERO, b.custom ?? ZERO) } : {}),
  };
}

interface StoreResult { products: ProductRoas[]; orphanSpend: number; store: AdsStoreKey; adsCurrency: string; }

async function buildProductsForStore(
  storeKey: AdsStoreKey,
  endDate: string,
  customRange: { start: string; end: string } | undefined,
  include90: boolean,
): Promise<StoreResult> {
  if (!isShopifyConfigured(storeKey)) return { products: [], orphanSpend: 0, store: storeKey, adsCurrency: 'EUR' };

  const conn = await getConnection(storeKey);
  const token = conn?.refreshToken || ENV_FALLBACK[storeKey];

  const adsCurrency  = { luhvia: 'EUR', cecole: 'EUR', luvande: 'EUR', modemeister: 'EUR' }[storeKey];
  const shopCurrency = STORES[storeKey].currency;
  const r2 = (v: number) => Math.round(v * 100) / 100;

  console.log(`[product-roas] ${storeKey}: token=${!!token} adsConfigured=${isAdsProductsConfigured(storeKey)}`);

  const [shopifyProducts, spendMap, revenues] = await Promise.all([
    fetchAllShopifyProducts(storeKey),
    token && isAdsProductsConfigured(storeKey)
      ? fetchProductSpendMap(storeKey, endDate, token, customRange, include90).catch(err => {
          console.error(`[product-roas] ${storeKey} ads spend failed:`, err.message);
          return {} as Record<string, SpendEntry>;
        })
      : Promise.resolve({} as Record<string, SpendEntry>),
    fetchProductRevenueByPeriod(storeKey, endDate, customRange, include90),
  ]);

  console.log(`[product-roas] ${storeKey}: shopify=${shopifyProducts.length} spendKeys=${Object.keys(spendMap).length}`);

  const revenueById = new Map(revenues.map(r => [r.productId, r]));

  // Build variant → product map from Shopify data we already have
  const variantToProduct = new Map<string, string>();
  const shopifyProductIds = new Set(shopifyProducts.map(p => p.id));
  for (const p of shopifyProducts) {
    for (const vid of p.variantIds) variantToProduct.set(vid, p.id);
  }

  // Merge spend from unmatched keys (variant IDs) into their parent product
  const resolvedSpendMap: Record<string, SpendEntry> = { ...spendMap };
  for (const [key, entry] of Object.entries(spendMap)) {
    if (!shopifyProductIds.has(key)) {
      const productId = variantToProduct.get(key);
      if (productId) {
        const existing = resolvedSpendMap[productId];
        resolvedSpendMap[productId] = existing ? mergeSpendEntries(existing, entry) : entry;
        delete resolvedSpendMap[key];
      }
    }
  }

  const buildPeriod = (
    spend: ProductPeriodMetrics,
    shopifyRev: number,
  ): ProductPeriodMetrics => {
    const s = spend.spend;
    return {
      spend:       r2(spend.spend),
      revenue:     r2(shopifyRev),
      adsRevenue:  r2(spend.revenue), // Google Ads conversion value
      conversions: spend.conversions,
      clicks:      spend.clicks,
      impressions: spend.impressions,
      roas:        s > 0 ? r2(shopifyRev / s) : 0,
      ctr:         spend.ctr,
      cpc:         r2(spend.cpc),
      cpa:         r2(spend.cpa),
    };
  };

  const products: ProductRoas[] = shopifyProducts.map(p => {
    const s = resolvedSpendMap[p.id];
    const rev = revenueById.get(p.id);

    return {
      productId:    p.id,
      title:        p.title,
      currency:     shopCurrency,
      store:        storeKey,
      status:       p.status,
      variantCount: p.variantCount,
      imageUrl:     p.imageUrl,
      brandName:    p.brandName,
      activeDays:   p.publishedAt ? Math.floor((Date.now() - new Date(p.publishedAt).getTime()) / 86400000) : undefined,
      d90: include90 ? buildPeriod(s?.d90 ?? ZERO, rev?.d90 ?? 0) : ZERO,
      d30: buildPeriod(s?.d30 ?? ZERO, rev?.d30 ?? 0),
      d14: buildPeriod(s?.d14 ?? ZERO, rev?.d14 ?? 0),
      d7:  buildPeriod(s?.d7  ?? ZERO, rev?.d7  ?? 0),
      ...(customRange ? { custom: buildPeriod(s?.custom ?? ZERO, rev?.custom ?? 0) } : {}),
    };
  });

  // Total spend in raw spendMap (before Shopify join)
  const rawTotal = Object.values(spendMap).reduce((s, e) => s + e.d30.spend, 0);
  const matchedTotal = products.reduce((s, p) => s + p.d30.spend, 0);

  // Orphan spend: entries in resolvedSpendMap not matched to any Shopify product
  let orphanSpend = 0;
  for (const [key, entry] of Object.entries(resolvedSpendMap)) {
    if (!shopifyProductIds.has(key)) orphanSpend += entry.d30.spend;
  }
  console.log(`[product-roas] ${storeKey}: rawTotal=${rawTotal.toFixed(2)} matchedTotal=${matchedTotal.toFixed(2)} orphan=${orphanSpend.toFixed(2)}`);

  // Sort: products with spend first (by spend desc), then by revenue desc
  return {
    products: products.sort((a, b) => {
      if (b.d30.spend !== a.d30.spend) return b.d30.spend - a.d30.spend;
      return b.d30.revenue - a.d30.revenue;
    }),
    orphanSpend,
    store: storeKey,
    adsCurrency: adsCurrency!,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store     = searchParams.get('store') || 'all';
  const endDate   = searchParams.get('end') || new Date().toISOString().slice(0, 10);
  const customStart = searchParams.get('customStart') || '';
  const customEnd   = searchParams.get('customEnd')   || '';
  const customRange = DATE_RE.test(customStart) && DATE_RE.test(customEnd) && customStart <= customEnd
    ? { start: customStart, end: customEnd }
    : undefined;
  const include90 = searchParams.get('d90') === '1';

  const keys: AdsStoreKey[] = store === 'all'
    ? STORE_KEYS.filter(isShopifyConfigured)
    : (STORE_KEYS.includes(store as AdsStoreKey) ? [store as AdsStoreKey] : []);

  if (!keys.length) {
    return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
  }

  try {
    const toEur = await getEurConverter();
    const r2 = (v: number) => Math.round(v * 100) / 100;

    const perStore = await Promise.all(keys.map(k =>
      buildProductsForStore(k, endDate, customRange, include90).catch(err => {
        console.error(`[product-roas] ${k} failed:`, err.message);
        return { products: [] as ProductRoas[], orphanSpend: 0, store: k, adsCurrency: 'EUR' } as StoreResult;
      }),
    ));
    const allProducts = perStore.flatMap(r => r.products);

    // Convert currencies to EUR
    const convertPeriod = (m: ProductPeriodMetrics, adsCur: string, shopCur: string): ProductPeriodMetrics => {
      const spend   = r2(toEur(m.spend, adsCur));
      const revenue = r2(toEur(m.revenue, shopCur));
      return {
        spend,
        revenue,
        adsRevenue:  m.adsRevenue !== undefined ? r2(toEur(m.adsRevenue, adsCur)) : undefined,
        conversions: m.conversions,
        clicks:      m.clicks,
        impressions: m.impressions,
        roas:        spend > 0 ? r2(revenue / spend) : 0,
        ctr:         m.ctr,
        cpc:         r2(toEur(m.cpc, adsCur)),
        cpa:         r2(toEur(m.cpa, adsCur)),
      };
    };

    const ADS_CURRENCY: Record<AdsStoreKey, string> = { luhvia: 'EUR', cecole: 'EUR', luvande: 'EUR', modemeister: 'EUR' };

    const productsEur: ProductRoas[] = allProducts.map(p => {
      const adsCur  = ADS_CURRENCY[p.store as AdsStoreKey] ?? 'EUR';
      const shopCur = STORES[p.store as AdsStoreKey]?.currency ?? 'EUR';
      return {
        ...p,
        currency: 'EUR',
        d90: convertPeriod(p.d90, adsCur, shopCur),
        d30: convertPeriod(p.d30, adsCur, shopCur),
        d14: convertPeriod(p.d14, adsCur, shopCur),
        d7:  convertPeriod(p.d7,  adsCur, shopCur),
        ...(p.custom ? { custom: convertPeriod(p.custom, adsCur, shopCur) } : {}),
      };
    });

    // Orphan spend per store (in EUR), keyed by store name
    const orphanSpendEur: Record<string, number> = {};
    for (const r of perStore) {
      orphanSpendEur[r.store] = r2(toEur(r.orphanSpend, r.adsCurrency));
    }

    return NextResponse.json({ products: productsEur, orphanSpend: orphanSpendEur });
  } catch (err: any) {
    console.error('Product ROAS error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
