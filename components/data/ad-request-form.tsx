'use client';

import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Plus, Save, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { OBJECTIVE_LABELS } from './status-badge';

/**
 * The New / Edit Ad Request form.
 *
 * Field for field, this is the "Ads Campaign Activation Requirement Format"
 * sheet Ops fills today. Everything is a plain text box except the two
 * genuine choices — client type and age restriction — plus the account picker
 * and the campaign objective the rest of the CRM already keys off.
 *
 * Mirrors the server's zod schema so the two cannot drift: the client catches
 * a bad value before the round-trip, and the server catches it again for
 * anything that skips the form.
 */

/** Blank is a legitimate answer for most of the sheet. */
const opt = (max: number) => z.string().trim().max(max).optional();

/**
 * A number typed into a plain text box.
 *
 * Kept numeric — rather than stored as text like the rest — because the flow
 * does arithmetic on these: CPL approval, and pacing delivered leads against
 * the monthly plan below.
 */
const optNumber = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (!Number.isNaN(Number(v)) && Number(v) >= 0), `${label} must be a number`);

const URL_FIELDS = [
  ['adUrlKapplpDesktop', 'Ads URL (KAPPLP) — Adwords Desktop'],
  ['adUrlKapplpMobile', 'Ads URL (KAPPLP) — Adwords Mobile'],
  ['adUrlKapplpBing', 'Ads URL (KAPPLP) — Bing'],
  ['adUrlClientlpDesktop', 'Ads URL (CLIENTLP) — Adwords Desktop'],
  ['adUrlClientlpMobile', 'Ads URL (CLIENTLP) — Adwords Mobile'],
  ['adUrlClientlpBing', 'Ads URL (CLIENTLP) — Bing'],
] as const;

const urlField = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), 'Enter a full URL, including https://');

const baseSchema = z
  .object({
    // ── Campaign ──────────────────────────────────────────────────────────
    trackingId: opt(100),
    title: z.string().trim().min(3, 'Give the campaign a name').max(200),
    clientType: z.enum(['CLIENT', 'GENERIC', 'NON_CLIENT', 'EXAM']).optional(),
    productService: z.string().trim().min(2, 'Which courses?').max(500),

    // ── Targets ───────────────────────────────────────────────────────────
    requiredLeads: optNumber('Required leads'),
    performanceParameter: opt(200),
    targetApplication: optNumber('Target applications'),
    targetAdmission: opt(200),

    // ── Dates ─────────────────────────────────────────────────────────────
    startDate: z.string().min(1, 'Pick the client onboarding date'),
    applicationDeadline: opt(200),
    focusedMonths: opt(200),

    // ── Targeting ─────────────────────────────────────────────────────────
    ageRestriction: z.enum(['OPEN', 'AGE_18_24']).optional(),
    location: z.string().trim().min(2, 'Where should the ads run?').max(500),
    blockedLocations: opt(5000),
    accountVisibility: opt(200),
    reportingPanel: opt(200),

    // ── Destination URLs ──────────────────────────────────────────────────
    adUrlKapplpDesktop: urlField,
    adUrlKapplpMobile: urlField,
    adUrlKapplpBing: urlField,
    adUrlClientlpDesktop: urlField,
    adUrlClientlpMobile: urlField,
    adUrlClientlpBing: urlField,

    // ── Free text ─────────────────────────────────────────────────────────
    notes: opt(5000),

    leadTargets: z
      .array(z.object({ month: z.string(), leads: z.string() }))
      .max(36)
      .optional(),
  });

// Split from its refinements so the field list stays readable at runtime:
// `.refine()` returns a ZodEffects, which has no `.shape`.
/** Exported for the unit tests: the lead-plan rules are easy to get wrong. */
/** How the Google Ads account is shared with the client. */
export const ACCOUNT_VISIBILITY = ['Open', 'Hidden', 'OtherAccount', 'Domain'] as const;

/** Radix will not take '' as an item value, so an explicit "none" is needed. */
const NOT_SET = '__not_set__';

