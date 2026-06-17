import { NextResponse } from 'next/server';
import { fetchHerdelicaDailyRevenue } from '@/lib/herdelicaShopify';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start') ?? '2026-05-01';
  const end = url.searchParams.get('end') ?? new Date().toISOString().slice(0, 10);

  try {
    const daily = await fetchHerdelicaDailyRevenue(start, end);
    const totalRevenue = daily.reduce((sum, d) => sum + d.revenue, 0);
    const totalOrders = daily.reduce((sum, d) => sum + d.orders, 0);
    return NextResponse.json({
      ok: true,
      range: { start, end },
      totals: { revenue: Math.round(totalRevenue * 100) / 100, orders: totalOrders },
      daily,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
