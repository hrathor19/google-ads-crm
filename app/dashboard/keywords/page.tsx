'use client';

import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { HealthBadge, metricColumns } from '@/components/data/metric-columns';
import { StatTile } from '@/components/data/stat-tile';
import { ErrorState, TableSkeleton, TileSkeleton } from '@/components/data/states';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { useFilters } from '@/components/providers/filters-provider';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type KeywordRow = {
  id: number;
  text: string | null;
  matchType: string | null;
  status: string | null;
  qualityScore: number | null;
  expectedCtr: string | null;
  adRelevance: string | null;
  landingPageExperience: string | null;
  campaignName: string | null;
  adGroupName: string | null;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
  score: number;
  level: string;
};

/** Google returns these as enum names; render them as a person would say them. */
function bucketLabel(value: string | null): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').toLowerCase();
}

export default function KeywordsPage() {
  const filters = useFilters();
  const { can } = usePermissions();
  const { data, isLoading, error, refetch } = useFilteredApi<{
    rows: KeywordRow[];
    canSeeMoney: boolean;
    summary: { total: number; healthy: number; warning: number; critical: number };
  }>('keywords', '/api/keywords', { limit: 1000 });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const canSeeMoney = data?.canSeeMoney ?? false;

  const columns: Array<Column<KeywordRow>> = [
    {
      key: 'text',
      header: 'Keyword',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.text ?? '—'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {(r.matchType ?? '').toLowerCase()} · {r.campaignName}
          </p>
        </div>
      ),
      sortValue: (r) => r.text,
    },
    {
      key: 'health',
      header: 'Health',
      cell: (r) => <HealthBadge score={r.score} level={r.level} />,
      sortValue: (r) => r.score,
    },
    {
      key: 'qs',
      header: 'Quality',
      align: 'right',
      cell: (r) =>
        r.qualityScore === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn('font-medium tabular-nums', r.qualityScore < 5 && 'text-destructive')}
          >
            {r.qualityScore}
          </span>
        ),
      sortValue: (r) => r.qualityScore,
    },
    {
      key: 'expectedCtr',
      header: 'Exp. CTR',
      cell: (r) => <span className="text-xs">{bucketLabel(r.expectedCtr)}</span>,
      sortValue: (r) => r.expectedCtr,
      hideOnMobile: true,
    },
    {
      key: 'lpe',
      header: 'Landing page',
      cell: (r) => <span className="text-xs">{bucketLabel(r.landingPageExperience)}</span>,
      sortValue: (r) => r.landingPageExperience,
      hideOnMobile: true,
    },
    ...metricColumns<KeywordRow>(canSeeMoney),
  ];

  return (
    <>
      <PageHeader
        title="Keywords"
        description="Keyword performance with Quality Score and its three sub-components, scored against the same rules as the source console."
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <TileSkeleton count={4} />
          <TableSkeleton rows={12} columns={8} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Keywords with data" value={formatNumber(data.summary.total)} />
            <StatTile label="Healthy" value={formatNumber(data.summary.healthy)} />
            <StatTile label="Warning" value={formatNumber(data.summary.warning)} />
            <StatTile label="Critical" value={formatNumber(data.summary.critical)} />
          </div>

          <DataTable
            rows={data.rows}
            columns={columns}
            rowKey={(r) => String(r.id)}
            searchable={(r) => `${r.text ?? ''} ${r.campaignName ?? ''} ${r.adGroupName ?? ''}`}
            searchPlaceholder="Search keywords, campaigns or ad groups…"
            initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
            caption="Keyword performance and Quality Score for the selected period"
            onExport={
              can('KEYWORDS', 'EXPORT')
                ? (format) =>
                    window.open(
                      `/api/export?dataset=keywords&format=${format}&${filters.queryString()}`,
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
