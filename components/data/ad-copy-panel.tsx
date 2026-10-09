'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  FileUp,
  Loader2,
  Pencil,
  RotateCcw,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { parseKeywordCsv, type KeywordVolume } from '@/lib/ai/keyword-csv';
import { DEFAULT_EXCLUDED_TERMS, parseExcludedTerms } from '@/lib/ai/exclusions';
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
export const SITELINK_TEXT_MAX = 25;
export const SITELINK_DESC_MAX = 35;

/** What a complete hand-over carries, and what the counters count towards. */
/** What the "Never mention" field starts with. */
export const DEFAULT_EXCLUDED = DEFAULT_EXCLUDED_TERMS.join(', ');

export const H_COUNT = 15;
export const D_COUNT = 4;
export const SITELINK_COUNT = 6;

export type Asset = { text: string; characters: number; reason?: string };
export type Sitelink = { text: string; description1: string; description2: string };

export type Validation = {
  expectedAdStrength: string;
  headlineCount: number;
  descriptionCount: number;
  sitelinkCount?: number;
  subjectInHeadlines?: number;
  subjectInDescriptions?: number;
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

/**
 * One button, no settings.
 *
 * This replaced a tone picker. Choosing between "premium" and "value" was a
 * decision nobody was placed to make — the brief never described an
 * audience precisely enough to answer it — and whichever was chosen got
 * applied to all fifteen headlines, which is the one thing a responsive
 * search ad should not do. The generator spreads the angles itself now, so
 * there is nothing left to set.
 */
export function GenerateButton({
  onGenerate,
  generating,
  label = 'Generate ad copy',
}: {
  onGenerate: () => void;
  generating: boolean;
  label?: string;
}) {
  return (
    <Button onClick={onGenerate} disabled={generating} className="btn-sheen">
      {generating ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
      )}
      {generating ? 'Generating…' : label}
    </Button>
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
            {validation.headlineCount}/{H_COUNT} headlines · {validation.descriptionCount}/
            {D_COUNT} descriptions
            {validation.sitelinkCount !== undefined &&
              ` · ${validation.sitelinkCount}/${SITELINK_COUNT} sitelinks`}
          </Badge>
          <Badge variant="outline" className="font-normal">
            Keyword coverage {Math.round(validation.keywordCoverage * 100)}%
          </Badge>
          {validation.subjectInHeadlines !== undefined && (
            <Badge
              variant="outline"
              className={cn(
                'font-normal',
                validation.subjectInHeadlines === 0 &&
                  'border-destructive/30 bg-destructive/10 text-destructive'
              )}
            >
              Name in {validation.subjectInHeadlines} headline
              {validation.subjectInHeadlines === 1 ? '' : 's'}
              {validation.subjectInDescriptions !== undefined &&
                ` · ${validation.subjectInDescriptions} description${validation.subjectInDescriptions === 1 ? '' : 's'}`}
            </Badge>
          )}
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

/**
 * The six sitelinks, with all three character counters live.
 *
 * Laid out as cards rather than rows of the asset list because a sitelink is
 * three fields under three different caps — 25, 35 and 35 — and putting them
 * in one line of a table meant the counters were too small to read and the
 * two descriptions were indistinguishable.
 */
export function SitelinkList({
  sitelinks,
  editable,
  onChange,
}: {
  sitelinks: Sitelink[];
  editable?: boolean;
  onChange?: (sitelinks: Sitelink[]) => void;
}) {
  const { toast } = useToast();

  function copyAll() {
    const text = sitelinks
      .map((s) => [s.text, s.description1, s.description2].filter(Boolean).join('\t'))
      .join('\n');
    navigator.clipboard.writeText(text).then(
      () => toast({ title: 'Copied', description: 'Tab-separated, ready to paste into Google Ads.' }),
      () => toast({ variant: 'destructive', title: 'Could not copy' })
    );
  }

  function update(index: number, field: keyof Sitelink, value: string) {
    if (!onChange) return;
    const next = [...sitelinks];
    next[index] = { ...next[index]!, [field]: value };
    onChange(next);
  }

  const Counter = ({ value, limit }: { value: string; limit: number }) => (
    <span
      className={cn(
        'shrink-0 text-[11px] tabular-nums',
        value.length > limit ? 'font-semibold text-destructive' : 'text-muted-foreground'
      )}
    >
      {value.length}/{limit}
    </span>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Sitelinks
          <span className="ml-1.5 font-normal text-muted-foreground">
            {sitelinks.length} of {SITELINK_COUNT} · {SITELINK_TEXT_MAX} / {SITELINK_DESC_MAX} /{' '}
            {SITELINK_DESC_MAX} characters
          </span>
        </h3>
        {sitelinks.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={copyAll}>
            <Copy className="mr-1.5 h-3 w-3" aria-hidden="true" />
            Copy all
          </Button>
        )}
      </div>

      {sitelinks.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No sitelinks generated yet.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {sitelinks.map((sl, i) => (
            <li key={i} className="rounded-lg border p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                {editable ? (
                  <Input
                    value={sl.text}
                    onChange={(e) => update(i, 'text', e.target.value)}
                    className="h-7 text-sm font-medium"
                    aria-label={`Sitelink ${i + 1} link text`}
                  />
                ) : (
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{sl.text}</p>
                )}
                <Counter value={sl.text} limit={SITELINK_TEXT_MAX} />
              </div>

              {(['description1', 'description2'] as const).map((field, n) => (
                <div key={field} className="mt-1 flex items-center gap-2 pl-6">
                  {editable ? (
                    <Input
                      value={sl[field]}
                      onChange={(e) => update(i, field, e.target.value)}
                      className="h-7 text-xs"
                      aria-label={`Sitelink ${i + 1} description ${n + 1}`}
                    />
                  ) : (
                    <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {sl[field] || '—'}
                    </p>
                  )}
                  <Counter value={sl[field]} limit={SITELINK_DESC_MAX} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Upload the Keyword Research export.
 *
 * The file is read and parsed in the browser so the Ads person sees what was
 * understood — how many keywords, which column the volume came from, what
 * was skipped — before anything is generated from it. The parsed rows go to
 * the server as JSON and are validated there again; this is a preview, not
 * the guard.
 */
export function KeywordCsvUpload({
  rows,
  onChange,
  disabled,
}: {
  rows: KeywordVolume[];
  onChange: (rows: KeywordVolume[]) => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const inputId = 'keyword-csv';

  async function onFile(file: File | null) {
    if (!file) return;
    // A stray .xlsx would parse as mojibake and produce one nonsense
    // "keyword" per row, which is worse than refusing it.
    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast({
        variant: 'destructive',
        title: 'That is not a CSV',
        description: 'Export from Keyword Research with the Export CSV button, then upload that file.',
      });
      return;
    }
    const text = await file.text();
    const result = parseKeywordCsv(text);
    if (result.error) {
      toast({ variant: 'destructive', title: 'Could not read that file', description: result.error });
      return;
    }
    setFileName(file.name);
    setWarnings(result.warnings);
    onChange(result.rows);
  }

  function clear() {
    setFileName(null);
    setWarnings([]);
    onChange([]);
  }

  const withVolume = rows.filter((r) => r.volume > 0).length;
  const totalVolume = rows.reduce((sum, r) => sum + r.volume, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId} className="text-xs">
          Keywords from research
        </Label>
        {rows.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            onClick={clear}
            disabled={disabled}
          >
            <X className="mr-1 h-3 w-3" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>

      <label
        htmlFor={inputId}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center transition-colors',
          'hover:border-primary/50 hover:bg-accent/40',
          disabled && 'pointer-events-none opacity-50',
          rows.length > 0 && 'border-emerald-500/40 bg-emerald-500/5'
        )}
      >
        <FileUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {rows.length > 0 ? (
          <>
            <span className="text-xs font-medium">
              {rows.length} keyword{rows.length === 1 ? '' : 's'} loaded
            </span>
            <span className="text-[11px] text-muted-foreground">
              {fileName}
              {withVolume > 0 && ` · ${totalVolume.toLocaleString('en-IN')} searches a month`}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs font-medium">Upload the Keyword Research CSV</span>
            <span className="text-[11px] text-muted-foreground">
              Keyword and Avg monthly searches
            </span>
          </>
        )}
      </label>
      <input
        id={inputId}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          void onFile(e.target.files?.[0] ?? null);
          // Reset, so re-picking the same file after a Clear still fires.
          e.target.value = '';
        }}
      />

      {warnings.length > 0 && (
        <ul className="space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rows.slice(0, 6).map((r) => (
            <Badge key={r.keyword} variant="secondary" className="font-normal">
              {r.keyword}
              {r.volume > 0 && (
                <span className="ml-1 text-muted-foreground">
                  {r.volume.toLocaleString('en-IN')}
                </span>
              )}
            </Badge>
          ))}
          {rows.length > 6 && (
            <Badge variant="outline" className="font-normal">
              +{rows.length - 6} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Words the copy must not use.
 *
 * Pre-filled with "fee" because that is the one everybody wants banned and
 * nobody remembers to ban: the figure on a landing page is one intake's
 * tuition before scholarships, so an ad that mentions it generates calls
 * about a number that was never the price.
 *
 * Shown as chips rather than left as raw text so it is obvious what is
 * actually in force — a comma typed in the wrong place is otherwise a ban
 * that silently covers nothing.
 */
export function ExcludedTermsField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const terms = parseExcludedTerms(value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="excludedTerms" className="flex items-center gap-1.5">
        <Ban className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        Never mention
      </Label>
      <Input
        id="excludedTerms"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="fee, hostel, placement guarantee"
        autoComplete="off"
      />
      {terms.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {terms.map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Nothing is excluded. Anything on the landing page may appear in the copy.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {terms.length > 0
          ? 'Dropped from every headline, description and sitelink, and from the landing-page facts the generator reads. Plurals are covered.'
          : 'Separate with commas.'}
      </p>
    </div>
  );
}

/** Everything the generator reads, as the two screens both present it. */
export type CopyBriefFields = {
  /** The college or university. Null on the standalone tool, which has one name field. */
  institution: string | null;
  /** The course, or the whole name where there is only one field. */
  product: string;
  landingPageUrl: string;
  targetAudience: string;
  location: string;
  usps: string;
};

/**
 * The brief, on the screen that generates from it.
 *
 * Inside an ad request these start filled from what Ops filed and stay
 * editable. They have to be visible: the Ads person is the one who can see
 * that the course was typed as "MBA/PGDM" when the landing page says
 * "PGDM in Communications", and before this they had no way to correct it
 * short of editing somebody else's requirement form.
 *
 * Edits apply to the generation only. The request keeps what Ops asked for,
 * because a brief that quietly rewrites itself is no longer a record of
 * anything.
 */
export function CopyBriefFields({
  value,
  onChange,
  disabled,
  /** Shown when the values came from a request and have been changed. */
  onReset,
  changed,
  stacked,
}: {
  value: CopyBriefFields;
  onChange: (next: CopyBriefFields) => void;
  disabled?: boolean;
  onReset?: () => void;
  changed?: boolean;
  /**
   * One column, for a narrow sidebar. Tailwind's `sm:` is viewport-based,
   * not container-based, so a two-column grid inside the standalone tool's
   * 22rem column would go side-by-side on a desktop and be unusable.
   */
  stacked?: boolean;
}) {
  const set = <K extends keyof CopyBriefFields>(key: K, v: CopyBriefFields[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-3">
      {onReset && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Filled from the request. Edits here change this generation only, not the brief.
          </p>
          {changed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={onReset}
              disabled={disabled}
            >
              <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
              Reset to the brief
            </Button>
          )}
        </div>
      )}

      <div className={cn('grid gap-3', !stacked && 'sm:grid-cols-2')}>
        {value.institution !== null && (
          <div className="space-y-1.5">
            <Label htmlFor="brief-institution">College / University</Label>
            <Input
              id="brief-institution"
              value={value.institution}
              onChange={(e) => set('institution', e.target.value)}
              disabled={disabled}
              placeholder="Christ University"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="brief-product">
            {value.institution === null ? 'College / University / Course' : 'Course'}{' '}
            <span className="text-destructive">*</span>
          </Label>
          <Input
            id="brief-product"
            value={value.product}
            onChange={(e) => set('product', e.target.value)}
            disabled={disabled}
            placeholder={value.institution === null ? 'Christ University — MBA/PGDM' : 'MBA/PGDM'}
          />
        </div>

        {/* Under the name, not floating after the last field — it describes
            what these two boxes are for. */}
        <p className={cn('-mt-1 text-[11px] text-muted-foreground', !stacked && 'sm:col-span-2')}>
          {value.institution === null
            ? 'This name goes into the headlines and descriptions, so write it the way a student would search for it.'
            : 'Both names go into the headlines and descriptions, so write them the way a student would search for them.'}
        </p>

        <div className={cn('space-y-1.5', !stacked && 'sm:col-span-2')}>
          <Label htmlFor="brief-url">
            Landing page URL <span className="text-destructive">*</span>
          </Label>
          <Input
            id="brief-url"
            type="url"
            inputMode="url"
            value={value.landingPageUrl}
            onChange={(e) => set('landingPageUrl', e.target.value)}
            disabled={disabled}
            placeholder="https://example.com/mba"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brief-audience">Target audience</Label>
          <Input
            id="brief-audience"
            value={value.targetAudience}
            onChange={(e) => set('targetAudience', e.target.value)}
            disabled={disabled}
            placeholder="Graduates aged 21–26"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brief-location">Location</Label>
          <Input
            id="brief-location"
            value={value.location}
            onChange={(e) => set('location', e.target.value)}
            disabled={disabled}
            placeholder="Bangalore"
          />
        </div>

        <div className={cn('space-y-1.5', !stacked && 'sm:col-span-2')}>
          <Label htmlFor="brief-usps">USPs and offers</Label>
          <Textarea
            id="brief-usps"
            rows={2}
            value={value.usps}
            onChange={(e) => set('usps', e.target.value)}
            disabled={disabled}
            placeholder="NAAC A++, scholarships up to 50%"
          />
        </div>
      </div>
    </div>
  );
}
