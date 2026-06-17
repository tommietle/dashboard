import { cached } from './cache';

export type StoreKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister' | 'all';

const SHOPIFY_TIMEZONE = 'Europe/Amsterdam';

// Returns a Shopify-API-compatible datetime string like "2026-05-10T00:00:00+02:00"
// so that day boundaries match the store's local timezone (Amsterdam).
export function shopifyTzParam(dateStr: string, isEnd: boolean): string {
  const timeStr = isEnd ? '23:59:59' : '00:00:00';
  // Use noon on the target date as reference to avoid DST-boundary edge cases.
  const ref = new Date(`${dateStr}T12:00:00Z`);

  const fmt = (tz: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(ref);

  const parseMs = (s: string): number => {
    const m = s.match(/(\d+)\/(\d+)\/(\d+),\s+(\d+):(\d+):(\d+)/);
    if (!m) return 0;
    return new Date(`${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:${m[6]}Z`).getTime();
  };

  const offsetMin = (parseMs(fmt(SHOPIFY_TIMEZONE)) - parseMs(fmt('UTC'))) / 60_000;
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs  = Math.abs(offsetMin);
  const hh   = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm   = String(abs % 60).padStart(2, '0');
  return `${dateStr}T${timeStr}${sign}${hh}:${mm}`;
}
type ShopKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

const STORES = {
  luhvia: {
    name: 'Luhvia',
    currency: 'USD',
    flag: '🇺🇸',
    store: process.env.LUHVIA_SHOPIFY_STORE!,
    token: process.env.LUHVIA_SHOPIFY_TOKEN!,
  },
  cecole: {
    name: 'Cecole',
    currency: 'CAD',
    flag: '🇨🇦',
    store: process.env.CECOLE_SHOPIFY_STORE!,
    token: process.env.CECOLE_SHOPIFY_TOKEN!,
  },
  luvande: {
    name: 'Luvande',
    currency: 'CHF',
    flag: '🇬🇧',
    store: process.env.LUVANDE_SHOPIFY_STORE!,
    token: process.env.LUVANDE_SHOPIFY_TOKEN!,
  },
  modemeister: {
    name: 'Modemeister',
    currency: 'EUR',
    flag: '🇵🇱',
    store: process.env.MODEMEISTER_SHOPIFY_STORE!,
    token: process.env.MODEMEISTER_SHOPIFY_TOKEN!,
  },
};

export type StoreConfig = typeof STORES.luhvia;
export { STORES };

// Dev dashboard (post-jan-2026) custom apps geven access tokens via
// client_credentials grant. Die vervallen na ~24u, dus we ruilen on-demand
// CLIENT_ID + CLIENT_SECRET in voor een access token en cachen die in geheugen.
const SHOPIFY_CLIENT_AUTH: Record<ShopKey, { clientId?: string; clientSecret?: string }> = {
  luhvia:  { clientId: process.env.LUHVIA_SHOPIFY_CLIENT_ID,  clientSecret: process.env.LUHVIA_SHOPIFY_CLIENT_SECRET },
  cecole:  { clientId: process.env.CECOLE_SHOPIFY_CLIENT_ID,  clientSecret: process.env.CECOLE_SHOPIFY_CLIENT_SECRET },
  luvande:     { clientId: process.env.LUVANDE_SHOPIFY_CLIENT_ID,     clientSecret: process.env.LUVANDE_SHOPIFY_CLIENT_SECRET },
  modemeister: { clientId: process.env.MODEMEISTER_SHOPIFY_CLIENT_ID, clientSecret: process.env.MODEMEISTER_SHOPIFY_CLIENT_SECRET },
};

const tokenCache = new Map<ShopKey, { token: string; expiresAt: number }>();

export async function getShopifyAccessToken(storeKey: ShopKey): Promise<string> {
  const cfg = STORES[storeKey];
  const auth = SHOPIFY_CLIENT_AUTH[storeKey];

  if (auth.clientId && auth.clientSecret && cfg.store) {
    const cached = tokenCache.get(storeKey);
    if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
      return cached.token;
    }
    const res = await fetch(`https://${cfg.store}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify token exchange ${storeKey}: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const token = data.access_token as string;
    const ttlMs = (data.expires_in ?? 86400) * 1000;
    tokenCache.set(storeKey, { token, expiresAt: Date.now() + ttlMs });
    return token;
  }

  if (cfg.token) return cfg.token;
  throw new Error(`Geen Shopify auth ingesteld voor ${storeKey}.`);
}

export function isShopifyConfigured(storeKey: ShopKey): boolean {
  const cfg = STORES[storeKey];
  const auth = SHOPIFY_CLIENT_AUTH[storeKey];
  return !!cfg.store && (!!cfg.token || !!(auth.clientId && auth.clientSecret));
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  orders: number;
}

export interface StoreMetrics {
  store: StoreKey;
  storeName: string;
  currency: string;
  flag: string;
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  dailyData: DailyRevenue[];
}

async function shopifyRequest(storeKey: ShopKey, endpoint: string) {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);
  const url = `https://${cfg.store}/admin/api/2024-04/${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Shopify ${storeKey} error: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchStoreMetrics(
  storeKey: ShopKey,
  startDate: string,
  endDate: string
): Promise<StoreMetrics> {
  return cached(
    `shopify:metrics:v5:${storeKey}:${startDate}:${endDate}`,
    600,
    () => fetchStoreMetricsUncached(storeKey, startDate, endDate),
  );
}

async function fetchStoreMetricsUncached(
  storeKey: ShopKey,
  startDate: string,
  endDate: string,
): Promise<StoreMetrics> {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);
  const allOrders: any[] = [];
  let pageInfo: string | null = null;
  let isFirst = true;

  while (true) {
    let endpoint: string;
    if (isFirst) {
      endpoint = `orders.json?status=any&financial_status=any&created_at_min=${startDate}T00:00:00&created_at_max=${endDate}T23:59:59&limit=250&fields=id,created_at,financial_status,current_total_price_set,currency`;
      isFirst = false;
    } else if (pageInfo) {
      endpoint = `orders.json?page_info=${pageInfo}&limit=250&fields=id,created_at,financial_status,current_total_price_set,currency`;
    } else {
      break;
    }

    const url = `https://${cfg.store}/admin/api/2024-04/${endpoint}`;
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`Shopify ${storeKey}: ${res.status}`);

    const data = await res.json();
    allOrders.push(...(data.orders || []));

    const linkHeader = res.headers.get('Link');
    const nextMatch = linkHeader?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
    if (!pageInfo) break;
  }

  const dailyMap = new Map<string, { revenue: number; orders: number }>();
  let totalRevenue = 0;

  for (const order of allOrders) {
    const fs = order.financial_status;
    if (fs !== 'paid' && fs !== 'partially_refunded') continue;
    const date = order.created_at.slice(0, 10);
    // current_total_price_set reflects net revenue after any refunds applied
    const price = parseFloat(order.current_total_price_set?.shop_money?.amount ?? '0');
    totalRevenue += price;
    const existing = dailyMap.get(date) || { revenue: 0, orders: 0 };
    dailyMap.set(date, { revenue: existing.revenue + price, orders: existing.orders + 1 });
  }

  const dailyData: DailyRevenue[] = Array.from(dailyMap.entries())
    .map(([date, d]) => ({ date, revenue: Math.round(d.revenue * 100) / 100, orders: d.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    store: storeKey,
    storeName: cfg.name,
    currency: cfg.currency,
    flag: cfg.flag,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalOrders: allOrders.length,
    averageOrderValue: allOrders.length > 0 ? Math.round((totalRevenue / allOrders.length) * 100) / 100 : 0,
    dailyData,
  };
}
