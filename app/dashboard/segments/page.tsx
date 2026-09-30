'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Globe, Map as MapIcon, Smartphone, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { metricColumns } from '@/components/data/metric-columns';
import { CategoryBarChart } from '@/components/data/charts';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/data/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';

// The map pulls in d3-geo and a topojson parser; loading it on demand keeps
// that off the initial bundle for everyone who only wants the table.
const GeoMap = dynamic(() => import('@/components/data/geo-map').then((m) => m.GeoMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full rounded-lg" />,
});

type SegmentRow = {
  segment: string;
  /** ISO 3166-1 numeric — present on geo rows, used to join to the map. */
  isoNumeric?: number | null;
  criterionId?: number | null;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
};

export default function SegmentsPage() {
  const [geoView, setGeoView] = useState<'map' | 'table'>('map');
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
        description="The two segment dimensions the sync captures. Geography is reported at country level — the granularity the Google Ads geographic view returns."
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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Globe className="h-4 w-4 opacity-70" aria-hidden="true" />
                Geography
                <span className="font-normal text-muted-foreground">
                  {data.geo.length} countr{data.geo.length === 1 ? 'y' : 'ies'}
                </span>
              </h2>

              {data.geo.length > 0 && (
                <div className="flex rounded-lg border p-0.5" role="group" aria-label="Geography view">
                  {(
                    [
                      ['map', 'Map', MapIcon],
                      ['table', 'Table', Table2],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setGeoView(key)}
                      aria-pressed={geoView === key}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                        geoView === key
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {data.geo.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No geographic data in this window"
                description="Run a sync covering these dates to populate the geographic view."
              />
            ) : geoView === 'map' ? (
              <Card>
                <CardContent className="p-4">
                  <GeoMap
                    data={data.geo.map((g) => ({
                      segment: g.segment,
                      isoNumeric: g.isoNumeric ?? null,
                      impressions: g.impressions,
                      clicks: g.clicks,
                      cost: g.cost,
                      conversions: g.conversions,
                      ctr: g.ctr,
                    }))}
                    canSeeMoney={canSeeMoney}
                  />
                  {data.geo.length === 1 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      All targeting in this window is {data.geo[0]!.segment}, so one country is
                      shaded. The map fills out as you add markets.
                    </p>
                  )}
                </CardContent>
              </Card>
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
