'use client';

import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/data/page-header';
import { StatTile } from '@/components/data/stat-tile';
import { EmptyState, ErrorState, TileSkeleton } from '@/components/data/states';
import { Skeleton } from '@/components/ui/skeleton';
import { useFilteredApi } from '@/lib/hooks/use-filtered-api';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

type Alert = {
  code: string;
  severity: 'critical' | 'high' | 'medium';
  entity: string;
  entityId: number;
  entityName: string | null;
  accountName: string | null;
  title: string;
  detail: string;
  metric: string | null;
  value: number | null;
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-l-destructive',
  high: 'border-l-amber-500',
  medium: 'border-l-blue-500',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
  high: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  medium: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
};

export default function AlertsPage() {
  const [severity, setSeverity] = useState<string>('all');
  const { data, isLoading, error, refetch } = useFilteredApi<{
    referenceDate: string;
    alerts: Alert[];
  }>('alerts', '/api/alerts');

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const alerts = data?.alerts ?? [];
  const filtered = severity === 'all' ? alerts : alerts.filter((a) => a.severity === severity);
  const counts = {
    critical: alerts.filter((a) => a.severity === 'critical').length,
    high: alerts.filter((a) => a.severity === 'high').length,
    medium: alerts.filter((a) => a.severity === 'medium').length,
  };

  /** Alerts carry mixed metric types; render each as the unit it is. */
  const renderValue = (a: Alert) => {
    if (a.value === null) return null;
    if (a.metric === 'ctr' || a.metric === 'budgetUtilization') return formatPercent(a.value);
    return formatNumber(a.value, { decimals: 2 });
  };

  return (
    <>
      <PageHeader
        title="Alerts"
        description={
          data
            ? `Day-over-day changes on ${formatDate(data.referenceDate)}, evaluated against the same thresholds as the source console.`
            : 'Evaluating…'
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <TileSkeleton count={3} />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {(['critical', 'high', 'medium'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSeverity(severity === s ? 'all' : s)} className="text-left">
                <StatTile
                  label={s}
                  value={formatNumber(counts[s])}
                  hint={`Click to ${severity === s ? 'clear the filter' : `show only ${s} alerts`}`}
                />
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title={alerts.length === 0 ? 'No alerts' : 'Nothing at this severity'}
              description={
                alerts.length === 0
                  ? 'No campaign crossed a threshold between the last two synced days.'
                  : 'Try another severity.'
              }
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((a, i) => (
                <Card key={`${a.code}-${a.entityId}-${i}`} className={cn('border-l-4', SEVERITY_STYLE[a.severity])}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{a.title}</p>
                        <Badge variant="outline" className={cn('font-normal', SEVERITY_BADGE[a.severity])}>
                          {a.severity}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{a.detail}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {a.entityName ?? 'Unnamed campaign'}
                        {a.accountName ? ` · ${a.accountName}` : ''}
                      </p>
                    </div>
                    {a.value !== null && (
                      <div className="shrink-0 text-right">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {a.metric}
                        </p>
                        <p className="font-semibold tabular-nums">{renderValue(a)}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
