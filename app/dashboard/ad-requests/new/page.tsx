'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/data/page-header';
import { AdRequestForm } from '@/components/data/ad-request-form';
import { usePermissions } from '@/components/providers/permission-provider';
import { EmptyState } from '@/components/data/states';

export default function NewAdRequestPage() {
  const { can } = usePermissions();

  if (!can('AD_REQUESTS', 'CREATE')) {
    return (
      <EmptyState
        title="You cannot raise ad requests"
        description="Your role does not include the Ad Requests: Create permission. Ask a Super Admin if you need it."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="New ad request"
        description="Fill in the brief. Save it as a draft, or submit it straight to a manager for approval."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/ad-requests">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Back
            </Link>
          </Button>
        }
      />
      <div className="max-w-6xl">
        <AdRequestForm />
      </div>
    </>
  );
}
