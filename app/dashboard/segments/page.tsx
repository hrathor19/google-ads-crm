'use client';

import { Globe, Smartphone } from 'lucide-react';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { metricColumns } from '@/components/data/metric-columns';
import { CategoryBarChart } from '@/components/data/charts';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/data/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';

type SegmentRow = {
  segment: string;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
};

export default function SegmentsPage() {
  const { data, isLoading, error, refetch } = useFilteredApi<{
    devices: SegmentRow[];
    geo: SegmentRow[];
    canSeeMoney: boolean;
  }>('segments', '/api/segments');

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const canSeeMoney = data?.canSeeMoney ?? false;
  const valueKey = canSeeMoney ? 'cost' : 'clicks';

  const columns = (label: string): Array<Column<SegmentRow>> => [
    {
      key: 'segment',
      header: label,
      cell: (r) => <span className="font-medium">{r.segment}</span>,
      sortValue: (r) => r.segment,
    },
    ...metricColumns<SegmentRow>(canSeeMoney),
  ];

  return (
    <>
      <PageHeader
        title="Devices & geography"
        description="The two segment dimensions the sync captures. Geography is reported at country level, which is the granularity the Google Ads geographic view returns here."
      />

      {isLoading || !data ? (
        <div className="space-y-6">
          <TableSkeleton rows={4} columns={6} />
          <TableSkeleton rows={6} columns={6} />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <Card className="mb-3">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Smartphone className="h-4 w-4 opacity-70" aria-hidden="true" />
                  Devices
                </CardTitle>
                <CardDescription>
                  {canSeeMoney ? 'Spend' : 'Clicks'} by device category.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.devices.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No device data in this window.
                  </p>
                ) : (
                  <CategoryBarChart
                    data={data.devices.map((d) => ({
                      label: d.segment,
                      cost: d.cost ?? 0,
                      clicks: d.clicks,
                    }))}
                    valueKey={valueKey}
                    money={canSeeMoney}
                    height={200}
                  />
                )}
              </CardContent>
            </Card>
            <DataTable
              rows={data.devices}
              columns={columns('Device')}
              rowKey={(r) => r.segment}
              pageSize={10}
              emptyMessage="No device-segmented rows in this window."
            />
          </section>

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Globe className="h-4 w-4 opacity-70" aria-hidden="true" />
              Geography
            </h2>
            {data.geo.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No geographic data in this window"
                description="Run a sync covering these dates to populate the geographic view."
              />
            ) : (
              <DataTable
                rows={data.geo}
                columns={columns('Location')}
                rowKey={(r) => r.segment}
                searchable={(r) => r.segment}
                searchPlaceholder="Search locations…"
                initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
                emptyMessage="No geo-segmented rows in this window."
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}
