import { NextRequest, NextResponse } from 'next/server';

// Try to extract result count from Google Shopping HTML
async function scrapeGoogleShoppingCount(q: string, gl: string, hl: string): Promise<{ count: number | null; raw: string | null; status: number }> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=shop&gl=${gl}&hl=${hl}&num=10`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': `${hl},en;q=0.8`,
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    const html = await res.text();

    // Scan for result count patterns across multiple languages
    const patterns: [RegExp, number][] = [
      [/([0-9][0-9\s\.,]+)\s*Ergebnisse/i, 1],          // German
      [/Mehr als\s+([0-9][0-9\.,\s]+)\s*Ergebnisse/i, 1],
      [/Ca\.\s*([0-9][0-9\.,]+)\s*Ergebnisse/i, 1],
      [/([0-9][0-9\s\.,]+)\s*resultaten/i, 1],            // Dutch
      [/Meer dan\s+([0-9][0-9\.,]+)\s*resultaten/i, 1],
      [/About\s+([0-9][0-9,\.]+)\s*results/i, 1],         // English
      [/Approximately\s+([0-9][0-9,\.]+)\s*results/i, 1],
      [/([0-9][0-9,\.]+)\s*results/i, 1],
      [/Environ\s+([0-9][0-9\s]+)\s*résultats/i, 1],      // French
      [/([0-9][0-9\s]+)\s*résultats/i, 1],
      [/([0-9][0-9\s\.]+)\s*risultati/i, 1],              // Italian
      [/([0-9][0-9\s\.]+)\s*resultados/i, 1],             // Spanish
      [/Ungefär\s+([0-9][0-9\s]+)\s*resultat/i, 1],       // Swedish
      [/"totalResults":"([0-9]+)"/i, 1],                   // JSON embedded
      [/data-count="([0-9]+)"/i, 1],
    ];

    for (const [pattern] of patterns) {
      const match = html.match(pattern);
      if (match) {
        const numStr = match[1].replace(/[\s\.,]/g, '').replace(/[^0-9]/g, '');
        const num = parseInt(numStr);
        if (!isNaN(num) && num > 0) {
          return { count: num, raw: match[0], status: res.status };
        }
      }
    }
    // Return a snippet of HTML for debugging if no pattern matched
    const snippet = html.slice(0, 2000);
    return { count: null, raw: snippet, status: res.status };
  } catch (err: any) {
    return { count: null, raw: err.message, status: 0 };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? 'external hard drive';
  const gl = searchParams.get('gl') ?? 'us';
  const hl = searchParams.get('hl') ?? 'en';
  const apiKey = process.env.SERPAPI_KEY;

  const [scrapeResult, valueserp] = await Promise.allSettled([
    scrapeGoogleShoppingCount(q, gl, hl),
    apiKey
      ? fetch(`https://serpapi.com/search?${new URLSearchParams({ api_key: apiKey, engine: 'google_shopping', q, gl, hl })}`, { signal: AbortSignal.timeout(12000) }).then(r => r.json())
      : Promise.resolve(null),
  ]);

  const scrape = scrapeResult.status === 'fulfilled' ? scrapeResult.value : { count: null, raw: 'error', status: 0 };
  const vs = valueserp.status === 'fulfilled' ? valueserp.value : null;

  return NextResponse.json({
    scrape_count: scrape.count,
    scrape_status: scrape.status,
    serpapi_error: vs?.error ?? null,
    serpapi_total: vs?.search_information?.total_results ?? null,
    serpapi_shopping_count: (vs?.shopping_results ?? []).length,
    serpapi_first_result_keys: vs?.shopping_results?.[0] ? Object.keys(vs.shopping_results[0]).join(',') : null,
    serpapi_first_source: vs?.shopping_results?.[0]?.source ?? null,
  });
}
