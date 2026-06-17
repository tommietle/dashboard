'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { StoreMetrics } from '@/lib/shopify';

interface Props { stores: StoreMetrics[]; }

function mergeDaily(stores: StoreMetrics[]) {
  if (stores.length === 0) return [];

  // Build a per-store lookup: date → revenue
  const storeMaps = stores.map(store => {
    const m = new Map<string, number>();
    for (const d of store.dailyData) m.set(d.date, d.revenue);
    return { name: store.storeName, m };
  });

  // Find the full date range across all stores
  const allDates = stores.flatMap(s => s.dailyData.map(d => d.date)).sort();
  if (allDates.length === 0) return [];

  const start = new Date(allDates[0] + 'T12:00:00');
  const end   = new Date(allDates[allDates.length - 1] + 'T12:00:00');

  const result: Record<string, any>[] = [];
  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const date = cur.toISOString().slice(0, 10);
    const entry: Record<string, any> = { date };
    for (const { name, m } of storeMaps) entry[name] = m.get(date) ?? 0;
    result.push(entry);
  }
  return result;
}

const COLORS = ['#f97316', '#10b981'];

const formatDate = (date: string) => {
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('nl-NL', { month: 'short', day: 'numeric' });
};

const fmtEur = (v: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

function niceYTicks(maxVal: number): number[] {
  if (maxVal === 0) return [0, 500, 1000, 1500, 2000];
  const STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 25000, 50000];
  // Pick the smallest step that results in 4–6 ticks
  const step = STEPS.find(s => {
    const count = Math.ceil(maxVal / s) + 1;
    return count >= 4 && count <= 6;
  }) ?? STEPS[STEPS.length - 1];
  const ceiling = Math.ceil(maxVal / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= ceiling; v += step) ticks.push(v);
  return ticks;
}

function fmtTick(v: number) {
  if (v === 0) return '€0';
  if (v >= 1000) return `€${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `€${v}`;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const dateLabel = label ? formatDate(label) : '';
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 text-sm shadow-lg">
      <div className="text-gray-400 mb-2 text-xs">{dateLabel}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span style={{ color: p.color }}>●</span>
          <span className="text-gray-500">{p.dataKey}:</span>
          <span className="text-gray-900 font-semibold">{fmtEur(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function RevenueChart({ stores }: Props) {
  const data = mergeDaily(stores);

  const maxVal = data.reduce((m, row) => {
    const vals = stores.map(s => (row[s.storeName] as number) || 0);
    return Math.max(m, ...vals);
  }, 0);
  const yTicks = niceYTicks(maxVal);
  const yMax   = yTicks[yTicks.length - 1];

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, yMax]}
          ticks={yTicks}
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtTick}
          width={52}
        />
        <Tooltip content={(props) => <CustomTooltip {...props} />} />
        {stores.length > 1 && (
          <Legend wrapperStyle={{ color: '#6b7280', fontSize: 12, paddingTop: 12 }} />
        )}
        {stores.map((store, i) => (
          <Line
            key={store.storeName}
            type="monotone"
            dataKey={store.storeName}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
