'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/data/states';
import { OBJECTIVE_LABELS, RequestStatusBadge, REQUEST_STATUS_LABELS } from '@/components/data/status-badge';
import { useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type RequestRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  objective: string;
  budget: number | null;
  startDate: string;
  landingPageUrl: string;
  createdAt: string;
  accountName: string | null;
  createdBy: { name: string; email: string };
  assignedTo: { name: string; email: string } | null;
  _count: { adCopyVersions: number; landingScores: number };
};

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'DRAFT', label: 'Drafts' },
  { key: 'SUBMITTED', label: 'Pending approval' },
  { key: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { key: 'APPROVED,IN_PROGRESS,READY', label: 'Ads team queue' },
  { key: 'LIVE,COMPLETED', label: 'Live & done' },
  { key: 'REJECTED', label: 'Rejected' },
];

export default function AdRequestsPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const [status, setStatus] = useState('all');

  const qs = new URLSearchParams({ limit: '200' });
  if (status !== 'all') qs.set('status', status);

  const { data, isLoading, error, refetch } = useApi<{
    rows: RequestRow[];
    total: number;
    statusCounts: Record<string, number>;
    canSeeMoney: boolean;
  }>(['ad-requests', status], `/api/ad-requests?${qs.toString()}`);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const canSeeMoney = data?.canSeeMoney ?? false;

  const columns: Array<Column<RequestRow>> = [
    {
      key: 'title',
      header: 'Request',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {r.reference} · {r.accountName ?? 'No account'}
          </p>
        </div>
      ),
      sortValue: (r) => r.title,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <RequestStatusBadge status={r.status} />,
      sortValue: (r) => REQUEST_STATUS_LABELS[r.status] ?? r.status,
    },
    {
      key: 'objective',
      header: 'Objective',
      cell: (r) => (
        <span className="text-sm">{OBJECTIVE_LABELS[r.objective] ?? r.objective}</span>
      ),
      sortValue: (r) => r.objective,
      hideOnMobile: true,
    },
    ...(canSeeMoney
      ? [
          {
            key: 'budget',
            header: 'Budget',
            align: 'right' as const,
            cell: (r: RequestRow) => formatCurrency(r.budget),
            sortValue: (r: RequestRow) => r.budget,
          },
        ]
      : []),
    {
      key: 'owner',
      header: 'Raised by',
      cell: (r) => <span className="truncate text-sm">{r.createdBy.name}</span>,
      sortValue: (r) => r.createdBy.name,
      hideOnMobile: true,
    },
    {
      key: 'assignee',
      header: 'Owner',
      cell: (r) => (
        <span className="truncate text-sm">
          {r.assignedTo?.name ?? <span className="text-muted-foreground">Unassigned</span>}
        </span>
      ),
      sortValue: (r) => r.assignedTo?.name ?? null,
      hideOnMobile: true,
    },
    {
      key: 'createdAt',
      header: 'Raised',
      align: 'right',
      cell: (r) => <span className="text-sm">{formatDate(r.createdAt)}</span>,
      sortValue: (r) => r.createdAt,
    },
  ];

  return (
    <>
      <PageHeader
        title="Ad requests"
        description="Operations raises a request, a manager approves it, and the Google Ads team takes it live."
        actions={
          can('AD_REQUESTS', 'CREATE') && (
            <Button asChild size="sm">
              <Link href="/dashboard/ad-requests/new">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                New request
              </Link>
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-1.5 p-3">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                status === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              aria-pressed={status === f.key}
            >
              {f.label}
            </button>
          ))}
        </CardContent>
      </Card>

      {isLoading || !data ? (
        <TableSkeleton rows={8} columns={6} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={status === 'all' ? 'No ad requests yet' : 'Nothing in this state'}
          description={
            status === 'all'
              ? 'Raise the first one to start the approval workflow.'
              : 'Try a different filter.'
          }
          action={
            can('AD_REQUESTS', 'CREATE') && status === 'all' ? (
              <Button asChild size="sm">
                <Link href="/dashboard/ad-requests/new">New request</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          rows={data.rows}
          columns={columns}
          rowKey={(r) => r.id}
          searchable={(r) => `${r.title} ${r.reference} ${r.accountName ?? ''} ${r.createdBy.name}`}
          searchPlaceholder="Search by title, reference, account or owner…"
          onRowClick={(r) => router.push(`/dashboard/ad-requests/${r.id}`)}
          initialSort={{ key: 'createdAt', dir: 'desc' }}
          caption="Ad requests"
        />
      )}
    </>
  );
}
