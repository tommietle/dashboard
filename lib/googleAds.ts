import { cached } from './cache';

export type AdsStoreKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

// Per store een vast customer-ID en valuta. De refresh token (de Google-login)
// wordt apart aangeleverd door de aanroeper en komt uit de in-dashboard
// koppeling. Het account wordt direct uitgelezen, niet via de MCC.
const ADS_ACCOUNTS: Record<AdsStoreKey, { customerId: string; currency: string }> = {
  luhvia:      { customerId: process.env.LUHVIA_GOOGLE_ADS_CUSTOMER_ID      || '', currency: 'USD' },
  cecole:      { customerId: process.env.CECOLE_GOOGLE_ADS_CUSTOMER_ID      || '', currency: 'EUR' },
  luvande:     { customerId: process.env.LUVANDE_GOOGLE_ADS_CUSTOMER_ID     || '', currency: 'EUR' },
  modemeister: { customerId: process.env.MODEMEISTER_GOOGLE_ADS_CUSTOMER_ID || '', currency: 'EUR' },
};

export function isAdsConfigured(storeKey: AdsStoreKey): boolean {
  return !!ADS_ACCOUNTS[storeKey].customerId;
}

// In-memory token cache — overleeft meerdere requests op dezelfde warm instance.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(refreshToken: string): Promise<string> {
  const hit = tokenCache.get(refreshToken);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`OAuth token error: ${res.status}`);
  const data = await res.json();
  const token = data.access_token as string;
  tokenCache.set(refreshToken, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
  return token;
}

export interface AdsMetrics {
  store: AdsStoreKey;
  spend: number;
  conversionsValue: number;
  conversions: number;
  roas: number;
  cpa: number;
  currency: string;
}

export function fetchAdsMetrics(
  storeKey: AdsStoreKey,
  startDate: string,
  endDate: string,
  refreshToken: string
): Promise<AdsMetrics> {
  return cached(
    `google-ads:metrics:v2:${storeKey}:${startDate}:${endDate}`,
    600,
    () => fetchAdsMetricsUncached(storeKey, startDate, endDate, refreshToken),
  );
}

async function fetchAdsMetricsUncached(
  storeKey: AdsStoreKey,
  startDate: string,
  endDate: string,
  refreshToken: string
): Promise<AdsMetrics> {
  const account = ADS_ACCOUNTS[storeKey];
  if (!account.customerId) {
    throw new Error(`Geen Google Ads customer-ID ingesteld voor ${storeKey}.`);
  }

  const accessToken = await getAccessToken(refreshToken);
  const customerId = account.customerId.replace(/-/g, '');

  const query = `
    SELECT
      metrics.cost_micros,
      metrics.conversions_value,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Ads ${storeKey}: ${res.status} ${err}`);
  }

  const data = await res.json();
  const results: any[] = data.results || [];

  let totalCostMicros = 0;
  let totalConversionsValue = 0;
  let totalConversions = 0;

  for (const row of results) {
    totalCostMicros += Number(row.metrics?.costMicros ?? 0);
    totalConversionsValue += Number(row.metrics?.conversionsValue ?? 0);
    totalConversions += Number(row.metrics?.conversions ?? 0);
  }

  const spend = totalCostMicros / 1_000_000;
  const roas = spend > 0 ? totalConversionsValue / spend : 0;
  const cpa = totalConversions > 0 ? spend / totalConversions : 0;

  return {
    store: storeKey,
    spend: Math.round(spend * 100) / 100,
    conversionsValue: Math.round(totalConversionsValue * 100) / 100,
    conversions: Math.round(totalConversions * 100) / 100,
    roas: Math.round(roas * 100) / 100,
    cpa: Math.round(cpa * 100) / 100,
    currency: account.currency,
  };
}
