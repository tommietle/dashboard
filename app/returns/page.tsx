'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { StoreKey } from '@/lib/shopify';
import { ReturnsMetrics, ReturnProduct } from '@/lib/shopifyReturns';
import { Dispute, formatReason } from '@/lib/shopifyDisputes';

const STORES: { key: StoreKey; label: string }[] = [
  { key: 'all',         label: 'All Stores'     },
  { key: 'luhvia',      label: '🇺🇸 Luhvia'      },
  { key: 'cecole',      label: '🇨🇦 Cecole'      },
  { key: 'luvande',     label: '🇬🇧 Luvande'     },
  { key: 'modemeister', label: '🇵🇱 Modemeister' },
];

const DATE_PRESETS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const STORE_FLAGS: Record<string, string> = { luhvia: '🇺🇸', cecole: '🇨🇦', luvande: '🇬🇧', modemeister: '🇵🇱' };
const STORE_NAMES: Record<string, string>  = { luhvia: 'Luhvia', cecole: 'Cecole', luvande: 'Luvande', modemeister: 'Modemeister' };

const DISPUTE_STATUS: Record<string, { label: string; color: string }> = {
  needs_response:  { label: 'Actie vereist',  color: 'bg-red-100 text-red-700'         },
  under_review:    { label: 'In review',       color: 'bg-amber-100 text-amber-700'     },
  won:             { label: 'Gewonnen',        color: 'bg-emerald-100 text-emerald-700' },
  lost:            { label: 'Verloren',        color: 'bg-red-100 text-red-600'         },
  accepted:        { label: 'Geaccepteerd',    color: 'bg-gray-100 text-gray-500'       },
  charge_refunded: { label: 'Terugbetaald',   color: 'bg-gray-100 text-gray-500'       },
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

interface StoreBreakdown {
  store: 'luhvia' | 'cecole' | 'luvande' | 'modemeister';
  currency: string;
  totalOrders: number;
  totalRevenue: number;
  returnedOrders: number;
  returnedQty: number;
  returnedRevenue: number;
  returnRate: number;
  refundRevenuePct: number;
  disputeCount: number;
}

interface BrandRow {
  brandName: string;
  imageUrl: string;
  currency: string;
  stores: ('luhvia' | 'cecole' | 'luvande' | 'modemeister')[];
  totalOrders: number;
  totalRevenue: number;
  returnedOrders: number;
  returnedQty: number;
  returnedRevenue: number;
  returnRate: number;
  refundRevenuePct: number;
  disputeCount: number;
  disputeAmount: number;
  storeBreakdown: StoreBreakdown[];
}

function groupByBrand(products: ReturnProduct[]): BrandRow[] {
  const map = new Map<string, BrandRow>();

  for (const p of products) {
    const key = p.brandName.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, {
        brandName: titleCase(p.brandName.trim()),
        imageUrl: p.imageUrl,
        currency: p.currency,
        stores: [],
        totalOrders: 0, totalRevenue: 0,
        returnedOrders: 0, returnedQty: 0, returnedRevenue: 0,
        returnRate: 0, refundRevenuePct: 0,
        disputeCount: 0, disputeAmount: 0,
        storeBreakdown: [],
      });
    }
    const b = map.get(key)!;
    if (b.currency !== p.currency) b.currency = 'mixed';
    if (!b.imageUrl && p.imageUrl) b.imageUrl = p.imageUrl;
    if (!b.stores.includes(p.store)) b.stores.push(p.store);

    b.totalOrders    += p.totalOrders;
    b.totalRevenue   += p.totalRevenue;
    b.returnedOrders += p.returnedOrders;
    b.returnedQty    += p.returnedQty;
    b.returnedRevenue += p.returnedRevenue;
    b.disputeCount   += p.disputeCount;
    b.disputeAmount  += p.disputeAmount;

    // Per-store breakdown
    let sd = b.storeBreakdown.find(s => s.store === p.store);
    if (!sd) {
      sd = { store: p.store, currency: p.currency, totalOrders: 0, totalRevenue: 0, returnedOrders: 0, returnedQty: 0, returnedRevenue: 0, returnRate: 0, refundRevenuePct: 0, disputeCount: 0 };
      b.storeBreakdown.push(sd);
    }
    sd.totalOrders    += p.totalOrders;
    sd.totalRevenue   += p.totalRevenue;
    sd.returnedOrders += p.returnedOrders;
    sd.returnedQty    += p.returnedQty;
    sd.returnedRevenue += p.returnedRevenue;
    sd.disputeCount   += p.disputeCount;
  }

  for (const b of map.values()) {
    b.returnRate = b.totalOrders > 0
      ? Math.min(Math.round((b.returnedOrders / b.totalOrders) * 1000) / 10, 100) : 0;
    b.refundRevenuePct = b.totalRevenue > 0
      ? Math.round((b.returnedRevenue / b.totalRevenue) * 1000) / 10 : 0;
    b.returnedRevenue = Math.round(b.returnedRevenue * 100) / 100;
    b.totalRevenue    = Math.round(b.totalRevenue * 100) / 100;

    for (const sd of b.storeBreakdown) {
      sd.returnRate = sd.totalOrders > 0
        ? Math.min(Math.round((sd.returnedOrders / sd.totalOrders) * 1000) / 10, 100) : 0;
      sd.refundRevenuePct = sd.totalRevenue > 0
        ? Math.round((sd.returnedRevenue / sd.totalRevenue) * 1000) / 10 : 0;
      sd.returnedRevenue = Math.round(sd.returnedRevenue * 100) / 100;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.refundRevenuePct - a.refundRevenuePct);
}

function getRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function RefundPctBadge({ pct }: { pct: number }) {
  const color = pct >= 15
    ? 'bg-red-100 text-red-700 border-red-200'
    : pct >= 8
    ? 'bg-amber-100 text-amber-700 border-amber-200'
    : pct >= 3
    ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
    : 'bg-gray-100 text-gray-500 border-gray-200';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {pct.toFixed(1)}%
    </span>
  );
}

function ProductThumb({ imageUrl, name }: { imageUrl: string; name: string }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-gray-100"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 border border-gray-100">
      <svg width="16" height="16" fill="none" stroke="#9ca3af" strokeWidth="1.5" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </div>
  );
}

interface KpiLine { value: string; sub?: string; accent?: string; }

function KpiCard({ label, value, sub, accent, lines }: {
  label: string; value?: string; sub?: string; accent?: string; lines?: KpiLine[];
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      {lines ? (
        <div className="space-y-1.5 mt-1">
          {lines.map((l, i) => (
            <div key={i}>
              <div className={`text-xl font-bold leading-tight ${l.accent ?? 'text-gray-900'}`}>{l.value}</div>
              {l.sub && <div className="text-[11px] text-gray-400">{l.sub}</div>}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className={`text-2xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
        </>
      )}
    </div>
  );
}

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-5 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
      className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

export default function ReturnsPage() {
  const [selectedStore, setSelectedStore] = useState<StoreKey>('all');
  const [showStoreMenu, setShowStoreMenu] = useState(false);
  const [days, setDays] = useState(30);
  const [dateMode, setDateMode] = useState<'preset' | 'alltime' | 'custom'>('preset');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // committedCustom only updates when user clicks "Toepassen", driving the actual fetch
  const [committedCustom, setCommittedCustom] = useState<{ start: string; end: string } | null>(null);
  const [returns, setReturns] = useState<ReturnsMetrics[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [minSold, setMinSold] = useState('');
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

  function fmtEur(amount: number): string {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let start: string, end: string;
      if (dateMode === 'alltime') {
        start = '2020-01-01';
        end = new Date().toISOString().slice(0, 10);
      } else if (dateMode === 'custom' && committedCustom) {
        start = committedCustom.start; end = committedCustom.end;
      } else {
        ({ start, end } = getRange(days));
      }
      const res = await fetch(`/api/returns?store=${selectedStore}&start=${start}&end=${end}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setReturns(json.returns || []);
      setDisputes(json.disputes || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedStore, days, dateMode, committedCustom]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function toggleBrand(name: string) {
    setExpandedBrands(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  const activeLabel = STORES.find(s => s.key === selectedStore)?.label ?? 'All Stores';
  const periodLabel = dateMode === 'alltime' ? 'Alle tijd'
    : dateMode === 'custom' && committedCustom ? `${committedCustom.start} – ${committedCustom.end}`
    : `${days} dagen`;

  const totalOrders              = returns.reduce((s, r) => s + r.totalOrders, 0);
  const totalReturnedOrders      = returns.reduce((s, r) => s + r.totalRefundedOrders, 0);
  const totalReturnedItems       = returns.reduce((s, r) => s + r.totalReturnedItems, 0);
  const totalReturnedRevenueEur  = returns.reduce((s, r) => s + cvtEur(r.totalReturnedRevenue, r.currency), 0);
  const totalSoldRevenueEur      = returns.reduce((s, r) => s + cvtEur(r.totalSoldRevenue, r.currency), 0);
  const overallReturnRate        = totalOrders > 0 ? (totalReturnedOrders / totalOrders) * 100 : 0;
  const overallRefundPct         = totalSoldRevenueEur > 0 ? (totalReturnedRevenueEur / totalSoldRevenueEur) * 100 : 0;
  const openDisputes             = disputes.filter(d => d.status === 'needs_response' || d.status === 'under_review').length;
  const totalDisputeAmountEur    = disputes.reduce((s, d) => s + cvtEur(d.amount, d.currency), 0);

  const allProducts: ReturnProduct[] = returns
    .flatMap(r => r.products)
    .sort((a, b) => b.refundRevenuePct - a.refundRevenuePct);

  const minSoldNum = minSold !== '' ? Number(minSold) : 0;
  const brandRows: BrandRow[] = groupByBrand(allProducts).filter(b => b.totalOrders >= minSoldNum);
  const filteredProducts = allProducts.filter(p => p.totalOrders >= minSoldNum);
  const showBrands = selectedStore === 'all';

  return (
    <div className="min-h-screen bg-[#f0f2f7]">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <h1 className="text-lg font-bold text-gray-900 mr-2">Returns & Disputes</h1>

        <div className="relative">
          <button onClick={() => setShowStoreMenu(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700 hover:bg-gray-100 transition-colors">
            {activeLabel}
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {showStoreMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 min-w-[140px]">
              {STORES.map(s => (
                <button key={s.key} onClick={() => { setSelectedStore(s.key); setShowStoreMenu(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${selectedStore === s.key ? 'text-indigo-600 font-medium' : 'text-gray-700'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {DATE_PRESETS.map(p => (
            <button key={p.days} onClick={() => { setDays(p.days); setDateMode('preset'); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${dateMode === 'preset' && days === p.days ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => setDateMode('alltime')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${dateMode === 'alltime' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            All time
          </button>
          <button onClick={() => setDateMode('custom')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${dateMode === 'custom' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            Custom
          </button>
          {dateMode === 'custom' && (
            <div className="flex items-center gap-1 ml-1">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="px-2 py-1 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400" />
              <span className="text-gray-400 text-xs">–</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="px-2 py-1 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400" />
              <button
                onClick={() => { if (customStart && customEnd) setCommittedCustom({ start: customStart, end: customEnd }); }}
                disabled={!customStart || !customEnd}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-40">
                Toepassen
              </button>
            </div>
          )}
          <button onClick={fetchData} className="p-1.5 ml-1 text-gray-400 hover:text-gray-600">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>
      </header>

      <div className="px-6 py-6 space-y-5">
        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">⚠️ {error}</div>}

        {loading ? (
          <div className="grid grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl border border-gray-200 animate-pulse"/>)}
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-4">
            <KpiCard label="Totale orders" value={totalOrders.toLocaleString('nl-NL')} sub={periodLabel} />
            <KpiCard
              label="Retourrate"
              value={`${overallReturnRate.toFixed(1)}%`}
              sub={`${totalReturnedOrders} van ${totalOrders} orders`}
              accent={overallReturnRate >= 10 ? 'text-red-600' : overallReturnRate >= 5 ? 'text-amber-600' : 'text-gray-900'}
            />
            <KpiCard label="Retourartikelen" value={totalReturnedItems.toLocaleString('nl-NL')} sub="Totaal geretourneerd" />
            <KpiCard
              label="Refund % omzet"
              value={`${overallRefundPct.toFixed(1)}%`}
              sub={`van ${fmtEur(totalSoldRevenueEur)} omzet`}
              accent={overallRefundPct >= 15 ? 'text-red-600' : overallRefundPct >= 8 ? 'text-amber-600' : 'text-gray-900'}
            />
            <KpiCard
              label="Refund bedrag"
              value={totalReturnedRevenueEur > 0 ? fmtEur(totalReturnedRevenueEur) : '—'}
              sub={periodLabel}
              accent={overallRefundPct >= 15 ? 'text-red-600' : overallRefundPct >= 8 ? 'text-amber-600' : 'text-gray-900'}
            />
            <KpiCard
              label="Disputes"
              value={String(disputes.length)}
              sub={openDisputes > 0 ? `${openDisputes} vereisen actie` : 'Geen open disputes'}
              accent={openDisputes > 0 ? 'text-red-600' : 'text-gray-900'}
            />
          </div>
        )}

        {/* Product / brand table */}
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-800">Productanalyse — Retouren & Disputes</div>
              <div className="text-xs text-gray-400 mt-0.5">
                Gesorteerd op refund % omzet (incl. partials) · {activeLabel} · {periodLabel}
                {showBrands && <span className="ml-1 text-indigo-400">· Klik op een merk om per store te zien</span>}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Min. verkocht</label>
                <input
                  type="number"
                  min="0"
                  value={minSold}
                  onChange={e => setMinSold(e.target.value)}
                  placeholder="0"
                  className="w-20 px-2 py-1 text-sm border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                {minSold !== '' && (
                  <button onClick={() => setMinSold('')} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                    Wis
                  </button>
                )}
              </div>
              {!loading && (
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>≥ 15% kritiek</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>8–15% verhoogd</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block"/>{'<'} 8% normaal</span>
                </div>
              )}
            </div>
          </div>

          {loading ? <Skeleton rows={8} /> : (showBrands ? brandRows.length === 0 : filteredProducts.length === 0) ? (
            <div className="py-12 text-center text-gray-400 text-sm">Geen retouren gevonden in deze periode.</div>
          ) : showBrands ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-8">#</th>
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Merk</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Verkocht</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Omzet (€)</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Refund % omzet</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Refund (€)</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Geref. orders</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Disputes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {brandRows.map((b, i) => {
                  const isOpen = expandedBrands.has(b.brandName);
                  const bRevenueEur = b.storeBreakdown.reduce((s, sd) => s + cvtEur(sd.totalRevenue, sd.currency), 0);
                  const bRefundEur  = b.storeBreakdown.reduce((s, sd) => s + cvtEur(sd.returnedRevenue, sd.currency), 0);
                  const bRefundPct  = bRevenueEur > 0 ? Math.round((bRefundEur / bRevenueEur) * 1000) / 10 : 0;
                  return (
                    <Fragment key={b.brandName}>
                      <tr
                        onClick={() => toggleBrand(b.brandName)}
                        className={`cursor-pointer hover:bg-gray-50 transition-colors ${bRefundPct >= 15 ? 'bg-red-50/30' : ''}`}
                      >
                        <td className="py-3 px-4 text-gray-300 text-xs">{i + 1}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <ProductThumb imageUrl={b.imageUrl} name={b.brandName} />
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-gray-800 text-[13px] leading-tight flex items-center gap-1.5">
                                {b.brandName}
                                <span className="text-gray-300"><ChevronIcon open={isOpen} /></span>
                              </div>
                              <div className="text-[11px] text-gray-400 mt-0.5">
                                {b.stores.map(s => STORE_FLAGS[s]).join(' ')}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right text-gray-600">{b.totalOrders}</td>
                        <td className="py-3 px-4 text-right text-gray-700 font-medium">{fmtEur(bRevenueEur)}</td>
                        <td className="py-3 px-4 text-right"><RefundPctBadge pct={bRefundPct} /></td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-900">{fmtEur(bRefundEur)}</td>
                        <td className="py-3 px-4 text-right text-gray-500">{b.returnedOrders > 0 ? b.returnedOrders : <span className="text-gray-300">—</span>}</td>
                        <td className="py-3 px-4 text-right">
                          {b.disputeCount > 0
                            ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200">{b.disputeCount}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>

                      {isOpen && b.storeBreakdown.map(sd => {
                        const sdRefundPct = sd.totalRevenue > 0 ? Math.round((sd.returnedRevenue / sd.totalRevenue) * 1000) / 10 : 0;
                        return (
                        <tr key={`${b.brandName}-${sd.store}`} className="bg-indigo-50/40 border-b border-indigo-100/60" onClick={e => e.stopPropagation()}>
                          <td className="py-2 px-4" />
                          <td className="py-2 px-4 pl-[72px]">
                            <div className="flex items-center gap-2 text-[13px] text-gray-600 font-medium">
                              <span>{STORE_FLAGS[sd.store]}</span>
                              <span>{STORE_NAMES[sd.store]}</span>
                            </div>
                          </td>
                          <td className="py-2 px-4 text-right text-gray-500 text-[13px]">{sd.totalOrders}</td>
                          <td className="py-2 px-4 text-right text-gray-600 text-[13px]">
                            {fmtEur(cvtEur(sd.totalRevenue, sd.currency))}
                          </td>
                          <td className="py-2 px-4 text-right"><RefundPctBadge pct={sdRefundPct} /></td>
                          <td className="py-2 px-4 text-right text-gray-600 text-[13px] font-medium">
                            {fmtEur(cvtEur(sd.returnedRevenue, sd.currency))}
                          </td>
                          <td className="py-2 px-4 text-right text-gray-500 text-[13px]">{sd.returnedOrders > 0 ? sd.returnedOrders : <span className="text-gray-300">—</span>}</td>
                          <td className="py-2 px-4 text-right">
                            {sd.disputeCount > 0
                              ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200">{sd.disputeCount}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">#</th>
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Product</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Verkocht</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Omzet (€)</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Refund % omzet</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Refund (€)</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Geref. orders</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Disputes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredProducts.map((p, i) => (
                  <tr key={`${p.store}-${p.productId}`}
                    className={`hover:bg-gray-50 transition-colors ${p.refundRevenuePct >= 15 ? 'bg-red-50/30' : ''}`}>
                    <td className="py-3 px-4 text-gray-300 text-xs">{i + 1}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <ProductThumb imageUrl={p.imageUrl} name={p.title} />
                        <div>
                          <div className="font-medium text-gray-800 text-[13px] leading-tight">{p.title}</div>
                          <div className="text-[11px] text-gray-400 mt-0.5">{titleCase(p.brandName)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">{p.totalOrders}</td>
                    <td className="py-3 px-4 text-right text-gray-700 font-medium">{fmtEur(cvtEur(p.totalRevenue, p.currency))}</td>
                    <td className="py-3 px-4 text-right"><RefundPctBadge pct={p.refundRevenuePct} /></td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-900">{fmtEur(cvtEur(p.returnedRevenue, p.currency))}</td>
                    <td className="py-3 px-4 text-right text-gray-500">{p.returnedOrders > 0 ? p.returnedOrders : <span className="text-gray-300">—</span>}</td>
                    <td className="py-3 px-4 text-right">
                      {p.disputeCount > 0
                        ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200">{p.disputeCount}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Disputes detail table */}
        {!loading && disputes.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800">Chargebacks & Disputes — detail</div>
                <div className="text-xs text-gray-400 mt-0.5">Via Shopify Payments · {activeLabel} · {periodLabel}</div>
              </div>
              <span className="text-xs text-gray-400">
                {disputes.length} dispute{disputes.length !== 1 ? 's' : ''} · {fmtEur(totalDisputeAmountEur)}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Datum', 'Store', 'Bedrag', 'Type', 'Reden', 'Producten', 'Status', 'Deadline'].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {disputes.map(d => {
                  const statusInfo = DISPUTE_STATUS[d.status] ?? { label: d.status, color: 'bg-gray-100 text-gray-500' };
                  return (
                    <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-gray-600 text-xs whitespace-nowrap">{fmtDate(d.initiatedAt)}</td>
                      <td className="py-3 px-4 text-lg">{STORE_FLAGS[d.store]}</td>
                      <td className="py-3 px-4 font-semibold text-gray-900">{fmtEur(cvtEur(d.amount, d.currency))}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${d.type === 'chargeback' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                          {d.type === 'chargeback' ? 'Chargeback' : 'Inquiry'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-xs">{formatReason(d.reason)}</td>
                      <td className="py-3 px-4 text-xs text-gray-600 max-w-[200px]">
                        {d.products.length > 0
                          ? d.products.map(p => p.title).join(', ')
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">{fmtDate(d.evidenceDueBy ?? '')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
