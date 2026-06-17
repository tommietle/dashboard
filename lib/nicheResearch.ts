import { getConnection } from './adsConnections';

export const GEO_OPTIONS = [
  { label: 'Nederland',            geoId: '2528', languageId: '1010', flag: '🇳🇱', countryCode: 'NL' },
  { label: 'België (NL)',          geoId: '2056', languageId: '1010', flag: '🇧🇪', countryCode: 'BE' },
  { label: 'België (FR)',          geoId: '2056', languageId: '1002', flag: '🇧🇪', countryCode: 'BE' },
  { label: 'Duitsland',            geoId: '2276', languageId: '1001', flag: '🇩🇪', countryCode: 'DE' },
  { label: 'Verenigd Koninkrijk',  geoId: '2826', languageId: '1000', flag: '🇬🇧', countryCode: 'GB' },
  { label: 'Verenigde Staten',     geoId: '2840', languageId: '1000', flag: '🇺🇸', countryCode: 'US' },
  { label: 'Frankrijk',            geoId: '2250', languageId: '1002', flag: '🇫🇷', countryCode: 'FR' },
  { label: 'Italië',               geoId: '2380', languageId: '1004', flag: '🇮🇹', countryCode: 'IT' },
  { label: 'Spanje',               geoId: '2724', languageId: '1003', flag: '🇪🇸', countryCode: 'ES' },
  { label: 'Zweden',               geoId: '2752', languageId: '1015', flag: '🇸🇪', countryCode: 'SE' },
  { label: 'Noorwegen',            geoId: '2578', languageId: '1013', flag: '🇳🇴', countryCode: 'NO' },
  { label: 'Denemarken',           geoId: '2208', languageId: '1009', flag: '🇩🇰', countryCode: 'DK' },
  { label: 'Polen',                geoId: '2616', languageId: '1019', flag: '🇵🇱', countryCode: 'PL' },
  { label: 'Oostenrijk',           geoId: '2040', languageId: '1001', flag: '🇦🇹', countryCode: 'AT' },
  { label: 'Zwitserland',          geoId: '2756', languageId: '1001', flag: '🇨🇭', countryCode: 'CH' },
  { label: 'Ierland',              geoId: '2372', languageId: '1000', flag: '🇮🇪', countryCode: 'IE' },
  { label: 'Finland',              geoId: '2246', languageId: '1011', flag: '🇫🇮', countryCode: 'FI' },
  { label: 'Canada',               geoId: '2124', languageId: '1000', flag: '🇨🇦', countryCode: 'CA' },
  { label: 'Australië',            geoId: '2036', languageId: '1000', flag: '🇦🇺', countryCode: 'AU' },
  { label: 'Nieuw-Zeeland',        geoId: '2554', languageId: '1000', flag: '🇳🇿', countryCode: 'NZ' },
];

// Map Google Ads languageId → ISO language code
const LANG_CODE: Record<string, string> = {
  '1010': 'nl', '1001': 'de', '1000': 'en', '1002': 'fr',
  '1003': 'es', '1004': 'it', '1015': 'sv', '1013': 'no',
  '1009': 'da', '1019': 'pl', '1011': 'fi',
};

// Country code → ISO language (for buy-intent query variants)
const COUNTRY_LANG: Record<string, string> = {
  NL: 'nl', BE: 'nl', DE: 'de', AT: 'de', CH: 'de',
  GB: 'en', US: 'en', CA: 'en', AU: 'en', IE: 'en', NZ: 'en',
  FR: 'fr', IT: 'it', ES: 'es', SE: 'sv', NO: 'no',
  DK: 'da', PL: 'pl', FI: 'fi',
};

// Language-specific buy-intent suffixes
const BUY_TERMS: Record<string, string[]> = {
  nl: ['kopen', 'bestellen', 'goedkoop'],
  de: ['kaufen', 'bestellen', 'günstig'],
  en: ['buy', 'cheap', 'order online'],
  fr: ['acheter', 'pas cher', 'commander'],
  es: ['comprar', 'barato', 'precio'],
  it: ['comprare', 'economico', 'acquistare'],
  sv: ['köpa', 'billig', 'beställa'],
  no: ['kjøpe', 'billig', 'bestille'],
  da: ['købe', 'billig', 'bestille'],
  pl: ['kupić', 'tani', 'zamówić'],
  fi: ['ostaa', 'halpa', 'tilata'],
};

export async function translateKeyword(keyword: string, languageId: string): Promise<string> {
  const lang = LANG_CODE[languageId] ?? 'en';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return keyword;
    const data = await res.json();
    const translated = data?.[0]?.[0]?.[0] as string | undefined;
    return translated && translated.trim() ? translated.trim() : keyword;
  } catch {
    return keyword;
  }
}

const MONTH_NUM: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};
const MONTH_NL = ['', 'Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(refreshToken: string): Promise<string> {
  const hit = tokenCache.get(refreshToken);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`OAuth token fout: ${res.status}`);
  const data = await res.json();
  const token = data.access_token as string;
  tokenCache.set(refreshToken, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
  return token;
}

