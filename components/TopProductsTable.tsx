'use client';

import { TopProduct } from '@/lib/shopifyProducts';

const STORE_FLAGS: Record<string, string> = { luhvia: '🇺🇸', cecole: '🇨🇦', luvande: '🇬🇧' };

function fmtEur(v: number) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

interface Props {
  products: TopProduct[];
  selectedStore: string;
  toEur?: (amount: number, currency: string) => number;
  qcChecks?: Record<string, boolean>;
  onQcChange?: (store: string, productId: string, checked: boolean) => void;
  brandOverrides?: Record<string, string>;
}

export default function TopProductsTable({ products, selectedStore, toEur, qcChecks = {}, onQcChange, brandOverrides = {} }: Props) {
  const convert = toEur ?? ((v: number) => v);

  if (products.length === 0) {
    return <div className="text-center text-gray-400 text-sm py-10">No product data found.</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">#</th>
          {selectedStore === 'all' && (
            <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Store</th>
          )}
          <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-28">Brand</th>
          <th className="text-left py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Product</th>
          <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Revenue (€)</th>
          <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Orders</th>
          <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Qty sold</th>
          <th className="text-right py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">AOV (€)</th>
          <th className="text-center py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">QC Done</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {products.map((p, i) => {
          const qcKey = `${p.store}:${p.productId}`;
          const isChecked = !!qcChecks[qcKey];
          return (
            <tr key={qcKey} className={`hover:bg-gray-50 transition-colors ${isChecked ? 'opacity-60' : ''}`}>
              <td className="py-3 px-4 text-gray-300 text-xs">{i + 1}</td>
              {selectedStore === 'all' && (
                <td className="py-3 px-4 text-lg">{STORE_FLAGS[p.store]}</td>
              )}
              <td className="py-3 px-4 text-[12px] text-gray-500 font-medium w-28">
                {brandOverrides[qcKey] || p.brandName || <span className="text-gray-300">—</span>}
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden text-[11px] font-bold text-gray-400">
                    {p.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                      : p.title.charAt(0)
                    }
                  </div>
                  <div className="font-medium text-gray-800 text-[13px] leading-tight">{p.title}</div>
                </div>
              </td>
              <td className="py-3 px-4 text-right font-semibold text-gray-900">{fmtEur(convert(p.revenue, p.currency))}</td>
              <td className="py-3 px-4 text-right text-gray-600">{p.orders}</td>
              <td className="py-3 px-4 text-right text-gray-600">{p.quantity}</td>
              <td className="py-3 px-4 text-right text-gray-600">{fmtEur(convert(p.aov, p.currency))}</td>
              <td className="py-3 px-4 text-center">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={e => onQcChange?.(p.store, p.productId, e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-violet-600 cursor-pointer accent-violet-600"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
