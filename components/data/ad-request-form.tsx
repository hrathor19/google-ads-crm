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

const schema = z
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
  })
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
  );

export type AdRequestFormValues = z.infer<typeof schema>;

export function AdRequestForm({
  requestId,
  defaults,
}: {
  requestId?: string;
  defaults?: Partial<AdRequestFormValues>;
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
    resolver: zodResolver(schema),
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
      // Drop half-filled rows rather than sending a month with no number.
      leadTargets: (values.leadTargets ?? [])
        .filter((t) => t.month && t.leads !== '')
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
  const ageRestriction = watch('ageRestriction');

  return (
    <form className="space-y-4" noValidate>
      {/* ── Campaign ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Campaign</CardTitle>
          <CardDescription>
            What is being activated, and for whom. The Google Ads team builds from this.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Targets</CardTitle>
          <CardDescription>
            Budget and CPL are optional here — Ops applies them at the budget stage, which is why
            the sheet leaves them blank at submission.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Targeting</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
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
            <Input id="accountVisibility" placeholder="Hidden" {...register('accountVisibility')} />
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ads URLs</CardTitle>
          <CardDescription>
            At least one is required. The first one present is the page we score and write ad copy
            against, client pages first.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {URL_FIELDS.map(([name, label]) => (
            <Field key={name} id={name} label={label} error={errors[name]?.message}>
              <Input id={name} placeholder="https://" {...register(name)} />
            </Field>
          ))}
        </CardContent>
      </Card>

      {/* ── Monthly lead plan ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly lead plan</CardTitle>
          <CardDescription>
            Optional. How the required leads are expected to land month by month.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {months.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">No months added yet.</p>
          )}
          {months.fields.map((row, i) => (
            <div key={row.id} className="flex items-end gap-2">
              <Field id={`leadTargets.${i}.month`} label={i === 0 ? 'Month' : ''} className="flex-1">
                <Input
                  id={`leadTargets.${i}.month`}
                  type="month"
                  {...register(`leadTargets.${i}.month` as const)}
                />
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
          ))}

          {errors.leadTargets?.message && (
            <p className="text-xs text-destructive">{errors.leadTargets.message}</p>
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Keywords and remarks</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
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
    <div className={`space-y-1.5 ${className ?? ''}`}>
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