async function getCredentials(): Promise<{ customerId: string; refreshToken: string }> {
  const storeKeys = ['luvande', 'cecole', 'luhvia'];
  const envIds: Record<string, string | undefined> = {
    luvande: process.env.LUVANDE_GOOGLE_ADS_CUSTOMER_ID,
    cecole:  process.env.CECOLE_GOOGLE_ADS_CUSTOMER_ID,
    luhvia:  process.env.LUHVIA_GOOGLE_ADS_CUSTOMER_ID,
  };
  const envTokens: Record<string, string | undefined> = {
    luvande: process.env.LUVANDE_GOOGLE_ADS_REFRESH_TOKEN || process.env.GOOGLE_ADS_REFRESH_TOKEN,
    cecole:  process.env.CECOLE_GOOGLE_ADS_REFRESH_TOKEN  || process.env.GOOGLE_ADS_REFRESH_TOKEN,
    luhvia:  process.env.LUHVIA_GOOGLE_ADS_REFRESH_TOKEN  || process.env.GOOGLE_ADS_REFRESH_TOKEN,
  };

  for (const store of storeKeys) {
    const conn = await getConnection(store);
    const customerId = envIds[store];
    const refreshToken = conn?.refreshToken || envTokens[store];
    if (customerId && refreshToken) {
      return { customerId: customerId.replace(/-/g, ''), refreshToken };
    }
  }
  throw new Error('Geen Google Ads account gevonden. Koppel eerst een account via Instellingen.');
}

export interface MonthlyVolume {
  year: number;
  month: number; // 1-12
  searches: number;
}

export interface KeywordIdea {
  keyword: string;
  avgMonthlySearches: number;
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNSPECIFIED';
  competitionIndex: number;
  lowCpcEur: number;
  highCpcEur: number;
  avgCpcEur: number;
  shoppingCpcEur: number;
  monthlyVolumes: MonthlyVolume[];
}

export interface NicheSummary {
  totalSearchVolume: number;
  avgShoppingCpcEur: number;
  dominantCompetition: string;
  avgCompetitionIndex: number;
  opportunityScore: number;
  verdict: 'GO' | 'CONSIDER' | 'NO-GO';
  verdictReason: string;
  // Trend
  trendDirection: 'GROWING' | 'STABLE' | 'DECLINING';
  trendPercent: number;
  peakMonths: string[];
  monthlyVolumes: MonthlyVolume[];
  // Shopping advertisers
  shoppingAdvertiserCount: number | null;
}

export interface NicheResearchResult {
  niche: string;
  geo: string;
  keywords: KeywordIdea[];
  summary: NicheSummary;
}

export interface CountryResult {
  geo: string;
  geoId: string;
  languageId: string;
  flag: string;
  summary: NicheSummary;
  topKeyword: string;
  topVolume: number;
  topKeywords: string[]; // top 5 keyword strings for multi-variant shopping scan
}

export interface GlobalNicheResult {
  niche: string;
  countries: CountryResult[];
  bestCountry: CountryResult;
}

function toCompetition(raw: string): KeywordIdea['competition'] {
  if (raw === 'LOW' || raw === 'MEDIUM' || raw === 'HIGH') return raw;
  return 'UNSPECIFIED';
}

function calcTrend(volumes: MonthlyVolume[]): { direction: NicheSummary['trendDirection']; percent: number } {
  if (volumes.length < 6) return { direction: 'STABLE', percent: 0 };
  const sorted = [...volumes].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  const recent = sorted.slice(-3).reduce((s, v) => s + v.searches, 0) / 3;
  const prev   = sorted.slice(-6, -3).reduce((s, v) => s + v.searches, 0) / 3;
  if (prev === 0) return { direction: 'STABLE', percent: 0 };
  const pct = Math.round(((recent - prev) / prev) * 100);
  return { direction: pct >= 15 ? 'GROWING' : pct <= -15 ? 'DECLINING' : 'STABLE', percent: pct };
}