const THIS_YEAR = new Date().getUTCFullYear();

/** `01`–`12` with their names, so a row cannot hold a half-picked month. */
export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, '0'),
  label: new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, i, 1))
  ),
}));

/** A plan can look back a little and forward a few intakes. */
export const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => THIS_YEAR - 1 + i);

export const adRequestFormSchema = baseSchema
  .refine((v) => URL_FIELDS.some(([k]) => (v[k] ?? '').trim().length > 0), {
    message: 'Give at least one ads URL — it is the page we score and write copy against.',
    path: ['adUrlClientlpDesktop'],
  })
  .refine(
    (v) => {
      const months = (v.leadTargets ?? []).filter((t) => t.month).map((t) => t.month);
      return months.length === new Set(months).size;
    },
    { message: 'Each month can appear only once.', path: ['leadTargets'] }
  )
  // A half-filled row used to be dropped on the way out, without a word.
  // Pick a month, forget the number, save — and that month was simply gone,
  // which is indistinguishable from the app losing it. A row is now either
  // untouched (and ignored) or complete.
  .refine(
    (v) =>
      (v.leadTargets ?? []).every((t) => {
        const hasMonth = Boolean((t.month ?? '').trim());
        const hasLeads = String(t.leads ?? '').trim() !== '';
        return hasMonth === hasLeads;
      }),
    {
      message:
        'Every month needs a lead number, and every lead number needs a month. Fill the row in or remove it.',
      path: ['leadTargets'],
    }
  );

export type AdRequestFormValues = z.infer<typeof adRequestFormSchema>;

/**
 * Every field the requirement form captures.
 *
 * Exported so a test can assert the read-only brief maps all of them: the
 * old brief was a hand-written list and had silently fallen six fields
 * behind this one.
 */
export const AD_REQUEST_FORM_FIELDS = Object.keys(baseSchema.shape) as Array<keyof AdRequestFormValues>;

