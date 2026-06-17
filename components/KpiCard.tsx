'use client';

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: string;
  trend?: number;
  currency?: string;
}

export default function KpiCard({ title, value, subtitle, icon, trend, currency }: KpiCardProps) {
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <div>
        <div className="text-2xl font-bold text-white">
          {currency && <span className="text-sm text-gray-400 mr-1">{currency}</span>}
          {value}
        </div>
        {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
      </div>
      {trend !== undefined && (
        <div className={`text-xs font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}% vs prev period
        </div>
      )}
    </div>
  );
}
