import { NextRequest, NextResponse } from 'next/server';
import { GEO_OPTIONS, translateKeyword, fetchExactShoppingAdsCount, fetchMultiKeywordShoppingAds } from '@/lib/nicheResearch';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const geoId = searchParams.get('geo');
  const languageId = searchParams.get('lang') ?? '1000';
  const directKeyword = searchParams.get('keyword')?.trim();
  const niche = searchParams.get('niche')?.trim();
  const multiKeywords = searchParams.get('keywords')?.trim(); // comma-separated list

  if (!geoId || (!directKeyword && !niche && !multiKeywords)) {
    return NextResponse.json({ error: 'Missing geo and keyword/niche' }, { status: 400 });
  }

  const geo = GEO_OPTIONS.find(g => g.geoId === geoId);
  if (!geo) return NextResponse.json({ error: 'Onbekende geo' }, { status: 400 });

  const geoOptions = { geoId: geo.geoId, languageId };

  if (multiKeywords) {
    const keywords = multiKeywords.split(',').map(k => k.trim()).filter(Boolean).slice(0, 8);
    const { count, countIsExact, uniqueAdvertisers, merchants, debug } = await fetchMultiKeywordShoppingAds(keywords, geo.countryCode, geoOptions);
    return NextResponse.json({ count, countIsExact, uniqueAdvertisers, merchants, keywords, geo: geo.label, debug });
  }

  const keyword = directKeyword ?? await translateKeyword(niche!, languageId);
  const { count, countIsExact, uniqueAdvertisers, merchants, debug } = await fetchExactShoppingAdsCount(keyword, geo.countryCode, geoOptions);
  return NextResponse.json({ count, countIsExact, uniqueAdvertisers, merchants, keyword, geo: geo.label, debug });
}
