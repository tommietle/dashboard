'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import RevenueChart from '@/components/RevenueChart';
import { StoreMetrics, StoreKey } from '@/lib/shopify';
import { AdsMetrics } from '@/lib/googleAds';

const DATE_PRESETS = [
  { label: 'Today', days: 1 },
  { label: 'Yesterday', days: 2 },
  { label: 'Last 30 days', days: 30 },
  { label: 'More', days: 90 },
];

const STORES: { key: StoreKey; label: string; flag: string }[] = [
  { key: 'all',     label: 'All Stores', flag: ''   },
  { key: 'luhvia',  label: 'Luhvia',     flag: '🇺🇸' },
  { key: 'cecole',  label: 'Cecole',     flag: '🇨🇦' },
  { key: 'luvande', label: 'Luvande',    flag: '🇬🇧' },
];

function getDateRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function getPrevDateRange(days: number) {
  const end = new Date();
  end.setDate(end.getDate() - days);
  const start = new Date();
  start.setDate(start.getDate() - (days * 2 - 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

function fmtEur(value: number) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

function fmtNum(value: number) {
  return new Intl.NumberFormat('nl-NL').format(value);
}

function fmtCur(value: number, currency: string) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

interface ApiResponse { stores: StoreMetrics[]; startDate: string; endDate: string; error?: string; }
interface AdsResponse { ads: AdsMetrics[]; error?: string; }
interface AnalyticsResponse { analytics: { store: string; sessions: number; conversions: number; conversionRate: number }[]; error?: string; }

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-sm text-gray-400 font-medium">— vs previous period</span>;
  const up = pct >= 0;
  return (
    <span className={`flex items-center gap-1 text-sm font-medium ${up ? 'text-emerald-500' : 'text-red-500'}`}>
      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <polyline points={up ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
      </svg>
      {Math.abs(pct).toFixed(1)}% vs previous period
    </span>
  );
}

function KpiDivider() {
  return <div className="w-px h-10 bg-gray-200 shrink-0" />;
}

function KpiMetric({ label, value, pct }: { label: string; value: string; pct?: number | null }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-5">
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-bold text-gray-800">{value}</span>
      {pct !== undefined && pct !== null && (
        <span className={`text-[10px] font-medium ${pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
          {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [selectedStore, setSelectedStore] = useState<StoreKey>('all');
  const [days, setDays] = useState(30);
  const [showStoreMenu, setShowStoreMenu] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [prevData, setPrevData] = useState<ApiResponse | null>(null);
  const [adsData, setAdsData] = useState<AdsResponse | null>(null);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fxRates, setFxRates] = useState<Record<string, number>>({ USD: 1.08, CAD: 1.47, GBP: 0.86, EUR: 1 });

  useEffect(() => {
    fetch('https://api.frankfurter.app/latest?base=EUR')
      .then(r => r.json())
      .then(d => { if (d.rates) setFxRates({ ...d.rates, EUR: 1 }); })
      .catch(() => {});
  }, []);

  function cvtEur(amount: number, currency: string): number {
    if (currency === 'EUR') return amount;
    const r = fxRates[currency];
    return r ? amount / r : amount;
  }

  const fetchIdRef = useRef(0);

  const fetchData = useCallback(() => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    setPrevData(null);
    setAdsData(null);
    setAnalyticsData(null);

    const { start, end } = getDateRange(days);
    const prev = getPrevDateRange(days);

    const shopifyP = fetch(`/api/shopify?store=${selectedStore}&start=${start}&end=${end}`).then(r => r.json());
    const prevP = fetch(`/api/shopify?store=${selectedStore}&start=${prev.start}&end=${prev.end}`).then(r => r.json());
    const adsP = fetch(`/api/google-ads?store=${selectedStore}&start=${start}&end=${end}`).then(r => r.json());
    const analyticsP = fetch(`/api/analytics?store=${selectedStore}&start=${start}&end=${end}`).then(r => r.json());

    // Hoofdrendering ontgrendelt zodra de huidige periode binnen is —
    // de rest druppelt in op de achtergrond.
    shopifyP
      .then(json => {
        if (fetchId !== fetchIdRef.current) return;
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(e => { if (fetchId === fetchIdRef.current) setError(e.message); })
      .finally(() => { if (fetchId === fetchIdRef.current) setLoading(false); });

    prevP
      .then(json => {
        if (fetchId !== fetchIdRef.current) return;
        setPrevData(json.error ? null : json);
      })
      .catch(() => {});

    adsP
      .then(json => { if (fetchId === fetchIdRef.current) setAdsData(json); })
      .catch(() => {});

    analyticsP
      .then(json => { if (fetchId === fetchIdRef.current) setAnalyticsData(json); })
      .catch(() => {});
  }, [selectedStore, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const stores = data?.stores || [];
  const totalRevenue = stores.reduce((s, st) => s + cvtEur(st.totalRevenue, st.currency), 0);
  const totalOrders = stores.reduce((s, st) => s + st.totalOrders, 0);
  const totalAov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const totalSpend = adsData?.ads?.reduce((s, a) => s + cvtEur(a.spend, a.currency), 0) ?? 0;
  const combinedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const netProfit = totalRevenue - totalSpend;

  const prevStores = prevData?.stores || [];
  const prevTotalRevenue = prevStores.reduce((s, st) => s + cvtEur(st.totalRevenue, st.currency), 0);
  const prevTotalOrders = prevStores.reduce((s, st) => s + st.totalOrders, 0);
  const prevTotalAov = prevTotalOrders > 0 ? prevTotalRevenue / prevTotalOrders : 0;
  const revenuePct = pctChange(totalRevenue, prevTotalRevenue);
  const ordersPct = pctChange(totalOrders, prevTotalOrders);
  const aovPct = pctChange(totalAov, prevTotalAov);

  const activeStoreLabel = STORES.find(s => s.key === selectedStore)?.label ?? 'All Stores';

  return (
    <div className="min-h-screen bg-[#f0f2f7]">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <h1 className="text-lg font-bold text-gray-900 mr-2">Dashboard</h1>

        {/* Store selector */}
        <div className="relative">
          <button
            onClick={() => setShowStoreMenu(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            {activeStoreLabel}
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showStoreMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 min-w-[140px]">
              {STORES.map(s => (
                <button
                  key={s.key}
                  onClick={() => { setSelectedStore(s.key); setShowStoreMenu(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${selectedStore === s.key ? 'text-indigo-600 font-medium' : 'text-gray-700'}`}
                >
                  {s.flag} {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Date filters */}
        <div className="flex items-center gap-1 ml-auto">
          {DATE_PRESETS.map(p => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                days === p.days
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Icons */}
        <button onClick={fetchData} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="Refresh">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
        <button className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
      </header>

      <div className="px-6 py-6 space-y-5">
        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Revenue hero */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            {/* Left: big revenue */}
            <div>
              <div className="text-sm text-gray-500 mb-1">{activeStoreLabel} · Revenue</div>
              {loading ? (
                <div className="h-12 w-40 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                <div className="text-5xl font-bold text-gray-900">{fmtEur(totalRevenue)}</div>
              )}
              <div className="mt-2">
                {loading || !prevData ? (
                  <div className="h-5 w-40 bg-gray-100 rounded animate-pulse" />
                ) : (
                  <PctBadge pct={revenuePct} />
                )}
              </div>
              <div className="flex gap-4 mt-3 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
                  Set daily target
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
                  Set monthly target
                </span>
              </div>
            </div>

            {/* Right: KPI metrics row */}
            {loading ? (
              <div className="flex gap-2 flex-wrap">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 w-20 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="flex items-center flex-wrap gap-y-3">
                <KpiMetric label="Orders" value={fmtNum(totalOrders)} pct={ordersPct} />
                <KpiDivider />
                <KpiMetric label="Sessions" value={
                  analyticsData?.analytics
                    ? fmtNum(analyticsData.analytics.reduce((s, a) => s + a.sessions, 0))
                    : '—'
                } />
                <KpiDivider />
                <KpiMetric label="CVR" value={
                  analyticsData?.analytics
                    ? `${(analyticsData.analytics.reduce((s, a) => s + a.conversionRate, 0) / analyticsData.analytics.length).toFixed(2)}%`
                    : '—'
                } />
                <KpiDivider />
                <KpiMetric label="AOV" value={totalOrders > 0 ? fmtEur(totalAov) : '—'} pct={aovPct} />
                <KpiDivider />
                <KpiMetric label="Ad Spend" value={totalSpend > 0 ? fmtEur(totalSpend) : '€0.00'} />
                <KpiDivider />
                <KpiMetric label="ROAS" value={combinedRoas > 0 ? `${combinedRoas.toFixed(2)}x` : '—'} />
                <KpiDivider />
                <KpiMetric label="Net Profit" value={fmtEur(netProfit)} />
              </div>
            )}
          </div>
        </div>

        {/* Chart row */}
        <div className="grid grid-cols-3 gap-5">
          {/* Revenue Trend chart */}
          <div className="col-span-2 bg-white rounded-2xl border border-gray-200 p-5">
            <div className="text-sm font-semibold text-gray-800 mb-0.5">Revenue Trend</div>
            <div className="text-xs text-gray-400 mb-4">{activeStoreLabel}</div>
            {loading ? (
              <div className="h-60 bg-gray-50 rounded-xl animate-pulse" />
            ) : stores.length > 0 ? (
              <RevenueChart stores={stores} />
            ) : (
              <div className="h-60 flex items-center justify-center text-gray-400 text-sm">No data</div>
            )}
          </div>

          {/* Right panel */}
          <div className="flex flex-col gap-4">
            {/* Alerts */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg width="16" height="16" fill="none" stroke="#14b8a6" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span className="text-sm font-semibold text-gray-800">Alerts</span>
              </div>
              {combinedRoas >= 2.5 ? (
                <div className="text-sm text-teal-600 font-medium">All stores above 2.5x ROAS</div>
              ) : (
                <div className="text-sm text-gray-400">No active alerts</div>
              )}
            </div>

            {/* Detailed Insights */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-2">
                <svg width="16" height="16" fill="none" stroke="#6366f1" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <span className="text-sm font-semibold text-gray-800">Detailed Insights</span>
              </div>
              <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                Deep-dive into store performance, trends, and anomalies.
              </p>
              <button className="text-sm text-indigo-600 font-medium hover:text-indigo-700 transition-colors flex items-center gap-1">
                View insights
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Per-store breakdown */}
        {!loading && stores.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Per store</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {stores.map(store => {
                const storeAds = adsData?.ads?.find(a => a.store === store.store);
                const storeRevenueEur = cvtEur(store.totalRevenue, store.currency);
                const storeSpendEur = storeAds && storeAds.spend > 0 ? cvtEur(storeAds.spend, storeAds.currency) : 0;
                const storeRoasNum = storeSpendEur > 0 ? storeRevenueEur / storeSpendEur : 0;
                const storeRoas = storeRoasNum > 0 ? `${storeRoasNum.toFixed(2)}x` : '—';
                const storeSpendFmt = storeSpendEur > 0 ? fmtEur(storeSpendEur) : '—';
                return (
                  <div key={store.store} className="bg-white rounded-2xl border border-gray-200 p-5">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                      {store.flag} {store.storeName}
                    </div>
                    <div className="grid grid-cols-5 gap-3 text-center">
                      <div>
                        <div className="text-base font-bold text-gray-900">{fmtEur(storeRevenueEur)}</div>
                        <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">Revenue</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-gray-900">{fmtNum(store.totalOrders)}</div>
                        <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">Orders</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-gray-900">{store.totalOrders > 0 ? fmtEur(cvtEur(store.averageOrderValue, store.currency)) : '—'}</div>
                        <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">AOV</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-gray-900">{storeSpendFmt}</div>
                        <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">Ad Spend</div>
                      </div>
                      <div>
                        <div className={`text-base font-bold ${storeRoasNum >= 2.5 ? 'text-emerald-600' : 'text-gray-900'}`}>{storeRoas}</div>
                        <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">ROAS</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && !error && stores.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            No data found for the selected period.
          </div>
        )}
      </div>
    </div>
  );
}
