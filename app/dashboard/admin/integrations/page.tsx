'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/data/page-header';
import { ErrorState } from '@/components/data/states';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

type Integration = {
  key: string;
  label: string;
  configured: boolean;
  missing: string[];
  hint: string | null;
  description: string;
};

type Response = {
  integrations: Integration[];
  sync: {
    lastSuccessfulAt: string | null;
    latestStatus: string | null;
    latestAt: string | null;
    runningCount: number;
    failedLast24h: number;
  };
};

export default function IntegrationsPage() {
  const { can } = usePermissions();
  const { data, isLoading, error, refetch } = useApi<Response>(
    ['integrations'],
    '/api/admin/integrations'
  );

  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; detail: string }>>({});

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  async function test(key: string) {
    setTesting(key);
    try {
      const res = await apiSend<{ ok: boolean; detail: string }>(
        '/api/admin/integrations/test',
        'POST',
        { key }
      );
      setResults((prev) => ({ ...prev, [key]: res }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [key]: { ok: false, detail: e instanceof Error ? e.message : 'Unknown error.' },
      }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Integrations health"
        description="Which external services are wired up. Credentials are never shown — only whether they are present, and the last four characters where that helps identify a key."
      />

      {isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {data.integrations.map((integration) => {
              const result = results[integration.key];
              return (
                <Card
                  key={integration.key}
                  className={cn(
                    'border',
                    integration.configured ? 'border-emerald-500/30' : 'border-amber-500/40'
                  )}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{integration.label}</CardTitle>
                        <CardDescription>{integration.description}</CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 gap-1 font-normal',
                          integration.configured
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        )}
                      >
                        {integration.configured ? (
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-3 w-3" aria-hidden="true" />
                        )}
                        {integration.configured ? 'Connected' : 'Not configured'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {integration.hint && (
                      <p className="font-mono text-xs text-muted-foreground">{integration.hint}</p>
                    )}
                    {integration.missing.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Missing:{' '}
                        <code className="rounded bg-muted px-1 py-0.5">
                          {integration.missing.join(', ')}
                        </code>
                      </p>
                    )}

                    {result && (
                      <p
                        className={cn(
                          'rounded-md border px-3 py-2 text-xs',
                          result.ok
                            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                            : 'border-destructive/30 bg-destructive/5 text-destructive'
                        )}
                      >
                        {result.detail}
                      </p>
                    )}

                    {can('INTEGRATIONS', 'MANAGE') && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testing === integration.key}
                        onClick={() => test(integration.key)}
                      >
                        {testing === integration.key ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <PlugZap className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Test connection
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sync health</CardTitle>
              <CardDescription>
                The last time Google Ads data landed in the database.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <Stat label="Last successful sync" value={formatRelative(data.sync.lastSuccessfulAt)} />
              <Stat label="Latest run status" value={data.sync.latestStatus ?? 'never'} />
              <Stat label="Currently running" value={String(data.sync.runningCount)} />
              <Stat
                label="Failed in 24h"
                value={String(data.sync.failedLast24h)}
                tone={data.sync.failedLast24h > 0 ? 'bad' : undefined}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-0.5 text-sm font-medium', tone === 'bad' && 'text-destructive')}>
        {value}
      </p>
    </div>
  );
}
