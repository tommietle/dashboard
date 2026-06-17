export type GA4StoreKey = 'luhvia' | 'cecole' | 'luvande';

const GA4_PROPERTIES: Record<GA4StoreKey, string> = {
  luhvia:  process.env.LUHVIA_GA4_PROPERTY_ID!,
  cecole:  process.env.CECOLE_GA4_PROPERTY_ID!,
  luvande: process.env.LUVANDE_GA4_PROPERTY_ID!,
};

async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN!,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`GA4 OAuth error: ${res.status}`);
  const json = await res.json();
  return json.access_token;
}

export interface GA4Metrics {
  store: GA4StoreKey;
  sessions: number;
  conversions: number;
  conversionRate: number; // percentage, e.g. 2.4
}

async function runReport(propertyId: string, token: string, startDate: string, endDate: string) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'conversions' },
          { name: 'sessionConversionRate' },
        ],
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 API error: ${res.status} ${err.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchGA4Metrics(
  storeKey: GA4StoreKey,
  startDate: string,
  endDate: string
): Promise<GA4Metrics> {
  const propertyId = GA4_PROPERTIES[storeKey];
  const token = await getAccessToken();
  const data = await runReport(propertyId, token, startDate, endDate);

  const row = data.rows?.[0]?.metricValues ?? [];
  const sessions       = Math.round(Number(row[0]?.value ?? 0));
  const conversions    = Math.round(Number(row[1]?.value ?? 0));
  const conversionRate = Math.round(Number(row[2]?.value ?? 0) * 10000) / 100; // 0.024 → 2.40

  return { store: storeKey, sessions, conversions, conversionRate };
}
