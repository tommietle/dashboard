import { NextResponse } from 'next/server';
import { checkAdvertorialHealth } from '@/lib/herdelicaAdvertorial';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rollback = url.searchParams.get('rollback') === '1';

  const cronSecret = process.env.CRON_SECRET;
  if (rollback && cronSecret) {
    const provided = url.searchParams.get('secret') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (provided !== cronSecret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await checkAdvertorialHealth({ rollback });
    return NextResponse.json(result, { status: result.identical || result.drift?.rolledBack ? 200 : 409 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
