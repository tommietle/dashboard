'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import { ProductRoas, ProductPeriodMetrics } from '@/lib/googleAdsProducts';

type Period = 'd90' | 'd30' | 'd14' | 'd7' | 'custom';

// ROAS → background color (red → yellow → green gradient). ROAS = 0 → red.
function roasBg(roas: number): string {
  const hue = Math.min((roas / 4.5) * 120, 120);
  return `hsl(${hue}, 72%, 91%)`;
}
function roasText(roas: number): string {
  const hue = Math.min((roas / 4.5) * 120, 120);
  return `hsl(${hue}, 60%, 32%)`;
}

function fmt(v: number, currency: string, decimals = 0) {
  if (v === 0) return '—';
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency', currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}
function fmtPct(v: number) { return v === 0 ? '—' : `${v.toFixed(2)}%`; }

const STORE_FLAGS: Record<string, string> = { luhvia: '🇺🇸', cecole: '🇨🇦', luvande: '🇬🇧', modemeister: '🇵🇱' };

// Sticky column widths
const COL_PRODUCT = 'min-w-[220px] max-w-[220px]';

interface SortKey { field: 'spend' | 'revenue' | 'adsRevenue' | 'conversions' | 'clicks' | 'roas' | 'ctr' | 'cpc' | 'cpa'; period: Period }

function Th({ children, right, sticky, sorted, onClick, className = '', style }:
  { children: React.ReactNode; right?: boolean; sticky?: boolean; sorted?: boolean; onClick?: () => void; className?: string; style?: React.CSSProperties }) {
  return (
    <th
      onClick={onClick}
      className={`
        whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider border-b border-gray-200
        ${right ? 'text-right' : 'text-left'}
        ${sticky ? 'sticky z-20 bg-white' : ''}
        ${sorted ? 'bg-violet-50 text-violet-700' : 'text-gray-400 bg-white'}
        ${onClick ? 'cursor-pointer select-none hover:bg-gray-50' : ''}
        ${className}
      `}
      style={{ ...(sorted && !sticky ? { backgroundColor: '#f5f3ff' } : {}), ...style }}
    >
      {children}
    </th>
  );
}

function Td({ children, right, sticky, sorted, className = '', style }:
  { children: React.ReactNode; right?: boolean; sticky?: boolean; sorted?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <td
      className={`
        px-3 py-2.5 text-[12px] border-b border-gray-100
        ${right ? 'text-right' : 'text-left'}
        ${sticky ? 'sticky z-10 bg-white border-r border-gray-100' : ''}
        ${sorted ? 'bg-violet-50/40' : ''}
        ${className}
      `}
      style={style}
    >
      {children}
    </td>
  );
}

function RoasCell({ roas }: { roas: number }) {
  return (
    <td
      className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-gray-100 min-w-[72px]"
      style={{ backgroundColor: roasBg(roas), color: roasText(roas) }}
    >
      {roas === 0 ? '0.00' : roas.toFixed(2)}
    </td>
  );
}

function PeriodCols({ m, currency }: { m: ProductPeriodMetrics; currency: string }) {
  return (
    <>
      <RoasCell roas={m.roas} />
      <Td right className="text-gray-600 min-w-[90px]">{fmt(m.spend, currency, 2)}</Td>
      <Td right className="text-gray-600 min-w-[90px]">{fmt(m.revenue, currency, 2)}</Td>
    </>
  );
}

interface Props {
  products: ProductRoas[];
  selectedStore: string;
  show3m?: boolean;
  customLabel?: string;
  onAfterArchive?: () => void;
}

function selectionKey(p: ProductRoas) {
  return `${p.store}:${p.productId}`;
}

export default function ProductRoasTable({ products, selectedStore, show3m = false, customLabel = 'CUSTOM', onAfterArchive }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortKey>({ field: 'spend', period: 'd30' });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Actions
  const [actionMode, setActionMode] = useState<'none' | 'tag' | 'collection'>('none');
  const [tagValue, setTagValue] = useState('');
  const [collections, setCollections] = useState<{ id: string; title: string }[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCollId, setSelectedCollId] = useState('');
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setShowActionMenu(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleSort(field: SortKey['field'], period: SortKey['period']) {
    if (sort.field === field && sort.period === period) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSort({ field, period });
      setSortDir('desc');
    }
    setPage(1);
  }

  const showCustom = products.some(p => p.custom);

  const sorted = useMemo(() => {
    return [...products].sort((a, b) => {
      const pm = sort.period;
      const am = pm === 'custom' ? a.custom : pm === 'd90' ? a.d90 : a[pm];
      const bm = pm === 'custom' ? b.custom : pm === 'd90' ? b.d90 : b[pm];
      const av = (am ? ((am[sort.field] as number | undefined) ?? 0) : 0);
      const bv = (bm ? ((bm[sort.field] as number | undefined) ?? 0) : 0);
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [products, sort, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageItems  = sorted.slice((page - 1) * pageSize, page * pageSize);

  const isSorted = (field: SortKey['field'], period: SortKey['period']) =>
    sort.field === field && sort.period === period;

  function SortArrow({ field, period }: { field: SortKey['field']; period: SortKey['period'] }) {
    if (!isSorted(field, period)) return <span className="ml-0.5 opacity-30">↕</span>;
    return <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  function toggleOne(p: ProductRoas) {
    const key = selectionKey(p);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      for (const p of pageItems) {
        const key = selectionKey(p);
        if (checked) next.add(key); else next.delete(key);
      }
      return next;
    });
  }

  const pageAllSelected = pageItems.length > 0 && pageItems.every(p => selected.has(selectionKey(p)));
  const pageSomeSelected = !pageAllSelected && pageItems.some(p => selected.has(selectionKey(p)));

  // Group geselecteerde items per store, alleen Shopify-numerieke productIds zijn archiveerbaar.
  const selectedItems = useMemo(
    () => products.filter(p => selected.has(selectionKey(p))),
    [products, selected]
  );
  const archivable = selectedItems.filter(p => /^\d+$/.test(p.productId));
  const allArchived = archivable.length > 0 && archivable.every(p => p.status === 'archived');

  async function bulkAction(action: 'archive' | 'unarchive') {
    if (archivable.length === 0) return;
    const verb = action === 'archive' ? 'archiveren' : 'opnieuw activeren';
    if (!confirm(`Weet je zeker dat je ${archivable.length} product(en) wilt ${verb}?`)) return;

    setBusy(true);
    setFeedback(null);

    // Per store batchen.
    const byStore = new Map<'luhvia' | 'cecole' | 'luvande' | 'modemeister', string[]>();
    for (const p of archivable) {
      const store = p.store as 'luhvia' | 'cecole' | 'luvande' | 'modemeister';
      const arr = byStore.get(store) ?? [];
      arr.push(p.productId);
      byStore.set(store, arr);
    }

    let totalUpdated = 0;
    let totalFailed = 0;
    for (const [store, ids] of byStore.entries()) {
      try {
        const res = await fetch('/api/shopify-products/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store, productIds: ids, action }),
        });
        const json = await res.json();
        if (!res.ok) {
          totalFailed += ids.length;
          console.error(`Archive ${store}:`, json.error);
        } else {
          totalUpdated += json.updated ?? 0;
          totalFailed  += json.failed  ?? 0;
        }
      } catch (e: any) {
        totalFailed += ids.length;
        console.error('Archive request error:', e);
      }
    }

    setBusy(false);
    setSelected(new Set());
    setFeedback(
      `${totalUpdated} ge${action === 'archive' ? 'archiveerd' : 'activeerd'}` +
      (totalFailed ? `, ${totalFailed} mislukt` : '') + '.'
    );
    onAfterArchive?.();
  }

  // Unique stores in current selection.
  const storesInSelection = useMemo(
    () => Array.from(new Set(selectedItems.map(p => p.store))) as ('luhvia' | 'cecole' | 'luvande' | 'modemeister')[],
    [selectedItems]
  );

  async function openCollectionPicker() {
    setActionMode('collection');
    setSelectedCollId('');
    if (storesInSelection.length !== 1) return;
    setCollectionsLoading(true);
    try {
      const res = await fetch(`/api/shopify-collections?store=${storesInSelection[0]}`);
      const data = await res.json();
      setCollections(data.collections || []);
    } catch { setCollections([]); }
    finally { setCollectionsLoading(false); }
  }

  async function bulkAddTag() {
    if (!tagValue.trim() || selectedItems.length === 0) return;
    setBusy(true);
    setFeedback(null);
    let totalUpdated = 0, totalFailed = 0;
    for (const store of storesInSelection) {
      const ids = selectedItems.filter(p => p.store === store && /^\d+$/.test(p.productId)).map(p => p.productId);
      if (!ids.length) continue;
      try {
        const res = await fetch('/api/shopify-products/tag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store, productIds: ids, tag: tagValue.trim() }),
        });
        const json = await res.json();
        totalUpdated += json.updated ?? 0;
        totalFailed  += json.failed  ?? 0;
      } catch { totalFailed += ids.length; }
    }
    setBusy(false);
    setActionMode('none');
    setTagValue('');
    setSelected(new Set());
    setFeedback(`Tag "${tagValue.trim()}" toegevoegd aan ${totalUpdated} product(en)${totalFailed ? `, ${totalFailed} mislukt` : ''}.`);
  }

  async function bulkAddToCollection() {
    if (!selectedCollId || storesInSelection.length !== 1) return;
    const store = storesInSelection[0];
    const ids = selectedItems.filter(p => p.store === store && /^\d+$/.test(p.productId)).map(p => p.productId);
    if (!ids.length) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/shopify-products/add-to-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store, productIds: ids, collectionId: selectedCollId }),
      });
      const json = await res.json();
      const collTitle = collections.find(c => c.id === selectedCollId)?.title ?? 'collectie';
      setFeedback(`${json.added ?? 0} product(en) toegevoegd aan "${collTitle}"${json.failed ? `, ${json.failed} mislukt` : ''}.`);
    } catch { setFeedback('Er ging iets mis.'); }
    setBusy(false);
    setActionMode('none');
    setSelectedCollId('');
    setSelected(new Set());
  }

  if (products.length === 0) {
    return <div className="text-center text-gray-400 text-sm py-16">No product data found.</div>;
  }

  return (
    <div className="flex flex-col">
      {/* Bulk-action bar */}
      {selected.size > 0 && (
        <div className="flex flex-col border-b border-violet-100">
          <div className="flex items-center gap-2 px-5 py-3 bg-violet-50 text-sm flex-wrap">
            <span className="text-violet-700 font-medium shrink-0">
              {selected.size} geselecteerd
            </span>

            {/* Archive / Unarchive */}
            <button
              onClick={() => { setActionMode('none'); bulkAction(allArchived ? 'unarchive' : 'archive'); }}
              disabled={busy || archivable.length === 0}
              className="px-3 py-1.5 rounded-lg border border-violet-200 bg-white text-violet-700 text-xs font-medium hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {allArchived ? `Activeer (${archivable.length})` : `Archiveer (${archivable.length})`}
            </button>

            {/* Actions dropdown */}
            <div className="relative" ref={actionMenuRef}>
              <button
                onClick={() => setShowActionMenu(v => !v)}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                {busy ? 'Bezig…' : 'Actions'}
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {showActionMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50 min-w-[200px]">
                  <button
                    onClick={() => { setActionMode('tag'); setShowActionMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5"
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
                    </svg>
                    Tag toevoegen
                  </button>
                  <button
                    onClick={() => { openCollectionPicker(); setShowActionMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5"
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <rect x="2" y="3" width="20" height="5" rx="1"/><rect x="2" y="10" width="20" height="5" rx="1"/><rect x="2" y="17" width="7" height="5" rx="1"/>
                      <line x1="17" y1="19" x2="23" y2="19"/><line x1="20" y1="16" x2="20" y2="22"/>
                    </svg>
                    Toevoegen aan collectie
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => { setSelected(new Set()); setActionMode('none'); }}
              disabled={busy}
              className="ml-auto text-xs text-violet-500 hover:text-violet-700 transition-colors"
            >
              Deselecteer alles
            </button>
          </div>

          {/* Tag input panel */}
          {actionMode === 'tag' && (
            <div className="flex items-center gap-3 px-5 py-3 bg-white border-t border-violet-100">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-violet-500 shrink-0">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
              </svg>
              <span className="text-xs text-gray-500 font-medium shrink-0">Tag toevoegen aan {selected.size} product(en):</span>
              <input
                autoFocus
                type="text"
                value={tagValue}
                onChange={e => setTagValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') bulkAddTag(); if (e.key === 'Escape') setActionMode('none'); }}
                placeholder="Tag naam…"
                className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 max-w-xs"
              />
              <button
                onClick={bulkAddTag}
                disabled={!tagValue.trim() || busy}
                className="px-3 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-40 transition-colors"
              >
                Toevoegen
              </button>
              <button onClick={() => setActionMode('none')} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Annuleren</button>
            </div>
          )}

          {/* Collection picker panel */}
          {actionMode === 'collection' && (
            <div className="flex items-center gap-3 px-5 py-3 bg-white border-t border-violet-100 flex-wrap">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-violet-500 shrink-0">
                <rect x="2" y="3" width="20" height="5" rx="1"/><rect x="2" y="10" width="20" height="5" rx="1"/>
              </svg>
              {storesInSelection.length > 1 ? (
                <span className="text-xs text-amber-600">Selecteer producten van één store om toe te voegen aan een collectie.</span>
              ) : collectionsLoading ? (
                <span className="text-xs text-gray-400">Collecties laden…</span>
              ) : (
                <>
                  <span className="text-xs text-gray-500 font-medium shrink-0">{selected.size} product(en) toevoegen aan:</span>
                  <select
                    value={selectedCollId}
                    onChange={e => setSelectedCollId(e.target.value)}
                    className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                  >
                    <option value="">Kies een collectie…</option>
                    {collections.map(c => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                  <button
                    onClick={bulkAddToCollection}
                    disabled={!selectedCollId || busy}
                    className="px-3 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-40 transition-colors"
                  >
                    Toevoegen
                  </button>
                </>
              )}
              <button onClick={() => setActionMode('none')} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Annuleren</button>
            </div>
          )}
        </div>
      )}

      {feedback && (
        <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-100 text-xs text-emerald-700 flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-emerald-500 hover:text-emerald-700">×</button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 1400 }}>
          <thead>
            <tr>
              {/* Fixed left columns */}
              <Th sticky className="w-8" style={{ left: 0 }}>
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={pageAllSelected}
                  ref={el => { if (el) el.indeterminate = pageSomeSelected; }}
                  onChange={e => togglePage(e.target.checked)}
                />
              </Th>
              <Th sticky className={COL_PRODUCT} style={{ left: 32 }}>PRODUCT</Th>
              <Th className="min-w-[80px]">STATUS</Th>
              <Th className="min-w-[80px]">VARIANTS</Th>

              {/* Main metrics (30d) */}
              <Th right sorted={isSorted('spend', 'd30')} className="min-w-[100px]" onClick={() => handleSort('spend', 'd30')}>
                COST <SortArrow field="spend" period="d30" />
              </Th>
              <Th right sorted={isSorted('revenue', 'd30')} className="min-w-[120px]" onClick={() => handleSort('revenue', 'd30')}>
                SHOPIFY REVENUE <SortArrow field="revenue" period="d30" />
              </Th>
              <Th right sorted={isSorted('adsRevenue', 'd30')} className="min-w-[100px]" onClick={() => handleSort('adsRevenue', 'd30')}>
                GOOGLE REV <SortArrow field="adsRevenue" period="d30" />
              </Th>
              <Th right sorted={isSorted('conversions', 'd30')} className="min-w-[72px]" onClick={() => handleSort('conversions', 'd30')}>
                CONV. <SortArrow field="conversions" period="d30" />
              </Th>
              <Th right sorted={isSorted('ctr', 'd30')} className="min-w-[80px]" onClick={() => handleSort('ctr', 'd30')}>
                CTR <SortArrow field="ctr" period="d30" />
              </Th>
              <Th right sorted={isSorted('cpc', 'd30')} className="min-w-[72px]" onClick={() => handleSort('cpc', 'd30')}>
                CPC <SortArrow field="cpc" period="d30" />
              </Th>
              <Th right sorted={isSorted('cpa', 'd30')} className="min-w-[72px]" onClick={() => handleSort('cpa', 'd30')}>
                CPA <SortArrow field="cpa" period="d30" />
              </Th>

              {/* 7d group */}
              <Th sorted={isSorted('roas', 'd7')} className="min-w-[72px] border-l border-gray-200 pl-3" onClick={() => handleSort('roas', 'd7')}>
                ROAS 7D <SortArrow field="roas" period="d7" />
              </Th>
              <Th right sorted={isSorted('spend', 'd7')} className="min-w-[90px]" onClick={() => handleSort('spend', 'd7')}>
                $ 7D <SortArrow field="spend" period="d7" />
              </Th>
              <Th right sorted={isSorted('revenue', 'd7')} className="min-w-[90px]" onClick={() => handleSort('revenue', 'd7')}>
                ↗ 7D <SortArrow field="revenue" period="d7" />
              </Th>

              {/* 14d group */}
              <Th sorted={isSorted('roas', 'd14')} className="min-w-[72px] border-l border-gray-200 pl-3" onClick={() => handleSort('roas', 'd14')}>
                ROAS 14D <SortArrow field="roas" period="d14" />
              </Th>
              <Th right sorted={isSorted('spend', 'd14')} className="min-w-[90px]" onClick={() => handleSort('spend', 'd14')}>
                $ 14D <SortArrow field="spend" period="d14" />
              </Th>
              <Th right sorted={isSorted('revenue', 'd14')} className="min-w-[90px]" onClick={() => handleSort('revenue', 'd14')}>
                ↗ 14D <SortArrow field="revenue" period="d14" />
              </Th>

              {/* 30d group */}
              <Th sorted={isSorted('roas', 'd30')} className="min-w-[72px] border-l border-gray-200 pl-3" onClick={() => handleSort('roas', 'd30')}>
                ROAS 30D <SortArrow field="roas" period="d30" />
              </Th>
              <Th right sorted={isSorted('spend', 'd30')} className="min-w-[90px]" onClick={() => handleSort('spend', 'd30')}>
                $ 30D <SortArrow field="spend" period="d30" />
              </Th>
              <Th right sorted={isSorted('revenue', 'd30')} className="min-w-[90px]" onClick={() => handleSort('revenue', 'd30')}>
                ↗ 30D <SortArrow field="revenue" period="d30" />
              </Th>

              {/* 3m group — alleen zichtbaar als show3m aan staat */}
              {show3m && (
                <>
                  <Th sorted={isSorted('roas', 'd90')} className="min-w-[72px] border-l border-gray-200 pl-3" onClick={() => handleSort('roas', 'd90')}>
                    ROAS 3M <SortArrow field="roas" period="d90" />
                  </Th>
                  <Th right sorted={isSorted('spend', 'd90')} className="min-w-[90px]" onClick={() => handleSort('spend', 'd90')}>
                    $ 3M <SortArrow field="spend" period="d90" />
                  </Th>
                  <Th right sorted={isSorted('revenue', 'd90')} className="min-w-[90px]" onClick={() => handleSort('revenue', 'd90')}>
                    ↗ 3M <SortArrow field="revenue" period="d90" />
                  </Th>
                </>
              )}

              {/* Custom range group — alleen wanneer een custom range is geselecteerd */}
              {showCustom && (
                <>
                  <Th sorted={isSorted('roas', 'custom')} className="min-w-[72px] border-l-2 border-violet-300 pl-3 bg-violet-50/40" onClick={() => handleSort('roas', 'custom')}>
                    ROAS {customLabel} <SortArrow field="roas" period="custom" />
                  </Th>
                  <Th right sorted={isSorted('spend', 'custom')} className="min-w-[90px] bg-violet-50/40" onClick={() => handleSort('spend', 'custom')}>
                    $ {customLabel} <SortArrow field="spend" period="custom" />
                  </Th>
                  <Th right sorted={isSorted('revenue', 'custom')} className="min-w-[90px] bg-violet-50/40" onClick={() => handleSort('revenue', 'custom')}>
                    ↗ {customLabel} <SortArrow field="revenue" period="custom" />
                  </Th>
                </>
              )}
            </tr>
          </thead>

          <tbody>
            {pageItems.map((p, i) => {
              const num = (page - 1) * pageSize + i + 1;
              const key = selectionKey(p);
              const checked = selected.has(key);
              return (
                <tr key={key} className="hover:bg-gray-50/60 transition-colors group">
                  {/* Checkbox */}
                  <Td sticky className="w-8 group-hover:bg-gray-50/60" style={{ left: 0 }}>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={checked}
                      onChange={() => toggleOne(p)}
                    />
                  </Td>

                  {/* Product */}
                  <Td sticky className={`${COL_PRODUCT} group-hover:bg-gray-50/60`} style={{ left: 32 }}>
                    <div className="flex items-center gap-2.5">
                      {/* Thumbnail */}
                      <div className="relative w-9 h-9 rounded bg-gray-100 flex items-center justify-center shrink-0 text-[11px] font-bold text-gray-400 border border-gray-200 overflow-hidden">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{p.title.charAt(0)}</span>
                        )}
                        {selectedStore === 'all' && (
                          <span className="absolute text-[8px] bottom-0 right-0 leading-none">{STORE_FLAGS[p.store]}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-800 text-[12px] leading-tight truncate" title={p.title}>
                          {num}. {p.title}
                        </div>
                        <div className={`text-[10px] mt-0.5 ${p.brandName ? 'text-gray-500 font-medium' : 'text-gray-400'}`}>
                          {p.brandName ?? `ID: ${p.productId}`}
                        </div>
                      </div>
                    </div>
                  </Td>

                  {/* Status */}
                  <Td>
                    {p.status === 'active' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Active
                      </span>
                    ) : p.status === 'archived' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500 border border-gray-200">
                        Archived
                      </span>
                    ) : p.status === 'draft' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        Draft
                      </span>
                    ) : (
                      <span className="text-gray-300 text-[11px]">—</span>
                    )}
                  </Td>

                  {/* Variants */}
                  <Td className="text-gray-600">
                    {p.variantCount > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-[11px] font-medium text-gray-600">
                        {p.variantCount}
                        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="opacity-50">
                          <rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 14H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </Td>

                  {/* Main metrics (30d) */}
                  <Td right sorted className="text-gray-800 font-medium">{fmt(p.d30.spend, p.currency, 2)}</Td>
                  <Td right className="text-gray-800 font-medium">{fmt(p.d30.revenue, p.currency, 2)}</Td>
                  <Td right className="text-gray-600">{fmt(p.d30.adsRevenue ?? 0, p.currency, 2)}</Td>
                  <Td right className="text-gray-600">{p.d30.conversions > 0 ? p.d30.conversions.toFixed(0) : '—'}</Td>
                  <Td right className="text-gray-600">{fmtPct(p.d30.ctr)}</Td>
                  <Td right className="text-gray-600">{fmt(p.d30.cpc, p.currency, 2)}</Td>
                  <Td right className="text-gray-600">{fmt(p.d30.cpa, p.currency, 2)}</Td>

                  {/* 7d */}
                  <PeriodCols m={p.d7}  currency={p.currency} />
                  {/* 14d */}
                  <PeriodCols m={p.d14} currency={p.currency} />
                  {/* 30d */}
                  <PeriodCols m={p.d30} currency={p.currency} />
                  {/* 3m */}
                  {show3m && <PeriodCols m={p.d90} currency={p.currency} />}
                  {/* Custom range */}
                  {showCustom && (
                    p.custom ? (
                      <PeriodCols m={p.custom} currency={p.currency} />
                    ) : (
                      <>
                        <Td className="bg-violet-50/40 border-l-2 border-violet-200 text-center text-gray-300">—</Td>
                        <Td right className="bg-violet-50/40 text-gray-300">—</Td>
                        <Td right className="bg-violet-50/40 text-gray-300">—</Td>
                      </>
                    )
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-[12px] text-gray-500">
        <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length} products</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              onClick={() => setPage(n)}
              className={`w-8 h-8 rounded-lg text-[12px] font-medium transition-colors ${
                page === n
                  ? 'bg-violet-600 text-white'
                  : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-gray-400">
          <span>Show:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="border border-gray-200 rounded-lg px-2 py-1 text-[12px] text-gray-600 bg-white hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-violet-400 cursor-pointer"
          >
            {[25, 50, 75, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>per page</span>
        </div>
      </div>
    </div>
  );
}
