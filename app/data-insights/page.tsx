'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import RevenueChart from '@/components/RevenueChart';
import TopProductsTable from '@/components/TopProductsTable';
import { StoreMetrics, StoreKey } from '@/lib/shopify';
import { TopProduct } from '@/lib/shopifyProducts';
import { ProductRoas } from '@/lib/googleAdsProducts';

const STORES: { key: StoreKey; label: string }[] = [
  { key: 'all',         label: 'All Stores'     },
  { key: 'luhvia',      label: '🇺🇸 Luhvia'      },
  { key: 'cecole',      label: '🇨🇦 Cecole'      },
  { key: 'luvande',     label: '🇬🇧 Luvande'     },
  { key: 'modemeister', label: '🇵🇱 Modemeister' },
];

const DATE_PRESETS = [
  { label: 'Last 7 days',  days: 7  },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

function getRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function fmtEur(v: number) {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function DataInsightsPage() {
  const [selectedStore, setSelectedStore] = useState<StoreKey>('all');
  const [showStoreMenu, setShowStoreMenu] = useState(false);
  const [days, setDays] = useState(30);
  const [stores, setStores] = useState<StoreMetrics[]>([]);
  const [products, setProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fxRates, setFxRates] = useState<Record<string, number>>({ USD: 1.08, CAD: 1.47, GBP: 0.86, EUR: 1 });
  const [qcChecks, setQcChecks] = useState<Record<string, boolean>>({});
  const [brandOverrides, setBrandOverrides] = useState<Record<string, string>>({});

  // Product performance (ROAS) section
  const [roasProducts, setRoasProducts] = useState<ProductRoas[]>([]);
  const [roasLoading, setRoasLoading]   = useState(false);
  const [spendMin, setSpendMin]         = useState('100');
  const [roasMin,  setRoasMin]          = useState('2.5');

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getRange(days);
      const [shopRes, prodRes] = await Promise.all([
        fetch(`/api/shopify?store=${selectedStore}&start=${start}&end=${end}`),
        fetch(`/api/shopify-products?store=${selectedStore}&start=${start}&end=${end}`),
      ]);
      const shopJson = await shopRes.json();
      if (shopJson.error) throw new Error(shopJson.error);
      setStores(shopJson.stores || []);
      const prodJson = await prodRes.json();
      const prods: TopProduct[] = prodJson.products || [];
      setProducts(prods);

      // Afbeeldingen ophalen via meta API
      if (prods.length > 0) {
        try {
          const topN = 50;
          const luhviaIds      = prods.filter(p => p.store === 'luhvia').slice(0, topN).map(p => p.productId);
          const cecoleIds      = prods.filter(p => p.store === 'cecole').slice(0, topN).map(p => p.productId);
          const luvandeIds     = prods.filter(p => p.store === 'luvande').slice(0, topN).map(p => p.productId);
          const modemeisterIds = prods.filter(p => p.store === 'modemeister').slice(0, topN).map(p => p.productId);
          const metaRes = await fetch('/api/shopify-products/meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store: selectedStore, luhvia: luhviaIds, cecole: cecoleIds, luvande: luvandeIds, modemeister: modemeisterIds }),
          });
          if (metaRes.ok) {
            const meta = await metaRes.json();
            setProducts(prev => prev.map(p => {
              const m = meta[p.store]?.[p.productId];
              if (!m) return p;
              return { ...p, ...(m.imageUrl ? { imageUrl: m.imageUrl } : {}), ...(m.brandName ? { brandName: m.brandName } : {}) };
            }));
          }
        } catch { /* niet kritiek */ }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedStore, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    fetch('/api/qc-checks').then(r => r.json()).then(setQcChecks).catch(() => {});
    fetch('/api/brand-overrides').then(r => r.json()).then(setBrandOverrides).catch(() => {});
  }, []);

  // ROAS product data ophalen (30D + Shopify revenue merge)
  useEffect(() => {
    setRoasLoading(true);
    const end = new Date().toISOString().slice(0, 10);
    Promise.all([
      fetch(`/api/product-roas?store=${selectedStore}&end=${end}&d90=1`).then(r => r.json()),
      fetch(`/api/shopify-product-revenue?store=${selectedStore}&end=${end}&d90=1`).then(r => r.json()),
    ]).then(([roasJson, revJson]) => {
      const base: ProductRoas[] = roasJson.products || [];
      const shopRev: { productId: string; store: string; d30: number }[] = revJson.products || [];
      const map = new Map(shopRev.map(r => [`${r.store}:${r.productId}`, r.d30 ?? 0]));
      const round = (v: number) => Math.round(v * 100) / 100;
      const merged = base.map(p => {
        const rev = map.get(`${p.store}:${p.productId}`) ?? 0;
        return {
          ...p,
          d30: { ...p.d30, revenue: round(rev), roas: p.d30.spend > 0 ? round(rev / p.d30.spend) : 0 },
        };
      });
      setRoasProducts(merged);
    }).catch(() => {}).finally(() => setRoasLoading(false));
  }, [selectedStore]);

  const handleQcChange = useCallback(async (store: string, productId: string, checked: boolean) => {
    const key = `${store}:${productId}`;
    setQcChecks(prev => {
      const next = { ...prev };
      if (checked) next[key] = true; else delete next[key];
      return next;
    });
    await fetch('/api/qc-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store, productId, checked }),
    });
  }, []);

  const totalRevenueEur = stores.reduce((s, st) => s + cvtEur(st.totalRevenue, st.currency), 0);
  const totalOrders     = stores.reduce((s, st) => s + st.totalOrders, 0);
  const totalAovEur     = totalOrders > 0 ? totalRevenueEur / totalOrders : 0;
  const activeLabel  = STORES.find(s => s.key === selectedStore)?.label ?? 'All Stores';

  const filteredRoasProducts = useMemo(() => {
    const sMin = spendMin !== '' ? Number(spendMin) : 0;
    const rMin = roasMin  !== '' ? Number(roasMin)  : 0;
    return roasProducts
      .filter(p => p.d30.spend >= sMin && (rMin === 0 || p.d30.roas >= rMin))
      .sort((a, b) => b.d30.spend - a.d30.spend);
  }, [roasProducts, spendMin, roasMin]);

  return (
    <div className="min-h-screen bg-[#f0f2f7]">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <h1 className="text-lg font-bold text-gray-900 mr-2">Data Insights</h1>

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
            <button key={p.days} onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${days === p.days ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={fetchData} className="p-1.5 ml-1 text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>
      </header>

      <div className="px-6 py-6 space-y-5">
        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">⚠️ {error}</div>}

        {/* KPI cards */}
        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl border border-gray-200 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total Revenue" value={fmtEur(totalRevenueEur)} sub={`${days} days · ${stores.length} store${stores.length !== 1 ? 's' : ''}`} />
            <StatCard label="Total Orders"  value={totalOrders.toLocaleString('nl-NL')} sub={`Avg ${days} days`} />
            <StatCard label="Avg Order Value" value={totalOrders > 0 ? fmtEur(totalAovEur) : '—'} />
          </div>
        )}

        {/* Per-store KPIs */}
        {!loading && stores.length > 1 && (
          <div className="grid grid-cols-2 gap-4">
            {stores.map(store => (
              <div key={store.store} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  {store.flag} {store.storeName}
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-xl font-bold text-gray-900">{fmtEur(cvtEur(store.totalRevenue, store.currency))}</div>
                    <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">Revenue</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold text-gray-900">{store.totalOrders.toLocaleString('nl-NL')}</div>
                    <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">Orders</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold text-gray-900">{fmtEur(cvtEur(store.averageOrderValue, store.currency))}</div>
                    <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">AOV</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Revenue chart */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-800 mb-1">Revenue Trend</div>
          <div className="text-xs text-gray-400 mb-4">{activeLabel} · Last {days} days</div>
          {loading ? (
            <div className="h-60 bg-gray-50 rounded-xl animate-pulse" />
          ) : stores.length > 0 ? (
            <RevenueChart stores={stores} />
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-400 text-sm">No data</div>
          )}
        </div>

        {/* Top products */}
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-800">Top Products by Revenue</div>
              <div className="text-xs text-gray-400 mt-0.5">Shopify verkoopdata · Last {days} days</div>
            </div>
            {!loading && <span className="text-xs text-gray-400">{products.length} products</span>}
          </div>
          {loading ? (
            <div className="p-5 space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}
            </div>
          ) : (
            <TopProductsTable products={products} selectedStore={selectedStore} toEur={cvtEur} qcChecks={qcChecks} onQcChange={handleQcChange} brandOverrides={brandOverrides} />
          )}
        </div>

        {/* Product Performance (ROAS) */}
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-gray-800">Product Performance</div>
              <div className="text-xs text-gray-400 mt-0.5">Google Ads + Shopify · 30D</div>
            </div>
            <div className="flex items-center gap-3 ml-auto flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 font-medium">Min spend</span>
                <input
                  type="number"
                  value={spendMin}
                  onChange={e => setSpendMin(e.target.value)}
                  placeholder="0"
                  className="w-20 px-2 py-1 text-sm border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 font-medium">Min ROAS</span>
                <input
                  type="number"
                  value={roasMin}
                  onChange={e => setRoasMin(e.target.value)}
                  placeholder="0"
                  className="w-20 px-2 py-1 text-sm border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              {roasLoading && (
                <svg className="animate-spin text-gray-400" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeOpacity="0.25"/><path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round"/>
                </svg>
              )}
              {!roasLoading && <span className="text-xs text-gray-400">{filteredRoasProducts.length} products</span>}
            </div>
          </div>

          {roasLoading ? (
            <div className="p-5 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}
            </div>
          ) : filteredRoasProducts.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-10">Geen producten gevonden met deze drempelwaarden.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-8">#</th>
                    {selectedStore === 'all' && (
                      <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Store</th>
                    )}
                    <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Product</th>
                    <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Spend 30D</th>
                    <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Revenue 30D</th>
                    <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">ROAS 30D</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredRoasProducts.map((p, i) => {
                    const roas = p.d30.roas;
                    const roasColor = roas >= 4 ? 'text-green-600' : roas >= 2 ? 'text-lime-600' : roas >= 1 ? 'text-amber-600' : 'text-red-500';
                    const storeFlags: Record<string, string> = { luhvia: '🇺🇸', cecole: '🇨🇦', luvande: '🇬🇧', modemeister: '🇵🇱' };
                    return (
                      <tr key={`${p.store}:${p.productId}`} className="hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 px-4 text-gray-300 text-xs">{i + 1}</td>
                        {selectedStore === 'all' && (
                          <td className="py-2.5 px-4 text-base">{storeFlags[p.store]}</td>
                        )}
                        <td className="py-2.5 px-4 text-gray-800 max-w-xs">
                          <div className="truncate">{p.title}</div>
                          {p.brandName && <div className="text-[11px] text-gray-400 truncate">{p.brandName}</div>}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-gray-700 text-xs">
                          €{p.d30.spend.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-gray-700 text-xs">
                          €{p.d30.revenue.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-bold text-xs ${roasColor}`}>
                          {roas > 0 ? `${roas.toFixed(2)}x` : <span className="text-gray-300 font-normal">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
