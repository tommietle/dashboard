'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { StoreMetrics } from '@/lib/shopify';

interface Props {
  stores: StoreMetrics[];
}

function mergeDaily(stores: StoreMetrics[]) {
  const map = new Map<string, Record<string, number>>();
  for (const store of stores) {
    for (const d of store.dailyData) {
      if (!map.has(d.date)) map.set(d.date, {});
      const entry = map.get(d.date)!;
      entry[store.storeName] = d.orders;
    }
  }
  return Array.from(map.entries())
    .map(([date, vals]) => ({ date, ...vals }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const COLORS = ['#6366f1', '#10b981'];

const formatDate = (date: string) => {
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function OrdersChart({ stores }: Props) {
  const data = mergeDaily(stores);

  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-xl p-5">
      <div className="text-sm font-medium text-gray-300 mb-4">Orders per day</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#2a2a4a' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ background: '#12122a', border: '1px solid #2a2a4a', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
            itemStyle={{ color: '#e5e7eb' }}
            labelFormatter={(label: any) => formatDate(label)}
          />
          {stores.length > 1 && <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12, paddingTop: 8 }} />}
          {stores.map((store, i) => (
            <Bar key={store.storeName} dataKey={store.storeName} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
