import { NextRequest, NextResponse } from 'next/server';
import { saveConnection, getConnection } from '@/lib/adsConnections';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const store = params.get('state') || '';
  const oauthError = params.get('error');
  const settingsUrl = new URL('/settings', req.nextUrl.origin);

  if (oauthError) {
    settingsUrl.searchParams.set('error', oauthError);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code || (store !== 'luhvia' && store !== 'cecole' && store !== 'luvande' && store !== 'modemeister')) {
    settingsUrl.searchParams.set('error', 'missing_code');
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/google-ads/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const token = await tokenRes.json();

    // Als de code-exchange zelf mislukt (bijv. ongeldige code), stoppen we hier.
    if (token.error) {
      settingsUrl.searchParams.set('error', token.error);
      return NextResponse.redirect(settingsUrl);
    }

    // Google geeft soms geen nieuwe refresh_token als de grant nog actief is.
    // In dat geval hergebruiken we de bestaande opgeslagen token.
    let refreshToken: string | undefined = token.refresh_token;
    if (!refreshToken) {
      const existing = await getConnection(store);
      refreshToken = existing?.refreshToken || process.env.GOOGLE_ADS_REFRESH_TOKEN;
    }

    if (!refreshToken) {
      settingsUrl.searchParams.set('error', 'no_refresh_token');
      return NextResponse.redirect(settingsUrl);
    }

    // E-mail van de ingelogde Google-account ophalen (alleen voor weergave).
    let email: string | undefined;
    try {
      const info = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (info.ok) email = (await info.json()).email;
    } catch { /* niet kritiek */ }

    // Welke Google Ads-accounts ziet deze login?
    let accessibleCustomers: string[] | undefined;
    try {
      const list = await fetch(
        'https://googleads.googleapis.com/v24/customers:listAccessibleCustomers',
        {
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
          },
        }
      );
      if (list.ok) {
        const data = await list.json();
        accessibleCustomers = (data.resourceNames || []).map((r: string) =>
          r.replace('customers/', '')
        );
      }
    } catch { /* niet kritiek */ }

    await saveConnection({
      store,
      refreshToken,
      email,
      accessibleCustomers,
      connectedAt: new Date().toISOString(),
    });

    settingsUrl.searchParams.set('connected', store);
    return NextResponse.redirect(settingsUrl);
  } catch (err: any) {
    settingsUrl.searchParams.set('error', err.message || 'unknown');
    return NextResponse.redirect(settingsUrl);
  }
}