function aggregateMonthlyVolumes(keywords: KeywordIdea[]): MonthlyVolume[] {
  const map = new Map<string, MonthlyVolume>();
  for (const kw of keywords) {
    for (const mv of kw.monthlyVolumes) {
      const key = `${mv.year}-${mv.month}`;
      const existing = map.get(key);
      if (existing) existing.searches += mv.searches;
      else map.set(key, { ...mv });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}

function summarize(keywords: KeywordIdea[], shoppingAdvertiserCount: number | null = null): NicheSummary {
  if (!keywords.length) {
    return {
      totalSearchVolume: 0, avgShoppingCpcEur: 0, dominantCompetition: 'UNSPECIFIED',
      avgCompetitionIndex: 0,
      opportunityScore: 0, verdict: 'NO-GO', verdictReason: 'Geen keyword data beschikbaar.',
      trendDirection: 'STABLE', trendPercent: 0, peakMonths: [], monthlyVolumes: [],
      shoppingAdvertiserCount: null,
    };
  }

  const top = [...keywords].sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches).slice(0, 15);
  const totalVolume = top.reduce((s, k) => s + k.avgMonthlySearches, 0);
  const avgShoppingCpc = top.reduce((s, k) => s + k.shoppingCpcEur, 0) / top.length;

  const counts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, UNSPECIFIED: 0 };
  for (const k of top) counts[k.competition]++;
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const avgCompetitionIndex = Math.round(top.reduce((s, k) => s + k.competitionIndex, 0) / top.length);

  // --- Scoring voor fysiek dropshipping product €40–€150 ---

  // 1. Zoekvolume (50 punten) — primaire drijfveer
  let volScore: number;
  if      (totalVolume >= 50_000) volScore = 50;
  else if (totalVolume >= 15_000) volScore = 42;
  else if (totalVolume >= 5_000)  volScore = 32;
  else if (totalVolume >= 1_000)  volScore = 18;
  else if (totalVolume >= 200)    volScore = 8;
  else                            volScore = 2;

  // 2. Ads-competitie (30 punten) — gebaseerd op Google Ads competition enum (LOW/MEDIUM/HIGH)
  // LOW = weinig adverteerders = makkelijker in te stappen; HIGH = drukke markt
  let compScore: number;
  if      (dominant === 'LOW')         compScore = 28;
  else if (dominant === 'MEDIUM')      compScore = 20;
  else if (dominant === 'HIGH')        compScore = 10;
  else                                 compScore = 15; // UNSPECIFIED

  // 3. Shopping CPC (20 punten) — afgestemd op productprijzen €40–€150
  // Bij €80 product, 35% marge = €28, ROAS 3x → max €0.47/click haalbaar
  let cpcScore: number;
  if      (avgShoppingCpc >= 0.15 && avgShoppingCpc <= 0.70) cpcScore = 20;
  else if (avgShoppingCpc >  0.70 && avgShoppingCpc <= 1.30) cpcScore = 14;
  else if (avgShoppingCpc >  0.08 && avgShoppingCpc <  0.15) cpcScore = 8;
  else if (avgShoppingCpc >  1.30 && avgShoppingCpc <= 2.00) cpcScore = 6;
  else                                                        cpcScore = 2;

  const opportunityScore = Math.min(100, volScore + compScore + cpcScore);

  // Reden op basis van de zwakste schakel
  let verdict: NicheSummary['verdict'];
  let verdictReason: string;

  const volLabel  = totalVolume.toLocaleString('nl-NL');
  const cpcLabel  = `€${avgShoppingCpc.toFixed(2)}`;
  const compLabel = dominant === 'LOW' ? 'laag' : dominant === 'MEDIUM' ? 'gemiddeld' : dominant === 'HIGH' ? 'hoog' : 'onbekend';

  if (opportunityScore >= 65) {
    verdict = 'GO';
    verdictReason = `${volLabel} zoekopdrachten/mnd · ads-competitie ${compLabel} · Shopping CPC ${cpcLabel}. Voldoende vraag, haalbare concurrentie voor een nieuwkomer.`;
  } else if (opportunityScore >= 45) {
    const weakest = volScore < compScore && volScore < cpcScore ? `volume te laag (${volLabel}/mnd)`
      : compScore < cpcScore ? `ads-competitie ${compLabel} (veel adverteerders)`
      : `Shopping CPC ${cpcLabel} aan de hoge kant voor €40–€150`;
    verdict = 'CONSIDER';
    verdictReason = `Matig potentieel — ${weakest}. Onderzoek verder voor je stapt.`;
  } else {
    const reasons: string[] = [];
    if (volScore <= 8)   reasons.push(`te weinig zoekvolume (${volLabel}/mnd)`);
    if (compScore <= 10) reasons.push(`markt volledig gedomineerd door adverteerders (${compLabel})`);
    if (cpcScore <= 2)   reasons.push(`CPC onhaalbaar voor dit prijssegment (${cpcLabel})`);
    verdict = 'NO-GO';
    verdictReason = reasons.length ? reasons.join(' · ') : `Onvoldoende combinatie van volume, concurrentie en CPC.`;
  }

  // Trend from aggregated monthly volumes
  const monthlyVolumes = aggregateMonthlyVolumes(top);
  const { direction: trendDirection, percent: trendPercent } = calcTrend(monthlyVolumes);

  // Peak months: months with ≥85% of max volume
  const peakMonths: string[] = [];
  if (monthlyVolumes.length) {
    const maxVol = Math.max(...monthlyVolumes.map(v => v.searches));
    const threshold = maxVol * 0.85;
    for (const v of monthlyVolumes) {
      if (v.searches >= threshold) peakMonths.push(MONTH_NL[v.month]);
    }
  }

  return {
    totalSearchVolume: totalVolume,
    avgShoppingCpcEur: Math.round(avgShoppingCpc * 100) / 100,
    dominantCompetition: dominant,
    avgCompetitionIndex,
    opportunityScore,
    verdict,
    verdictReason,
    trendDirection,
    trendPercent,
    peakMonths,
    monthlyVolumes,
    shoppingAdvertiserCount,
  };
}

