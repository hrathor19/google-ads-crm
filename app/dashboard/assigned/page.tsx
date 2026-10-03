'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, ClipboardList, IndianRupee, MousePointerClick, Target, Users } from 'lucide-react';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { metricColumns, StatusBadge } from '@/components/data/metric-columns';
import { RequestStatusBadge, REQUEST_STATUS_LABELS } from '@/components/data/status-badge';
import { StatTile } from '@/components/data/stat-tile';
import { EmptyState, ErrorState, TableSkeleton, TileSkeleton } from '@/components/data/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * What the Ad Specialist was handed, and how it is doing.
 *
 * The approval flow stops at "assigned"; this is the screen that asks whether
 * the assignment is working. Each row pairs delivery from the synced Google
 * Ads data with the two numbers the Manager approved at step 10 — the
 * required CPL and the required leads — because a cost per lead is only
 * good or bad relative to what was promised.
 *
 * Grouping by assignment is the default: an assignment is the unit someone is
 * accountable for. The campaign view is there for the follow-up question,
 * "which campaign inside it is the problem".
 */

type Pacing = 'ON_TRACK' | 'OVER_CPL' | 'NO_LEADS' | 'NO_SPEND' | 'NO_TARGET' | null;

type AssignmentRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  accountId: number | null;
  accountName: string | null;
  specialistName: string | null;
  accountManagerName: string | null;
  linkedCampaignId: string | null;
  linkedCampaignCount: number;
  requiredCpl: number | null;
  requiredLeads: number | null;
  campaignCount: number;
  enabledCampaignCount: number;
  dailyBudget: number | null;
  pacing: Pacing;
  leadProgress: number | null;
  assignedAt: string | null;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
};

type CampaignRow = {
  id: number;
  campaignId: string;
  name: string | null;
  status: string | null;
  accountName: string | null;
  assignmentIds: string[];
  references: string[];
  specialists: string[];
  requiredCpl: number | null;
  pacing: Pacing;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
};

type Response = {
  canSeeMoney: boolean;
  canSeeAll: boolean;
  onlyMine: boolean;
  specialists: Array<{ id: string; name: string }>;
  statusCounts: Record<string, number>;
  totals: {
    assignments: number;
    campaigns: number;
    accounts: number;
    impressions: number;
    clicks: number;
    cost: number | null;
    conversions: number;
    ctr: number | null;
    avgCpc: number | null;
    costPerConversion: number | null;
  };
  assignments: AssignmentRow[];
  campaigns: CampaignRow[];
};

/** Stages of the flow, grouped the way somebody chasing delivery thinks. */
const STAGE_FILTERS = [
  { key: 'all', label: 'All assigned' },
  {
    key: 'AM_ASSIGNED,AWAITING_AD_SUBMISSION,ADS_SUBMITTED,UNDER_REVIEW,RECHECK_REQUESTED,REVIEW_APPROVED,BUDGET_APPROVED',
    label: 'Being built',
  },
  { key: 'ACCOUNT_ASSIGNED', label: 'Account handed over' },
  { key: 'LIVE', label: 'Live' },
  { key: 'COMPLETED', label: 'Completed' },
];

const PACING_LABELS: Record<Exclude<Pacing, null>, string> = {
  ON_TRACK: 'At or under CPL',
  OVER_CPL: 'Over CPL',
  NO_LEADS: 'Spending, no leads',
  NO_SPEND: 'No delivery',
  NO_TARGET: 'No CPL set',
};

const PACING_TONE: Record<Exclude<Pacing, null>, string> = {
  ON_TRACK: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  OVER_CPL: 'bg-destructive/10 text-destructive border-destructive/20',
  NO_LEADS: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  NO_SPEND: 'bg-muted text-muted-foreground border-transparent',
  NO_TARGET: 'bg-muted text-muted-foreground border-transparent',
};

function PacingBadge({ pacing }: { pacing: Pacing }) {
  if (!pacing) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium', PACING_TONE[pacing])}>
      {PACING_LABELS[pacing]}
    </Badge>
  );
}

