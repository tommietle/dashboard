import { NextRequest, NextResponse } from 'next/server';
import { researchNiche, researchNicheGlobal, GEO_OPTIONS } from '@/lib/nicheResearch';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const niche = searchParams.get('niche')?.trim();
  const mode = searchParams.get('mode');

  if (!niche) {
    return NextResponse.json({ error: 'Geef een niche op via ?niche=...' }, { status: 400 });
  }

  try {
    if (mode === 'global') {
      const result = await researchNicheGlobal(niche);
      return NextResponse.json(result);
    }

    const geoId = searchParams.get('geo') || '2528';
    const languageId = searchParams.get('lang') || '1010';

    if (!GEO_OPTIONS.find(g => g.geoId === geoId && g.languageId === languageId)) {
      return NextResponse.json({ error: 'Ongeldige geo/taal combinatie.' }, { status: 400 });
    }

    const result = await researchNiche(niche, geoId, languageId);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Niche research error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
