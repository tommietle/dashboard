import { ProductRoas, ProductPeriodMetrics } from './googleAdsProducts';

function period(spend: number, roas: number, imp: number): ProductPeriodMetrics {
  const revenue     = Math.round(spend * roas * 100) / 100;
  const conversions = Math.round((revenue / 52) * 10) / 10;
  const clicks      = Math.round(imp * 0.018);
  const ctr         = Math.round((clicks / imp) * 10000) / 100;
  const cpc         = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
  const cpa         = conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0;
  return { spend, revenue, conversions, clicks, impressions: imp, roas, ctr, cpc, cpa };
}

function product(
  store: 'luhvia' | 'cecole',
  currency: string,
  productId: string,
  title: string,
  status: 'active' | 'archived',
  variants: number,
  spend30: number, roas30: number, imp30: number,
  roas14: number,
  roas7: number,
): ProductRoas {
  const imp90 = Math.round(imp30 * 3);
  const imp14 = Math.round(imp30 * 0.46);
  const imp7  = Math.round(imp30 * 0.22);
  return {
    productId,
    title,
    currency,
    store,
    status,
    variantCount: variants,
    d90: period(Math.round(spend30 * 3 * 100) / 100,    roas30, imp90),
    d30: period(spend30,                                 roas30, imp30),
    d14: period(Math.round(spend30 * 0.46 * 100) / 100, roas14, imp14),
    d7:  period(Math.round(spend30 * 0.22 * 100) / 100, roas7,  imp7),
  };
}

export const MOCK_PRODUCTS_LUHVIA: ProductRoas[] = [
  product('luhvia','USD','8812341001','Silk Satin Slip Dress',      'active',  32, 969,  5.8,  48_200, 6.2, 4.9),
  product('luhvia','USD','8812341002','Linen Wide-Leg Trousers',    'active',  25, 638,  4.4,  117_900, 3.9, 5.1),
  product('luhvia','USD','8812341003','Ribbed Knit Bodysuit',       'active',  12, 517,  1.2,  71_280, 1.5, 1.1),
  product('luhvia','USD','8812341004','Wedge Sandals with Thong',   'archived',15, 225,  0.0,  30_182,  0.0, 0.0),
  product('luhvia','USD','8812341005','Fit and Flare Woven Mini D.','archived', 8, 195,  0.7,  29_917, 0.3, 0.2),
  product('luhvia','USD','8812341006','Bodycon Mini Dress – Cors.', 'active',  30, 149,  5.1,  37_208, 4.9, 5.1),
  product('luhvia','USD','8812341007','Fit-and-Flare Midi Dress',   'archived',18, 134,  0.0,  16_476, 0.6, 0.0),
  product('luhvia','USD','8812341008','Wide Leg Denim Jeans',       'archived', 6, 103,  0.0,  54_686, 0.0, 0.0),
  product('luhvia','USD','8812341009','Fitted Satin Maxi Dress',    'active',  20,  84,  4.5,  10_542, 3.6, 4.5),
  product('luhvia','USD','8812341010','Draped Neck Sleeveless Pl.', 'active',   6,  76,  2.4,  13_328, 2.4, 2.4),
  product('luhvia','USD','8812341011',"Men's Wind-Resist Jacket",   'active',  48,  68,  1.6,   5_974, 1.2, 1.3),
  product('luhvia','USD','8812341012','Linen Summer Shirt',         'active',  45,  67,  1.6,   2_480, 1.6, 2.0),
];

export const MOCK_PRODUCTS_CECOLE: ProductRoas[] = [
  product('cecole','CAD','9923450001','Merino Wool Cardigan',       'active',  28, 842,  4.7,  62_100, 5.1, 4.2),
  product('cecole','CAD','9923450002','Tailored Wool Coat',         'active',  14, 610,  3.8,  44_800, 3.5, 4.3),
  product('cecole','CAD','9923450003','Leather Crossbody Bag',      'active',   8, 530,  6.3,  38_500, 6.8, 5.7),
  product('cecole','CAD','9923450004','Knit Turtleneck Dress',      'archived',22, 380,  0.8,  29_300, 0.5, 1.1),
  product('cecole','CAD','9923450005','Straight-Leg Jeans',         'active',  18, 310,  1.4,  55_700, 1.8, 0.8),
  product('cecole','CAD','9923450006','Quilted Puffer Vest',        'active',  10, 265,  4.2,  21_400, 4.6, 3.9),
  product('cecole','CAD','9923450007','Suede Chelsea Boots',        'active',   6, 195,  5.0,  15_800, 5.4, 4.6),
  product('cecole','CAD','9923450008','Ribbed Tank Top 3-Pack',     'active',   9, 148,  3.5,  19_200, 3.1, 3.9),
  product('cecole','CAD','9923450009','Wide Brim Felt Hat',         'archived', 4, 112,  0.6,  12_100, 0.9, 0.4),
  product('cecole','CAD','9923450010','Satin Pyjama Set',           'active',  12,  98,  2.8,   9_800, 3.2, 2.4),
];

export function getMockProducts(store: string): ProductRoas[] {
  if (store === 'luhvia') return MOCK_PRODUCTS_LUHVIA;
  if (store === 'cecole') return MOCK_PRODUCTS_CECOLE;
  return [...MOCK_PRODUCTS_LUHVIA, ...MOCK_PRODUCTS_CECOLE];
}
