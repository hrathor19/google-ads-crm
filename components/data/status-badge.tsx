'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** The Ad Request lifecycle, rendered consistently wherever a status appears. */
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  AWAITING_AM_ASSIGNMENT: 'Awaiting assignment',
  AM_ASSIGNED: 'Assigned, with budget',
  AWAITING_AD_SUBMISSION: 'Awaiting ad submission',
  ADS_SUBMITTED: 'Ads submitted',
  UNDER_REVIEW: 'Under review',
  RECHECK_REQUESTED: 'Recheck requested',
  REVIEW_APPROVED: 'Review approved',
  BUDGET_APPROVED: 'Budget approved',
  ACCOUNT_ASSIGNED: 'Account assigned',
  LIVE: 'Live',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  // Retired, shown only if an old row survived the migration.
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In progress',
  READY: 'Ready',
};

/**
 * What a button *does*, as opposed to the state it lands in.
 *
 * "Assign an Account Manager" is an instruction; "Account Manager assigned"
 * is a status, and reads as though it has already happened.
 */
export const REQUEST_ACTION_LABELS: Record<string, string> = {
  SUBMITTED: 'Submit',
  AM_ASSIGNED: 'Assign with budget and CPL',
  ADS_SUBMITTED: 'Submit keywords and ad copy',
  RECHECK_REQUESTED: 'Request a recheck',
  REVIEW_APPROVED: 'Approve the review',
  // Retired steps. Nothing moves to them any more; the labels remain for
  // requests that were already in one when the flow changed.
  BUDGET_APPROVED: 'Apply budget and CPL',
  ACCOUNT_ASSIGNED: 'Hand over the full account',
  LIVE: 'Mark live',
  COMPLETED: 'Complete',
  REJECTED: 'Reject',
};

const TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-transparent',
  SUBMITTED: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  AWAITING_AM_ASSIGNMENT: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  AM_ASSIGNED: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  AWAITING_AD_SUBMISSION: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20',
  ADS_SUBMITTED: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20',
  UNDER_REVIEW: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  RECHECK_REQUESTED: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  REVIEW_APPROVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  BUDGET_APPROVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  ACCOUNT_ASSIGNED: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20',
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
