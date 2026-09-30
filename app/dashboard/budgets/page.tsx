'use client';

import { Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/data/page-header';
import { StatTile } from '@/components/data/stat-tile';
import { DataTable, type Column } from '@/components/data/data-table';
import { EmptyState, ErrorState, TableSkeleton, TileSkeleton } from '@/components/data/states';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

type BudgetRow = {
  id: number;
  name: string | null;
  accountName: string | null;
  snapshotDate: string | null;
  amount: number;
  spend: number;
  utilization: number | null;
  risk: 'healthy' | 'warning' | 'critical';
  projectedEodSpend: number;
};

const RISK_TONE: Record<string, string> = {
  healthy: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
};

export default function BudgetsPage() {
  const { can } = usePermissions();
  const { data, isLoading, error, refetch } = useFilteredApi<{
    rows: BudgetRow[];
    summary: { total: number; healthy: number; warning: number; critical: number };
  }>('budgets', '/api/budgets', {}, { enabled: can('FINANCIALS', 'VIEW') });

  if (!can('FINANCIALS', 'VIEW')) {
    return (
      <>
        <PageHeader title="Budgets" />
        <EmptyState
          icon={Wallet}
          title="Budgets are financial data"
          description="This page is entirely spend, so it needs the Spend & Financial Data: View permission. Ask a Super Admin if you need it."
        />
      </>
    );
  }

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const columns: Array<Column<BudgetRow>> = [
    {
      key: 'name',
      header: 'Budget',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name ?? `Budget ${r.id}`}</p>
          <p className="truncate text-xs text-muted-foreground">{r.accountName}</p>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'risk',
      header: 'Risk',
      cell: (r) => (
        <Badge variant="outline" className={cn('font-normal', RISK_TONE[r.risk])}>
          {r.risk}
        </Badge>
      ),
      sortValue: (r) => ({ critical: 3, warning: 2, healthy: 1 })[r.risk],
    },
    {
      key: 'amount',
      header: 'Daily budget',
      align: 'right',
      cell: (r) => formatCurrency(r.amount),
      sortValue: (r) => r.amount,
    },
    {
      key: 'spend',
      header: 'Spent',
      align: 'right',
      cell: (r) => formatCurrency(r.spend),
      sortValue: (r) => r.spend,
    },
    {
      key: 'utilization',
      header: 'Utilisation',
      align: 'right',
      cell: (r) => (
        <span className={cn('tabular-nums', (r.utilization ?? 0) >= 1 && 'font-semibold text-destructive')}>
          {formatPercent(r.utilization, { decimals: 0 })}
        </span>
      ),
      sortValue: (r) => r.utilization,
    },
    {
      key: 'projected',
      header: 'Projected EOD',
      align: 'right',
      cell: (r) => formatCurrency(r.projectedEodSpend),
      sortValue: (r) => r.projectedEodSpend,
      hideOnMobile: true,
    },
    {
      key: 'date',
      header: 'As of',
      align: 'right',
      cell: (r) => <span className="text-sm">{formatDate(r.snapshotDate)}</span>,
      sortValue: (r) => r.snapshotDate,
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Daily budget utilisation, with end-of-day spend projected by linear extrapolation from the day elapsed so far."
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <TileSkeleton count={4} />
          <TableSkeleton rows={10} columns={6} />
        </div>
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No budget snapshots in scope"
          description="Run a sync that includes budgets to populate this view."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Budgets" value={formatNumber(data.summary.total)} />
            <StatTile label="Healthy" value={formatNumber(data.summary.healthy)} />
            <StatTile label="Warning" value={formatNumber(data.summary.warning)} />
            <StatTile label="Critical" value={formatNumber(data.summary.critical)} />
          </div>

          <DataTable
            rows={data.rows}
            columns={columns}
            rowKey={(r) => String(r.id)}
            searchable={(r) => `${r.name ?? ''} ${r.accountName ?? ''}`}
            searchPlaceholder="Search budgets or accounts…"
            initialSort={{ key: 'utilization', dir: 'desc' }}
            caption="Budget utilisation and end-of-day projection"
          />
        </div>
      )}
    </>
  );
}
