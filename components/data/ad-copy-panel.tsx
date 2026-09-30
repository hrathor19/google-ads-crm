'use client';

import { useState } from 'react';
import { Check, Copy, Loader2, Pencil, Sparkles, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

/**
 * Generated ad copy with live character counting against Google's limits.
 *
 * The counter is the point of this panel: a headline is capped at 30
 * characters and a description at 90, and an over-length asset is rejected at
 * upload, so the count has to be visible while someone is typing rather than
 * discovered later.
 */

export const H_MAX = 30;
export const D_MAX = 90;

export const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'premium', label: 'Premium' },
  { value: 'value', label: 'Value' },
  { value: 'direct', label: 'Direct' },
];

export type Asset = { text: string; characters: number; reason?: string };

export type Validation = {
  expectedAdStrength: string;
  headlineCount: number;
  descriptionCount: number;
  uniqueHeadlineRatio: number;
  keywordCoverage: number;
  predictedCtrBand: string;
  qualityScoreContribution: string;
  flags: Array<{ level: string; field: string; message: string }>;
};

const STRENGTH_TONE: Record<string, string> = {
  EXCELLENT: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  GOOD: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30',
  AVERAGE: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  POOR: 'bg-destructive/10 text-destructive border-destructive/30',
};

export function ToneSelector({
  tone,
  onChange,
  onGenerate,
  generating,
  label = 'Generate ad copy',
}: {
  tone: string;
  onChange: (tone: string) => void;
  onGenerate: () => void;
  generating: boolean;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="tone" className="text-xs">
          Tone
        </Label>
        <Select value={tone} onValueChange={onChange}>
          <SelectTrigger id="tone" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONE_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={onGenerate} disabled={generating} className="btn-sheen">
        {generating ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {generating ? 'Generating…' : label}
      </Button>
    </div>
  );
}

export function AssetList({
  title,
  assets,
  limit,
  editable,
  onChange,
}: {
  title: string;
  assets: Asset[];
  limit: number;
  editable?: boolean;
  onChange?: (assets: Asset[]) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<number | null>(null);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: 'Copied' }),
      () => toast({ variant: 'destructive', title: 'Could not copy' })
    );
  }

  function update(index: number, text: string) {
    if (!onChange) return;
    const next = [...assets];
    next[index] = { ...next[index]!, text, characters: text.length };
    onChange(next);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {title}
          <span className="ml-1.5 font-normal text-muted-foreground">
            {assets.length} · max {limit} characters
          </span>
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => copy(assets.map((a) => a.text).join('\n'))}
        >
          <Copy className="mr-1.5 h-3 w-3" aria-hidden="true" />
          Copy all
        </Button>
      </div>

      <ul className="space-y-1.5">
        {assets.map((asset, i) => {
          const over = asset.text.length > limit;
          return (
            <li
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2',
                over && 'border-destructive/40 bg-destructive/5'
              )}
            >
              <span className="mt-1 w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                {editing === i && editable ? (
                  <Input
                    autoFocus
                    value={asset.text}
                    onChange={(e) => update(i, e.target.value)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
                    className="h-8"
                    aria-label={`Edit ${title.toLowerCase()} ${i + 1}`}
                  />
                ) : (
                  <p className="break-words text-sm">{asset.text}</p>
                )}
                {asset.reason && editing !== i && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{asset.reason}</p>
                )}
              </div>

              <span
                className={cn(
                  'mt-0.5 shrink-0 text-xs tabular-nums',
                  over ? 'font-semibold text-destructive' : 'text-muted-foreground'
                )}
                aria-label={`${asset.text.length} of ${limit} characters`}
              >
                {asset.text.length}/{limit}
              </span>

              <div className="flex shrink-0 gap-0.5">
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setEditing(editing === i ? null : i)}
                    aria-label={`Edit ${title.toLowerCase()} ${i + 1}`}
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => copy(asset.text)}
                  aria-label={`Copy ${title.toLowerCase()} ${i + 1}`}
                >
                  <Copy className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
        {assets.length === 0 && (
          <li className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing generated yet.
          </li>
        )}
      </ul>
    </div>
  );
}

export function ValidationSummary({
  validation,
  backend,
  backendReason,
}: {
  validation: Validation;
  backend?: string;
  backendReason?: string | null;
}) {
  const errors = validation.flags.filter((f) => f.level === 'error');
  const warnings = validation.flags.filter((f) => f.level === 'warning');

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn('font-medium', STRENGTH_TONE[validation.expectedAdStrength] ?? '')}
          >
            <Star className="mr-1 h-3 w-3" aria-hidden="true" />
            Ad strength: {validation.expectedAdStrength.toLowerCase()}
          </Badge>
          <Badge variant="outline" className="font-normal">
            {validation.headlineCount} headlines · {validation.descriptionCount} descriptions
          </Badge>
          <Badge variant="outline" className="font-normal">
            Keyword coverage {Math.round(validation.keywordCoverage * 100)}%
          </Badge>
          {backend && (
            <Badge variant="secondary" className="font-normal">
              {backend === 'gemini' ? 'Gemini' : 'Deterministic engine'}
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Predicted CTR {validation.predictedCtrBand} · Quality Score{' '}
          {validation.qualityScoreContribution}
        </p>

        {backend === 'deterministic' && backendReason && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Built by the deterministic engine rather than the model. {backendReason}
          </p>
        )}

        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((f, i) => (
              <p key={i} className="text-xs text-destructive">
                {f.message}
              </p>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {warnings.length} warning(s)
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              {warnings.map((f, i) => (
                <li key={i} className="list-disc text-muted-foreground">
                  {f.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {errors.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Every asset is within Google&apos;s character limits.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
