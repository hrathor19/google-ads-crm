'use client';

import { useState } from 'react';
import { BarChart3, KeyRound, Layers, Link2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/data/data-table';
import { TrendChart } from '@/components/data/charts';
import { metricColumns, StatusBadge } from '@/components/data/metric-columns';
import { StatTile } from '@/components/data/stat-tile';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/data/states';
import { Badge } from '@/components/ui/badge';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * One request's campaigns, in depth.
 *
 * The Assigned campaigns page answers "which assignments are in trouble".
 * This answers "why" for one of them, over the same campaign set: the trend,
 * then campaigns, ad groups, keywords and the search terms that actually
 * triggered the ads. Without it the Ad Specialist has to rebuild the same
 * filter by hand on four other screens and hope they match.
 */

type Row = {
  id: number;
  name: string | null;
  status: string | null;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
};

type CampaignRow = Row & { campaignId: string; accountName: string | null };
type AdGroupRow = Row & { campaignName: string | null };
type KeywordRow = Row & {
  text: string | null;
  matchType: string | null;
  qualityScore: number | null;
  campaignName: string | null;
  adGroupName: string | null;
};
type TermRow = Omit<Row, 'id' | 'name' | 'status'> & {
  id: number;
  query: string;
  status: string | null;
  campaignName: string | null;
  adGroupName: string | null;
};

type Response = {
  basis: 'LINKED' | 'LEGACY' | 'ACCOUNT' | 'NONE';
  canSeeMoney: boolean;
  requiredCpl: number | null;
  requiredLeads: number | null;
  campaignCount: number;
  totals: {
    impressions: number;
    clicks: number;
    cost: number | null;
    conversions: number;
    ctr: number | null;
    avgCpc: number | null;
    costPerConversion: number | null;
  };
  pacing: string | null;
  leadProgress: number | null;
  series: Array<{
    date: string;
    impressions: number;
    clicks: number;
    cost: number | null;
    conversions: number;
  }>;
  campaigns: CampaignRow[];
  adGroups: AdGroupRow[];
  keywords: KeywordRow[];
  searchTerms: TermRow[];
};

/** What the numbers are actually being read from, said plainly. */
const BASIS_NOTE: Record<Response['basis'], string | null> = {
  LINKED: null,
  LEGACY:
    'Reading from the single campaign ID recorded at launch. Link the campaigns properly to include the rest.',
  ACCOUNT:
    'No campaigns are linked, so this shows every campaign in the account — not just this client’s. Link the campaigns to narrow it.',
  NONE: null,
};

const VIEWS = [
  { key: 'campaigns', label: 'Campaigns', icon: BarChart3 },
  { key: 'adGroups', label: 'Ad groups', icon: Layers },
  { key: 'keywords', label: 'Keywords', icon: KeyRound },
  { key: 'searchTerms', label: 'Search terms', icon: Search },
] as const;

export function RequestPerformance({
  requestId,
  onLinkCampaigns,
}: {
  requestId: string;
  onLinkCampaigns?: () => void;
}) {
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('campaigns');
  const { data, isLoading, error, refetch } = useFilteredApi<Response>(
    `request-performance`,
    `/api/ad-requests/${requestId}/performance`
  );

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <TableSkeleton rows={8} columns={7} />;

  if (data.basis === 'NONE' || data.campaignCount === 0) {
    return (
      <EmptyState
        icon={Link2}
        title="Nothing linked to report on"
        description="Link the campaigns this client is running and their performance appears here, measured against the CPL and lead targets on this request."
        action={
          onLinkCampaigns ? (
            <Button size="sm" onClick={onLinkCampaigns}>
              Link campaigns
            </Button>
          ) : undefined
        }
      />
    );
  }

  const money = data.canSeeMoney;
  const t = data.totals;
  const note = BASIS_NOTE[data.basis];

  const campaignColumns: Array<Column<CampaignRow>> = [
    {
      key: 'name',
      header: 'Campaign',
      maxWidth: '18rem',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name ?? 'Unnamed'}</p>
          <p className="truncate text-xs text-muted-foreground">{r.accountName}</p>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status,
      hideOnMobile: true,
    },
    ...metricColumns<CampaignRow>(money),
  ];

  const adGroupColumns: Array<Column<AdGroupRow>> = [
    {
      key: 'name',
      header: 'Ad group',
      maxWidth: '18rem',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name ?? 'Unnamed'}</p>
          <p className="truncate text-xs text-muted-foreground">{r.campaignName}</p>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status,
      hideOnMobile: true,
    },
    ...metricColumns<AdGroupRow>(money),
  ];

  const keywordColumns: Array<Column<KeywordRow>> = [
    {
      key: 'text',
      header: 'Keyword',
      maxWidth: '16rem',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.text ?? '—'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {r.matchType?.toLowerCase()} · {r.adGroupName}
          </p>
        </div>
      ),
      sortValue: (r) => r.text,
    },
    {
      key: 'qs',
      header: 'QS',
      align: 'right',
      cell: (r) =>
        r.qualityScore === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              'font-medium tabular-nums',
              r.qualityScore <= 4 && 'text-destructive',
              r.qualityScore >= 8 && 'text-emerald-600 dark:text-emerald-400'
            )}
          >
            {r.qualityScore}
          </span>
        ),
      sortValue: (r) => r.qualityScore,
    },
    ...metricColumns<KeywordRow>(money),
  ];

  const termColumns: Array<Column<TermRow>> = [
    {
      key: 'query',
      header: 'Search term',
      maxWidth: '18rem',
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
    ...metricColumns<TermRow>(money),
  ];

  return (
    <div className="space-y-4">
      {note && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <p className="min-w-0 flex-1 text-xs text-amber-700 dark:text-amber-400">{note}</p>
            {onLinkCampaigns && (
              <Button size="sm" variant="outline" onClick={onLinkCampaigns}>
                Link campaigns
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Clicks"
          value={formatNumber(t.clicks, { compact: true })}
          caption={`${formatNumber(t.impressions, { compact: true })} impressions · ${formatPercent(t.ctr)} CTR`}
        />
        <StatTile
          label="Leads"
          value={formatNumber(t.conversions, { decimals: 1 })}
          caption={
            data.requiredLeads
              ? `of ${formatNumber(data.requiredLeads)} required`
              : 'no lead target set'
          }
        />
        {money ? (
          <>
            <StatTile
              label="Spend"
              value={formatCurrency(t.cost, { compact: true })}
              caption={`${formatCurrency(t.avgCpc)} avg. CPC`}
            />
            <StatTile
              label="Cost per lead"
              value={formatCurrency(t.costPerConversion)}
              caption={
                data.requiredCpl === null
                  ? 'no CPL target set'
                  : `target ${formatCurrency(data.requiredCpl)}`
              }
            />
          </>
        ) : (
          <>
            <StatTile
              label="Campaigns"
              value={formatNumber(data.campaignCount)}
              caption="reporting in this window"
            />
            <StatTile
              label="Conversion rate"
              value={t.clicks ? formatPercent(t.conversions / t.clicks) : '—'}
              caption="leads per click"
            />
          </>
        )}
      </div>

      {/* Two charts, not two series on one axis. Spend runs to ₹1.8L while
          leads run to 300: share a Y axis and the leads line is pinned flat
          against zero, which reads as "no leads" rather than "different
          order of magnitude". */}
      {data.series.length > 1 && (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {money ? 'Spend' : 'Clicks'}
              </p>
              <TrendChart
                data={data.series}
                series={
                  money
                    ? [{ key: 'cost', label: 'Spend', money: true }]
                    : [{ key: 'clicks', label: 'Clicks' }]
                }
                height={200}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Leads
              </p>
              <TrendChart
                data={data.series}
                series={[{ key: 'conversions', label: 'Leads' }]}
                height={200}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {VIEWS.map((v) => {
          const count = data[v.key].length;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-pressed={view === v.key}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                view === v.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <v.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {v.label}
              <Badge
                variant="outline"
                className={cn(
                  'ml-0.5 h-4 border-0 px-1 text-[10px] font-semibold tabular-nums',
                  view === v.key ? 'bg-primary-foreground/20' : 'bg-background/60'
                )}
              >
                {count}
              </Badge>
            </button>
          );
        })}
      </div>

      {view === 'campaigns' && (
        <DataTable
          rows={data.campaigns}
          columns={campaignColumns}
          rowKey={(r) => String(r.id)}
          searchable={(r) => `${r.name ?? ''} ${r.campaignId}`}
          searchPlaceholder="Search campaigns…"
          initialSort={{ key: money ? 'cost' : 'clicks', dir: 'desc' }}
          caption="Linked campaigns for the selected period"
        />
      )}
      {view === 'adGroups' && (
        <DataTable
          rows={data.adGroups}
          columns={adGroupColumns}
          rowKey={(r) => String(r.id)}
          searchable={(r) => `${r.name ?? ''} ${r.campaignName ?? ''}`}
          searchPlaceholder="Search ad groups…"
          initialSort={{ key: money ? 'cost' : 'clicks', dir: 'desc' }}
          emptyMessage="No ad groups reported in this window."
          caption="Ad groups inside the linked campaigns"
        />
      )}
      {view === 'keywords' && (
        <DataTable
          rows={data.keywords}
          columns={keywordColumns}
          rowKey={(r) => String(r.id)}
          searchable={(r) => `${r.text ?? ''} ${r.adGroupName ?? ''}`}
          searchPlaceholder="Search keywords…"
          initialSort={{ key: money ? 'cost' : 'clicks', dir: 'desc' }}
          emptyMessage="No keywords reported in this window."
          caption="Top keywords inside the linked campaigns"
        />
      )}
      {view === 'searchTerms' && (
        <DataTable
          rows={data.searchTerms}
          columns={termColumns}
          rowKey={(r) => String(r.id)}
          searchable={(r) => r.query}
          searchPlaceholder="Search terms…"
          initialSort={{ key: money ? 'cost' : 'clicks', dir: 'desc' }}
          emptyMessage="No search terms reported in this window."
          caption="What people actually typed to trigger these ads"
        />
      )}
    </div>
  );
}
