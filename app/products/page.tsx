'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ProductRoasTable from '@/components/ProductRoasTable';
import { ProductRoas } from '@/lib/googleAdsProducts';

interface SavedFilter {
  name: string;
  filters: {
    status: string;
    roasMin: string; roasMax: string;
    roas90Min: string; roas90Max: string;
    activeDaysMin: string;
    spendMin: string; spendMax: string;
    spend90Min: string; spend90Max: string;
    clicksMin: string; clicksMax: string;
    cpcMin: string; cpcMax: string;
    customStart: string; customEnd: string;
  };
}

const STORES = [
  { key: 'all',         label: 'All Stores'     },
  { key: 'luhvia',      label: '🇺🇸 Luhvia'      },
  { key: 'cecole',      label: '🇨🇦 Cecole'      },
  { key: 'luvande',     label: '🇬🇧 Luvande'     },
  { key: 'modemeister', label: '🇵🇱 Modemeister' },
];

function NumInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}

function Dash() {
  return <span className="text-gray-400 text-sm">–</span>;
}

interface Collection { id: string; title: string; }

export default function ProductsPage() {
  const [selectedStore, setSelectedStore]   = useState('all');
  const [showStoreMenu, setShowStoreMenu]   = useState(false);
  const [products, setProducts]             = useState<ProductRoas[]>([]);
  const [orphanSpend, setOrphanSpend]       = useState<Record<string, number>>({});
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [endDate, setEndDate]               = useState('');
  const [brandOverrides, setBrandOverrides] = useState<Record<string, string>>({});
  const fetchIdRef = useRef(0);

  // Collection filter
  const [collections, setCollections]               = useState<Collection[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());
  const [excludedCollections, setExcludedCollections] = useState<Set<string>>(new Set());
  const [collectionProductIds, setCollectionProductIds]   = useState<Set<string> | null>(null);
  const [excludedProductIds,   setExcludedProductIds]     = useState<Set<string> | null>(null);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [showCollectionMenu, setShowCollectionMenu] = useState(false);
  const collectionMenuRef = useRef<HTMLDivElement>(null);

  // Filter state
  const [search,    setSearch]    = useState('');
  const [status,    setStatus]    = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [roasMin,   setRoasMin]   = useState('');
  const [roasMax,   setRoasMax]   = useState('');
  const [roas90Min, setRoas90Min] = useState('');
  const [roas90Max,     setRoas90Max]     = useState('');
  const [activeDaysMin, setActiveDaysMin] = useState('');
  const [spendMin,   setSpendMin]   = useState('');
  const [spendMax,   setSpendMax]   = useState('');
  const [spend90Min, setSpend90Min] = useState('');
  const [spend90Max, setSpend90Max] = useState('');
  const [clicksMin, setClicksMin] = useState('');
  const [clicksMax, setClicksMax] = useState('');
  const [cpcMin,    setCpcMin]    = useState('');
  const [cpcMax,    setCpcMax]    = useState('');
  // Custom datumbereik — als beide zijn gezet wordt er een extra kolom getoond.
  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');
  const customActive = !!customStart && !!customEnd && customStart <= customEnd;

  // Saved filters (localStorage)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [showSavedMenu, setShowSavedMenu] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState('');
  const savedMenuRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    const myId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const end = new Date().toISOString().slice(0, 10);
      setEndDate(end);
      const customQuery = customActive
        ? `&customStart=${customStart}&customEnd=${customEnd}`
        : '';
      const [roasRes, revRes] = await Promise.all([
        fetch(`/api/product-roas?store=${selectedStore}&end=${end}${customQuery}&d90=1`),
        fetch(`/api/shopify-product-revenue?store=${selectedStore}&end=${end}${customQuery}&d90=1`),
      ]);
      if (myId !== fetchIdRef.current) return; // stale — a newer fetch is in flight
      const json = await roasRes.json();
      if (json.error) throw new Error(json.error);
      const base: ProductRoas[] = json.products;
      setOrphanSpend(json.orphanSpend ?? {});

      // Vervang Google Ads conversion value door echte Shopify omzet per product
      // en hereken ROAS per periode. Zonder Shopify-match: revenue = 0, roas = 0.
      let merged = base;
      if (revRes.ok) {
        const revJson = await revRes.json();
        const shopRev: { productId: string; store: string; d90: number; d30: number; d14: number; d7: number; custom?: number }[] = revJson.products || [];
        const map = new Map<string, { d90: number; d30: number; d14: number; d7: number; custom?: number }>();
        for (const r of shopRev) map.set(`${r.store}:${r.productId}`, { d90: r.d90 ?? 0, d30: r.d30, d14: r.d14, d7: r.d7, custom: r.custom });
        const round = (v: number) => Math.round(v * 100) / 100;
        merged = base.map(p => {
          const r = map.get(`${p.store}:${p.productId}`) ?? { d90: 0, d30: 0, d14: 0, d7: 0, custom: 0 };
          // p.d30.revenue is op dit punt nog Google Ads-omzet — bewaren als adsRevenue.
          const out: ProductRoas = {
            ...p,
            d90: { ...p.d90, adsRevenue: p.d90.adsRevenue ?? p.d90.revenue, revenue: round(r.d90), roas: p.d90.spend > 0 ? round(r.d90 / p.d90.spend) : 0 },
            d30: { ...p.d30, adsRevenue: p.d30.adsRevenue ?? p.d30.revenue, revenue: round(r.d30), roas: p.d30.spend > 0 ? round(r.d30 / p.d30.spend) : 0 },
            d14: { ...p.d14, adsRevenue: p.d14.adsRevenue ?? p.d14.revenue, revenue: round(r.d14), roas: p.d14.spend > 0 ? round(r.d14 / p.d14.spend) : 0 },
            d7:  { ...p.d7,  adsRevenue: p.d7.adsRevenue  ?? p.d7.revenue,  revenue: round(r.d7),  roas: p.d7.spend  > 0 ? round(r.d7  / p.d7.spend)  : 0 },
          };
          if (p.custom) {
            const customRev = r.custom ?? 0;
            out.custom = {
              ...p.custom,
              adsRevenue: p.custom.adsRevenue ?? p.custom.revenue,
              revenue: round(customRev),
              roas: p.custom.spend > 0 ? round(customRev / p.custom.spend) : 0,
            };
          }
          return out;
        });
      }
      setProducts(merged);
      setLoading(false);

      // Per store top 50 op spend — anders pakt slice(0,150) alleen Luhvia
      // omdat de flat array gesorteerd is als [alle Luhvia, alle Cecole, alle Luvande].
      const topN = 50;
      const luhviaIds      = merged.filter(p => p.store === 'luhvia').slice(0, topN).map(p => p.productId);
      const cecoleIds      = merged.filter(p => p.store === 'cecole').slice(0, topN).map(p => p.productId);
      const luvandeIds     = merged.filter(p => p.store === 'luvande').slice(0, topN).map(p => p.productId);
      const modemeisterIds = merged.filter(p => p.store === 'modemeister').slice(0, topN).map(p => p.productId);
      if (luhviaIds.length || cecoleIds.length || luvandeIds.length || modemeisterIds.length) {
        try {
          const metaRes = await fetch('/api/shopify-products/meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store: selectedStore, luhvia: luhviaIds, cecole: cecoleIds, luvande: luvandeIds, modemeister: modemeisterIds }),
          });
          if (myId !== fetchIdRef.current) return; // stale
          if (metaRes.ok) {
            const meta = await metaRes.json();
            setProducts(prev => prev.map(p => {
              const m = meta[p.store]?.[p.productId];
              return m ? { ...p, status: m.status, variantCount: m.variantCount, imageUrl: m.imageUrl, brandName: m.brandName } : p;
            }));
          }
        } catch (e) {
          console.warn('Shopify meta enrichment skipped:', e);
        }
      }
    } catch (e: any) {
      if (myId !== fetchIdRef.current) return; // stale
      setError(e.message);
      setLoading(false);
    }
  }, [selectedStore, customStart, customEnd, customActive]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Brand overrides ophalen — eenmalig bij mount, onafhankelijk van store/datum.
  useEffect(() => {
    fetch('/api/brand-overrides')
      .then(r => r.json())
      .then((data: Record<string, string>) => setBrandOverrides(data))
      .catch(() => {});
  }, []);

  // Collections laden als een specifieke store is geselecteerd.
  useEffect(() => {
    setSelectedCollections(new Set());
    setExcludedCollections(new Set());
    setCollectionProductIds(null);
    setExcludedProductIds(null);
    setCollections([]);
    if (selectedStore === 'all') return;
    setCollectionsLoading(true);
    fetch(`/api/shopify-collections?store=${selectedStore}`)
      .then(r => r.json())
      .then(data => setCollections(data.collections || []))
      .catch(() => {})
      .finally(() => setCollectionsLoading(false));
  }, [selectedStore]);

  // Product-IDs laden voor alle geselecteerde collecties (union).
  useEffect(() => {
    if (selectedCollections.size === 0) { setCollectionProductIds(null); return; }
    Promise.all(
      Array.from(selectedCollections).map(id =>
        fetch(`/api/shopify-collections?store=${selectedStore}&collectionId=${id}`)
          .then(r => r.json())
          .then(data => data.productIds as string[] || [])
          .catch(() => [] as string[])
      )
    ).then(results => setCollectionProductIds(new Set<string>(results.flat())));
  }, [selectedCollections, selectedStore]);

  // Product-IDs laden voor alle uitgesloten collecties (union).
  useEffect(() => {
    if (excludedCollections.size === 0) { setExcludedProductIds(null); return; }
    Promise.all(
      Array.from(excludedCollections).map(id =>
        fetch(`/api/shopify-collections?store=${selectedStore}&collectionId=${id}`)
          .then(r => r.json())
          .then(data => data.productIds as string[] || [])
          .catch(() => [] as string[])
      )
    ).then(results => setExcludedProductIds(new Set<string>(results.flat())));
  }, [excludedCollections, selectedStore]);

  // Sluit collection-menu bij klik buiten.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (collectionMenuRef.current && !collectionMenuRef.current.contains(e.target as Node)) {
        setShowCollectionMenu(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Saved filters uit localStorage laden.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('productSavedFilters');
      if (raw) setSavedFilters(JSON.parse(raw));
    } catch {}
  }, []);

  // Sluit saved-menu bij klik buiten.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (savedMenuRef.current && !savedMenuRef.current.contains(e.target as Node)) {
        setShowSavedMenu(false);
        setShowSaveInput(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function currentFilterSnapshot() {
    return { status, roasMin, roasMax, roas90Min, roas90Max, activeDaysMin, spendMin, spendMax, spend90Min, spend90Max, clicksMin, clicksMax, cpcMin, cpcMax, customStart, customEnd };
  }

  function saveCurrentFilter() {
    const name = saveName.trim();
    if (!name) return;
    const entry: SavedFilter = { name, filters: currentFilterSnapshot() };
    const updated = [...savedFilters.filter(f => f.name !== name), entry];
    setSavedFilters(updated);
    localStorage.setItem('productSavedFilters', JSON.stringify(updated));
    setSaveName('');
    setShowSaveInput(false);
  }

  function applyFilter(f: SavedFilter) {
    setStatus(f.filters.status);
    setRoasMin(f.filters.roasMin);   setRoasMax(f.filters.roasMax);
    setRoas90Min(f.filters.roas90Min ?? ''); setRoas90Max(f.filters.roas90Max ?? '');
    setActiveDaysMin(f.filters.activeDaysMin ?? '');
    setSpendMin(f.filters.spendMin); setSpendMax(f.filters.spendMax);
    setSpend90Min(f.filters.spend90Min ?? ''); setSpend90Max(f.filters.spend90Max ?? '');
    setClicksMin(f.filters.clicksMin); setClicksMax(f.filters.clicksMax);
    setCpcMin(f.filters.cpcMin ?? ''); setCpcMax(f.filters.cpcMax ?? '');
    setCustomStart(f.filters.customStart); setCustomEnd(f.filters.customEnd);
    setShowSavedMenu(false);
  }

  function deleteSavedFilter(name: string) {
    const updated = savedFilters.filter(f => f.name !== name);
    setSavedFilters(updated);
    localStorage.setItem('productSavedFilters', JSON.stringify(updated));
  }

  // Count active filters for badge
  const activeFilterCount = [roasMin, roasMax, roas90Min, roas90Max, activeDaysMin, spendMin, spendMax, spend90Min, spend90Max, clicksMin, clicksMax, cpcMin, cpcMax]
    .filter(v => v !== '').length + (status !== 'all' ? 1 : 0) + (customActive ? 1 : 0);

  function clearFilters() {
    setRoasMin(''); setRoasMax(''); setRoas90Min(''); setRoas90Max(''); setActiveDaysMin('');
    setSpendMin(''); setSpendMax(''); setSpend90Min(''); setSpend90Max('');
    setClicksMin(''); setClicksMax('');
    setCpcMin(''); setCpcMax('');
    setStatus('all');
    setSearch('');
    setCustomStart(''); setCustomEnd('');
  }

  // Apply filters + brand overrides client-side
  const filtered = useMemo(() => {
    return products
      .filter(p => selectedStore === 'all' || p.store === selectedStore)
      .filter(p => !collectionProductIds || collectionProductIds.has(p.productId))
      .filter(p => !excludedProductIds  || !excludedProductIds.has(p.productId))
      .map(p => {
        const override = brandOverrides[`${p.store}:${p.productId}`];
        return override !== undefined ? { ...p, brandName: override || undefined } : p;
      })
      .filter(p => {
        if (search) {
          const q = search.toLowerCase();
          if (
            !p.title.toLowerCase().includes(q) &&
            !p.productId.includes(q) &&
            !(p.brandName ?? '').toLowerCase().includes(q)
          ) return false;
        }
        if (status !== 'all') {
          // Products without Shopify enrichment have status='unknown' (only top 50 get enriched).
          // Treat unknown as active since unenriched products are most likely active.
          const effectiveStatus = p.status === 'unknown' ? 'active' : p.status;
          if (effectiveStatus !== status) return false;
        }
        if (roasMin   !== '' && p.d30.roas < Number(roasMin))   return false;
        if (roasMax   !== '' && p.d30.roas > Number(roasMax))   return false;
        if (roas90Min    !== '' && p.d90.roas < Number(roas90Min))           return false;
        if (roas90Max    !== '' && p.d90.roas > Number(roas90Max))           return false;
        if (activeDaysMin !== '' && (p.activeDays ?? 0) < Number(activeDaysMin)) return false;
        if (spendMin   !== '' && p.d30.spend < Number(spendMin))   return false;
        if (spendMax   !== '' && p.d30.spend > Number(spendMax))   return false;
        if (spend90Min !== '' && p.d90.spend < Number(spend90Min)) return false;
        if (spend90Max !== '' && p.d90.spend > Number(spend90Max)) return false;
        if (clicksMin !== '' && p.d30.clicks < Number(clicksMin)) return false;
        if (clicksMax !== '' && p.d30.clicks > Number(clicksMax)) return false;
        if (cpcMin !== '' && p.d30.cpc < Number(cpcMin)) return false;
        if (cpcMax !== '' && p.d30.cpc > Number(cpcMax)) return false;
        return true;
      });
  }, [products, selectedStore, collectionProductIds, excludedProductIds, brandOverrides, search, status, roasMin, roasMax, roas90Min, roas90Max, activeDaysMin, spendMin, spendMax, spend90Min, spend90Max, clicksMin, clicksMax, cpcMin, cpcMax]);

  const filteredRoas = useMemo(() => {
    let spend = 0, revenue = 0;
    for (const p of filtered) { spend += p.d30.spend; revenue += p.d30.revenue; }
    // Add orphan spend (deleted products still advertised in Google Ads)
    const extraSpend = selectedStore === 'all'
      ? Object.values(orphanSpend).reduce((s, v) => s + v, 0)
      : (orphanSpend[selectedStore] ?? 0);
    spend += extraSpend;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return { spend: r2(spend), revenue: r2(revenue), roas: spend > 0 ? r2(revenue / spend) : 0 };
  }, [filtered, orphanSpend, selectedStore]);

  const startDate = endDate
    ? (() => { const d = new Date(endDate); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); })()
    : '';

  const activeLabel = STORES.find(s => s.key === selectedStore)?.label ?? 'All Stores';

  // Detect if the custom range is the 3m preset (≈ 89-91 day range ending today).
  const customLabel = (() => {
    if (!customActive) return 'CUSTOM';
    const start = new Date(customStart); const end = new Date(customEnd);
    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 88 && diffDays <= 91 ? '90D' : 'CUSTOM';
  })();

  return (
    <div className="min-h-screen bg-[#f0f2f7]">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-30">
        <h1 className="text-lg font-bold text-gray-900 mr-2">Product Insights</h1>

        <div className="relative">
          <button
            onClick={() => setShowStoreMenu(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            {activeLabel}
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showStoreMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-40 min-w-[140px]">
              {STORES.map(s => (
                <button key={s.key} onClick={() => { setSelectedStore(s.key); setShowStoreMenu(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${selectedStore === s.key ? 'text-indigo-600 font-medium' : 'text-gray-700'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {[['hsl(120,72%,91%)','≥ 4x'],['hsl(80,72%,91%)','≥ 2x'],['hsl(40,72%,91%)','≥ 1x'],['hsl(0,72%,91%)','< 1x']].map(([bg, label]) => (
              <span key={label} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: bg }} />
                {label}
              </span>
            ))}
          </div>
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <svg className="animate-spin" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" strokeOpacity="0.25"/>
                <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round"/>
              </svg>
              Loading…
            </div>
          )}
          <button onClick={fetchData} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="Refresh">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </header>

      <div className="px-6 py-5 space-y-4">

        {/* Filter card */}
        <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, brand, product ID, or variant ID..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
            />
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status */}
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-gray-500 font-medium">Status:</span>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 cursor-pointer"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            {/* Filters toggle */}
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                showFilters || activeFilterCount > 0
                  ? 'border-violet-500 bg-violet-50 text-violet-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Saved filters */}
            <div className="relative" ref={savedMenuRef}>
              <button
                onClick={() => { setShowSavedMenu(v => !v); setShowSaveInput(false); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  showSavedMenu ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
                Saved filters
                {savedFilters.length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center">
                    {savedFilters.length}
                  </span>
                )}
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </button>

              {showSavedMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-2 z-50 min-w-[220px]">
                  {savedFilters.length === 0 && !showSaveInput && (
                    <div className="px-4 py-2 text-xs text-gray-400">No saved filters yet.</div>
                  )}
                  {savedFilters.map(f => (
                    <div key={f.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 group">
                      <button
                        onClick={() => applyFilter(f)}
                        className="flex-1 text-left text-sm text-gray-700 truncate"
                      >
                        {f.name}
                      </button>
                      <button
                        onClick={() => deleteSavedFilter(f.name)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all text-xs px-1"
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <div className="border-t border-gray-100 mt-1 pt-1 px-3">
                    {showSaveInput ? (
                      <div className="flex items-center gap-2 py-1">
                        <input
                          autoFocus
                          value={saveName}
                          onChange={e => setSaveName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveCurrentFilter(); if (e.key === 'Escape') setShowSaveInput(false); }}
                          placeholder="Filter name…"
                          className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-300"
                        />
                        <button
                          onClick={saveCurrentFilter}
                          disabled={!saveName.trim()}
                          className="px-2 py-1 text-xs bg-violet-600 text-white rounded-lg disabled:opacity-40 hover:bg-violet-700 transition-colors"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowSaveInput(true)}
                        className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 py-1.5 font-medium transition-colors"
                      >
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Save current filters
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Collection filter */}
            {selectedStore !== 'all' && (
              <div className="relative" ref={collectionMenuRef}>
                <button
                  onClick={() => setShowCollectionMenu(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                    selectedCollections.size > 0 || excludedCollections.size > 0
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {collectionsLoading
                    ? <svg className="animate-spin" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" strokeOpacity="0.25"/><path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round"/></svg>
                    : <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
                  }
                  Collection
                  {selectedCollections.size > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-violet-600 text-white text-[10px] font-bold leading-none">
                      +{selectedCollections.size}
                    </span>
                  )}
                  {excludedCollections.size > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold leading-none">
                      −{excludedCollections.size}
                    </span>
                  )}
                  <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                </button>

                {showCollectionMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-[280px] max-h-80 overflow-y-auto">
                    {(selectedCollections.size > 0 || excludedCollections.size > 0) && (
                      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-3">
                        {selectedCollections.size > 0 && (
                          <button onClick={() => setSelectedCollections(new Set())} className="text-xs text-violet-600 hover:text-violet-800 font-medium transition-colors">
                            Clear +{selectedCollections.size}
                          </button>
                        )}
                        {excludedCollections.size > 0 && (
                          <button onClick={() => setExcludedCollections(new Set())} className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
                            Clear −{excludedCollections.size}
                          </button>
                        )}
                      </div>
                    )}
                    {collections.length === 0 && !collectionsLoading && (
                      <div className="px-4 py-3 text-xs text-gray-400">No collections found</div>
                    )}
                    {/* Header row */}
                    {collections.length > 0 && (
                      <div className="flex items-center px-3 py-1.5 border-b border-gray-50">
                        <span className="flex-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Collectie</span>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-16 text-center">Include</span>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-16 text-center">Exclude</span>
                      </div>
                    )}
                    {collections.map(c => {
                      const included = selectedCollections.has(c.id);
                      const excluded = excludedCollections.has(c.id);
                      return (
                        <div key={c.id} className="flex items-center gap-1 px-3 py-2 hover:bg-gray-50 transition-colors">
                          <span className={`flex-1 text-sm truncate ${included ? 'text-violet-700 font-medium' : excluded ? 'text-red-600 font-medium line-through' : 'text-gray-700'}`}>
                            {c.title}
                          </span>
                          {/* Include toggle */}
                          <button
                            onClick={() => {
                              setSelectedCollections(prev => { const n = new Set(prev); included ? n.delete(c.id) : n.add(c.id); return n; });
                              setExcludedCollections(prev => { const n = new Set(prev); n.delete(c.id); return n; });
                            }}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-colors shrink-0 ${
                              included ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-400 hover:bg-violet-100 hover:text-violet-600'
                            }`}
                            title="Include"
                          >
                            +
                          </button>
                          {/* Exclude toggle */}
                          <button
                            onClick={() => {
                              setExcludedCollections(prev => { const n = new Set(prev); excluded ? n.delete(c.id) : n.add(c.id); return n; });
                              setSelectedCollections(prev => { const n = new Set(prev); n.delete(c.id); return n; });
                            }}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-colors shrink-0 ${
                              excluded ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-500'
                            }`}
                            title="Exclude"
                          >
                            −
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-violet-600 hover:text-violet-800 transition-colors font-medium">
                Clear all
              </button>
            )}
          </div>

          {/* Expanded filters panel */}
          {showFilters && (
            <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50 grid grid-cols-2 gap-6">
              {/* PERFORMANCE */}
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Performance</div>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-20 shrink-0">ROAS 30D</span>
                    <NumInput value={roasMin} onChange={setRoasMin} placeholder="Min" />
                    <Dash />
                    <NumInput value={roasMax} onChange={setRoasMax} placeholder="Max" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-20 shrink-0">ROAS 90D</span>
                    <NumInput value={roas90Min} onChange={setRoas90Min} placeholder="Min" />
                    <Dash />
                    <NumInput value={roas90Max} onChange={setRoas90Max} placeholder="Max" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-20 shrink-0">Active ≥ dagen</span>
                    <NumInput value={activeDaysMin} onChange={setActiveDaysMin} placeholder="bv. 90" />
                  </div>
                </div>
              </div>

              {/* AD SPEND */}
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Ad Spend</div>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-20 shrink-0">Ad Cost 30D</span>
                    <NumInput value={spendMin} onChange={setSpendMin} placeholder="Min" />
                    <Dash />
                    <NumInput value={spendMax} onChange={setSpendMax} placeholder="Max" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-20 shrink-0">Ad Cost 90D</span>
                    <NumInput value={spend90Min} onChange={setSpend90Min} placeholder="Min" />
                    <Dash />
                    <NumInput value={spend90Max} onChange={setSpend90Max} placeholder="Max" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-20 shrink-0">Clicks</span>
                    <NumInput value={clicksMin} onChange={setClicksMin} placeholder="Min" />
                    <Dash />
                    <NumInput value={clicksMax} onChange={setClicksMax} placeholder="Max" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-20 shrink-0">CPC</span>
                    <NumInput value={cpcMin} onChange={setCpcMin} placeholder="Min" />
                    <Dash />
                    <NumInput value={cpcMax} onChange={setCpcMax} placeholder="Max" />
                  </div>
                </div>
              </div>

              {/* CUSTOM DATE RANGE */}
              <div className="col-span-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  Custom Date Range
                  {customActive && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-600 w-12 shrink-0">From</span>
                  <input
                    type="date"
                    value={customStart}
                    max={customEnd || endDate}
                    onChange={e => setCustomStart(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
                  />
                  <Dash />
                  <span className="text-sm text-gray-600 shrink-0">To</span>
                  <input
                    type="date"
                    value={customEnd}
                    min={customStart}
                    max={endDate}
                    onChange={e => setCustomEnd(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
                  />
                  {(customStart || customEnd) && (
                    <button
                      onClick={() => { setCustomStart(''); setCustomEnd(''); }}
                      className="text-xs text-violet-600 hover:text-violet-800 transition-colors font-medium"
                    >
                      Clear
                    </button>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">
                    Voegt een extra kolom toe met de geselecteerde periode.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Date range */}
          {endDate && (
            <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
              <svg width="13" height="13" fill="none" stroke="#7c3aed" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span className="text-gray-500 font-medium">Performance Data</span>
              <span>• {startDate} to {endDate}</span>
            </div>
          )}
        </div>

        {/* Summary cards */}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Products</div>
              <div className="text-2xl font-bold text-gray-900">
                {filtered.length}
                {filtered.length !== products.length && <span className="text-sm text-gray-400 font-normal ml-1">of {products.length}</span>}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Avg ROAS 30d</div>
              <div className="text-2xl font-bold text-gray-900">
                {filteredRoas.spend > 0 ? `${filteredRoas.roas.toFixed(2)}x` : '—'}
              </div>
              {filteredRoas.spend > 0 && (
                <div className="text-xs text-gray-400 mt-0.5">
                  €{Math.round(filteredRoas.revenue).toLocaleString()} / €{Math.round(filteredRoas.spend).toLocaleString()}
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">ROAS &lt; 1x (30d)</div>
              <div className="text-2xl font-bold text-red-500">
                {filtered.filter(p => p.d30.spend > 0 && p.d30.roas < 1).length}
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-base font-bold text-gray-900">Product Performance Data</div>
            </div>
            <div className="flex items-center gap-2">
              {!loading && (
                <span className="text-xs text-gray-400">
                  {filtered.length !== products.length ? `${filtered.length} of ${products.length}` : `${products.length}`} products
                </span>
              )}
              <span className="text-xs text-gray-400 italic">Selecteer producten voor acties</span>
            </div>
          </div>

          {loading && (
            <div className="p-6 space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {error && (
            <div className="p-6 text-sm text-red-500 bg-red-50 rounded-b-2xl">⚠️ {error}</div>
          )}

          {!loading && !error && filtered.length === 0 && products.length > 0 && (
            <div className="py-14 text-center text-gray-400 text-sm">
              No products match the current filters.{' '}
              <button onClick={clearFilters} className="text-violet-600 hover:underline">Clear filters</button>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <ProductRoasTable
              products={filtered}
              selectedStore={selectedStore}
              show3m={true}
              customLabel={customLabel}
              onAfterArchive={fetchData}
            />
          )}
        </div>
      </div>
    </div>
  );
}
