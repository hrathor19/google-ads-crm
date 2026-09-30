'use client';

import { useRouter } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { metricColumns, StatusBadge } from '@/components/data/metric-columns';
import { StatTile } from '@/components/data/stat-tile';
import { EmptyState, ErrorState, TableSkeleton, TileSkeleton } from '@/components/data/states';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { useFilters } from '@/components/providers/filters-provider';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';

type AccountRow = {
  id: number;
  customerId: string;
  name: string | null;
  currency: string | null;
  status: string | null;
  campaigns: number;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
};

type Response = {
  rows: AccountRow[];
  totals: AccountRow;
  canSeeMoney: boolean;
};

export default function AccountsPage() {
  const router = useRouter();
  const filters = useFilters();
  const { can } = usePermissions();
  const { data, isLoading, error, refetch } = useFilteredApi<Response>('accounts', '/api/accounts');

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const canSeeMoney = data?.canSeeMoney ?? false;

  const columns: Array<Column<AccountRow>> = [
    {
      key: 'name',
      header: 'Account',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name ?? 'Unnamed account'}</p>
          <p className="truncate text-xs text-muted-foreground">{r.customerId}</p>
        </div>
      ),
      sortValue: (r) => r.name ?? r.customerId,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status,
      hideOnMobile: true,
    },
    {
      key: 'campaigns',
      header: 'Campaigns',
      align: 'right',
      cell: (r) => formatNumber(r.campaigns),
      sortValue: (r) => r.campaigns,
    },
    ...metricColumns<AccountRow>(canSeeMoney),
  ];

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Every client account under the manager account. Select one to drill into its campaigns."
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <TileSkeleton count={4} />
          <TableSkeleton rows={10} columns={7} />
        </div>
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No accounts in scope"
          description="Either nothing has synced yet, or your role is scoped to accounts that no longer exist."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Accounts" value={formatNumber(data.rows.length)} />
            <StatTile
              label="Total spend"
              value={canSeeMoney ? formatCurrency(data.totals.cost) : '—'}
            />
            <StatTile label="Clicks" value={formatNumber(data.totals.clicks, { compact: true })} />
            <StatTile label="Blended CTR" value={formatPercent(data.totals.ctr)} />
          </div>

          <DataTable
            rows={data.rows}
            columns={columns}
            rowKey={(r) => String(r.id)}
            searchable={(r) => `${r.name ?? ''} ${r.customerId}`}
            searchPlaceholder="Search accounts by name or ID…"
            onRowClick={(r) => router.push(`/dashboard/accounts/${r.id}?${filters.queryString()}`)}
            initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
            caption="Google Ads accounts with performance for the selected period"
            onExport={
              can('ACCOUNTS', 'EXPORT')
                ? (format) =>
                    window.open(
                      `/api/export?dataset=accounts&format=${format}&${filters.queryString()}`,
                      '_blank'
                    )
                : undefined
            }
          />
        </div>
      )}
    </>
  );
}
