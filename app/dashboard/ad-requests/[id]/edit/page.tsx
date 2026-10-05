'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/data/page-header';
import { AdRequestForm } from '@/components/data/ad-request-form';
import { toFormDefaults } from '@/lib/workflow/form-defaults';
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
      <div className="max-w-6xl">
        {isLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-96 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <AdRequestForm
            requestId={params.id}
            defaults={toFormDefaults(data.request)}
          />
        )}
      </div>
    </>
  );
}
