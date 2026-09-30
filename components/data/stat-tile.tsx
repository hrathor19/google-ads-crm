'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { deltaTone, formatDelta } from '@/lib/format';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * A KPI tile with its period-over-period change.
 *
 * `direction` exists because a rise is not universally good: clicks going up
 * is progress, CPC going up is not, and colouring both green would make the
 * row worse than no colour at all.
 */
export function StatTile({
  label,
  value,
  delta,
  direction = 'up-good',
  hint,
  previous,
}: {
  label: string;
  value: string;
  delta?: number | null;
  direction?: 'up-good' | 'down-good';
  hint?: string;
  previous?: string;
}) {
  const tone = deltaTone(delta, direction);
  const Icon = tone === 'neutral' ? Minus : (delta ?? 0) > 0 ? ArrowUpRight : ArrowDownRight;

  const body = (
    <Card className="hover-lift">
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1.5 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
        {delta !== undefined && (
          <div className="mt-1.5 flex items-center gap-1 text-xs">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums',
                tone === 'positive' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                tone === 'negative' && 'bg-destructive/10 text-destructive',
                tone === 'neutral' && 'bg-muted text-muted-foreground'
              )}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              {formatDelta(delta)}
            </span>
            <span className="truncate text-muted-foreground">
              {previous ? `from ${previous}` : 'vs previous period'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (!hint) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{body}</div>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
