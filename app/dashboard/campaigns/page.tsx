'use client';

import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { HealthBadge, metricColumns, StatusBadge } from '@/components/data/metric-columns';
import { ErrorState, TableSkeleton } from '@/components/data/states';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { useFilters } from '@/components/providers/filters-provider';
import { usePermissions } from '@/components/providers/permission-provider';

type CampaignRow = {
  id: number;
  campaignId: string;
  name: string | null;
  status: string | null;
  channelType: string | null;
  accountName: string | null;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
  health: { score: number; level: string; primaryReason: string | null } | null;
};

export default function CampaignsPage() {
  const filters = useFilters();
  const { can } = usePermissions();
  const { data, isLoading, error, refetch } = useFilteredApi<{
    rows: CampaignRow[];
    canSeeMoney: boolean;
  }>('campaigns', '/api/campaigns', { withHealth: 'true' });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const canSeeMoney = data?.canSeeMoney ?? false;

  const columns: Array<Column<CampaignRow>> = [
    {
      key: 'name',
      header: 'Campaign',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name ?? 'Unnamed'}</p>
          <p className="truncate text-xs text-muted-foreground">{r.accountName}</p>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'health',
      header: 'Health',
      // Without a cap the reason text ("Spend up 340% week over week", …)
      // stretches this column and pushes the metrics off the right edge.
      maxWidth: '11.5rem',
      cell: (r) =>
        r.health ? (
          <div className="flex min-w-0 items-center gap-2">
            <HealthBadge score={r.health.score} level={r.health.level} />
            {r.health.primaryReason && (
              <span
                className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground xl:block"
                title={r.health.primaryReason}
              >
                {r.health.primaryReason}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      sortValue: (r) => r.health?.score ?? null,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status,
      hideOnMobile: true,
    },
    ...metricColumns<CampaignRow>(canSeeMoney),
  ];

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Performance and health score for every campaign in scope. Health is computed on the latest fully-synced day."
      />

      {isLoading || !data ? (
        <TableSkeleton rows={12} columns={8} />
      ) : (
        <DataTable
          rows={data.rows}
          columns={columns}
          rowKey={(r) => String(r.id)}
          searchable={(r) => `${r.name ?? ''} ${r.accountName ?? ''} ${r.campaignId}`}
          searchPlaceholder="Search campaigns or accounts…"
          initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
          caption="Campaign performance for the selected period"
          onExport={
            can('CAMPAIGNS', 'EXPORT')
              ? (format) =>
                  window.open(
                    `/api/export?dataset=campaigns&format=${format}&${filters.queryString()}`,
                    '_blank'
                  )
              : undefined
          }
        />
      )}
    </>
  );
}