export function AdRequestForm({
  requestId,
  defaults,
  readOnly = false,
}: {
  requestId?: string;
  defaults?: Partial<AdRequestFormValues>;
  /**
   * Show the requirement exactly as it was filled in, uneditable.
   *
   * A `fieldset[disabled]` rather than a `readOnly` prop on each input: it
   * covers every control including the Radix selects, which are buttons and
   * ignore `readOnly`, and it cannot be missed off a field added later. The
   * opacity override is what keeps it legible — a greyed-out form is the
   * right affordance for "you cannot type here" and the wrong one for "this
   * is the brief you are working from".
   */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const { data: accountData } = useApi<{
    accounts: Array<{ id: number; name: string | null; customerId: string }>;
  }>(['account-options'], '/api/accounts/options', { staleTime: 5 * 60_000 });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AdRequestFormValues>({
    resolver: zodResolver(adRequestFormSchema),
    defaultValues: {
      ageRestriction: 'OPEN',
      startDate: new Date().toISOString().slice(0, 10),
      leadTargets: [],
      ...defaults,
    },
  });

  const months = useFieldArray({ control, name: 'leadTargets' });
  const leadRows = watch('leadTargets') ?? [];
  const plannedTotal = leadRows.reduce((sum, r) => sum + (Number(r?.leads) || 0), 0);
  const requiredLeads = Number(watch('requiredLeads')) || 0;

  async function save(values: AdRequestFormValues, submit: boolean) {
    const num = (v?: string) => (v && v.trim() !== '' ? Number(v) : null);
    const str = (v?: string) => (v && v.trim() !== '' ? v.trim() : null);

    const payload = {
      ...values,
      clientType: values.clientType ?? null,
      ageRestriction: values.ageRestriction ?? 'OPEN',
      requiredLeads: num(values.requiredLeads),
      targetApplication: num(values.targetApplication),
      trackingId: str(values.trackingId),
      performanceParameter: str(values.performanceParameter),
      targetAdmission: str(values.targetAdmission),
      applicationDeadline: str(values.applicationDeadline),
      focusedMonths: str(values.focusedMonths),
      blockedLocations: str(values.blockedLocations),
      accountVisibility: str(values.accountVisibility),
      reportingPanel: str(values.reportingPanel),
      notes: str(values.notes),
      // Only fully blank rows are dropped here — an "Add month" the user
      // never filled in. A half-filled one is refused by the schema above
      // rather than silently discarded on its way to the server.
      leadTargets: (values.leadTargets ?? [])
        .filter((t) => (t.month ?? '').trim() && String(t.leads ?? '').trim() !== '')
        .map((t) => ({ month: t.month, leads: Number(t.leads) })),
    };

    try {
      if (requestId) {
        await apiSend(`/api/ad-requests/${requestId}`, 'PATCH', payload);
        if (submit) {
          await apiSend(`/api/ad-requests/${requestId}/transition`, 'POST', {
            target: 'SUBMITTED',
          });
        }
        toast({ title: submit ? 'Resubmitted for approval' : 'Changes saved' });
        router.push(`/dashboard/ad-requests/${requestId}`);
      } else {
        const created = await apiSend<{ id: string }>('/api/ad-requests', 'POST', {
          ...payload,
          submit,
        });
        toast({
          title: submit ? 'Submitted for approval' : 'Saved as a draft',
          description: submit ? 'A manager has been notified.' : 'Submit it when you are ready.',
        });
        router.push(`/dashboard/ad-requests/${created.id}`);
      }
      router.refresh();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not save',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    }
  }

  const clientType = watch('clientType');
  const accountVisibility = watch('accountVisibility');
  const ageRestriction = watch('ageRestriction');

  return (
    <form className="space-y-3" noValidate>
      <fieldset
        disabled={readOnly}
        className={cn(
          'm-0 min-w-0 space-y-3 border-0 p-0',
          readOnly && [
            // Legible, not greyed out: a washed-out form is the right
            // affordance for "you cannot type here" and the wrong one for
            // "this is the brief you are working from".
            '[&_:disabled]:cursor-default [&_:disabled]:opacity-100',
            // No placeholders. "35" sitting in an empty Target applications
            // box reads as a value somebody entered, when the truth is the
            // field was left blank.
            '[&_input::placeholder]:text-transparent [&_textarea::placeholder]:text-transparent',
            '[&_[data-placeholder]]:text-transparent',
          ]
        )}
      >
      {/* ── Campaign ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-base">Campaign</CardTitle>
          <CardDescription className="text-xs">
            What is being activated, and for whom. The Google Ads team builds from this.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-4 gap-y-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="trackingId" label="New tracking ID" error={errors.trackingId?.message}>
            <Input id="trackingId" placeholder="13000047" {...register('trackingId')} />
          </Field>

          <Field id="title" label="Campaign / client name" error={errors.title?.message}>
            <Input id="title" placeholder="JIMS Rohini" {...register('title')} />
          </Field>

          <Field
            id="clientType"
            label="Client / Generic / NonClient / Exam"
            error={errors.clientType?.message}
          >
            <Select
              value={clientType ?? ''}
              onValueChange={(v) => setValue('clientType', v as AdRequestFormValues['clientType'])}
            >
              <SelectTrigger id="clientType">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLIENT">Client</SelectItem>
                <SelectItem value="GENERIC">Generic</SelectItem>
                <SelectItem value="NON_CLIENT">NonClient</SelectItem>
                <SelectItem value="EXAM">Exam</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field id="productService" label="Courses" error={errors.productService?.message}>
            <Input id="productService" placeholder="MBA/PGDM" {...register('productService')} />
          </Field>

        </CardContent>
      </Card>

      {/* ── Targets ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-base">Targets</CardTitle>
          <CardDescription className="text-xs">
            Budget and CPL are optional here — Ops applies them at the budget stage, which is why
            the sheet leaves them blank at submission.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-4 gap-y-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="requiredLeads" label="Required leads" error={errors.requiredLeads?.message}>
            <Input id="requiredLeads" inputMode="numeric" placeholder="100" {...register('requiredLeads')} />
          </Field>
          <Field
            id="performanceParameter"
            label="Performance parameter"
            error={errors.performanceParameter?.message}
          >
            <Input id="performanceParameter" placeholder="Applications" {...register('performanceParameter')} />
          </Field>
          <Field
            id="targetApplication"
            label="Target applications"
            error={errors.targetApplication?.message}
          >
            <Input id="targetApplication" inputMode="numeric" placeholder="35" {...register('targetApplication')} />
          </Field>
          <Field
            id="targetAdmission"
            label="Target admissions"
            hint="Free text — a dash is fine."
            error={errors.targetAdmission?.message}
          >
            <Input id="targetAdmission" placeholder="-" {...register('targetAdmission')} />
          </Field>
        </CardContent>
      </Card>

      {/* ── Dates ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-base">Dates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-4 gap-y-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="startDate" label="Client onboarding date" error={errors.startDate?.message}>
            <Input id="startDate" type="date" {...register('startDate')} />
          </Field>
          <Field
            id="applicationDeadline"
            label="Application deadline"
            hint='Free text — "End of February" is fine.'
            error={errors.applicationDeadline?.message}
          >
            <Input id="applicationDeadline" placeholder="End of February" {...register('applicationDeadline')} />
          </Field>
          <Field id="focusedMonths" label="Focused months" error={errors.focusedMonths?.message}>
            <Input id="focusedMonths" placeholder="Sep-Jun" {...register('focusedMonths')} />
          </Field>
        </CardContent>
      </Card>

      {/* ── Targeting ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-base">Targeting</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-4 gap-y-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="ageRestriction" label="Age restriction" error={errors.ageRestriction?.message}>
            <Select
              value={ageRestriction ?? 'OPEN'}
              onValueChange={(v) =>
                setValue('ageRestriction', v as AdRequestFormValues['ageRestriction'])
              }
            >
              <SelectTrigger id="ageRestriction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="AGE_18_24">18-24 Year</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="accountVisibility"
            label="Open / Hidden / OtherAccount / Domain"
            error={errors.accountVisibility?.message}
          >
            <Select
              value={accountVisibility || NOT_SET}
              onValueChange={(v) => setValue('accountVisibility', v === NOT_SET ? '' : v)}
            >
              <SelectTrigger id="accountVisibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Optional, so it has to be clearable. Radix refuses an
                    empty string as an item value, hence the sentinel. */}
                <SelectItem value={NOT_SET}>Not set</SelectItem>
                {ACCOUNT_VISIBILITY.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
                {/* Anything already saved that is not one of the four, so
                    opening an old request and saving it cannot silently
                    blank a value somebody typed. */}
                {accountVisibility &&
                  !(ACCOUNT_VISIBILITY as readonly string[]).includes(accountVisibility) && (
                  <SelectItem value={accountVisibility}>{accountVisibility}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field id="location" label="Location (need to be run)" error={errors.location?.message}>
            <Input id="location" placeholder="Delhi" {...register('location')} />
          </Field>

          <Field id="reportingPanel" label="Reporting panel" error={errors.reportingPanel?.message}>
            <Input id="reportingPanel" placeholder="NPF 5" {...register('reportingPanel')} />
          </Field>

          <Field
            id="blockedLocations"
            label="Location (to be blocked)"
            className="sm:col-span-2"
            hint="Pincodes or areas, comma separated."
            error={errors.blockedLocations?.message}
          >
            <Textarea
              id="blockedLocations"
              rows={2}
              placeholder="110085, 110019, 110070, 110024"
              {...register('blockedLocations')}
            />
          </Field>
        </CardContent>
      </Card>

      {/* ── Destination URLs ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-base">Ads URLs</CardTitle>
          <CardDescription className="text-xs">
            At least one is required. The first one present is the page we score and write ad copy
            against, client pages first.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-4 gap-y-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          {URL_FIELDS.map(([name, label]) => (
            <Field key={name} id={name} label={label} error={errors[name]?.message}>
              <Input id={name} placeholder="https://" {...register(name)} />
            </Field>
          ))}
        </CardContent>
      </Card>

      {/* ── Monthly lead plan ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-base">Monthly lead plan</CardTitle>
          <CardDescription className="text-xs">
            Optional. How the required leads are expected to land month by month.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          {months.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">No months added yet.</p>
          )}
          {months.fields.map((row, i) => {
            const [rowYear = '', rowMonth = ''] = (leadRows[i]?.month ?? '').split('-');
            // A month with no year is the trap this replaced: the native
            // month input reports an empty value until *both* parts are
            // filled, so "October ----" looked chosen and submitted nothing.
            // Picking a month here always produces a complete value, because
            // the year falls back to the one already shown.
            const setPart = (part: 'year' | 'month', value: string) => {
              const year = part === 'year' ? value : rowYear || String(THIS_YEAR);
              const month = part === 'month' ? value : rowMonth;
              setValue(`leadTargets.${i}.month` as const, month ? `${year}-${month}` : '', {
                shouldValidate: true,
                shouldDirty: true,
              });
            };

            return (
            <div key={row.id} className="flex items-end gap-2">
              <Field id={`leadTargets.${i}.month`} label={i === 0 ? 'Month' : ''} className="flex-1">
                <div className="flex gap-2">
                  <Select value={rowMonth} onValueChange={(v) => setPart('month', v)}>
                    <SelectTrigger id={`leadTargets.${i}.month`} className="flex-1">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_OPTIONS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={rowYear || String(THIS_YEAR)}
                    onValueChange={(v) => setPart('year', v)}
                  >
                    <SelectTrigger id={`leadTargets.${i}.year`} className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEAR_OPTIONS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Field>
              <Field id={`leadTargets.${i}.leads`} label={i === 0 ? 'Leads' : ''} className="w-32">
                <Input
                  id={`leadTargets.${i}.leads`}
                  inputMode="numeric"
                  placeholder="0"
                  {...register(`leadTargets.${i}.leads` as const)}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove month ${i + 1}`}
                onClick={() => months.remove(i)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            );
          })}

          {/* `root` as well as `message`: react-hook-form files an error
              aimed at a field array under `.root`, so reading `.message`
              alone showed nothing — the submit button simply did nothing
              and gave no reason, which is how a blocked save reads as a
              broken one. */}
          {(errors.leadTargets?.root?.message ?? errors.leadTargets?.message) && (
            <p className="text-xs text-destructive">
              {errors.leadTargets?.root?.message ?? errors.leadTargets?.message}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => months.append({ month: '', leads: '' })}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Add month
            </Button>
            {months.fields.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Planned total <span className="font-medium tabular-nums">{plannedTotal}</span>
                {requiredLeads > 0 && (
                  <>
                    {' '}
                    of <span className="font-medium tabular-nums">{requiredLeads}</span> required
                    {plannedTotal !== requiredLeads && (
                      <span className="text-amber-600 dark:text-amber-500">
                        {' '}
                        — {plannedTotal > requiredLeads ? 'over' : 'short'} by{' '}
                        {Math.abs(requiredLeads - plannedTotal)}
                      </span>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-base">Keywords and remarks</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-4 gap-y-3 px-4 pb-4">
          <Field id="notes" label="Remarks" error={errors.notes?.message}>
            <Textarea
              id="notes"
              rows={2}
              placeholder="Run using age filter, in night from 9 PM to 5 AM"
              {...register('notes')}
            />
          </Field>
        </CardContent>
      </Card>

      </fieldset>

      {!readOnly && (
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={handleSubmit((v) => save(v, false))}
        >
          {isSubmitting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          Save draft
        </Button>
        <Button type="button" disabled={isSubmitting} onClick={handleSubmit((v) => save(v, true))}>
          {isSubmitting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          {requestId ? 'Save and resubmit' : 'Submit for approval'}
        </Button>
      </div>
      )}
    </form>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
