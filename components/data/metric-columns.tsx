'use client';

import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Column } from './data-table';

/**
 * The metric columns every reporting table shares.
 *
 * Defined once so "CTR" means the same thing, formats the same way, and sorts
 * the same way on the accounts, campaigns, ad groups, keywords and search term
 * screens. `canSeeMoney` drops the monetary columns entirely rather than
 * rendering them blank — a column of dashes is worse than no column.
 */
export function metricColumns<T extends {
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
}>(canSeeMoney: boolean): Array<Column<T>> {
  const columns: Array<Column<T>> = [
    {
      key: 'impressions',
      header: 'Impressions',
      align: 'right',
      cell: (r) => formatNumber(r.impressions),
      sortValue: (r) => r.impressions,
    },
    {
      key: 'clicks',
      header: 'Clicks',
      align: 'right',
      cell: (r) => formatNumber(r.clicks),
      sortValue: (r) => r.clicks,
    },
    {
      key: 'ctr',
      header: 'CTR',
      align: 'right',
      cell: (r) => formatPercent(r.ctr),
      sortValue: (r) => r.ctr,
    },
  ];

  if (canSeeMoney) {
    columns.push(
      {
        key: 'cost',
        header: 'Spend',
        align: 'right',
        cell: (r) => formatCurrency(r.cost),
        sortValue: (r) => r.cost,
      },
      {
        key: 'avgCpc',
        header: 'Avg. CPC',
        align: 'right',
        cell: (r) => formatCurrency(r.avgCpc),
        sortValue: (r) => r.avgCpc,
        hideOnMobile: true,
      }
    );
  }

  columns.push({
    key: 'conversions',
    header: 'Conv.',
    align: 'right',
    cell: (r) => formatNumber(r.conversions, { decimals: 1 }),
    sortValue: (r) => r.conversions,
  });

  if (canSeeMoney) {
    columns.push({
      key: 'costPerConversion',
      header: 'Cost / conv.',
      align: 'right',
      cell: (r) => formatCurrency(r.costPerConversion),
      sortValue: (r) => r.costPerConversion,
      hideOnMobile: true,
    });
  }

  return columns;
}

const STATUS_TONE: Record<string, string> = {
  ENABLED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  PAUSED: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  REMOVED: 'bg-muted text-muted-foreground',
  DISAPPROVED: 'bg-destructive/10 text-destructive border-destructive/20',
  APPROVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={cn('font-normal', STATUS_TONE[status] ?? '')}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}

const HEALTH_TONE: Record<string, string> = {
  healthy: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
  ignored: 'bg-muted text-muted-foreground',
};

export function HealthBadge({ score, level }: { score: number; level: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium tabular-nums', HEALTH_TONE[level] ?? '')}>
      {level === 'ignored' ? 'paused' : score}
    </Badge>
  );
}
