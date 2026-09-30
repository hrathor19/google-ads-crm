'use client';

import { ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/data/page-header';
import { StatTile } from '@/components/data/stat-tile';
import { DataTable, type Column } from '@/components/data/data-table';
import { HealthBadge } from '@/components/data/metric-columns';
import { EmptyState, ErrorState, TableSkeleton, TileSkeleton } from '@/components/data/states';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { formatCurrency, formatNumber } from '@/lib/format';

/**
 * The priority queue: what to fix first.
 *
 * Ranked by `0.7 × (100 − health) + 0.3 × spend pressure`, so a mildly
 * unhealthy campaign burning a lot outranks a badly broken one spending
 * nothing — which is the order someone with an hour actually wants.
 */

type PriorityRow = {
  campaignPk: number;
  name: string | null;
  accountName: string | null;
  score: number;
  level: string;
  primaryReason: string | null;
  spendToday: number | null;
  priority: {
    score: number;
    reasons: string[];
    estimatedReviewMinutes: number;
    estimatedWastedSpend: number | null;
  };
};

export default function PrioritiesPage() {
  const { data, isLoading, error, refetch } = useFilteredApi<{
    referenceDate: string;
    totalReviewMinutes: number;
    estimatedWastedSpend: number | null;
    rows: PriorityRow[];
    canSeeMoney: boolean;
  }>('priorities', '/api/priorities');

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const canSeeMoney = data?.canSeeMoney ?? false;

  const columns: Array<Column<PriorityRow>> = [
    {
      key: 'priority',
      header: 'Priority',
      cell: (r) => (
        <Badge variant="outline" className="font-semibold tabular-nums">
          {r.priority.score}
        </Badge>
      ),
      sortValue: (r) => r.priority.score,
    },
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
      cell: (r) => <HealthBadge score={r.score} level={r.level} />,
      sortValue: (r) => r.score,
    },
    {
      key: 'reason',
      header: 'What to look at',
      maxWidth: '20rem',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.priority.reasons.slice(0, 3).map((reason) => (
            <Badge key={reason} variant="secondary" className="font-normal">
              {reason}
            </Badge>
          ))}
        </div>
      ),
      sortValue: (r) => r.primaryReason,
    },
    ...(canSeeMoney
      ? [
          {
            key: 'waste',
            header: 'Est. wasted',
            align: 'right' as const,
            cell: (r: PriorityRow) => formatCurrency(r.priority.estimatedWastedSpend),
            sortValue: (r: PriorityRow) => r.priority.estimatedWastedSpend,
          },
        ]
      : []),
    {
      key: 'minutes',
      header: 'Review',
      align: 'right',
      cell: (r) => <span className="text-sm">{r.priority.estimatedReviewMinutes} min</span>,
      sortValue: (r) => r.priority.estimatedReviewMinutes,
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Priority queue"
        description="Unhealthy campaigns ranked by how much they cost you, not just how broken they are. Scored on the latest fully-synced day."
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <TileSkeleton count={3} />
          <TableSkeleton rows={10} columns={6} />
        </div>
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nothing needs attention"
          description="Every active campaign in scope scored healthy on the reference day."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label="Campaigns to review" value={formatNumber(data.rows.length)} />
            <StatTile
              label="Estimated review time"
              value={`${Math.round(data.totalReviewMinutes / 60)}h ${data.totalReviewMinutes % 60}m`}
            />
            <StatTile
              label="Estimated wasted spend"
              value={canSeeMoney ? formatCurrency(data.estimatedWastedSpend) : '—'}
              hint="Today's spend scaled by how unhealthy each campaign is. An indicator, not an invoice."
            />
          </div>

          <DataTable
            rows={data.rows}
            columns={columns}
            rowKey={(r) => String(r.campaignPk)}
            searchable={(r) => `${r.name ?? ''} ${r.accountName ?? ''}`}
            searchPlaceholder="Search campaigns…"
            initialSort={{ key: 'priority', dir: 'desc' }}
            caption="Campaigns ranked by review priority"
          />
        </div>
      )}
    </>
  );
}
