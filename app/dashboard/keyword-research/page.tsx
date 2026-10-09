'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import Papa from 'papaparse';
import {
  Activity,
  CheckCircle2,
  Download,
  Gauge,
  Globe,
  Link2,
  Loader2,
  Search,
  Sparkles,
  TrendingUp,
  Wand2,
} from 'lucide-react';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { Sparkline } from '@/components/data/sparkline';
import { MultiSelect, type MultiSelectOption } from '@/components/data/multi-select';
import { StatTile } from '@/components/data/stat-tile';
import { TrendChart } from '@/components/data/charts';
import { EmptyState, ErrorState } from '@/components/data/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Keyword research.
 *
 * The same service that powers Keyword Planner in the Google Ads UI, with two
 * things that interface cannot do: it knows which ideas the accounts are
 * already bidding on, and it shows the twelve-month shape next to the average
 * rather than behind a click — which for admissions is most of the decision,
 * since a 40,000/month keyword that is 40,000 in one month and nothing in the
 * other eleven is a completely different media plan.
 */

const MAX_SEEDS = 20;
const MAX_LOCATIONS = 10;

type Idea = {
  keyword: string;
  avgMonthlySearches: number;
  competition: 'UNSPECIFIED' | 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';
  competitionIndex: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  monthly: Array<{ label: string; searches: number }>;
  peakMonth: string | null;
  peakSearches: number | null;
  trend: number | null;
  emerging: boolean;
  alreadyRunning: boolean;
};

type IdeaResponse = { ideas: Idea[]; canSeeMoney: boolean; total: number };

type OptionsResponse = {
  locations: Array<{ id: string; name: string; type: string }>;
  languages: Array<{ id: string; name: string }>;
  defaults: { geoTargetIds: string[]; languageId: string };
  degraded: boolean;
};

const COMPETITION_TONE: Record<string, string> = {
  LOW: 'bg-emerald-500',
  MEDIUM: 'bg-amber-500',
  HIGH: 'bg-rose-500',
};
const COMPETITION_LABEL: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  UNKNOWN: 'Unknown',
  UNSPECIFIED: 'Unknown',
};

