import { NextRequest, NextResponse } from 'next/server';

const STORES = ['luhvia', 'cecole', 'luvande', 'modemeister'];

// Start de Google OAuth-flow voor één store. Stuurt de gebruiker naar Google,
// waar die inlogt met het account dat toegang heeft tot de webshop.
export async function GET(req: NextRequest) {
  const store = req.nextUrl.searchParams.get('store') || '';
  if (!STORES.includes(store)) {
    return NextResponse.json({ error: 'Onbekende store' }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'GOOGLE_ADS_CLIENT_ID ontbreekt in .env.local' },
      { status: 500 }
    );
  }

  const redirectUri = `${req.nextUrl.origin}/api/google-ads/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/adwords',
    access_type: 'offline',
    // select_account: altijd de accountkiezer tonen. consent: forceer refresh token.
    prompt: 'consent select_account',
    state: store,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
