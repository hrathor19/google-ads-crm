'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Save, Send } from 'lucide-react';
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
 * Mirrors the server's zod schema field for field so the two cannot drift —
 * the client catches a bad value before the round-trip, and the server catches
 * it again for anything that skips the form.
 */
const schema = z.object({
  title: z.string().trim().min(3, 'Give the request a title').max(200),
  accountId: z.string().optional(),
  objective: z.enum([
    'LEAD_GENERATION',
    'WEBSITE_TRAFFIC',
    'BRAND_AWARENESS',
    'APP_PROMOTION',
    'SALES',
    'LOCAL_VISITS',
  ]),
  productService: z.string().trim().min(2, 'What is being advertised?').max(500),
  targetAudience: z.string().trim().min(2, 'Describe who the ads should reach').max(1000),
  location: z.string().trim().min(2, 'Where should the ads run?').max(500),
  budget: z.coerce.number().positive('Enter a budget above zero'),
  startDate: z.string().min(1, 'Pick a start date'),
  endDate: z.string().optional(),
  landingPageUrl: z
    .string()
    .trim()
    .url('Enter a full URL, including https://')
    .refine((v) => /^https?:\/\//i.test(v), 'The URL must start with http:// or https://'),
  usps: z.string().trim().max(2000).optional(),
  keywords: z.string().trim().max(5000).optional(),
  notes: z.string().trim().max(5000).optional(),
});

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
    formState: { errors, isSubmitting },
  } = useForm<AdRequestFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      objective: 'LEAD_GENERATION',
      startDate: new Date().toISOString().slice(0, 10),
      ...defaults,
    },
  });

  async function save(values: AdRequestFormValues, submit: boolean) {
    const payload = {
      ...values,
      accountId: values.accountId && values.accountId !== 'none' ? Number(values.accountId) : null,
      endDate: values.endDate || null,
      usps: values.usps || null,
      keywords: values.keywords || null,
      notes: values.notes || null,
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

  const objective = watch('objective');
  const accountId = watch('accountId');

  return (
    <form className="space-y-4" noValidate>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The brief</CardTitle>
          <CardDescription>
            What the campaign is for. The Google Ads team builds from this, so be specific.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            className="sm:col-span-2"
            id="title"
            label="Title"
            error={errors.title?.message}
            hint="A short name everyone will recognise in the queue."
          >
            <Input id="title" placeholder="MBA Admissions 2026 — Bangalore" {...register('title')} />
          </Field>

          <Field id="accountId" label="Client / account" error={errors.accountId?.message}>
            <Select
              value={accountId ?? 'none'}
              onValueChange={(v) => setValue('accountId', v, { shouldValidate: true })}
            >
              <SelectTrigger id="accountId">
                <SelectValue placeholder="Pick an account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No specific account</SelectItem>
                {(accountData?.accounts ?? []).map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name ?? a.customerId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field id="objective" label="Campaign objective" error={errors.objective?.message}>
            <Select
              value={objective}
              onValueChange={(v) =>
                setValue('objective', v as AdRequestFormValues['objective'], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id="objective">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OBJECTIVE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            className="sm:col-span-2"
            id="productService"
            label="Product or service"
            error={errors.productService?.message}
          >
            <Input
              id="productService"
              placeholder="Two-year full-time MBA"
              {...register('productService')}
            />
          </Field>

          <Field
            className="sm:col-span-2"
            id="targetAudience"
            label="Target audience"
            error={errors.targetAudience?.message}
          >
            <Textarea
              id="targetAudience"
              rows={2}
              placeholder="Graduates aged 21–26 in metro India considering a full-time MBA in 2026"
              {...register('targetAudience')}
            />
          </Field>

          <Field id="location" label="Location" error={errors.location?.message}>
            <Input id="location" placeholder="Bangalore, Chennai, Hyderabad" {...register('location')} />
          </Field>

          <Field
            id="budget"
            label="Budget"
            error={errors.budget?.message}
            hint="Total for the flight, in the account currency."
          >
            <Input id="budget" type="number" min={0} step="0.01" {...register('budget')} />
          </Field>

          <Field id="startDate" label="Start date" error={errors.startDate?.message}>
            <Input id="startDate" type="date" {...register('startDate')} />
          </Field>

          <Field
            id="endDate"
            label="End date"
            error={errors.endDate?.message}
            hint="Leave blank to run until paused."
          >
            <Input id="endDate" type="date" {...register('endDate')} />
          </Field>

          <Field
            className="sm:col-span-2"
            id="landingPageUrl"
            label="Landing page URL"
            error={errors.landingPageUrl?.message}
            hint="The Ads team scores this page from inside the request."
          >
            <Input
              id="landingPageUrl"
              type="url"
              inputMode="url"
              placeholder="https://example.com/mba-admissions"
              {...register('landingPageUrl')}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Supporting detail</CardTitle>
          <CardDescription>
            Optional, but it is what the AI copy generator draws on.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field id="usps" label="USPs and offers" error={errors.usps?.message}>
            <Textarea
              id="usps"
              rows={3}
              placeholder="NAAC A++, 100% placement record, scholarships up to 50%, applications close 31 July"
              {...register('usps')}
            />
          </Field>

          <Field
            id="keywords"
            label="Keywords"
            error={errors.keywords?.message}
            hint="One per line. Optional — the team will research more."
          >
            <Textarea
              id="keywords"
              rows={4}
              placeholder={'mba admission 2026\nbest mba college bangalore\nmba fees'}
              {...register('keywords')}
            />
          </Field>

          <Field id="notes" label="Notes" error={errors.notes?.message}>
            <Textarea
              id="notes"
              rows={3}
              placeholder="Anything the reviewer or the Ads team should know."
              {...register('notes')}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={handleSubmit((v) => save(v, false))}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Save as draft
        </Button>
        <Button
          type="button"
          className="btn-sheen"
          disabled={isSubmitting}
          onClick={handleSubmit((v) => save(v, true))}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Submit for approval
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
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
