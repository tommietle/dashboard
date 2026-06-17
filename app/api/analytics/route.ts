import { NextRequest, NextResponse } from 'next/server';
import { fetchGA4Metrics } from '@/lib/googleAnalytics';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const store     = searchParams.get('store') || 'all';
  const startDate = searchParams.get('start') || daysAgo(29);
  const endDate   = searchParams.get('end')   || today();

  try {
    if (store === 'all') {
      const [luhvia, cecole, luvande, modemeister] = await Promise.all([
        fetchGA4Metrics('luhvia',      startDate, endDate),
        fetchGA4Metrics('cecole',      startDate, endDate),
        fetchGA4Metrics('luvande',     startDate, endDate),
        fetchGA4Metrics('modemeister', startDate, endDate),
      ]);
      return NextResponse.json({ analytics: [luhvia, cecole, luvande, modemeister] });
    } else if (store === 'luhvia' || store === 'cecole' || store === 'luvande' || store === 'modemeister') {
      const data = await fetchGA4Metrics(store, startDate, endDate);
      return NextResponse.json({ analytics: [data] });
    } else {
      return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('GA4 error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
