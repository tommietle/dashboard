import { NextRequest, NextResponse } from 'next/server';
import { GEO_OPTIONS, translateKeyword, fetchGoogleTrends } from '@/lib/nicheResearch';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const niche = searchParams.get('niche')?.trim();
  const geoId = searchParams.get('geo');
  const languageId = searchParams.get('lang') ?? '1000';

  if (!niche || !geoId) {
    return NextResponse.json({ error: 'Missing niche or geo' }, { status: 400 });
  }

  const geo = GEO_OPTIONS.find(g => g.geoId === geoId);
  if (!geo) return NextResponse.json({ error: 'Onbekende geo' }, { status: 400 });

  const translated = await translateKeyword(niche, languageId);
  const data = await fetchGoogleTrends(translated, geo.countryCode);

  return NextResponse.json({ keyword: translated, geo: geo.label, countryCode: geo.countryCode, data });
}
