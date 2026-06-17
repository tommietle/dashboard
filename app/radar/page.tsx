'use client';

import { useState, useEffect, useCallback } from 'react';

type ThreatLevel = 'RED_FLAG' | 'WATCH';

interface TriggerMatch {
  level: ThreatLevel;
  phrase: string;
  context: string;
}

interface RadarItem {
  conversationId: string;
  number: number;
  subject: string;
  customerName: string;
  customerEmail: string;
  updatedAt: string;
  url: string;
  match: TriggerMatch;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m geleden`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}u geleden`;
  return `${Math.floor(hrs / 24)}d geleden`;
}

export default function RadarPage() {
  const [items, setItems]     = useState<RadarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<'all' | ThreatLevel>('all');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/chargeback-radar')
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setItems(d.items || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const redFlags = items.filter(i => i.match.level === 'RED_FLAG');
  const watches  = items.filter(i => i.match.level === 'WATCH');
  const shown    = filter === 'all' ? items : items.filter(i => i.match.level === filter);

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chargeback Radar</h1>
          {!loading && !error && (
            <p className="text-sm text-gray-400 mt-0.5">
              Re:amaze inbox · laatste 14 dagen · {items.length} signaal{items.length !== 1 ? 'en' : ''}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          {loading ? 'Laden…' : '↻ Vernieuwen'}
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-6">
        {([
          { key: 'all',      label: `Alles (${items.length})`,          cls: filter === 'all'      ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
          { key: 'RED_FLAG', label: `🚨 Red Flag (${redFlags.length})`, cls: filter === 'RED_FLAG' ? 'bg-red-600 text-white'   : 'bg-red-50 text-red-700 hover:bg-red-100'   },
          { key: 'WATCH',    label: `👁 Watch (${watches.length})`,     cls: filter === 'WATCH'    ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
        ] as const).map(({ key, label, cls }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${cls}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-8">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Re:amaze inbox scannen…
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          <strong>Fout:</strong> {error}
        </div>
      )}

      {!loading && !error && shown.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
          <div className="text-3xl mb-2">✅</div>
          <div className="text-emerald-800 font-semibold">Geen signalen gevonden</div>
          <div className="text-emerald-600 text-sm mt-1">
            {filter === 'all'
              ? 'Geen chargeback-dreigementen in de Re:amaze inbox van de afgelopen 14 dagen.'
              : `Geen ${filter === 'RED_FLAG' ? 'Red Flag' : 'Watch'} signalen gevonden.`}
          </div>
        </div>
      )}

      {/* Items */}
      {!loading && !error && shown.length > 0 && (
        <div className="space-y-3">
          {shown.map(item => {
            const isRed = item.match.level === 'RED_FLAG';
            return (
              <div
                key={item.conversationId}
                className={`rounded-xl border p-4 ${isRed ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Level badge + time */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        isRed ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {isRed ? '🚨 RED FLAG' : '👁 WATCH'}
                      </span>
                      <span className="text-xs text-gray-400">{timeAgo(item.updatedAt)}</span>
                      <span className="text-xs text-gray-300">#{item.number}</span>
                    </div>

                    {/* Customer */}
                    <div className="font-semibold text-gray-900 text-sm truncate">{item.customerName}</div>
                    <div className="text-xs text-gray-500 truncate mb-1">{item.customerEmail}</div>

                    {/* Subject */}
                    <div className="text-sm text-gray-700 font-medium truncate">{item.subject}</div>

                    {/* Context excerpt */}
                    <div className={`text-sm mt-1.5 italic line-clamp-2 ${isRed ? 'text-red-700' : 'text-amber-700'}`}>
                      "{item.match.context}"
                    </div>

                    {/* Trigger */}
                    <div className="text-xs text-gray-400 mt-1.5">
                      Trigger:{' '}
                      <code className="bg-white/70 px-1.5 py-0.5 rounded text-[11px]">
                        {item.match.phrase}
                      </code>
                    </div>
                  </div>

                  {/* CTA */}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`shrink-0 text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${
                      isRed
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    }`}
                  >
                    Open →
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
