'use client';

import { PageHeader } from '@/components/data/page-header';
import { StatTile } from '@/components/data/stat-tile';
import { ComparisonChart, TrendChart } from '@/components/data/charts';
import { ErrorState, TileSkeleton } from '@/components/data/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/lib/format';

type Point = {
  date: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
};

type Response = {
  window: { start: string; end: string };
  previousWindow: { start: string; end: string };
  series: Point[];
  previousSeries: Point[];
  totals: Record<string, number | null>;
  previousTotals: Record<string, number | null>;
  deltas: Record<string, number | null>;
  canSeeMoney: boolean;
};

export default function TrendsPage() {
  const { data, isLoading, error, refetch } = useFilteredApi<Response>('trends', '/api/trends');

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        title="Trends"
        description={
          data
            ? `${formatDate(data.window.start)} – ${formatDate(data.window.end)} against ${formatDate(
                data.previousWindow.start
              )} – ${formatDate(data.previousWindow.end)}.`
            : 'Loading…'
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <TileSkeleton count={4} />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Clicks"
              value={formatNumber(data.totals.clicks ?? 0)}
              delta={data.deltas.clicks}
              previous={formatNumber(data.previousTotals.clicks ?? 0)}
            />
            <StatTile
              label="Impressions"
              value={formatNumber(data.totals.impressions ?? 0, { compact: true })}
              delta={data.deltas.impressions}
            />
            <StatTile
              label="Spend"
              value={data.canSeeMoney ? formatCurrency(data.totals.cost) : '—'}
              delta={data.canSeeMoney ? data.deltas.cost : undefined}
            />
            <StatTile
              label="CTR"
              value={formatPercent(data.totals.ctr)}
              delta={data.deltas.ctr}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Period comparison</CardTitle>
              <CardDescription>
                This window against the equivalent window immediately before it, aligned day for
                day.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="clicks">
                <TabsList>
                  <TabsTrigger value="clicks">Clicks</TabsTrigger>
                  <TabsTrigger value="impressions">Impressions</TabsTrigger>
                  <TabsTrigger value="conversions">Conversions</TabsTrigger>
                  {data.canSeeMoney && <TabsTrigger value="cost">Spend</TabsTrigger>}
                </TabsList>
                <TabsContent value="clicks">
                  <ComparisonChart
                    current={data.series}
                    previous={data.previousSeries}
                    dataKey="clicks"
                    label="Clicks"
                  />
                </TabsContent>
                <TabsContent value="impressions">
                  <ComparisonChart
                    current={data.series}
                    previous={data.previousSeries}
                    dataKey="impressions"
                    label="Impressions"
                  />
                </TabsContent>
                <TabsContent value="conversions">
                  <ComparisonChart
                    current={data.series}
                    previous={data.previousSeries}
                    dataKey="conversions"
                    label="Conversions"
                  />
                </TabsContent>
                {data.canSeeMoney && (
                  <TabsContent value="cost">
                    <ComparisonChart
                      current={data.series}
                      previous={data.previousSeries}
                      dataKey="cost"
                      label="Spend"
                      money
                    />
                  </TabsContent>
                )}
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">All metrics</CardTitle>
              <CardDescription>Every metric on one axis for the current window.</CardDescription>
            </CardHeader>
            <CardContent>
              <TrendChart
                data={data.series}
                series={[
                  { key: 'clicks', label: 'Clicks' },
                  { key: 'conversions', label: 'Conversions' },
                  ...(data.canSeeMoney ? [{ key: 'cost', label: 'Spend', money: true }] : []),
                ]}
                height={300}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
