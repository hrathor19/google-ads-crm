'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, formatNumber } from '@/lib/format';

/**
 * Chart primitives.
 *
 * Colours come from the theme's CSS variables rather than literals so both
 * modes stay legible from one definition, and the categorical set is ordered
 * so adjacent series never collide.
 */
const SERIES_COLORS = [
  'hsl(var(--primary))',
  'hsl(173 58% 39%)',
  'hsl(43 74% 49%)',
  'hsl(280 55% 55%)',
  'hsl(12 76% 55%)',
  'hsl(200 70% 45%)',
];

const axisProps = {
  stroke: 'hsl(var(--muted-foreground))',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  money?: string[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 tabular-nums">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: entry.color }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto font-medium">
            {money?.includes(entry.name ?? '')
              ? formatCurrency(entry.value ?? 0)
              : formatNumber(entry.value ?? 0, { decimals: 2 })}
          </span>
        </p>
      ))}
    </div>
  );
}

export type TrendSeries = { key: string; label: string; money?: boolean };

export type ChartRow = Record<string, number | string | null | undefined>;

export function TrendChart({
  data,
  series,
  height = 260,
}: {
  data: ChartRow[];
  series: TrendSeries[];
  height?: number;
}) {
  const money = series.filter((s) => s.money).map((s) => s.label);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={56} tickFormatter={(v) => formatNumber(v, { compact: true })} />
        <Tooltip content={<ChartTooltip money={money} />} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            fill={`url(#grad-${s.key})`}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ComparisonChart({
  current,
  previous,
  dataKey,
  label,
  money,
  height = 240,
}: {
  current: ChartRow[];
  previous: ChartRow[];
  dataKey: string;
  label: string;
  money?: boolean;
  height?: number;
}) {
  // Aligned by index, not by date: the two windows cover different calendar
  // days, and "day 1 vs day 1" is the comparison someone actually wants.
  const merged = current.map((row, i) => ({
    date: row.date,
    current: row[dataKey],
    previous: previous[i]?.[dataKey] ?? null,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={merged} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={56} tickFormatter={(v) => formatNumber(v, { compact: true })} />
        <Tooltip content={<ChartTooltip money={money ? [label, `Previous ${label}`] : []} />} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Line
          type="monotone"
          dataKey="current"
          name={label}
          stroke={SERIES_COLORS[0]}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="previous"
          name={`Previous ${label}`}
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CategoryBarChart({
  data,
  valueKey,
  money,
  height = 260,
}: {
  data: Array<{ label: string } & ChartRow>;
  valueKey: string;
  money?: boolean;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis
          type="number"
          {...axisProps}
          tickFormatter={(v) => (money ? formatCurrency(v, { compact: true }) : formatNumber(v, { compact: true }))}
        />
        <YAxis type="category" dataKey="label" {...axisProps} width={110} />
        <Tooltip content={<ChartTooltip money={money ? [valueKey] : []} />} cursor={{ fill: 'hsl(var(--muted))' }} />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export { SERIES_COLORS };
