'use client';

import { useState, useEffect, useCallback } from 'react';

interface ChargebackCase {
  id: string;
  store: string;
  storeName: string;
  flag: string;
  orderName: string | null;
  customerEmail: string | null;
  customerName: string | null;
  amount: number;
  currency: string;
  reason: string;
  reasonLabel: string;
  status: string;
  statusLabel: string;
  outcome: 'lost' | 'won' | 'open';
  initiatedAt: string;
  daysOrderToCb: number | null;
  products: string[];
  contactedBefore: boolean;
  threatenedChargeback: boolean;
  grievance: string;
  rootCause: string;
  keyQuote: string | null;
  reamazeUrl: string | null;
  threads: { subject: string; date: string }[];
}

const STORES = [
  { key: 'all', label: 'Both stores' },
  { key: 'cecole', label: '🇨🇦 Cecole' },
  { key: 'luhvia', label: '🇺🇸 Luhvia' },
];
const CURRENCIES = ['all', 'USD', 'CAD', 'GBP'];

function money(v: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
}

const OUTCOME = {
  lost: { label: 'Lost', cls: 'bg-red-100 text-red-700 border-red-200' },
  won: { label: 'Won / Prevented', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  open: { label: 'Open', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
} as const;

function CaseCard({ c }: { c: ChargebackCase }) {
  const o = OUTCOME[c.outcome];
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-3">
      {/* header */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${o.cls}`}>
              {o.label}
            </span>
            <span className="font-semibold text-gray-900 text-sm">
              {c.orderName || `Dispute ${c.id.slice(-6)}`}
            </span>
            <span className="text-sm font-bold text-gray-900">{money(c.amount, c.currency)}</span>
            <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
              {c.reasonLabel}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5 truncate">
            {c.customerName ? `${c.customerName} · ` : ''}
            {c.customerEmail || 'unknown customer'}
            {c.daysOrderToCb != null && ` · ${c.daysOrderToCb}d after order`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-medium text-gray-600">{c.flag} {c.storeName}</div>
          <div className="text-[11px] text-gray-400">{c.initiatedAt.slice(0, 10)}</div>
        </div>
      </div>

      {/* products */}
      {c.products.length > 0 && (
        <div className="text-xs text-gray-500 truncate">📦 {c.products.join(', ')}</div>
      )}

      {/* signals */}
      <div className="flex flex-wrap gap-1.5">
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-slate-50 text-slate-600 border-slate-200">
          {c.grievance}
        </span>
        {c.contactedBefore ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-blue-50 text-blue-700 border-blue-200">
            ✉️ Contacted support first
          </span>
        ) : (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-gray-50 text-gray-500 border-gray-200">
            No prior contact
          </span>
        )}
        {c.threatenedChargeback && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-red-50 text-red-700 border-red-200">
            ⚠️ Threatened chargeback in chat
          </span>
        )}
      </div>

      {/* why it went wrong */}
      <div className="bg-amber-50/60 border border-amber-100 rounded-xl px-3 py-2">
        <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-0.5">
          Why it likely went wrong
        </div>
        <p className="text-[13px] text-gray-700 leading-snug">{c.rootCause}</p>
      </div>

      {/* customer quote */}
      {c.keyQuote && (
        <p className="text-[13px] text-gray-500 italic leading-snug border-l-2 border-gray-200 pl-3">
          “{c.keyQuote}…”
        </p>
      )}

      {/* actions */}
      <div className="flex items-center gap-2">
        {c.reamazeUrl && (
          <a
            href={c.reamazeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors"
          >
            Open conversation →
          </a>
        )}
        {c.customerEmail && (
          <a
            href={`mailto:${c.customerEmail}`}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Email customer
          </a>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 flex-1">
      <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

export default function ChargebackCasesPage() {
  const [store, setStore] = useState('all');
  const [currency, setCurrency] = useState('all');
  const [cases, setCases] = useState<ChargebackCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chargeback-cases?store=${store}&currency=${currency}`);
      const data = await res.json();
      setCases(data.cases || []);
      if (data.error) setError(data.error);
    } catch {
      setError('Failed to load cases.');
    } finally {
      setLoading(false);
    }
  }, [store, currency]);

  useEffect(() => {
    load();
  }, [load]);

  const lost = cases.filter((c) => c.outcome === 'lost');
  const lostAmt = lost.reduce((s, c) => s + c.amount, 0);
  const contactedPct = cases.length
    ? Math.round((cases.filter((c) => c.contactedBefore).length / cases.length) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-[#f0f2f7]">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900 leading-tight">Chargeback Cases</h1>
          <p className="text-[11px] text-gray-400 leading-tight">
            Cecole &amp; Luhvia chargebacks (USD/CAD/GBP) — what happened and why
          </p>
        </div>

        <div className="flex items-center gap-1 ml-2">
          {STORES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStore(s.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                store === s.key ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {CURRENCIES.map((cur) => (
            <button
              key={cur}
              onClick={() => setCurrency(cur)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                currency === cur ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {cur === 'all' ? 'All ccy' : cur}
            </button>
          ))}
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="p-6 space-y-6 max-w-4xl">
        <div className="flex gap-4">
          <Kpi label="Chargebacks" value={String(cases.length)} />
          <Kpi label="Lost" value={String(lost.length)} accent="text-red-600" />
          <Kpi label="Lost amount" value={cases.length ? money(lostAmt, lost[0]?.currency || cases[0].currency) : '—'} accent="text-red-600" />
          <Kpi label="Contacted first" value={`${contactedPct}%`} accent="text-blue-600" />
        </div>

        {error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl px-4 py-2">
            {error}
          </div>
        )}

        {loading && cases.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 bg-white/60 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : cases.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <div className="text-3xl mb-2">📭</div>
            <h2 className="font-semibold text-gray-900 mb-1">No chargebacks</h2>
            <p className="text-sm text-gray-500">No chargebacks for this filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cases.map((c) => (
              <CaseCard key={`${c.store}-${c.id}`} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
