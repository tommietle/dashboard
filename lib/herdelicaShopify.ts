const API_VERSION = '2024-10';

type CachedToken = { token: string; expiresAt: number };
let tokenCache: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const store = process.env.HERDELICA_SHOPIFY_STORE;
  const clientId = process.env.HERDELICA_SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.HERDELICA_SHOPIFY_CLIENT_SECRET;

  if (!store || !clientId || !clientSecret) {
    throw new Error('Herdelica Shopify env vars missing (HERDELICA_SHOPIFY_STORE / CLIENT_ID / CLIENT_SECRET).');
  }

  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Herdelica token request failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

async function shopifyFetch(endpoint: string): Promise<Response> {
  const store = process.env.HERDELICA_SHOPIFY_STORE!;
  const token = await getAccessToken();
  return fetch(`https://${store}/admin/api/${API_VERSION}/${endpoint}`, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  orders: number;
}

export async function fetchHerdelicaDailyRevenue(
  startDate: string,
  endDate: string
): Promise<DailyRevenue[]> {
  const allOrders: Array<{ created_at: string; total_price: string }> = [];
  let pageInfo: string | null = null;
  let isFirst = true;

  while (true) {
    let endpoint: string;
    if (isFirst) {
      endpoint = `orders.json?status=any&financial_status=paid&created_at_min=${startDate}T00:00:00&created_at_max=${endDate}T23:59:59&limit=250&fields=id,created_at,total_price,currency`;
      isFirst = false;
    } else if (pageInfo) {
      endpoint = `orders.json?page_info=${pageInfo}&limit=250&fields=id,created_at,total_price,currency`;
    } else {
      break;
    }

    const res = await shopifyFetch(endpoint);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Herdelica orders fetch failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as { orders: Array<{ created_at: string; total_price: string }> };
    allOrders.push(...(data.orders || []));

    const linkHeader = res.headers.get('Link');
    const nextMatch = linkHeader?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
    if (!pageInfo) break;
  }

  const dailyMap = new Map<string, { revenue: number; orders: number }>();
  for (const order of allOrders) {
    const date = order.created_at.slice(0, 10);
    const price = parseFloat(order.total_price || '0');
    const existing = dailyMap.get(date) || { revenue: 0, orders: 0 };
    dailyMap.set(date, { revenue: existing.revenue + price, orders: existing.orders + 1 });
  }

  return Array.from(dailyMap.entries())
    .map(([date, d]) => ({ date, revenue: Math.round(d.revenue * 100) / 100, orders: d.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
