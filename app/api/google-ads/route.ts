import { NextRequest, NextResponse } from 'next/server';
import { fetchAdsMetrics, AdsStoreKey, isAdsConfigured } from '@/lib/googleAds';
import { getConnection } from '@/lib/adsConnections';

// Optionele terugval op .env.local; normaal komt de token uit de koppeling.
// GOOGLE_ADS_REFRESH_TOKEN is de generieke fallback als er geen per-store token is.
const _generic = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const ENV_FALLBACK: Record<AdsStoreKey, string | undefined> = {
  luhvia:      process.env.LUHVIA_GOOGLE_ADS_REFRESH_TOKEN      || _generic,
  cecole:      process.env.CECOLE_GOOGLE_ADS_REFRESH_TOKEN      || _generic,
  luvande:     process.env.LUVANDE_GOOGLE_ADS_REFRESH_TOKEN     || _generic,
  modemeister: process.env.MODEMEISTER_GOOGLE_ADS_REFRESH_TOKEN || _generic,
};

async function metricsFor(store: AdsStoreKey, start: string, end: string) {
  const conn = await getConnection(store);
  const token = conn?.refreshToken || ENV_FALLBACK[store];
  if (!token) {
    throw new Error(
      `${store} is nog niet gekoppeld. Ga naar Instellingen en verbind het Google Ads-account.`
    );
  }
  return fetchAdsMetrics(store, start, end, token);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store = searchParams.get('store') || 'all';
  const startDate = searchParams.get('start') || getDefaultStart();
  const endDate = searchParams.get('end') || getDefaultEnd();

  try {
    if (store === 'all') {
      const keys: AdsStoreKey[] = (['luhvia', 'cecole', 'luvande', 'modemeister'] as AdsStoreKey[]).filter(isAdsConfigured);
      const ads = await Promise.all(keys.map(k => metricsFor(k, startDate, endDate)));
      return NextResponse.json({ ads });
    } else if (store === 'luhvia' || store === 'cecole' || store === 'luvande' || store === 'modemeister') {
      if (!isAdsConfigured(store)) {
        return NextResponse.json({ error: `Geen Google Ads customer-ID ingesteld voor ${store}.` }, { status: 400 });
      }
      const data = await metricsFor(store, startDate, endDate);
      return NextResponse.json({ ads: [data] });
    } else {
      return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Google Ads error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function getDefaultStart() {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

function getDefaultEnd() {
  return new Date().toISOString().slice(0, 10);
}
