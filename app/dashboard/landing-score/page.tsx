'use client';

import { useState } from 'react';
import { FileSearch, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/data/page-header';
import { EmptyState } from '@/components/data/states';
import { LandingScorePanel, type LandingScoreData } from '@/components/data/landing-score-panel';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatDateTime } from '@/lib/format';

export default function LandingScorePage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<LandingScoreData | null>(null);

  const history = useApi<{ rows: Array<LandingScoreData & { id: string }> }>(
    ['landing-history'],
    '/api/ai/landing-score'
  );

  if (!can('LANDING_SCORE', 'VIEW')) {
    return (
      <EmptyState
        title="No access to the landing page scorer"
        description="Your role does not include the Landing Page Scorer permissions."
      />
    );
  }

  async function score() {
    if (!url.trim()) return;
    setScoring(true);
    try {
      const res = await apiSend<LandingScoreData>('/api/ai/landing-score', 'POST', { url });
      setResult(res);
      history.refetch();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not score that page',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setScoring(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Landing page scorer"
        description="Fetches the page and scores it on the elements that drive ad conversions: CTA, fees, deadlines, proof, tracking tags and link hygiene."
      />

      {can('LANDING_SCORE', 'GENERATE_AI') && (
        <Card className="mb-4">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="url">Landing page URL</Label>
              <Input
                id="url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && score()}
                placeholder="https://example.com/admissions"
              />
            </div>
            <Button onClick={score} disabled={scoring || !url.trim()} className="btn-sheen">
              {scoring ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileSearch className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {scoring ? 'Fetching and scoring…' : 'Score the page'}
            </Button>
          </CardContent>
        </Card>
      )}

      {result ? (
        <LandingScorePanel data={result} />
      ) : (
        <EmptyState
          icon={FileSearch}
          title="No page scored yet"
          description="Paste a URL above. Only public http(s) pages are fetched — private and loopback hosts are refused."
        />
      )}

      {(history.data?.rows.length ?? 0) > 0 && (
        <Card className="mt-6">
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Your recent scores</h2>
            <ul className="divide-y text-sm">
              {history.data!.rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    onClick={() => setResult(row)}
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                  >
                    {row.url}
                  </button>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {row.score} · {row.grade}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
