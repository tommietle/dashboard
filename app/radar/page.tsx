'use client';

import { useState, useEffect, useCallback } from 'react';

type StoreKey = 'all' | 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

interface DetectedTrigger {
  key: string;
  label: string;
  icon: string;
  type: 'threat' | 'signal';
}

interface RadarItem {
  store: string;
  storeName: string;
  flag: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  orderRef: string | null;
  orderValue: number | null;
  currency: string;
  ordersCount: number | null;
  daysOpen: number;
  lastMessageAt: string;
  snippet: string;
  triggers: DetectedTrigger[];
  tier: 'red' | 'watch';
  reamazeUrl: string | null;
  severity: number;
  answered: boolean;
  waitingDays: number | null;
  readyToClose: boolean;
  quietDays: number | null;
}

const STORES: { key: StoreKey; label: string }[] = [
  { key: 'all',         label: 'All Stores'     },
  { key: 'luhvia',      label: '🇺🇸 Luhvia'      },
  { key: 'cecole',      label: '🇨🇦 Cecole'      },
  { key: 'luvande',     label: '🇬🇧 Luvande'     },
  { key: 'modemeister', label: '🇵🇱 Modemeister' },
];

function money(v: number | null, currency: string): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(v);
}

function Chip({ t }: { t: DetectedTrigger }) {
  const cls = t.type === 'threat'
    ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-slate-50 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${cls}`}>
      <span>{t.icon}</span>
      {t.label}
    </span>
  );
}

function Card({ item }: { item: RadarItem }) {
  const red = item.tier === 'red';
  return (
    <div className={`bg-white rounded-2xl border p-4 flex flex-col gap-2.5 transition-shadow hover:shadow-sm ${red ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${red ? 'bg-red-500' : 'bg-amber-400'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm truncate">
              {item.customerName || item.customerEmail}
            </span>
            {item.readyToClose ? (
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                🟢 Ready to close{item.quietDays != null ? ` · ${item.quietDays}d quiet` : ''}
              </span>
            ) : item.answered ? (
              <span className="text-[10px] font-medium text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">
                ✓ Replied
              </span>
            ) : (
              <span className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded">
                ⏳ Awaiting reply{item.waitingDays != null ? ` · ${item.waitingDays}d` : ''}
              </span>
            )}
            {item.ordersCount === 1 && (
              <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                1st order
              </span>
            )}
            {(item.ordersCount ?? 0) > 1 && (
              <span className="text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                🔁 {item.ordersCount} orders
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 truncate">{item.customerEmail}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-medium text-gray-600 whitespace-nowrap">
            {item.flag} {item.storeName}
          </div>
          <div className={`text-[11px] font-semibold ${item.daysOpen >= 14 ? 'text-red-600' : 'text-gray-400'}`}>
            {item.daysOpen}d open
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500 pl-5">
        {item.orderRef && <span className="font-semibold text-gray-700">{item.orderRef}</span>}
        {item.orderValue != null && (
          <>
            <span className="text-gray-300">·</span>
            <span className="font-semibold text-gray-900">{money(item.orderValue, item.currency)}</span>
          </>
        )}
        <span className="text-gray-300">·</span>
        <span className="truncate italic">"{item.subject}"</span>
      </div>

      <div className="flex flex-wrap gap-1.5 pl-5">
        {item.triggers.map((t) => <Chip key={t.key} t={t} />)}
      </div>

      {item.snippet && (
        <p className="text-[13px] text-gray-600 leading-snug pl-5 line-clamp-2">"{item.snippet}…"</p>
      )}

      <div className="flex items-center gap-2 pl-5 pt-0.5">
        {item.reamazeUrl && (
          <a
            href={item.reamazeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              red ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-gray-900 text-white hover:bg-gray-700'
            }`}
          >
            Open in Re:amaze →
          </a>
        )}
        <a
          href={`mailto:${item.customerEmail}`}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Email customer
        </a>
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

export default function RadarPage() {
  const [store, setStore]         = useState<StoreKey>('all');
  const [items, setItems]         = useState<RadarItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chargeback-radar?store=${store}`);
      const data = await res.json();
      setConfigured(data.configured !== false);
      setItems(data.items || []);
      if (data.error) setError(data.error);
      setUpdatedAt(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setError('Failed to load radar.');
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => { load(); }, [load]);

  const red        = items.filter((i) => i.tier === 'red');
  const watch      = items.filter((i) => i.tier === 'watch');
  const unanswered = items.filter((i) => !i.answered).length;
  const readyClose = items.filter((i) => i.readyToClose).length;
  const atRisk     = red.reduce((s, i) => s + (i.orderValue || 0), 0);

  return (
    <div className="min-h-screen bg-[#f0f2f7]">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-bold text-gray-900 leading-tight">Chargeback Radar</h1>
          <p className="text-[11px] text-gray-400 leading-tight">
            Open support cases signalling a chargeback — unanswered first
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

        <div className="ml-auto flex items-center gap-3">
          {updatedAt && <span className="text-[11px] text-gray-400">Updated {updatedAt}</span>}
          <button
            onClick={load}
            disabled={loading}
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </header>

      <div className="p-6 space-y-6 max-w-5xl">
        {!configured ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <div className="text-3xl mb-2">🔌</div>
            <h2 className="font-semibold text-gray-900 mb-1">Re:amaze not connected</h2>
            <p className="text-sm text-gray-500">
              Add <code className="text-xs bg-gray-100 px-1 rounded">REAMAZE_LOGIN_EMAIL</code> and{' '}
              <code className="text-xs bg-gray-100 px-1 rounded">REAMAZE_API_TOKEN</code> to your
              environment to enable the radar.
            </p>
          </div>
        ) : (
          <>
            <div className="flex gap-4">
              <Kpi label="Red flags"      value={String(red.length)}   accent="text-red-600"     />
              <Kpi label="Unanswered"     value={String(unanswered)}   accent="text-red-600"     />
              <Kpi label="Watch"          value={String(watch.length)} accent="text-amber-500"   />
              <Kpi label="Ready to close" value={String(readyClose)}   accent="text-emerald-600" />
              <Kpi label="At risk"        value={money(atRisk || null, red[0]?.currency || 'USD')} />
            </div>

            {error && (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl px-4 py-2">
                {error}
              </div>
            )}

            {loading && items.length === 0 ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-28 bg-white/60 rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
                <div className="text-3xl mb-2">✅</div>
                <h2 className="font-semibold text-gray-900 mb-1">No chargeback signals</h2>
                <p className="text-sm text-gray-500">
                  No threatening or at-risk support messages in the recent inbox.
                </p>
              </div>
            ) : (
              <>
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                      Red flags — act now
                    </h2>
                    <span className="text-xs text-gray-400">{red.length}</span>
                  </div>
                  {red.length === 0 ? (
                    <p className="text-sm text-gray-400 pl-5">No active threats. 🎉</p>
                  ) : (
                    <div className="space-y-3">
                      {red.map((it, i) => <Card key={`${it.customerEmail}-${i}`} item={it} />)}
                    </div>
                  )}
                </section>

                {watch.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                        Watch — resolve before it escalates
                      </h2>
                      <span className="text-xs text-gray-400">{watch.length}</span>
                    </div>
                    <div className="space-y-3">
                      {watch.map((it, i) => <Card key={`${it.customerEmail}-${i}`} item={it} />)}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
