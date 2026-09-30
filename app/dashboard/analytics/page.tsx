'use client';

import { Activity, PlugZap } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/data/page-header';
import { StatTile } from '@/components/data/stat-tile';
import { TrendChart } from '@/components/data/charts';
import { ErrorState, TileSkeleton } from '@/components/data/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatNumber, formatPercent } from '@/lib/format';

type Section = {
  key: string;
  label: string;
  dimensionLabel: string;
  columns: string[];
  rows: Array<{ label: string; values: number[] }>;
  totals: number[];
};

type Response = {
  configured: boolean;
  missing?: string[];
  range?: { start: string; end: string };
  summary?: {
    activeUsers: number;
    newUsers: number;
    sessions: number;
    engagedSessions: number;
    engagementRate: number | null;
    averageSessionDuration: number | null;
    screenPageViews: number;
    conversions: number;
    bounceRate: number | null;
  };
  timeseries?: Array<{ date: string; activeUsers: number; sessions: number; conversions: number }>;
  sections?: Section[];
};

/** Rate-shaped GA4 metrics arrive as 0-1 fractions; durations as seconds. */
function formatCell(column: string, value: number): string {
  if (/rate/i.test(column)) return formatPercent(value);
  if (/duration|time/i.test(column)) return `${Math.round(value)}s`;
  return formatNumber(value, { decimals: value % 1 === 0 ? 0 : 1 });
}

export default function AnalyticsPage() {
  const { can } = usePermissions();
  const { data, isLoading, error, refetch } = useFilteredApi<Response>(
    'analytics',
    '/api/analytics'
  );

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  if (!isLoading && data && !data.configured) {
    return (
      <>
        <PageHeader title="Analytics (GA4)" description="Google Analytics 4 reporting." />
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-4 py-10 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <PlugZap className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="mx-auto max-w-xl space-y-2">
              <p className="font-medium">GA4 is not connected yet</p>
              <p className="text-sm text-muted-foreground">
                The Google Ads Intelligence project this app was ported from had no GA4 reporting
                integration — GA4 appeared there only as tag detection inside the landing-page
                auditor — and it carried no GA4 credentials. This section is built and ready; it
                needs a service account with read access to your GA4 property.
              </p>
              {data.missing?.length ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  Set these environment variables:{' '}
                  <code className="rounded bg-muted px-1 py-0.5">{data.missing.join(', ')}</code>
                </p>
              ) : null}
            </div>
            {can('INTEGRATIONS', 'VIEW') && (
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/admin/integrations">Open Integrations Health</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analytics (GA4)"
        description="Traffic, engagement, conversions, audience, devices and geography from Google Analytics 4."
      />

      {isLoading || !data?.summary ? (
        <div className="space-y-4">
          <TileSkeleton count={4} />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Active users" value={formatNumber(data.summary.activeUsers)} />
            <StatTile label="Sessions" value={formatNumber(data.summary.sessions)} />
            <StatTile
              label="Engagement rate"
              value={formatPercent(data.summary.engagementRate)}
            />
            <StatTile label="Conversions" value={formatNumber(data.summary.conversions)} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="New users" value={formatNumber(data.summary.newUsers)} />
            <StatTile label="Page views" value={formatNumber(data.summary.screenPageViews)} />
            <StatTile
              label="Avg. session"
              value={`${Math.round(data.summary.averageSessionDuration ?? 0)}s`}
            />
            <StatTile label="Bounce rate" value={formatPercent(data.summary.bounceRate)} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 opacity-70" aria-hidden="true" />
                Traffic over time
              </CardTitle>
              <CardDescription>Daily users, sessions and conversions.</CardDescription>
            </CardHeader>
            <CardContent>
              <TrendChart
                data={data.timeseries ?? []}
                series={[
                  { key: 'activeUsers', label: 'Users' },
                  { key: 'sessions', label: 'Sessions' },
                  { key: 'conversions', label: 'Conversions' },
                ]}
              />
            </CardContent>
          </Card>

          {data.sections && data.sections.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Reports</CardTitle>
                <CardDescription>
                  Sources, landing pages, engagement, devices, geography and audience.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={data.sections[0]!.key}>
                  <TabsList>
                    {data.sections.map((s) => (
                      <TabsTrigger key={s.key} value={s.key}>
                        {s.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {data.sections.map((s) => (
                    <TabsContent key={s.key} value={s.key}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="border-b">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {s.dimensionLabel}
                              </th>
                              {s.columns.map((c) => (
                                <th
                                  key={c}
                                  className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                                >
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {s.rows.map((row) => (
                              <tr key={row.label} className="border-b last:border-0">
                                <td className="max-w-xs truncate px-3 py-2">{row.label}</td>
                                {row.values.map((v, i) => (
                                  <td key={i} className="px-3 py-2 text-right tabular-nums">
                                    {formatCell(s.columns[i] ?? '', v)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                            {s.rows.length === 0 && (
                              <tr>
                                <td
                                  colSpan={s.columns.length + 1}
                                  className="px-3 py-10 text-center text-muted-foreground"
                                >
                                  No rows for this window.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
