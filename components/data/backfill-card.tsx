'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { apiSend } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatNumber } from '@/lib/format';

/**
 * Historical backfill.
 *
 * The scheduled sync only ever pulls a rolling window (30 days by default), so
 * anything older than the first sync simply isn't in the database — a date
 * range before that renders empty, which reads as "no spend" when it actually
 * means "never fetched". This pulls an explicit window from Google Ads.
 *
 * Deliberately not on the Refresh button: a wide range across every account is
 * minutes of API calls against a shared quota, so it should be a decision
 * rather than a click someone makes by accident.
 */

type SyncResult = {
  syncType: string;
  window: { start: string; end: string };
  accountsProcessed: number;
  totals: { inserted: number; updated: number; failed: number };
  results: Array<{ status: string; error: string | null }>;
};

const ENTITY_PRESETS = [
  { key: 'campaigns', label: 'Campaigns, devices & geo', hint: 'Fastest. Covers the dashboard, trends and the geography map.' },
  { key: 'campaigns,ad_groups,keywords', label: 'Add ad groups & keywords', hint: 'Slower — keywords are the largest table.' },
  { key: 'campaigns,ad_groups,ads,keywords,search_terms,budgets', label: 'Everything', hint: 'Slowest. Expect several minutes per month of history.' },
];

export function BackfillCard() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [preset, setPreset] = useState(ENTITY_PRESETS[0]!.key);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  if (!can('SYNC', 'CREATE')) return null;

  const invalid = !start || !end || start > end;

  async function run() {
    setRunning(true);
    setResult(null);
    toast({
      title: 'Backfill started',
      description: `Pulling ${start} to ${end}. This can take several minutes — leave the page open.`,
    });
    try {
      const res = await apiSend<SyncResult>('/api/sync', 'POST', {
        entities: preset.split(','),
        start,
        end,
      });
      setResult(res);
      const failed = res.results.filter((r) => r.status === 'failed').length;
      toast({
        title: 'Backfill complete',
        description: `${formatNumber(res.totals.inserted)} row(s) written across ${res.accountsProcessed} account(s)${failed ? `, ${failed} entity run(s) failed` : ''}.`,
      });
      // Every reporting view is now potentially stale.
      queryClient.invalidateQueries();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Backfill failed',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 opacity-70" aria-hidden="true" />
          Backfill historical data
        </CardTitle>
        <CardDescription>
          The scheduled sync only pulls a rolling 30-day window, so older dates show empty
          because they were never fetched — not because nothing was spent. Pull an explicit
          range here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bf-start">From</Label>
            <Input
              id="bf-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={running}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-end">To</Label>
            <Input
              id="bf-end"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              disabled={running}
            />
          </div>
        </div>

        <fieldset className="space-y-2" disabled={running}>
          <legend className="mb-1 text-sm font-medium">What to pull</legend>
          {ENTITY_PRESETS.map((p) => (
            <label
              key={p.key}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="backfill-entities"
                value={p.key}
                checked={preset === p.key}
                onChange={() => setPreset(p.key)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block font-medium">{p.label}</span>
                <span className="block text-xs text-muted-foreground">{p.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {start && end && start > end && (
          <p className="text-xs text-destructive">The start date must not be after the end date.</p>
        )}

        <Button onClick={run} disabled={running || invalid}>
          {running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <History className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {running ? 'Backfilling…' : 'Run backfill'}
        </Button>

        {result && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {result.window.start} → {result.window.end}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatNumber(result.totals.inserted)} row(s) written across{' '}
              {result.accountsProcessed} account(s).{' '}
              {result.results.filter((r) => r.status === 'failed').length} entity run(s) failed.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