export interface TrendPoint {
  year: number;
  month: number;
  value: number; // 0-100 relative interest
}

const SERPAPI_MONTH: Record<string, number> = {
  Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
};

// Map GEO country code → Bing market code
const BING_MARKET: Record<string, string> = {
  NL: 'nl-NL', BE: 'nl-BE', DE: 'de-DE', GB: 'en-GB', US: 'en-US',
  FR: 'fr-FR', IT: 'it-IT', ES: 'es-ES', SE: 'sv-SE', NO: 'nb-NO',
  DK: 'da-DK', PL: 'pl-PL', AT: 'de-AT', CH: 'de-CH', IE: 'en-IE',
  FI: 'fi-FI', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ',
};

const BING_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.8',
};

const MERCHANT_NOISE = /gesponsord|gespons|sponsored|advertentie|leer hoe|choose ads|^learn/i;

async function scrapeShoppingMerchants(keyword: string, countryCode: string): Promise<{
  merchants: MerchantInfo[];
  count: number | null;
  countIsExact: boolean;
  debug?: string;
}> {
  const empty = { merchants: [], count: null, countIsExact: false };
  const mkt = BING_MARKET[countryCode.toUpperCase()] ?? 'en-US';
  const url = `https://www.bing.com/shop?q=${encodeURIComponent(keyword)}&mkt=${mkt}&count=30`;
  try {
    const res = await fetch(url, { headers: BING_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { ...empty, debug: `bing_http_${res.status}` };
    const html = await res.text();

    const seen = new Set<string>();
    const merchants: MerchantInfo[] = [];
    const pat = /class="[^"]*(?:seller|store|merchant|shop)[^"]*"[^>]*>([^<]{2,60})</gi;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(html)) !== null) {
      const name = m[1].trim();
      if (!name || seen.has(name) || MERCHANT_NOISE.test(name)) continue;
      seen.add(name);
      // Try to find the destination store URL from nearest preceding href
      let link: string | undefined;
      const before = html.slice(Math.max(0, m.index - 3000), m.index);
      const hrefMatches = [...before.matchAll(/href="([^"]+)"/gi)];
      for (let i = hrefMatches.length - 1; i >= 0; i--) {
        const href = hrefMatches[i][1];
        // Bing aclick redirect — extract url= param
        const urlParam = href.match(/[?&]url=([^&"]+)/i);
        if (urlParam) {
          try {
            const dest = new URL(decodeURIComponent(urlParam[1]));
            link = dest.origin;
            break;
          } catch {}
        }
        // Direct store href (not bing.com internal)
        if (href.startsWith('https://') && !href.includes('bing.com') && !href.includes('microsoft.com')) {
          try {
            const dest = new URL(href);
            link = dest.origin;
            break;
          } catch {}
        }
      }
      merchants.push({ name, isDirect: !isBigRetailer(name), link });
      if (merchants.length >= 30) break;
    }

    return {
      merchants,
      count: merchants.length > 0 ? merchants.length : null,
      countIsExact: false,
      debug: merchants.length === 0 ? 'bing_no_merchants' : undefined,
    };
  } catch (e: any) {
    return { ...empty, debug: `bing_fout: ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

// Yahoo Search subdomain by country (works from server-side / datacenter IPs)
const YAHOO_SUB: Record<string, string> = {
  NL: 'nl', BE: 'nl', DE: 'de', GB: 'uk', US: 'search',
  FR: 'fr', IT: 'it', ES: 'es', SE: 'se', NO: 'uk',
  DK: 'uk', PL: 'uk', AT: 'de', CH: 'de', IE: 'uk',
  FI: 'uk', CA: 'ca', AU: 'au', NZ: 'au',
};

async function scrapeOrganicDomains(keyword: string, countryCode: string): Promise<{
  domains: OrganicEntry[];
  debug?: string;
}> {
  const sub = YAHOO_SUB[countryCode.toUpperCase()] ?? 'search';
  const host = sub === 'search' ? 'search.yahoo.com' : `${sub}.search.yahoo.com`;
  const url = `https://${host}/search?p=${encodeURIComponent(keyword)}&n=10`;
  try {
    const res = await fetch(url, {
      headers: BING_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { domains: [], debug: `yahoo_http_${res.status}` };
    const html = await res.text();

    const seen = new Set<string>();
    const domains: OrganicEntry[] = [];
    // Yahoo organic results wrap outbound URLs in /RU=<encoded-url>/ redirect pattern
    const pat = /r\.search\.yahoo\.com\/[^"]*?RU=([^\/&"]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(html)) !== null && domains.length < 10) {
      const decoded = decodeURIComponent(m[1]);
      if (/bing\.com|yahoo\.com|aclick/i.test(decoded)) continue;
      try {
        const domain = new URL(decoded).hostname.replace(/^www\./, '');
        if (!domain || seen.has(domain)) continue;
        seen.add(domain);
        domains.push({ domain, isDirect: !isBigRetailer(domain) });
      } catch {}
    }

    return { domains, debug: domains.length === 0 ? 'yahoo_no_results' : undefined };
  } catch (e: any) {
    return { domains: [], debug: `yahoo_fout: ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

// Fetch 5-year monthly interest via Google Trends unofficial API (no key required)
export async function fetchGoogleTrends(keyword: string, countryCode: string): Promise<TrendPoint[]> {
  try {
    const exploreReq = JSON.stringify({
      comparisonItem: [{ keyword, geo: countryCode, time: 'today 5-y' }],
      category: 0,
      property: '',
    });
    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en&tz=-60&req=${encodeURIComponent(exploreReq)}`;
    const exploreRes = await fetch(exploreUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://trends.google.com/',
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!exploreRes.ok) return [];
    const exploreText = await exploreRes.text();
    const exploreJson = JSON.parse(exploreText.replace(/^\)\]\}'\n/, ''));
    const widgets: any[] = exploreJson.widgets ?? [];
    const tsWidget = widgets.find((w: any) => w.id === 'TIMESERIES');
    if (!tsWidget?.token) return [];

    const multilineReq = JSON.stringify(tsWidget.request);
    const multilineUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en&tz=-60&req=${encodeURIComponent(multilineReq)}&token=${encodeURIComponent(tsWidget.token)}`;
    const multilineRes = await fetch(multilineUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://trends.google.com/',
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!multilineRes.ok) return [];
    const multilineText = await multilineRes.text();
    const multilineJson = JSON.parse(multilineText.replace(/^\)\]\}'\n/, ''));

    const timelineData: any[] = multilineJson.default?.timelineData ?? [];
    return timelineData.map((item: any) => {
      const ts = parseInt(item.time) * 1000;
      const date = new Date(ts);
      return { year: date.getFullYear(), month: date.getMonth() + 1, value: item.value?.[0] ?? 0 };
    }).filter(p => p.year > 0);
  } catch {
    return [];
  }
}

export interface MerchantInfo {
  name: string;
  isDirect: boolean; // true = potential direct competitor (not a big-box retailer)
  link?: string;     // store homepage URL extracted from product link
}

// DataForSEO language codes (keyed by our Google languageId)
const DATAFORSEO_LANG: Record<string, string> = {
  '1000': 'en', '1001': 'de', '1002': 'fr', '1003': 'es', '1004': 'it',
  '1009': 'da', '1010': 'nl', '1011': 'fi', '1013': 'no', '1015': 'sv', '1019': 'pl',
};

// Google country domain per geoId — ensures DataForSEO queries the local Google version
const DATAFORSEO_SE_DOMAIN: Record<string, string> = {
  '2528': 'google.nl', '2056': 'google.be', '2276': 'google.de',
  '2826': 'google.co.uk', '2840': 'google.com', '2250': 'google.fr',
  '2380': 'google.it', '2724': 'google.es', '2752': 'google.se',
  '2578': 'google.no', '2208': 'google.dk', '2616': 'google.pl',
  '2040': 'google.at', '2756': 'google.ch', '2372': 'google.ie',
  '2246': 'google.fi', '2124': 'google.ca', '2036': 'google.com.au',
  '2554': 'google.co.nz',
};

// Human-readable location names for DataForSEO (alternative to location_code for routing)
const DATAFORSEO_LOCATION_NAME: Record<string, string> = {
  '2528': 'Netherlands', '2056': 'Belgium', '2276': 'Germany',
  '2826': 'United Kingdom', '2840': 'United States', '2250': 'France',
  '2380': 'Italy', '2724': 'Spain', '2752': 'Sweden',
  '2578': 'Norway', '2208': 'Denmark', '2616': 'Poland',
  '2040': 'Austria', '2756': 'Switzerland', '2372': 'Ireland',
  '2246': 'Finland', '2124': 'Canada', '2036': 'Australia',
  '2554': 'New Zealand',
};

// Fetch Google Shopping merchants via DataForSEO (exact Google data, pay-per-use)
async function fetchGoogleShoppingMerchants(keyword: string, geoId: string, languageId: string): Promise<{
  merchants: MerchantInfo[];
  count: number | null;
  debug?: string;
}> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { merchants: [], count: null, debug: 'no_dataforseo_creds' };

  const langCode = DATAFORSEO_LANG[languageId] ?? 'en';
  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  try {
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/shopping/live/regular', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        keyword,
        location_name: DATAFORSEO_LOCATION_NAME[geoId] ?? 'United States',
        language_code: langCode,
        se_domain: DATAFORSEO_SE_DOMAIN[geoId] ?? 'google.com',
        device: 'desktop',
        os: 'windows',
        depth: 100,
      }]),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { merchants: [], count: null, debug: `dataforseo_${res.status}` };
    const data = await res.json();
    const statusCode = data?.tasks?.[0]?.status_code;
    if (statusCode && statusCode !== 20000) return { merchants: [], count: null, debug: `dataforseo_task_${statusCode}` };
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];
    const seen = new Set<string>();
    const allDomains: string[] = [];
    const merchants: MerchantInfo[] = [];
    for (const item of items) {
      if (item.type !== 'shopping') continue;
      const domain = (item.domain || '').toLowerCase().replace(/^www\./, '');
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      allDomains.push(domain);
      const name = item.source || domain;
      merchants.push({
        name,
        isDirect: !isBigRetailer(name) && !isBigRetailer(domain),
        link: `https://${domain}`,
      });
    }
    const debugInfo = allDomains.length > 0 ? `all_domains: ${allDomains.join(', ')}` : undefined;
    return { merchants, count: merchants.length || null, debug: debugInfo };
  } catch (e: any) {
    return { merchants: [], count: null, debug: `dataforseo_err: ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

// Known large generalist retailers across all supported countries
const BIG_RETAILERS = [
  // Global marketplaces
  'amazon','ebay','alibaba','aliexpress','wish','shein','temu','ubuy','dhgate',
  // Electronics chains
  'mediamarkt','saturn','coolblue','expert','fnac','currys','bestbuy','best buy',
  'newegg','adorama','b&h','bhphoto','microcenter','micro center',
  'elgiganten','power','verkkokauppa','proshop','komplett','computersalg',
  'unieuro','mediaworld','euronics','darty','boulanger','conforama',
  // Department stores / general
  'walmart','target','costco','carrefour','tesco','lidl','aldi','metro',
  'otto','real','kaufland','edeka','rewe','intersport','decathlon',
  'john lewis','argos','very','very.co','next','marks & spencer',
  'bol.com','bol ','cdiscount','rakuten','manomano',
  // Price comparison & aggregators (NOT shops themselves)
  'billiger','idealo','pricespy','pricerunner','kelkoo','nextag','shopzilla',
  'tweakers','kieskeurig','vergelijk','beslist','google shopping',
  'getpricelist','shopmania','shopbot','become.com','pricegrabber',
  'shopping.com','shopping.de','bizrate','camelcamelcamel','fruugo',
  // Big tech/brand stores
  'apple','microsoft','samsung','google','sony','dell','hp','lenovo',
  'seagate','western digital','wd ','toshiba','sandisk','kingston',
  // Power tools / single-brand manufacturers (not general niche stores)
  'vonroc','bosch','dewalt','makita','stanley','black+decker','karcher','kärcher',
  'gardena','husqvarna','stihl','worx','einhell','ryobi','milwaukee',
  // Marketplaces / classifieds / social
  'marktplaats','vinted','2dehands','leboncoin','olx','catawiki',
  'youtube','wikipedia','reddit','facebook','instagram','tiktok','pinterest',
  // Supermarkets
  'ah ','albert heijn','jumbo','plus supermarkt',
  // DIY chains NL/DE/BE/AT
  'hornbach','praxis','gamma.nl','gamma ','bauhaus','obi ','obi.','baumarkt',
  'leenbakker','kwantum',
  // Garden/home NL
  'intratuin','tuincentrum','ikea','jysk','action ','action.','hema',
  // Other large EU retailers
  'zalando','about you','h&m','zara','c&a','primark','wehkamp','fonq',
  'coolcat','bijenkorf','v&d',
];

function isBigRetailer(name: string): boolean {
  const lower = name.toLowerCase();
  return BIG_RETAILERS.some(r => lower.includes(r));
}

// Shopping advertiser count + merchant list — uses Google (DataForSEO) when credentials available, Bing otherwise
export async function fetchExactShoppingAdsCount(keyword: string, countryCode: string, options?: { geoId?: string; languageId?: string }): Promise<{
  count: number | null;
  countIsExact: boolean;
  uniqueAdvertisers: number | null;
  merchants: MerchantInfo[];
  debug?: string;
}> {
  // Google Shopping via DataForSEO (preferred — exact counts from Google)
  if (process.env.DATAFORSEO_LOGIN && options?.geoId && options?.languageId) {
    const r = await fetchGoogleShoppingMerchants(keyword, options.geoId, options.languageId);
    if (r.count !== null) {
      return { count: r.count, countIsExact: true, uniqueAdvertisers: r.count, merchants: r.merchants.slice(0, 10), debug: r.debug ?? undefined };
    }
  }

  // Fallback: Bing Shopping scraping
  const lang = COUNTRY_LANG[countryCode.toUpperCase()] ?? 'en';
  const buyTerm = (BUY_TERMS[lang] ?? BUY_TERMS.en)[0];
  const variant = `${keyword} ${buyTerm}`;
  const [primary, secondary] = await Promise.all([
    scrapeShoppingMerchants(keyword, countryCode),
    scrapeShoppingMerchants(variant, countryCode),
  ]);
  const seen = new Set<string>(primary.merchants.map(m => m.name.toLowerCase()));
  const merged: MerchantInfo[] = [...primary.merchants];
  for (const m of secondary.merchants) {
    if (!seen.has(m.name.toLowerCase())) { seen.add(m.name.toLowerCase()); merged.push(m); }
  }
  const top10 = merged.slice(0, 10);
  const totalFound = merged.length > 0 ? merged.length : null;
  const debug = merged.length === 0 ? (primary.debug ?? secondary.debug) : undefined;
  return { count: totalFound, countIsExact: false, uniqueAdvertisers: totalFound, merchants: top10, debug };
}

// Multi-keyword shopping scan: scans each keyword in parallel, aggregates unique merchants
export async function fetchMultiKeywordShoppingAds(keywords: string[], countryCode: string, options?: { geoId?: string; languageId?: string }): Promise<{
  count: number | null;
  countIsExact: boolean;
  uniqueAdvertisers: number | null;
  merchants: MerchantInfo[];
  debug?: string;
}> {
  // Google Shopping via DataForSEO (preferred)
  if (process.env.DATAFORSEO_LOGIN && options?.geoId && options?.languageId) {
    const results = await Promise.all(keywords.map(kw => fetchGoogleShoppingMerchants(kw, options.geoId!, options.languageId!)));
    // Primary keyword (keywords[0]) merchants → used for Niche Stores display
    const primaryMerchants = results[0]?.merchants ?? [];
    // Merge all keywords → used for total advertiser count
    const seen = new Set<string>();
    const merged: MerchantInfo[] = [];
    for (const r of results) {
      for (const m of r.merchants) {
        const key = (m.link || m.name).toLowerCase();
        if (!seen.has(key)) { seen.add(key); merged.push(m); }
      }
    }
    if (merged.length > 0 || primaryMerchants.length > 0) {
      return { count: merged.length || null, countIsExact: true, uniqueAdvertisers: merged.length || null, merchants: primaryMerchants.slice(0, 10), debug: results[0]?.debug };
    }
  }

  // Fallback: Bing scraping
  const results = await Promise.all(keywords.map(kw => scrapeShoppingMerchants(kw, countryCode)));
  const seen = new Set<string>();
  const merged: MerchantInfo[] = [];
  for (const r of results) {
    for (const m of r.merchants) {
      if (!seen.has(m.name.toLowerCase())) { seen.add(m.name.toLowerCase()); merged.push(m); }
    }
  }
  const top10 = merged.slice(0, 10);
  const totalFound = merged.length || null;
  const debug = merged.length === 0 ? results.find(r => r.debug)?.debug : undefined;
  return { count: totalFound, countIsExact: false, uniqueAdvertisers: totalFound, merchants: top10, debug };
}

export interface OrganicEntry {
  domain: string;
  isDirect: boolean; // false = big retailer, true = potential niche store
}

export interface OrganicGapResult {
  storeKansScore: number | null; // 0-100: 100 = all big retailers (max opportunity)
  bigRetailerCount: number;
  nicheStoreCount: number;
  totalChecked: number;
  topDomains: OrganicEntry[];
  error?: string;
}

export async function fetchOrganicGap(keyword: string, countryCode: string): Promise<OrganicGapResult> {
  const empty: OrganicGapResult = { storeKansScore: null, bigRetailerCount: 0, nicheStoreCount: 0, totalChecked: 0, topDomains: [], error: undefined };
  const { domains, debug } = await scrapeOrganicDomains(keyword, countryCode);
  if (!domains.length) return { ...empty, error: debug ?? 'no_domains' };

  const bigRetailerCount = domains.filter(d => !d.isDirect).length;
  const nicheStoreCount = domains.filter(d => d.isDirect).length;
  const storeKansScore = Math.round((bigRetailerCount / domains.length) * 100);
  // topDomains shows only niche/direct stores — big retailers already counted in the score
  const topDomains = domains.filter(d => d.isDirect);
  return { storeKansScore, bigRetailerCount, nicheStoreCount, totalChecked: domains.length, topDomains };
}

// Estimate Shopping advertiser count from avg competition index (0-100)
// Google's competition_index = ratio of filled ad slots; rough mapping to advertiser count
function estimateShoppingAdvertisers(keywords: KeywordIdea[]): number | null {
  const top = keywords.slice(0, 10).filter(k => k.competitionIndex > 0);
  if (!top.length) return null;
  const avgIdx = top.reduce((s, k) => s + k.competitionIndex, 0) / top.length;
  if (avgIdx >= 90) return 1000;
  if (avgIdx >= 75) return 500;
  if (avgIdx >= 60) return 200;
  if (avgIdx >= 40) return 80;
  if (avgIdx >= 20) return 25;
  return 8;
}

async function fetchKeywordIdeas(
  niche: string,
  geoId: string,
  languageId: string,
  customerId: string,
  accessToken: string,
  preTranslated?: string, // skip translation when pre-computed (global scan)
): Promise<KeywordIdea[]> {
  const lang = LANG_CODE[languageId] ?? 'en';
  const buyTerms = BUY_TERMS[lang] ?? BUY_TERMS.en;

  let localKeyword: string;
  if (preTranslated) {
    localKeyword = preTranslated;
  } else {
    // Translate directly from input language to target (sl=auto detects source)
    localKeyword = await translateKeyword(niche, languageId);
  }

  // Always include the original input as a safety seed alongside the translation
  // in case the direct translation differs (e.g. "vijverbak" stays as-is for NL).
  const seedKeywords = Array.from(new Set([
    localKeyword,
    niche !== localKeyword ? niche : null,
    `${localKeyword} ${buyTerms[0]}`,
    `${localKeyword} ${buyTerms[1]}`,
  ].filter(Boolean) as string[])).slice(0, 5);

  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${customerId}:generateKeywordIdeas`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keywordSeed: { keywords: seedKeywords },
        language: `languageConstants/${languageId}`,
        geoTargetConstants: [`geoTargetConstants/${geoId}`],
        includeAdultKeywords: false,
        keywordPlanNetwork: 'GOOGLE_SEARCH',
        pageSize: 30,
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Ads API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const results: any[] = data.results ?? [];

  return results.map((r: any) => {
    const m = r.keywordIdeaMetrics ?? {};
    const lowMicros = Number(m.lowTopOfPageBidMicros ?? 0);
    const highMicros = Number(m.highTopOfPageBidMicros ?? 0);
    const lowEur = lowMicros / 1_000_000;
    const highEur = highMicros / 1_000_000;
    const avg = (lowEur + highEur) / 2;

    const monthlyVolumes: MonthlyVolume[] = (m.monthlySearchVolumes ?? []).map((mv: any) => ({
      year: Number(mv.year ?? 0),
      month: MONTH_NUM[String(mv.month ?? '').toUpperCase()] ?? 0,
      searches: Number(mv.monthlySearches ?? 0),
    })).filter((mv: MonthlyVolume) => mv.year > 0 && mv.month > 0);

    return {
      keyword: r.text ?? '',
      avgMonthlySearches: Number(m.avgMonthlySearches ?? 0),
      competition: toCompetition(m.competition ?? ''),
      competitionIndex: Number(m.competitionIndex ?? 0),
      lowCpcEur: Math.round(lowEur * 100) / 100,
      highCpcEur: Math.round(highEur * 100) / 100,
      avgCpcEur: Math.round(avg * 100) / 100,
      shoppingCpcEur: Math.round(avg * 0.4 * 100) / 100,
      monthlyVolumes,
    };
  }).sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches);
}

export async function researchNiche(
  niche: string,
  geoId: string,
  languageId: string,
): Promise<NicheResearchResult> {
  const { customerId, refreshToken } = await getCredentials();
  const accessToken = await getAccessToken(refreshToken);
  const geoLabel = GEO_OPTIONS.find(g => g.geoId === geoId && g.languageId === languageId)?.label ?? geoId;

  const keywords = await fetchKeywordIdeas(niche, geoId, languageId, customerId, accessToken);
  return { niche, geo: geoLabel, keywords, summary: summarize(keywords, estimateShoppingAdvertisers(keywords)) };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchKeywordIdeasWithRetry(
  niche: string, geoId: string, languageId: string, customerId: string, accessToken: string,
  preTranslated?: string,
): Promise<KeywordIdea[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchKeywordIdeas(niche, geoId, languageId, customerId, accessToken, preTranslated);
    } catch (err: any) {
      if (err.message?.includes('429') && attempt < 2) {
        await sleep(3000);
        continue;
      }
      return [];
    }
  }
  return [];
}

export async function researchNicheGlobal(niche: string): Promise<GlobalNicheResult> {
  const { customerId, refreshToken } = await getCredentials();
  const accessToken = await getAccessToken(refreshToken);

  // Pre-translate directly to each unique language (sl=auto detects input language)
  // Sequential to avoid rate-limiting Google Translate with 11 simultaneous calls
  const langMap = new Map<string, string>();
  for (const geo of GEO_OPTIONS) {
    if (!langMap.has(geo.languageId)) {
      langMap.set(geo.languageId, await translateKeyword(niche, geo.languageId));
    }
  }

  // Step 3: run KP calls in batches of 5 to avoid API rate limits (~15s total)
  const ordered: CountryResult[] = [];
  for (let i = 0; i < GEO_OPTIONS.length; i += 7) {
    const batch = GEO_OPTIONS.slice(i, i + 7);
    const batchResults = await Promise.all(batch.map(async (geo) => {
      const preTranslated = langMap.get(geo.languageId) ?? niche;
      const keywords = await fetchKeywordIdeasWithRetry(niche, geo.geoId, geo.languageId, customerId, accessToken, preTranslated);
      const summary = summarize(keywords, estimateShoppingAdvertisers(keywords));
      const top = keywords[0];
      const topKeywords = keywords.slice(0, 5).map(k => k.keyword).filter(Boolean);
      return {
        geo: geo.label,
        geoId: geo.geoId,
        languageId: geo.languageId,
        flag: geo.flag,
        summary,
        topKeyword: top?.keyword ?? preTranslated,
        topVolume: top?.avgMonthlySearches ?? 0,
        topKeywords: topKeywords.length > 0 ? topKeywords : [top?.keyword ?? preTranslated],
      } satisfies CountryResult;
    }));
    ordered.push(...batchResults);
    if (i + 7 < GEO_OPTIONS.length) await sleep(300);
  }

  ordered.sort((a, b) => b.summary.opportunityScore - a.summary.opportunityScore);
  return { niche, countries: ordered, bestCountry: ordered[0] };
}
