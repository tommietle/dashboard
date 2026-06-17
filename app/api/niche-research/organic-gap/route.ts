import { NextRequest, NextResponse } from 'next/server';
import { GEO_OPTIONS, fetchOrganicGap } from '@/lib/nicheResearch';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get('keyword')?.trim();
  const geoId = searchParams.get('geo');

  if (!keyword || !geoId) {
    return NextResponse.json({ error: 'Missing keyword or geo' }, { status: 400 });
  }

  const geo = GEO_OPTIONS.find(g => g.geoId === geoId);
  if (!geo) return NextResponse.json({ error: 'Unknown geo' }, { status: 400 });

  const result = await fetchOrganicGap(keyword, geo.countryCode);
  return NextResponse.json({ ...result });
}
