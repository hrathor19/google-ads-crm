'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** The Ad Request lifecycle, rendered consistently wherever a status appears. */
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending approval',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  IN_PROGRESS: 'In progress',
  READY: 'Ready',
  LIVE: 'Live',
  COMPLETED: 'Completed',
};

const TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-transparent',
  SUBMITTED: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  CHANGES_REQUESTED: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  APPROVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  REJECTED: 'bg-destructive/10 text-destructive border-destructive/20',
  IN_PROGRESS: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20',
  READY: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20',
  LIVE: 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/25',
  COMPLETED: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20',
};

export function RequestStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium', TONE[status] ?? '')}>
      {REQUEST_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export const OBJECTIVE_LABELS: Record<string, string> = {
  LEAD_GENERATION: 'Lead generation',
  WEBSITE_TRAFFIC: 'Website traffic',
  BRAND_AWARENESS: 'Brand awareness',
  APP_PROMOTION: 'App promotion',
  SALES: 'Sales',
  LOCAL_VISITS: 'Local visits',
};
