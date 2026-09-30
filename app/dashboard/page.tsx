'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Clock,
  Eye,
  MousePointerClick,
  Percent,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Users,
  Coins,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/data/page-header';
import { StatTile } from '@/components/data/stat-tile';
import { TrendChart } from '@/components/data/charts';
import { ErrorState, TileSkeleton } from '@/components/data/states';
import { Skeleton } from '@/components/ui/skeleton';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { formatCurrency, formatDate, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

type Totals = {
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
  conversionRate: number | null;
};

type CampaignRow = {
  id: number;
  name: string | null;
  accountName: string | null;
  cost: number | null;
  clicks: number;
  conversions: number;
  ctr: number | null;
  costPerConversion: number | null;
};

type OverviewResponse = {
  referenceDate: string;
  window: { start: string; end: string };
  previousWindow: { start: string; end: string };
  counts: { accounts: number; campaignsActive: number; adGroupsActive: number; keywordsActive: number };
  totals: Totals;
  previousTotals: Totals;
  deltas: Record<string, number | null>;
  series: Array<{ date: string; impressions: number; clicks: number; cost: number; conversions: number }>;
  alerts: Array<{ code: string; severity: string; title: string; detail: string; count: number }>;
  sync: { lastSuccessfulAt: string | null; latestStatus: string | null; failedLast24h: number };
  topSpenders: CampaignRow[];
  worstPerformers: CampaignRow[];
  canSeeMoney: boolean;
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-destructive/40 bg-destructive/5',
  high: 'border-amber-500/40 bg-amber-500/5',
  medium: 'border-blue-500/30 bg-blue-500/5',
};

const SEVERITY_ICON: Record<string, typeof AlertTriangle> = {
  critical: Ban,
  high: AlertTriangle,
  medium: Clock,
};

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useFilteredApi<OverviewResponse>(
    'overview',
    '/api/dashboard/overview'
  );

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        title="Executive overview"
        description={
          data
            ? `${formatDate(data.window.start)} – ${formatDate(data.window.end)}, compared with ` +
              `${formatDate(data.previousWindow.start)} – ${formatDate(data.previousWindow.end)}.`
            : 'Loading the latest synced performance…'
        }
        actions={
          data && (
            <Badge variant="outline" className="gap-1.5 font-normal">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  data.sync.latestStatus === 'success' ? 'bg-emerald-500' : 'bg-amber-500'
                )}
                aria-hidden="true"
              />
              Last synced {formatRelative(data.sync.lastSuccessfulAt)}
            </Badge>
          )
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <TileSkeleton count={4} />
          <TileSkeleton count={4} />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Headline KPIs */}
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Accounts"
              value={formatNumber(data.counts.accounts)}
              icon={Users}
              hint="Client accounts under the MCC, excluding the manager account itself."
            />
            <StatTile
              label="Spend"
              value={data.canSeeMoney ? formatCurrency(data.totals.cost) : '—'}
              icon={Wallet}
              delta={data.canSeeMoney ? data.deltas.cost : undefined}
              hint={data.canSeeMoney ? undefined : 'You do not have permission to view spend.'}
            />
            <StatTile
              label="Impressions"
              value={formatNumber(data.totals.impressions, { compact: true })}
              icon={Eye}
              delta={data.deltas.impressions}
            />
            <StatTile
              label="Clicks"
              value={formatNumber(data.totals.clicks, { compact: true })}
              icon={MousePointerClick}
              delta={data.deltas.clicks}
            />
          </section>

          <section aria-label="Efficiency metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="CTR"
              value={formatPercent(data.totals.ctr)}
              icon={Percent}
              delta={data.deltas.ctr}
            />
            <StatTile
              label="Avg. CPC"
              value={data.canSeeMoney ? formatCurrency(data.totals.avgCpc) : '—'}
              icon={Coins}
              delta={data.canSeeMoney ? data.deltas.avgCpc : undefined}
              direction="down-good"
            />
            <StatTile
              label="Conversions"
              value={formatNumber(data.totals.conversions, { decimals: 1 })}
              icon={Target}
              delta={data.deltas.conversions}
            />
            <StatTile
              label="Cost / conversion"
              value={data.canSeeMoney ? formatCurrency(data.totals.costPerConversion) : '—'}
              delta={data.canSeeMoney ? data.deltas.costPerConversion : undefined}
              direction="down-good"
            />
          </section>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <section aria-label="Alerts">
              <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.alerts.map((a) => {
                  const Icon = SEVERITY_ICON[a.severity] ?? AlertTriangle;
                  return (
                    <Card key={a.code} className={cn('border', SEVERITY_STYLES[a.severity])}>
                      <CardContent className="flex gap-3 p-3.5">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{a.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {/* Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Performance trend</CardTitle>
              <CardDescription>
                Daily clicks, impressions and conversions across the selected window.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.series.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No synced days fall inside this window.
                </p>
              ) : (
                <TrendChart
                  data={data.series}
                  series={[
                    { key: 'clicks', label: 'Clicks' },
                    { key: 'conversions', label: 'Conversions' },
                  ]}
                />
              )}
            </CardContent>
          </Card>

          {/* Top / bottom campaigns */}
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <CampaignList
              title="Top campaigns by spend"
              description="Where the money went this period."
              icon={TrendingUp}
              rows={data.topSpenders}
              canSeeMoney={data.canSeeMoney}
            />
            <CampaignList
              title="Worst cost per conversion"
              description="Spending campaigns with the least to show for it."
              icon={TrendingDown}
              rows={data.worstPerformers}
              canSeeMoney={data.canSeeMoney}
            />
          </div>
        </div>
      )}
    </>
  );
}

function CampaignList({
  title,
  description,
  icon: Icon,
  rows,
  canSeeMoney,
}: {
  title: string;
  description: string;
  icon: typeof TrendingUp;
  rows: CampaignRow[];
  canSeeMoney: boolean;
}) {
  return (
    // min-w-0 is load-bearing: without it this card is a grid item with
    // min-width:auto, and the truncating campaign names below set its
    // min-content width to the longest name rather than ellipsing.
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
            <span className="truncate">{title}</span>
          </CardTitle>
          <CardDescription className="truncate">{description}</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href="/dashboard/campaigns">
            All
            <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-1">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No campaign spent anything in this window.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name ?? 'Unnamed campaign'}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.accountName}</p>
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums">
                  <p className="font-medium">
                    {canSeeMoney ? formatCurrency(c.cost, { compact: true }) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(c.clicks)} clicks · {formatPercent(c.ctr)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
