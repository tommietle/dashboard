import { NextRequest, NextResponse } from 'next/server';
import { fetchChargebackCases } from '@/lib/chargebackCases';
import { isReamazeConfigured } from '@/lib/reamaze';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store = searchParams.get('store') || 'all';
  const currency = searchParams.get('currency') || 'all';
  const disposition = searchParams.get('disposition') || 'all';

  try {
    let cases = await fetchChargebackCases();
    if (store !== 'all') cases = cases.filter((c) => c.store === store);
    if (currency !== 'all') cases = cases.filter((c) => c.currency === currency);
    if (disposition !== 'all') cases = cases.filter((c) => c.disposition === disposition);
    return NextResponse.json({ reamazeLinked: isReamazeConfigured(), cases });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ cases: [], error: message }, { status: 500 });
  }
}