/** Leads delivered in the window against the number the request asked for. */
function LeadProgress({
  delivered,
  required,
}: {
  delivered: number;
  required: number | null;
}) {
  if (!required) {
    return (
      <span className="tabular-nums">
        {formatNumber(delivered, { decimals: 1 })}
        <span className="ml-1 text-xs text-muted-foreground">no target</span>
      </span>
    );
  }
  const pct = Math.min(1, delivered / required);
  return (
    <div className="min-w-[5.5rem] space-y-1">
      <p className="tabular-nums">
        {formatNumber(delivered, { decimals: 1 })}
        <span className="text-muted-foreground"> / {formatNumber(required)}</span>
      </p>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        {/* No sliver at zero: a 2px stub reads as a rendering fault rather
            than as "nothing has been delivered". */}
        {pct > 0 && (
          <div
            className={cn('h-full rounded-full', pct >= 1 ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${Math.max(3, pct * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

export default function AssignedCampaignsPage() {
  const router = useRouter();
  const [view, setView] = useState<'assignment' | 'campaign'>('assignment');
  const [stage, setStage] = useState('all');
  const [specialistId, setSpecialistId] = useState('all');
  const [pacing, setPacing] = useState('all');
  const [campaignStatus, setCampaignStatus] = useState('all');
  const [ownership, setOwnership] = useState<'everyone' | 'mine'>('everyone');

  const { data, isLoading, error, refetch } = useFilteredApi<Response>(
    'assigned-campaigns',
    '/api/assigned-campaigns',
    {
      status: stage === 'all' ? undefined : stage,
      specialistId: specialistId === 'all' ? undefined : specialistId,
      pacing: pacing === 'all' ? undefined : pacing,
      campaignStatus: campaignStatus === 'all' ? undefined : campaignStatus,
      mine: ownership === 'mine' ? 'true' : undefined,
    }
  );

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const canSeeMoney = data?.canSeeMoney ?? false;
  const totals = data?.totals;

  const assignmentColumns: Array<Column<AssignmentRow>> = [
    {
      key: 'title',
      header: 'Assignment',
      maxWidth: '18rem',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {r.reference} · {r.accountName ?? 'No account linked'}
          </p>
        </div>
      ),
      sortValue: (r) => r.title,
    },
    {
      key: 'specialist',
      header: 'Ad Specialist',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{r.specialistName ?? '—'}</p>
          {r.assignedAt && (
            <p className="truncate text-xs text-muted-foreground">
              since {formatDate(r.assignedAt)}
            </p>
          )}
        </div>
      ),
      sortValue: (r) => r.specialistName,
    },
    {
      key: 'status',
      header: 'Stage',
      cell: (r) => <RequestStatusBadge status={r.status} />,
      sortValue: (r) => REQUEST_STATUS_LABELS[r.status] ?? r.status,
      hideOnMobile: true,
    },
    {
      key: 'campaigns',
      header: 'Campaigns',
      align: 'right',
      cell: (r) =>
        r.campaignCount === 0 ? (
          <span className="text-xs text-muted-foreground">none yet</span>
        ) : (
          <div className="tabular-nums">
            {formatNumber(r.campaignCount)}
            {/* Say when the figures are the whole account rather than this
                client's campaigns — otherwise an unlinked request looks like
                a spectacular performer on somebody else's spend. */}
            <p
              className={cn(
                'text-xs',
                r.linkedCampaignCount === 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground'
              )}
            >
              {r.linkedCampaignCount === 0
                ? 'whole account'
                : `${r.enabledCampaignCount} enabled`}
            </p>
          </div>
        ),
      sortValue: (r) => r.campaignCount,
    },
    {
      key: 'clicks',
      header: 'Clicks',
      align: 'right',
      cell: (r) => formatNumber(r.clicks),
      sortValue: (r) => r.clicks,
      hideOnMobile: true,
    },
    ...(canSeeMoney
      ? [
          {
            key: 'cost',
            header: 'Spend',
            align: 'right' as const,
            cell: (r: AssignmentRow) => formatCurrency(r.cost),
            sortValue: (r: AssignmentRow) => r.cost,
          },
        ]
      : []),
    {
      key: 'leads',
      header: 'Leads',
      align: 'right',
      cell: (r) => <LeadProgress delivered={r.conversions} required={r.requiredLeads} />,
      sortValue: (r) => r.conversions,
    },
    ...(canSeeMoney
      ? [
          {
            key: 'cpl',
            header: 'CPL vs target',
            align: 'right' as const,
            cell: (r: AssignmentRow) => (
              <div className="tabular-nums">
                <span
                  className={cn(
                    'font-medium',
                    r.pacing === 'OVER_CPL' && 'text-destructive',
                    r.pacing === 'ON_TRACK' && 'text-emerald-600 dark:text-emerald-400'
                  )}
                >
                  {formatCurrency(r.costPerConversion)}
                </span>
                <p className="text-xs text-muted-foreground">
                  {r.requiredCpl === null ? 'no target' : `target ${formatCurrency(r.requiredCpl)}`}
                </p>
              </div>
            ),
            sortValue: (r: AssignmentRow) => r.costPerConversion,
          },
          {
            key: 'pacing',
            header: 'Pacing',
            cell: (r: AssignmentRow) => <PacingBadge pacing={r.pacing} />,
            sortValue: (r: AssignmentRow) => r.pacing,
            hideOnMobile: true,
          },
        ]
      : []),
  ];

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
      key: 'assignment',
      header: 'Assigned to',
      maxWidth: '12rem',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{r.specialists.join(', ') || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{r.references.join(', ')}</p>
        </div>
      ),
      sortValue: (r) => r.specialists[0] ?? null,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status,
      hideOnMobile: true,
    },
    ...metricColumns<CampaignRow>(canSeeMoney),
    ...(canSeeMoney
      ? [
          {
            key: 'target',
            header: 'Target CPL',
            align: 'right' as const,
            cell: (r: CampaignRow) => formatCurrency(r.requiredCpl),
            sortValue: (r: CampaignRow) => r.requiredCpl,
            hideOnMobile: true,
          },
          {
            key: 'pacing',
            header: 'Pacing',
            cell: (r: CampaignRow) => <PacingBadge pacing={r.pacing} />,
            sortValue: (r: CampaignRow) => r.pacing,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Assigned campaigns"
        description="Every campaign handed to an Ad Specialist through the ad request flow, measured over the selected window against the CPL and lead targets approved for it."
      />

      {/* ── Headline ── */}
      {isLoading || !totals ? (
        <div className="mb-4">
          <TileSkeleton count={5} />
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          <StatTile
            label="Assignments"
            value={formatNumber(totals.assignments)}
            caption={`${formatNumber(totals.accounts)} account${totals.accounts === 1 ? '' : 's'}`}
            icon={ClipboardList}
          />
          <StatTile
            label="Campaigns"
            value={formatNumber(totals.campaigns)}
            caption="in the assigned accounts"
            icon={BarChart3}
          />
          <StatTile
            label="Clicks"
            value={formatNumber(totals.clicks, { compact: true })}
            caption={`${formatNumber(totals.impressions, { compact: true })} impressions`}
            icon={MousePointerClick}
          />
          <StatTile
            label="Leads"
            value={formatNumber(totals.conversions, { decimals: 1 })}
            caption="conversions in the window"
            icon={Users}
          />
          {canSeeMoney ? (
            <StatTile
              label="Spend"
              value={formatCurrency(totals.cost, { compact: true })}
              caption={`${formatCurrency(totals.costPerConversion)} per lead`}
              icon={IndianRupee}
            />
          ) : (
            <StatTile
              label="Click-through rate"
              value={totals.ctr === null ? '—' : `${(totals.ctr * 100).toFixed(2)}%`}
              caption="across assigned campaigns"
              icon={Target}
            />
          )}
        </div>
      )}

      {/* ── Filters ── */}
      <Card className="mb-4">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap gap-1.5">
            {STAGE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStage(f.key)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  stage === f.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
                aria-pressed={stage === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="specialist" className="text-xs">
                Ad Specialist
              </Label>
              <Select value={specialistId} onValueChange={setSpecialistId}>
                <SelectTrigger id="specialist" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone assigned</SelectItem>
                  {(data?.specialists ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {canSeeMoney && (
              <div className="space-y-1.5">
                <Label htmlFor="pacing" className="text-xs">
                  Pacing
                </Label>
                <Select value={pacing} onValueChange={setPacing}>
                  <SelectTrigger id="pacing" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="ON_TRACK">At or under CPL</SelectItem>
                    <SelectItem value="OVER_CPL">Over CPL</SelectItem>
                    <SelectItem value="NO_LEADS">Spending, no leads</SelectItem>
                    <SelectItem value="NO_SPEND">No delivery</SelectItem>
                    <SelectItem value="NO_TARGET">No CPL set</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="campaignStatus" className="text-xs">
                Campaign status
              </Label>
              <Select value={campaignStatus} onValueChange={setCampaignStatus}>
                <SelectTrigger id="campaignStatus" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="ENABLED">Enabled only</SelectItem>
                  <SelectItem value="PAUSED">Paused only</SelectItem>
                  <SelectItem value="ENABLED,PAUSED">Excluding removed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {data?.canSeeAll && (
              <div className="space-y-1.5">
                <Label htmlFor="ownership" className="text-xs">
                  Showing
                </Label>
                <Select
                  value={ownership}
                  onValueChange={(v) => setOwnership(v as 'everyone' | 'mine')}
                >
                  <SelectTrigger id="ownership" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="everyone">Everyone&apos;s assignments</SelectItem>
                    <SelectItem value="mine">Only mine</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <span className="mr-1 text-xs text-muted-foreground">Group by</span>
            {(
              [
                ['assignment', 'Assignment'],
                ['campaign', 'Campaign'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  view === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
                aria-pressed={view === key}
              >
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Rows ── */}
      {isLoading || !data ? (
        <TableSkeleton rows={8} columns={7} />
      ) : data.assignments.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Nothing assigned in this view"
          description={
            stage === 'all' && pacing === 'all' && specialistId === 'all'
              ? 'A request appears here once a Manager assigns an Ad Specialist to it.'
              : 'No assignment matches these filters. Try widening the stage, the pacing or the date range.'
          }
        />
      ) : view === 'assignment' ? (
        <DataTable
          rows={data.assignments}
          columns={assignmentColumns}
          rowKey={(r) => r.id}
          searchable={(r) =>
            `${r.title} ${r.reference} ${r.accountName ?? ''} ${r.specialistName ?? ''}`
          }
          searchPlaceholder="Search by request, account or specialist…"
          onRowClick={(r) => router.push(`/dashboard/ad-requests/${r.id}`)}
          initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
          caption="Assigned work for the selected period"
        />
      ) : data.campaigns.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No campaigns yet"
          description="These assignments have no campaigns in the selected accounts for this window. The Ad Specialist builds them before the request goes live."
        />
      ) : (
        <DataTable
          rows={data.campaigns}
          columns={campaignColumns}
          rowKey={(r) => String(r.id)}
          searchable={(r) =>
            `${r.name ?? ''} ${r.accountName ?? ''} ${r.campaignId} ${r.references.join(' ')} ${r.specialists.join(' ')}`
          }
          searchPlaceholder="Search campaigns, accounts or references…"
          onRowClick={(r) =>
            r.assignmentIds[0] && router.push(`/dashboard/ad-requests/${r.assignmentIds[0]}`)
          }
          initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
          caption="Assigned campaign performance for the selected period"
        />
      )}
    </>
  );
}
