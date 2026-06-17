'use client';

import { useState, useEffect, useCallback } from 'react';

interface StoreConn {
  store: string;
  customerId: string | null;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  accessibleCustomers: string[];
}

interface TestState {
  loading: boolean;
  result?: string;
  error?: string;
}

const STORE_META: Record<string, { name: string; flag: string }> = {
  luhvia:  { name: 'Luhvia',  flag: '🇺🇸' },
  cecole:  { name: 'Cecole',  flag: '🇨🇦' },
  luvande: { name: 'Luvande', flag: '🇬🇧' },
};

function fmtCustomerId(id: string | null): string {
  if (!id) return '—';
  const d = id.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : id;
}

function errorText(code: string): string {
  switch (code) {
    case 'access_denied':
      return 'Je hebt de koppeling afgebroken in het Google-venster.';
    case 'no_refresh_token':
      return 'Google gaf geen refresh token terug. Probeer opnieuw te verbinden.';
    case 'missing_code':
      return 'De koppeling kwam onvolledig terug. Probeer het opnieuw.';
    default:
      return `Koppeling mislukt: ${code}`;
  }
}

export default function SettingsPage() {
  const [stores, setStores] = useState<StoreConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/google-ads/connections', { cache: 'no-store' });
      const data = await res.json();
      setStores(data.stores || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    const connected = q.get('connected');
    const error = q.get('error');
    if (connected) {
      setBanner({ ok: true, msg: `${STORE_META[connected]?.name ?? connected} is gekoppeld met Google Ads.` });
    } else if (error) {
      setBanner({ ok: false, msg: errorText(error) });
    }
    if (connected || error) window.history.replaceState({}, '', '/settings');
  }, [load]);

  async function disconnect(store: string) {
    await fetch(`/api/google-ads/connections?store=${store}`, { method: 'DELETE' });
    setTests((t) => ({ ...t, [store]: { loading: false } }));
    load();
  }

  async function runTest(store: string) {
    setTests((t) => ({ ...t, [store]: { loading: true } }));
    try {
      const res = await fetch(`/api/google-ads?store=${store}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || data.error) {
        setTests((t) => ({ ...t, [store]: { loading: false, error: data.error || 'Onbekende fout' } }));
      } else {
        const m = data.ads?.[0];
        setTests((t) => ({
          ...t,
          [store]: {
            loading: false,
            result: m
              ? `${m.spend.toLocaleString('nl-NL')} ${m.currency} spend · ROAS ${m.roas} · ${m.conversions} conversies (laatste 30 dagen)`
              : 'Verbonden, maar geen data in deze periode.',
          },
        }));
      }
    } catch (e: any) {
      setTests((t) => ({ ...t, [store]: { loading: false, error: e.message } }));
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Instellingen</h1>
      <p className="text-sm text-gray-500 mt-1">
        Koppel hier per webshop het Google Ads-account. Elk account wordt los
        verbonden via zijn eigen Google-login — er wordt niets onder een MCC gehangen.
      </p>

      {banner && (
        <div
          className={`mt-5 rounded-lg px-4 py-3 text-sm ${
            banner.ok
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {banner.msg}
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-3">
        Google Ads koppelingen
      </h2>

      {loading ? (
        <div className="text-sm text-gray-400">Laden…</div>
      ) : (
        <div className="space-y-3">
          {stores.map((s) => {
            const meta = STORE_META[s.store] ?? { name: s.store, flag: '' };
            const digits = (s.customerId || '').replace(/\D/g, '');
            const sees = s.connected && !!digits && s.accessibleCustomers.includes(digits);
            const test = tests[s.store];
            return (
              <div key={s.store} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-gray-900">
                      {meta.flag} {meta.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Account {fmtCustomerId(s.customerId)}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      s.connected
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {s.connected ? 'Verbonden' : 'Niet verbonden'}
                  </span>
                </div>

                {s.connected && (
                  <div className="text-xs text-gray-500 mt-3 space-y-1">
                    {s.email && (
                      <div>
                        Ingelogd als{' '}
                        <span className="text-gray-700 font-medium">{s.email}</span>
                      </div>
                    )}
                    {!!digits && (
                      <div className={sees ? 'text-emerald-600' : 'text-amber-600'}>
                        {sees
                          ? '✓ Deze login heeft toegang tot dit account.'
                          : `⚠ Deze login ziet account ${fmtCustomerId(
                              s.customerId
                            )} niet direct — verbind opnieuw met het juiste account.`}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                  <a
                    href={`/api/google-ads/connect?store=${s.store}`}
                    className="text-sm font-medium px-3.5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    {s.connected ? 'Opnieuw verbinden' : 'Verbinden met Google Ads'}
                  </a>
                  {s.connected && (
                    <>
                      <button
                        onClick={() => runTest(s.store)}
                        disabled={test?.loading}
                        className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        {test?.loading ? 'Testen…' : 'Test verbinding'}
                      </button>
                      <button
                        onClick={() => disconnect(s.store)}
                        className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gray-300 text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Loskoppelen
                      </button>
                    </>
                  )}
                </div>

                {test?.result && (
                  <div className="mt-3 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg px-3 py-2">
                    {test.result}
                  </div>
                )}
                {test?.error && (
                  <div className="mt-3 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2 break-words">
                    {test.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
