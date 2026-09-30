'use client';

import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
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
  icon: Accent,
}: {
  label: string;
  value: string;
  delta?: number | null;
  direction?: 'up-good' | 'down-good';
  hint?: string;
  previous?: string;
  /** Optional glyph for the tile's corner, to make a KPI row scannable. */
  icon?: LucideIcon;
}) {
  const tone = deltaTone(delta, direction);
  const Icon = tone === 'neutral' ? Minus : (delta ?? 0) > 0 ? ArrowUpRight : ArrowDownRight;
  // A null delta means the prior period had nothing to compare against — most
  // often because the synced history does not reach that far back. Saying so
  // is more use than a dash next to "vs previous period", and it fits a phone
  // tile without truncating.
  const unavailable = delta === null || delta === undefined;

  const body = (
    <Card className="overflow-hidden">
      <CardContent className="relative p-4">
        {/* A hairline of the metric's own colour along the top edge — enough
            to tell a rising figure from a falling one at a glance, without
            colouring the whole tile and shouting. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 top-0 h-0.5',
            tone === 'positive' && 'bg-emerald-500/70',
            tone === 'negative' && 'bg-destructive/60',
            (tone === 'neutral' || unavailable) && 'bg-border'
          )}
        />

        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {Accent && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
              <Accent className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </div>

        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>

        {delta !== undefined &&
          (unavailable ? (
            <p className="mt-2 text-xs text-muted-foreground">No prior period to compare</p>
          ) : (
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums',
                  tone === 'positive' &&
                    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  tone === 'negative' && 'bg-destructive/10 text-destructive',
                  tone === 'neutral' && 'bg-muted text-muted-foreground'
                )}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                {formatDelta(delta)}
              </span>
              <span className="truncate text-muted-foreground">
                {previous ? `from ${previous}` : 'vs prior period'}
              </span>
            </div>
          ))}
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
