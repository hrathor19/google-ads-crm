'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { metricColumns, StatusBadge } from '@/components/data/metric-columns';
import { ErrorState, TableSkeleton } from '@/components/data/states';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { useFilters } from '@/components/providers/filters-provider';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatNumber } from '@/lib/format';

type SearchTermRow = {
  id: number;
  query: string;
  status: string | null;
  matchType: string | null;
  campaignName: string | null;
  adGroupName: string | null;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
};

export default function SearchTermsPage() {
  const filters = useFilters();
  const { can } = usePermissions();
  const [minClicks, setMinClicks] = useState('');
  const [minCost, setMinCost] = useState('');
  const [contains, setContains] = useState('');

  const { data, isLoading, error, refetch } = useFilteredApi<{
    rows: SearchTermRow[];
    total: number;
    canSeeMoney: boolean;
  }>(
    'search-terms',
    '/api/search-terms',
    {
      limit: 200,
      minClicks: minClicks || undefined,
      minCost: minCost || undefined,
      contains: contains || undefined,
    }
  );

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const canSeeMoney = data?.canSeeMoney ?? false;

  const columns: Array<Column<SearchTermRow>> = [
    {
      key: 'query',
      header: 'Search term',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.query}</p>
          <p className="truncate text-xs text-muted-foreground">
            {r.campaignName} · {r.adGroupName}
          </p>
        </div>
      ),
      sortValue: (r) => r.query,
    },
    {
      key: 'status',
      header: 'Targeting',
      cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status,
      hideOnMobile: true,
    },
    ...metricColumns<SearchTermRow>(canSeeMoney),
  ];

  return (
    <>
      <PageHeader
        title="Search terms"
        description="The actual queries that triggered your ads. Filter for expensive terms with nothing to show and add them as negatives."
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="contains" className="text-xs">
              Contains
            </Label>
            <Input
              id="contains"
              value={contains}
              onChange={(e) => setContains(e.target.value)}
              placeholder="e.g. free"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="minClicks" className="text-xs">
              Minimum clicks
            </Label>
            <Input
              id="minClicks"
              type="number"
              min={0}
              value={minClicks}
              onChange={(e) => setMinClicks(e.target.value)}
              placeholder="0"
              className="h-9"
            />
          </div>
          {canSeeMoney && (
            <div className="space-y-1.5">
              <Label htmlFor="minCost" className="text-xs">
                Minimum spend
              </Label>
              <Input
                id="minCost"
                type="number"
                min={0}
                value={minCost}
                onChange={(e) => setMinCost(e.target.value)}
                placeholder="0"
                className="h-9"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading || !data ? (
        <TableSkeleton rows={12} columns={7} />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {formatNumber(data.total)} distinct term(s) match. Showing the top{' '}
            {formatNumber(data.rows.length)} by spend.
          </p>
          <DataTable
            rows={data.rows}
            columns={columns}
            rowKey={(r) => String(r.id)}
            searchable={(r) => r.query}
            searchPlaceholder="Filter the loaded terms…"
            initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
            caption="Search terms for the selected period"
            onExport={
              can('KEYWORDS', 'EXPORT')
                ? (format) =>
                    window.open(
                      `/api/export?dataset=searchTerms&format=${format}&${filters.queryString()}`,
                      '_blank'
                    )
                : undefined
            }
          />
        </>
      )}
    </>
  );
}
