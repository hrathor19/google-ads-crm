'use client';

import { useState } from 'react';
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
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { ErrorState, TableSkeleton } from '@/components/data/states';
import { useApi } from '@/lib/hooks/use-api';
import { formatDateTime } from '@/lib/format';

type AuditRow = {
  id: string;
  action: string;
  description: string;
  actorEmail: string | null;
  targetType: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
};

/** Group the action enum so the filter is a short list rather than 26 options. */
const ACTION_GROUPS: Record<string, string[]> = {
  'Sign-in': ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET'],
  Users: ['USER_CREATED', 'USER_UPDATED', 'USER_ACTIVATED', 'USER_DEACTIVATED'],
  'Roles & permissions': [
    'ROLE_CREATED',
    'ROLE_UPDATED',
    'ROLE_CLONED',
    'ROLE_DELETED',
    'PERMISSION_CHANGED',
    'ACCOUNT_SCOPE_CHANGED',
  ],
  'Ad requests': [
    'REQUEST_CREATED',
    'REQUEST_SUBMITTED',
    'REQUEST_APPROVED',
    'REQUEST_REJECTED',
    'REQUEST_CHANGES_REQUESTED',
    'REQUEST_STATUS_CHANGED',
  ],
  AI: ['AI_COPY_GENERATED', 'LANDING_PAGE_SCORED'],
  System: ['DATA_EXPORTED', 'SYNC_TRIGGERED', 'INTEGRATION_TESTED'],
};

const ACTION_TONE: Record<string, string> = {
  REQUEST_APPROVED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  REQUEST_REJECTED: 'border-destructive/30 bg-destructive/10 text-destructive',
  PERMISSION_CHANGED: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  USER_DEACTIVATED: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  LOGIN_FAILED: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export default function AuditPage() {
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');

  const qs = new URLSearchParams({ limit: '200' });
  if (group !== 'all') qs.set('action', (ACTION_GROUPS[group] ?? []).join(','));
  if (search) qs.set('search', search);

  const { data, isLoading, error, refetch } = useApi<{ rows: AuditRow[]; total: number }>(
    ['audit', group, search],
    `/api/admin/audit?${qs.toString()}`
  );

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const columns: Array<Column<AuditRow>> = [
    {
      key: 'createdAt',
      header: 'When',
      cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt)}</span>,
      sortValue: (r) => r.createdAt,
    },
    {
      key: 'actor',
      header: 'Who',
      cell: (r) => (
        <span className="text-sm">
          {r.actor?.name ?? r.actorEmail ?? <span className="text-muted-foreground">System</span>}
        </span>
      ),
      sortValue: (r) => r.actor?.name ?? r.actorEmail,
    },
    {
      key: 'action',
      header: 'Action',
      cell: (r) => (
        <Badge variant="outline" className={`font-normal ${ACTION_TONE[r.action] ?? ''}`}>
          {r.action.replace(/_/g, ' ').toLowerCase()}
        </Badge>
      ),
      sortValue: (r) => r.action,
    },
    {
      key: 'description',
      header: 'What happened',
      cell: (r) => <span className="text-sm">{r.description}</span>,
      sortValue: (r) => r.description,
    },
    {
      key: 'ip',
      header: 'IP',
      align: 'right',
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.ipAddress ?? '—'}</span>
      ),
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in, approval, role change, permission toggle, AI generation and export."
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="group" className="text-xs">
              Category
            </Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger id="group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All activity</SelectItem>
                {Object.keys(ACTION_GROUPS).map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="search" className="text-xs">
              Search descriptions
            </Label>
            <Input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. approved, GEMINI, AR-0003"
            />
          </div>
        </CardContent>
      </Card>

      {isLoading || !data ? (
        <TableSkeleton rows={12} columns={5} />
      ) : (
        <DataTable
          rows={data.rows}
          columns={columns}
          rowKey={(r) => r.id}
          initialSort={{ key: 'createdAt', dir: 'desc' }}
          caption="Audit trail"
          emptyMessage="Nothing matches this filter."
        />
      )}
    </>
  );
}
