'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/data/page-header';
import { AdRequestForm } from '@/components/data/ad-request-form';
import { ErrorState } from '@/components/data/states';
import { useApi } from '@/lib/hooks/use-api';

type Response = {
  request: {
    id: string;
    reference: string;
    title: string;
    accountId: number | null;
    objective: string;
    productService: string;
    targetAudience: string;
    location: string;
    budget: number | null;
    startDate: string;
    endDate: string | null;
    usps: string | null;
    keywords: string | null;
    notes: string | null;

    trackingId: string | null;
    clientType: string | null;
    ageRestriction: string | null;
    requiredLeads: number | null;
    requiredCpl: number | null;
    performanceParameter: string | null;
    targetApplication: number | null;
    targetAdmission: string | null;
    applicationDeadline: string | null;
    focusedMonths: string | null;
    blockedLocations: string | null;
    accountVisibility: string | null;
    reportingPanel: string | null;
    adUrlKapplpDesktop: string | null;
    adUrlKapplpMobile: string | null;
    adUrlKapplpBing: string | null;
    adUrlClientlpDesktop: string | null;
    adUrlClientlpMobile: string | null;
    adUrlClientlpBing: string | null;
    leadTargets?: Array<{ month: string; leads: number }>;
  };
};

export default function EditAdRequestPage({ params }: { params: { id: string } }) {
  const { data, isLoading, error, refetch } = useApi<Response>(
    ['ad-request', params.id],
    `/api/ad-requests/${params.id}`
  );

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        title="Edit request"
        description={data ? `${data.request.reference} · ${data.request.title}` : 'Loading…'}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/ad-requests/${params.id}`}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Back
            </Link>
          </Button>
        }
      />
      <div className="max-w-3xl">
        {isLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-96 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <AdRequestForm
            requestId={params.id}
            defaults={{
              title: data.request.title,
              accountId: data.request.accountId ? String(data.request.accountId) : 'none',
              objective: data.request.objective as never,
              productService: data.request.productService,
              targetAudience: data.request.targetAudience,
              location: data.request.location,
              // Every numeric field round-trips through the form as a string:
              // the inputs are plain text boxes, per the requirement sheet.
              budget: data.request.budget != null ? String(data.request.budget) : '',
              startDate: data.request.startDate.slice(0, 10),
              endDate: data.request.endDate?.slice(0, 10) ?? '',
              usps: data.request.usps ?? '',
              keywords: data.request.keywords ?? '',
              notes: data.request.notes ?? '',

              trackingId: data.request.trackingId ?? '',
              clientType: (data.request.clientType ?? undefined) as never,
              ageRestriction: (data.request.ageRestriction ?? 'OPEN') as never,
              requiredLeads:
                data.request.requiredLeads != null ? String(data.request.requiredLeads) : '',
              requiredCpl: data.request.requiredCpl != null ? String(data.request.requiredCpl) : '',
              performanceParameter: data.request.performanceParameter ?? '',
              targetApplication:
                data.request.targetApplication != null
                  ? String(data.request.targetApplication)
                  : '',
              targetAdmission: data.request.targetAdmission ?? '',
              applicationDeadline: data.request.applicationDeadline ?? '',
              focusedMonths: data.request.focusedMonths ?? '',
              blockedLocations: data.request.blockedLocations ?? '',
              accountVisibility: data.request.accountVisibility ?? '',
              reportingPanel: data.request.reportingPanel ?? '',
              adUrlKapplpDesktop: data.request.adUrlKapplpDesktop ?? '',
              adUrlKapplpMobile: data.request.adUrlKapplpMobile ?? '',
              adUrlKapplpBing: data.request.adUrlKapplpBing ?? '',
              adUrlClientlpDesktop: data.request.adUrlClientlpDesktop ?? '',
              adUrlClientlpMobile: data.request.adUrlClientlpMobile ?? '',
              adUrlClientlpBing: data.request.adUrlClientlpBing ?? '',
              leadTargets: (data.request.leadTargets ?? []).map((t) => ({
                month: String(t.month).slice(0, 7),
                leads: String(t.leads),
              })),
            }}
          />
        )}
      </div>
    </>
  );
}
