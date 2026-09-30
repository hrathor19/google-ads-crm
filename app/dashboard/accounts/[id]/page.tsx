'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { metricColumns, StatusBadge } from '@/components/data/metric-columns';
import { ErrorState, TableSkeleton } from '@/components/data/states';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { useFilters } from '@/components/providers/filters-provider';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The account drill-down: campaigns → ad groups → ads / keywords → search terms.
 *
 * Each level is fetched only when it is opened, so landing on an account with
 * 8,000 keywords does not pull them before anyone asks.
 */

type Base = {
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
};

type CampaignRow = Base & { id: number; name: string | null; status: string | null; campaignId: string };
type AdGroupRow = Base & { id: number; name: string | null; status: string | null };
type AdRow = Base & {
  id: number;
  adId: string;
  status: string | null;
  approvalStatus: string | null;
  headlines: string[];
  descriptions: string[];
};
type KeywordRow = Base & {
  id: number;
  text: string | null;
  matchType: string | null;
  status: string | null;
  qualityScore: number | null;
  level: string;
  score: number;
};
type SearchTermRow = Base & { id: number; query: string; matchType: string | null };

type Level = 'campaigns' | 'adGroups' | 'detail';

export default function AccountDetailPage({ params }: { params: { id: string } }) {
  const accountId = Number(params.id);
  const filters = useFilters();
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [adGroup, setAdGroup] = useState<AdGroupRow | null>(null);

  const level: Level = adGroup ? 'detail' : campaign ? 'adGroups' : 'campaigns';

  const campaigns = useFilteredApi<{ rows: CampaignRow[]; canSeeMoney: boolean }>(
    'account-campaigns',
    '/api/campaigns',
    { accountId }
  );
  const adGroups = useFilteredApi<{ rows: AdGroupRow[]; canSeeMoney: boolean }>(
    `account-adgroups-${campaign?.id ?? 'none'}`,
    '/api/ad-groups',
    { accountId, campaignPk: campaign?.id },
    { enabled: Boolean(campaign) }
  );
  const ads = useFilteredApi<{ rows: AdRow[]; canSeeMoney: boolean }>(
    `account-ads-${adGroup?.id ?? 'none'}`,
    '/api/ads',
    { accountId, adGroupPk: adGroup?.id },
    { enabled: Boolean(adGroup) }
  );
  const keywords = useFilteredApi<{ rows: KeywordRow[]; canSeeMoney: boolean }>(
    `account-keywords-${adGroup?.id ?? 'none'}`,
    '/api/keywords',
    { accountId, adGroupPk: adGroup?.id, limit: 500 },
    { enabled: Boolean(adGroup) }
  );
  const searchTerms = useFilteredApi<{ rows: SearchTermRow[]; canSeeMoney: boolean }>(
    `account-terms-${adGroup?.id ?? 'none'}`,
    '/api/search-terms',
    { accountId, adGroupPk: adGroup?.id, limit: 100 },
    { enabled: Boolean(adGroup) }
  );

  const canSeeMoney = campaigns.data?.canSeeMoney ?? false;
  const accountName = campaigns.data?.rows[0]
    ? (campaigns.data.rows[0] as CampaignRow & { accountName?: string }).accountName
    : null;

  if (campaigns.error) return <ErrorState error={campaigns.error} onRetry={() => campaigns.refetch()} />;

  return (
    <>
      <PageHeader
        title={accountName ?? `Account ${params.id}`}
        description="Drill from campaigns down to the search terms that triggered the ads."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/accounts?${filters.queryString()}`}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              All accounts
            </Link>
          </Button>
        }
      />

      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <BreadcrumbButton active={level === 'campaigns'} onClick={() => { setCampaign(null); setAdGroup(null); }}>
          Campaigns
        </BreadcrumbButton>
        {campaign && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <BreadcrumbButton active={level === 'adGroups'} onClick={() => setAdGroup(null)}>
              {campaign.name ?? 'Campaign'}
            </BreadcrumbButton>
          </>
        )}
        {adGroup && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <BreadcrumbButton active>{adGroup.name ?? 'Ad group'}</BreadcrumbButton>
          </>
        )}
      </nav>

      {level === 'campaigns' &&
        (campaigns.isLoading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : (
          <DataTable
            rows={campaigns.data?.rows ?? []}
            columns={
              [
                {
                  key: 'name',
                  header: 'Campaign',
                  cell: (r) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.name ?? 'Unnamed'}</p>
                      <p className="text-xs text-muted-foreground">{r.campaignId}</p>
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
                ...metricColumns<CampaignRow>(canSeeMoney),
              ] as Array<Column<CampaignRow>>
            }
            rowKey={(r) => String(r.id)}
            searchable={(r) => r.name ?? ''}
            searchPlaceholder="Search campaigns…"
            onRowClick={(r) => setCampaign(r)}
            initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
            emptyMessage="This account has no campaign data in the selected window."
          />
        ))}

      {level === 'adGroups' &&
        (adGroups.isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : (
          <DataTable
            rows={adGroups.data?.rows ?? []}
            columns={
              [
                {
                  key: 'name',
                  header: 'Ad group',
                  cell: (r) => <span className="font-medium">{r.name ?? 'Unnamed'}</span>,
                  sortValue: (r) => r.name,
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (r) => <StatusBadge status={r.status} />,
                  sortValue: (r) => r.status,
                  hideOnMobile: true,
                },
                ...metricColumns<AdGroupRow>(canSeeMoney),
              ] as Array<Column<AdGroupRow>>
            }
            rowKey={(r) => String(r.id)}
            searchable={(r) => r.name ?? ''}
            searchPlaceholder="Search ad groups…"
            onRowClick={(r) => setAdGroup(r)}
            initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
            emptyMessage="This campaign has no ad group data in the selected window."
          />
        ))}

      {level === 'detail' && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold">Ads</h2>
            {ads.isLoading ? (
              <TableSkeleton rows={3} columns={5} />
            ) : (
              <DataTable
                rows={ads.data?.rows ?? []}
                columns={
                  [
                    {
                      key: 'ad',
                      header: 'Ad',
                      cell: (r) => (
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-sm font-medium">
                            {r.headlines[0] ?? `Ad ${r.adId}`}
                          </p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {r.descriptions[0] ?? '—'}
                          </p>
                          {r.approvalStatus === 'DISAPPROVED' && (
                            <Badge variant="destructive" className="text-[10px]">
                              Disapproved
                            </Badge>
                          )}
                        </div>
                      ),
                      sortValue: (r) => r.headlines[0] ?? r.adId,
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      cell: (r) => <StatusBadge status={r.status} />,
                      sortValue: (r) => r.status,
                      hideOnMobile: true,
                    },
                    ...metricColumns<AdRow>(canSeeMoney),
                  ] as Array<Column<AdRow>>
                }
                rowKey={(r) => String(r.id)}
                pageSize={10}
                emptyMessage="No ads recorded for this ad group in the window."
              />
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Keywords</h2>
            {keywords.isLoading ? (
              <TableSkeleton rows={5} columns={6} />
            ) : (
              <DataTable
                rows={keywords.data?.rows ?? []}
                columns={
                  [
                    {
                      key: 'text',
                      header: 'Keyword',
                      cell: (r) => (
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.text ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">
                            {(r.matchType ?? '').toLowerCase()}
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
                              r.qualityScore < 5 && 'text-destructive'
                            )}
                          >
                            {r.qualityScore}
                          </span>
                        ),
                      sortValue: (r) => r.qualityScore,
                    },
                    ...metricColumns<KeywordRow>(canSeeMoney),
                  ] as Array<Column<KeywordRow>>
                }
                rowKey={(r) => String(r.id)}
                searchable={(r) => r.text ?? ''}
                searchPlaceholder="Search keywords…"
                pageSize={15}
                initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
                emptyMessage="No keyword data for this ad group in the window."
              />
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Search terms</h2>
            {searchTerms.isLoading ? (
              <TableSkeleton rows={5} columns={6} />
            ) : (
              <DataTable
                rows={searchTerms.data?.rows ?? []}
                columns={
                  [
                    {
                      key: 'query',
                      header: 'Search term',
                      cell: (r) => <span className="font-medium">{r.query}</span>,
                      sortValue: (r) => r.query,
                    },
                    ...metricColumns<SearchTermRow>(canSeeMoney),
                  ] as Array<Column<SearchTermRow>>
                }
                rowKey={(r) => String(r.id)}
                searchable={(r) => r.query}
                searchPlaceholder="Search terms…"
                pageSize={15}
                initialSort={{ key: canSeeMoney ? 'cost' : 'clicks', dir: 'desc' }}
                emptyMessage="No search terms recorded for this ad group in the window."
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}

function BreadcrumbButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={active || !onClick}
      className={cn(
        'max-w-[14rem] truncate rounded px-1.5 py-0.5 text-left',
        active
          ? 'font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </button>
  );
}