/** Seeds come in however someone has them: a list, a paste, commas. */
function parseSeeds(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function TrendPill({ value, emerging }: { value: number | null; emerging?: boolean }) {
  // Climbing off Google's reporting floor. A percentage here would be
  // arithmetic on a band, so this says what happened rather than how much.
  if (emerging) {
    return <span className="text-xs font-medium text-sky-600 dark:text-sky-400">Emerging</span>;
  }
  if (value === null) return <span className="text-xs text-muted-foreground">{'—'}</span>;
  // Banded volumes mean small movements are rounding, not news.
  const flat = Math.abs(value) < 0.05;
  return (
    <span
      className={cn(
        'text-xs font-medium tabular-nums',
        flat
          ? 'text-muted-foreground'
          : value > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400'
      )}
    >
      {flat ? 'Steady' : `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`}
    </span>
  );
}

function CompetitionCell({ idea }: { idea: Idea }) {
  const pct = idea.competitionIndex;
  const tone = COMPETITION_TONE[idea.competition] ?? 'bg-muted-foreground';
  return (
    // Right-aligned in the table, left in the mobile card, where the
    // surrounding dt/dd pairs all start at the left edge.
    <div className="flex items-center justify-start gap-2 md:justify-end">
      <span className="text-xs text-muted-foreground">
        {COMPETITION_LABEL[idea.competition] ?? idea.competition}
      </span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          className={cn('block h-full rounded-full', tone)}
          style={{ width: `${Math.max(4, Math.min(100, pct ?? 0))}%` }}
        />
      </span>
    </div>
  );
}

export default function KeywordResearchPage() {
  const { can } = usePermissions();
  const { toast } = useToast();

  // ─── The search ───────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'keywords' | 'url'>('keywords');
  const [seedText, setSeedText] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [geoTargetIds, setGeoTargetIds] = useState<string[]>(['2356']);
  const [languageId, setLanguageId] = useState('1000');

  // ─── Filters over the result ──────────────────────────────────────────────
  const [contains, setContains] = useState('');
  const [excludes, setExcludes] = useState('');
  const [minVolume, setMinVolume] = useState('');
  const [competitions, setCompetitions] = useState<Set<string>>(new Set());
  const [hideRunning, setHideRunning] = useState(false);
  const [detail, setDetail] = useState<Idea | null>(null);

  const { data: options } = useApi<OptionsResponse>(
    ['keyword-planner-options'],
    '/api/keyword-ideas/locations',
    { staleTime: 60 * 60_000 }
  );

  const locationOptions: MultiSelectOption[] = useMemo(
    () =>
      (options?.locations ?? []).map((l) => ({
        value: l.id,
        label: l.name,
        group: l.type === 'Country' ? 'Country' : l.type === 'State' ? 'States' : 'Cities',
      })),
    [options]
  );

  const seeds = useMemo(() => parseSeeds(seedText), [seedText]);

  const research = useMutation<IdeaResponse, Error>({
    mutationFn: () =>
      apiSend<IdeaResponse>('/api/keyword-ideas', 'POST', {
        keywords: mode === 'keywords' ? seeds.slice(0, MAX_SEEDS) : [],
        pageUrl: mode === 'url' ? pageUrl.trim() : '',
        geoTargetIds,
        languageId,
      }),
    onError: (err) =>
      toast({ title: 'Could not fetch keywords', description: err.message, variant: 'destructive' }),
  });

  // Memoised because the `?? []` would otherwise hand every downstream
  // useMemo a brand new array on each render, recomputing the filter, the
  // summary and the seasonality series on every keystroke in an unrelated box.
  const ideas = useMemo(() => research.data?.ideas ?? [], [research.data]);
  const canSeeMoney = research.data?.canSeeMoney ?? false;

  const ready =
    geoTargetIds.length > 0 &&
    (mode === 'keywords' ? seeds.length > 0 : /^https?:\/\/\S+$/i.test(pageUrl.trim()));

  // ─── Filtering ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const inc = contains.trim().toLowerCase();
    const exc = parseSeeds(excludes);
    const min = minVolume.trim() === '' ? 0 : Number(minVolume);
    return ideas.filter((i) => {
      if (inc && !i.keyword.includes(inc)) return false;
      if (exc.some((e) => i.keyword.includes(e))) return false;
      if (Number.isFinite(min) && i.avgMonthlySearches < min) return false;
      if (competitions.size > 0 && !competitions.has(i.competition)) return false;
      if (hideRunning && i.alreadyRunning) return false;
      return true;
    });
  }, [ideas, contains, excludes, minVolume, competitions, hideRunning]);

  // ─── Summary ──────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const totalSearches = filtered.reduce((s, i) => s + i.avgMonthlySearches, 0);
    const running = filtered.filter((i) => i.alreadyRunning).length;
    const bids = filtered
      .map((i) => i.highTopOfPageBid)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    // Median, not mean: one luxury term drags an average off the scale that
    // every other keyword on the page sits on.
    const medianBid = bids.length ? bids[Math.floor(bids.length / 2)] : null;
    return { totalSearches, running, medianBid };
  }, [filtered]);

  /** Combined demand by month — the seasonality of the whole shortlist. */
  const seasonality = useMemo(() => {
    const labels = filtered.find((i) => i.monthly.length > 0)?.monthly.map((m) => m.label) ?? [];
    if (labels.length === 0) return [];
    return labels.map((label, idx) => ({
      date: label,
      searches: filtered.reduce((s, i) => s + (i.monthly[idx]?.searches ?? 0), 0),
    }));
  }, [filtered]);

  const peakOfShortlist = useMemo(() => {
    if (seasonality.length === 0) return null;
    return seasonality.reduce((best, row) => (row.searches > best.searches ? row : best));
  }, [seasonality]);

  // ─── Export ───────────────────────────────────────────────────────────────
  /**
   * Built in the browser from rows already on screen. The alternative — a
   * server endpoint — would re-run the search and spend a second operation
   * of the daily quota to produce a file of data the page is already
   * holding.
   */
  const exportCsv = () => {
    const months = filtered.find((i) => i.monthly.length > 0)?.monthly.map((m) => m.label) ?? [];
    const rows = filtered.map((i) => ({
      Keyword: i.keyword,
      'Avg monthly searches': i.avgMonthlySearches,
      Competition: COMPETITION_LABEL[i.competition] ?? i.competition,
      'Competition index': i.competitionIndex ?? '',
      ...(canSeeMoney
        ? {
            'Top of page bid (low)': i.lowTopOfPageBid ?? '',
            'Top of page bid (high)': i.highTopOfPageBid ?? '',
          }
        : {}),
      'Three-month change': i.emerging
        ? 'Emerging'
        : i.trend === null
          ? ''
          : `${Math.round(i.trend * 100)}%`,
      'Peak month': i.peakMonth ?? '',
      'Peak searches': i.peakSearches ?? '',
      'Already running': i.alreadyRunning ? 'Yes' : 'No',
      ...Object.fromEntries(months.map((m, idx) => [m, i.monthly[idx]?.searches ?? ''])),
    }));

    const blob = new Blob([Papa.unparse(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keyword-research-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Array<Column<Idea>> = [
    {
      key: 'keyword',
      header: 'Keyword',
      maxWidth: '22rem',
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{r.keyword}</span>
          {r.alreadyRunning && (
            <Badge variant="info" className="shrink-0 gap-1 font-normal">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              Running
            </Badge>
          )}
        </div>
      ),
      sortValue: (r) => r.keyword,
    },
    {
      key: 'avgMonthlySearches',
      header: 'Avg monthly searches',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{formatNumber(r.avgMonthlySearches)}</span>,
      sortValue: (r) => r.avgMonthlySearches,
    },
    {
      key: 'monthly',
      header: '12-month trend',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => (
        <div className="flex justify-end">
          <Sparkline
            points={r.monthly.map((m) => m.searches)}
            title={`${r.keyword}: peak ${r.peakMonth ?? 'unknown'}`}
          />
        </div>
      ),
      // Sorts on the most recent month, a different question from the
      // twelve-month average beside it: what is busy now, not on average.
      // It also means the header renders like its sortable neighbours.
      sortValue: (r) => r.monthly[r.monthly.length - 1]?.searches ?? null,
    },
    {
      key: 'trend',
      header: 'Last 3 months',
      align: 'right',
      cell: (r) => <TrendPill value={r.trend} emerging={r.emerging} />,
      // An emerging keyword has no percentage but is the most interesting
      // thing in the column, so it sorts above everything that merely grew.
      sortValue: (r) => (r.emerging ? Number.MAX_SAFE_INTEGER : r.trend),
    },
    {
      key: 'competition',
      header: 'Competition',
      align: 'right',
      cell: (r) => <CompetitionCell idea={r} />,
      sortValue: (r) => r.competitionIndex,
    },
    ...(canSeeMoney
      ? [
          {
            key: 'bid',
            header: 'Top of page bid',
            align: 'right' as const,
            cell: (r: Idea) =>
              r.lowTopOfPageBid === null && r.highTopOfPageBid === null ? (
                <span className="text-muted-foreground">{'—'}</span>
              ) : (
                <span className="tabular-nums text-sm">
                  {formatCurrency(r.lowTopOfPageBid)} – {formatCurrency(r.highTopOfPageBid)}
                </span>
              ),
            sortValue: (r: Idea) => r.highTopOfPageBid,
          },
        ]
      : []),
    {
      key: 'peakMonth',
      header: 'Peak',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="text-xs text-muted-foreground">{r.peakMonth ?? '—'}</span>,
      sortValue: (r) => r.peakSearches,
    },
  ];

  return (
    <>
      <PageHeader
        title="Keyword research"
        description="Google's own search volume, competition and bid estimates. Start from a few seed keywords or a landing page, and the ideas you are already bidding on are flagged."
      />

      {/* ─── Search ─────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardContent className="space-y-4 p-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'keywords' | 'url')}>
            {/* Full width and halved below sm: "Start with keywords" and
                "Start with a page" together overflow a 390px card, and the
                second label was clipped mid-word. */}
            <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
              <TabsTrigger value="keywords" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                From keywords
              </TabsTrigger>
              <TabsTrigger value="url" className="gap-1.5">
                <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                From a page
              </TabsTrigger>
            </TabsList>

            <TabsContent value="keywords" className="mt-3 space-y-1.5">
              <Label htmlFor="seeds" className="text-xs">
                Seed keywords
              </Label>
              <Textarea
                id="seeds"
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                placeholder={'mba admission\nbba colleges in pune\ndistance mba'}
                rows={3}
                className="resize-y font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                One per line, or separated by commas.{' '}
                <span className={cn(seeds.length > MAX_SEEDS && 'font-medium text-destructive')}>
                  {seeds.length}/{MAX_SEEDS}
                </span>{' '}
                {seeds.length > MAX_SEEDS && '— only the first 20 are sent.'}
              </p>
            </TabsContent>

            <TabsContent value="url" className="mt-3 space-y-1.5">
              <Label htmlFor="pageUrl" className="text-xs">
                Landing page
              </Label>
              <Input
                id="pageUrl"
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                placeholder="https://example.com/mba-admissions"
                className="h-9"
                inputMode="url"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Google reads the page and works out what it is about. Useful when a client sends
                a URL and no brief.
              </p>
            </TabsContent>
          </Tabs>

          <div className="grid gap-3 sm:grid-cols-[2fr,1fr,auto] sm:items-end">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="locations" className="text-xs">
                Locations
              </Label>
              <MultiSelect
                id="locations"
                options={locationOptions}
                selected={geoTargetIds}
                onChange={setGeoTargetIds}
                placeholder="Pick at least one"
                searchPlaceholder="India, Karnataka, Pune…"
                maxSelected={MAX_LOCATIONS}
              />
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="language" className="text-xs">
                Language
              </Label>
              <Select value={languageId} onValueChange={setLanguageId}>
                <SelectTrigger id="language" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(options?.languages ?? [{ id: '1000', name: 'English' }]).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => research.mutate()}
              disabled={!ready || research.isPending}
              className="h-9 w-full gap-1.5 sm:w-auto"
            >
              {research.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4" aria-hidden="true" />
              )}
              {research.isPending ? 'Asking Google…' : 'Find keywords'}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Volumes are twelve-month averages and Google rounds them into bands, so read them as
            orders of magnitude. Each search spends one operation of the daily API quota shared
            with the nightly sync.
            {options?.degraded && ' The location list could not be loaded, so only India is offered.'}
          </p>
        </CardContent>
      </Card>

      {/* ─── Results ────────────────────────────────────────────────────── */}
      {research.isError && (
        <ErrorState error={research.error} onRetry={() => research.mutate()} />
      )}

      {research.isPending && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Google is working through the seeds. This usually takes a few seconds.
            </p>
          </CardContent>
        </Card>
      )}

      {!research.isPending && !research.isError && research.data && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Keywords"
              value={formatNumber(filtered.length)}
              caption={
                filtered.length === ideas.length
                  ? `${formatNumber(ideas.length)} returned`
                  : `of ${formatNumber(ideas.length)} returned`
              }
              icon={Sparkles}
            />
            <StatTile
              label="Combined monthly searches"
              value={formatNumber(summary.totalSearches, { compact: true })}
              caption="Across the shortlist below"
              icon={TrendingUp}
            />
            <StatTile
              label="Already running"
              value={formatNumber(summary.running)}
              caption={
                summary.running === 0
                  ? 'None of these are live yet'
                  : `${formatNumber(filtered.length - summary.running)} are genuine gaps`
              }
              icon={CheckCircle2}
            />
            {canSeeMoney ? (
              <StatTile
                label="Median top-of-page bid"
                value={formatCurrency(summary.medianBid)}
                caption="High estimate, middle of the list"
                icon={Gauge}
              />
            ) : (
              <StatTile
                label="Busiest month"
                value={peakOfShortlist?.date ?? '—'}
                caption="For the shortlist combined"
                icon={Activity}
              />
            )}
          </div>

          {seasonality.length > 1 && (
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Demand through the year</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Every keyword below, added together, month by month.
                  {peakOfShortlist && (
                    <>
                      {' '}
                      Demand peaks in <span className="font-medium text-foreground">
                        {peakOfShortlist.date}
                      </span>{' '}
                      at {formatNumber(peakOfShortlist.searches)} searches.
                    </>
                  )}
                </p>
              </CardHeader>
              <CardContent className="pt-2">
                <TrendChart
                  data={seasonality}
                  series={[{ key: 'searches', label: 'Monthly searches' }]}
                  height={200}
                />
              </CardContent>
            </Card>
          )}

          <Card className="mb-4">
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="contains" className="text-xs">
                  Contains
                </Label>
                <Input
                  id="contains"
                  value={contains}
                  onChange={(e) => setContains(e.target.value)}
                  placeholder="e.g. online"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="excludes" className="text-xs">
                  Exclude
                </Label>
                <Input
                  id="excludes"
                  value={excludes}
                  onChange={(e) => setExcludes(e.target.value)}
                  placeholder="free, jobs, salary"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minVolume" className="text-xs">
                  Minimum searches
                </Label>
                <Input
                  id="minVolume"
                  type="number"
                  min={0}
                  value={minVolume}
                  onChange={(e) => setMinVolume(e.target.value)}
                  placeholder="0"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <span className="block text-xs font-medium">Competition</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['LOW', 'MEDIUM', 'HIGH'] as const).map((c) => {
                    const on = competitions.has(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setCompetitions((prev) => {
                            const next = new Set(prev);
                            if (next.has(c)) next.delete(c);
                            else next.add(c);
                            return next;
                          })
                        }
                        className={cn(
                          'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                          on
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/70'
                        )}
                      >
                        {COMPETITION_LABEL[c]}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-pressed={hideRunning}
                    onClick={() => setHideRunning((v) => !v)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                      hideRunning
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    )}
                  >
                    Gaps only
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {ideas.length === 0 ? (
            <EmptyState
              title="Google returned nothing"
              description="Those seeds are too narrow, or the location and language combination has no data. Try a broader term."
            />
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {formatNumber(filtered.length)} keyword(s) after filtering.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {can('KEYWORD_PLANNER', 'EXPORT') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportCsv}
                      disabled={filtered.length === 0}
                      className="gap-1.5"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Export CSV
                    </Button>
                  )}
                  {/* Where the export is meant to go next. Without this the
                      CSV is a dead end unless somebody already knows the ad
                      copy screen accepts it. */}
                  {can('AD_COPY', 'VIEW') && (
                    <Button asChild variant="ghost" size="sm" className="gap-1.5">
                      <Link href="/dashboard/ad-copy">
                        <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Write ad copy from it
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
              <DataTable
                rows={filtered}
                columns={columns}
                rowKey={(r) => r.keyword}
                onRowClick={(r) => setDetail(r)}
                searchable={(r) => r.keyword}
                searchPlaceholder="Filter these keywords…"
                initialSort={{ key: 'avgMonthlySearches', dir: 'desc' }}
                pageSize={50}
                caption="Keyword ideas with search volume and competition"
                emptyMessage="No keyword matches those filters."
              />
            </>
          )}
        </>
      )}

      {!research.data && !research.isPending && !research.isError && (
        <EmptyState
          title="Nothing searched yet"
          description="Put in a few seed keywords, or a landing page, and Google will come back with everything related to them and how often each one is searched."
        />
      )}

      {/* ─── One keyword, in full ───────────────────────────────────────── */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="break-words pr-6">{detail.keyword}</DialogTitle>
                <DialogDescription>
                  {formatNumber(detail.avgMonthlySearches)} searches a month on average
                  {detail.peakMonth && <>, peaking at {formatNumber(detail.peakSearches)} in {detail.peakMonth}</>}
                  .
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Competition</p>
                    <p className="font-medium">
                      {COMPETITION_LABEL[detail.competition] ?? detail.competition}
                      {detail.competitionIndex !== null && (
                        <span className="text-muted-foreground"> · {detail.competitionIndex}/100</span>
                      )}
                    </p>
                  </div>
                  {canSeeMoney && (
                    <div>
                      <p className="text-xs text-muted-foreground">Top of page bid</p>
                      <p className="font-medium tabular-nums">
                        {detail.lowTopOfPageBid === null && detail.highTopOfPageBid === null
                          ? '—'
                          : `${formatCurrency(detail.lowTopOfPageBid)} – ${formatCurrency(detail.highTopOfPageBid)}`}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Last 3 months</p>
                    <p className="font-medium">
                      <TrendPill value={detail.trend} emerging={detail.emerging} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">In your accounts</p>
                    <p className="font-medium">
                      {detail.alreadyRunning ? 'Already bidding' : 'Not running'}
                    </p>
                  </div>
                </div>

                {detail.monthly.length > 1 && (
                  <div className="rounded-md border p-3">
                    <TrendChart
                      data={detail.monthly.map((m) => ({ date: m.label, searches: m.searches }))}
                      series={[{ key: 'searches', label: 'Searches' }]}
                      height={180}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
