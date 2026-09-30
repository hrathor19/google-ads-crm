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
    landingPageUrl: string;
    usps: string | null;
    keywords: string | null;
    notes: string | null;
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
              budget: data.request.budget ?? 0,
              startDate: data.request.startDate.slice(0, 10),
              endDate: data.request.endDate?.slice(0, 10) ?? '',
              landingPageUrl: data.request.landingPageUrl,
              usps: data.request.usps ?? '',
              keywords: data.request.keywords ?? '',
              notes: data.request.notes ?? '',
            }}
          />
        )}
      </div>
    </>
  );
}
