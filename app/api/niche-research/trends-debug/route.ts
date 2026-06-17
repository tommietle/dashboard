import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? 'festplatte';
  const geo = searchParams.get('geo') ?? 'DE';

  const exploreReq = JSON.stringify({
    comparisonItem: [{ keyword: q, geo, time: 'today 5-y' }],
    category: 0,
    property: '',
  });
  const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en&tz=-60&req=${encodeURIComponent(exploreReq)}`;

  try {
    const exploreRes = await fetch(exploreUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://trends.google.com/',
      },
      signal: AbortSignal.timeout(8000),
    });
    const status1 = exploreRes.status;
    const text1 = await exploreRes.text();

    if (!exploreRes.ok) {
      return NextResponse.json({ step: 'explore', status: status1, raw: text1.slice(0, 500) });
    }

    let exploreJson: any;
    try {
      exploreJson = JSON.parse(text1.replace(/^\)\]\}'\n/, ''));
    } catch (e: any) {
      return NextResponse.json({ step: 'explore_parse', status: status1, raw: text1.slice(0, 500), parseError: e.message });
    }

    const widgets: any[] = exploreJson.widgets ?? [];
    const tsWidget = widgets.find((w: any) => w.id === 'TIMESERIES');

    if (!tsWidget?.token) {
      return NextResponse.json({ step: 'no_token', widgetIds: widgets.map((w: any) => w.id), raw: text1.slice(0, 1000) });
    }

    const multilineReq = JSON.stringify(tsWidget.request);
    const multilineUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en&tz=-60&req=${encodeURIComponent(multilineReq)}&token=${encodeURIComponent(tsWidget.token)}`;

    const multilineRes = await fetch(multilineUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://trends.google.com/',
      },
      signal: AbortSignal.timeout(8000),
    });
    const status2 = multilineRes.status;
    const text2 = await multilineRes.text();

    if (!multilineRes.ok) {
      return NextResponse.json({ step: 'multiline', status: status2, raw: text2.slice(0, 500) });
    }

    let multilineJson: any;
    try {
      multilineJson = JSON.parse(text2.replace(/^\)\]\}'\n/, ''));
    } catch (e: any) {
      return NextResponse.json({ step: 'multiline_parse', status: status2, raw: text2.slice(0, 500), parseError: e.message });
    }

    const timelineData: any[] = multilineJson.default?.timelineData ?? [];
    return NextResponse.json({
      step: 'ok',
      token: tsWidget.token.slice(0, 20) + '...',
      pointCount: timelineData.length,
      sample: timelineData.slice(0, 3),
    });
  } catch (err: any) {
    return NextResponse.json({ step: 'catch', error: err.message });
  }
}
