'use client';

import { AlertCircle, Check, Gauge, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A landing-page score, its per-category breakdown and the fixes.
 *
 * Suggestions are ordered by the weight of the check that failed, so the top
 * item is always the biggest available lift rather than the first check that
 * happened to fail.
 */

export type ScoreCheck = { item: string; ok: boolean; weight: number; category: string };
export type ScoreCategory = {
  name: string;
  passed: number;
  max: number;
  score: number;
  items: Array<{ item: string; ok: boolean; weight: number }>;
};

export type LandingScoreData = {
  url: string;
  score: number;
  grade: string;
  pageType: string;
  passed: number;
  maxPoints?: number;
  max?: number;
  categories: ScoreCategory[];
  suggestions: string[];
  checks?: ScoreCheck[];
  tracking?: Record<string, unknown> | null;
  createdAt?: string;
};

const GRADE_TONE: Record<string, string> = {
  A: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  B: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30',
  C: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  D: 'bg-destructive/10 text-destructive border-destructive/30',
};

export function LandingScorePanel({ data }: { data: LandingScoreData }) {
  const max = data.maxPoints ?? data.max ?? 100;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div
            className={cn(
              'flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-xl border-2',
              GRADE_TONE[data.grade] ?? ''
            )}
          >
            <span className="text-2xl font-bold tabular-nums">{data.score}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide">
              Grade {data.grade}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{data.url}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Scored as {data.pageType === 'exam' ? 'an exam page' : 'a college page'} ·{' '}
              {data.passed} of {max} weighted points
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.categories.map((c) => (
                <Badge key={c.name} variant="outline" className="gap-1 font-normal">
                  <Gauge className="h-3 w-3 opacity-60" aria-hidden="true" />
                  {c.name} {c.score}%
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">What the page has</h3>
            <div className="space-y-3">
              {data.categories.map((cat) => (
                <div key={cat.name}>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {cat.name}
                  </p>
                  <ul className="space-y-1">
                    {cat.items.map((item) => (
                      <li key={item.item} className="flex items-start gap-2 text-sm">
                        {item.ok ? (
                          <Check
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-label="Present"
                          />
                        ) : (
                          <X
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                            aria-label="Missing"
                          />
                        )}
                        <span className={cn(!item.ok && 'text-muted-foreground')}>
                          {item.item}
                        </span>
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                          {item.weight}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">
              How to improve it
              <span className="ml-1.5 font-normal text-muted-foreground">
                (biggest lift first)
              </span>
            </h3>
            {data.suggestions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing to fix — every check passed.
              </p>
            ) : (
              <ol className="space-y-2.5">
                {data.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground">{s}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {data.tracking && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <AlertCircle className="h-4 w-4 opacity-70" aria-hidden="true" />
              Tracking tags detected
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['gtm', 'Google Tag Manager'],
                  ['ga4', 'GA4'],
                  ['google_ads_conversion', 'Google Ads conversion'],
                  ['meta_pixel', 'Meta Pixel'],
                  ['remarketing', 'Remarketing'],
                  ['cookie_consent', 'Cookie consent'],
                ] as const
              ).map(([key, label]) => {
                const present = Boolean(data.tracking?.[key]);
                return (
                  <Badge
                    key={key}
                    variant="outline"
                    className={cn(
                      'gap-1 font-normal',
                      present
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {present ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <X className="h-3 w-3" aria-hidden="true" />
                    )}
                    {label}
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
