'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApi } from '@/lib/hooks/use-api';
import { formatCurrency } from '@/lib/format';

/**
 * The one dialog every step of the approval flow uses.
 *
 * Which fields appear is derived from the step, not hardcoded per screen, so
 * the dialog and the server's state machine cannot drift: if a step requires
 * an Account Manager, the picker is here because the requirement is declared
 * there. Previously the buttons existed but the fields did not, so clicking
 * "Account Manager assigned" produced a 400 with nowhere to answer it.
 */

export type TransitionPayload = {
  reason?: string;
  accountManagerId?: string;
  adSpecialistId?: string;
  budget?: number;
  requiredCpl?: number;
  linkedCampaignId?: string;
};

/** What each step needs before the server will accept it. */
const STEP_CONFIG: Record<
  string,
  {
    title: string;
    description: string;
    /** Permission the assignee must hold, when this step picks a person. */
    assign?: { field: 'accountManagerId' | 'adSpecialistId'; permission: string; label: string };
    needsReason?: boolean;
    needsBudget?: boolean;
    needsCampaignId?: boolean;
    confirmLabel: string;
    destructive?: boolean;
    /** Shown above the buttons when the step is hard to undo. */
    confirmNote?: string;
  }
> = {
  AM_ASSIGNED: {
    title: 'Assign an Account Manager',
    description: 'They will own this account from here, and be notified that it is theirs.',
    assign: {
      field: 'accountManagerId',
      permission: 'AD_REQUESTS:VIEW',
      label: 'Account Manager',
    },
    confirmLabel: 'Assign',
  },
  ACCOUNT_ASSIGNED: {
    title: 'Hand the account to an Ad Specialist',
    description: 'They build the campaign and take it live.',
    assign: {
      field: 'adSpecialistId',
      permission: 'AD_REQUESTS:EDIT',
      label: 'Ad Specialist',
    },
    confirmLabel: 'Assign the account',
  },
  RECHECK_REQUESTED: {
    title: 'Send back for a recheck',
    description: 'The Ad Specialist sees exactly what you write here.',
    needsReason: true,
    confirmLabel: 'Request a recheck',
  },
  REJECTED: {
    title: 'Reject this request',
    description: 'The person who raised it sees exactly what you write here.',
    needsReason: true,
    confirmLabel: 'Reject',
    destructive: true,
  },
  BUDGET_APPROVED: {
    title: 'Apply the budget and CPL',
    description: 'This is the spend the campaign will run against.',
    needsBudget: true,
    confirmLabel: 'Approve the budget',
    confirmNote: 'Check both figures. The Ad Specialist builds against them.',
  },
  LIVE: {
    title: 'Mark the campaign live',
    description: 'Link the Google Ads campaign you created, so the two stay connected.',
    needsCampaignId: true,
    confirmLabel: 'Mark live',
  },
  REVIEW_APPROVED: {
    title: 'Approve the review',
    description: 'The keywords and ad copy are good to go. The request moves to the budget stage.',
    confirmLabel: 'Approve',
  },
  COMPLETED: {
    title: 'Complete the setup',
    description: 'Everything is live, tracked and monitored.',
    confirmLabel: 'Complete',
  },
};

/** Steps that open this dialog rather than firing straight away. */
export function stepNeedsDialog(target: string): boolean {
  const c = STEP_CONFIG[target];
  if (!c) return false;
  return Boolean(c.assign || c.needsReason || c.needsBudget || c.needsCampaignId || c.confirmNote);
}

export function TransitionDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (payload: TransitionPayload) => void;
}) {
  const config = target ? STEP_CONFIG[target] : undefined;

  const [reason, setReason] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [budget, setBudget] = useState('');
  const [cpl, setCpl] = useState('');
  const [campaignId, setCampaignId] = useState('');

  // Clear between openings, so yesterday's rejection reason cannot be sent
  // with today's approval.
  useEffect(() => {
    setReason('');
    setAssigneeId('');
    setBudget('');
    setCpl('');
    setCampaignId('');
  }, [target]);

  const { data: assignees, isLoading: loadingAssignees } = useApi<{
    users: Array<{ id: string; name: string; email: string; roleName: string }>;
  }>(
    ['assignees', config?.assign?.permission ?? 'none'],
    `/api/ad-requests/assignees?permission=${encodeURIComponent(config?.assign?.permission ?? '')}`,
    { enabled: Boolean(config?.assign) }
  );

  if (!target || !config) return null;

  const budgetNum = Number(budget);
  const cplNum = Number(cpl);
  const ready =
    (!config.assign || assigneeId !== '') &&
    (!config.needsReason || reason.trim().length > 0) &&
    (!config.needsBudget || (budgetNum > 0 && cplNum > 0)) &&
    (!config.needsCampaignId || campaignId.trim().length > 0);

  // How many leads the budget implies, as a sanity check on the pair.
  const impliedLeads = budgetNum > 0 && cplNum > 0 ? Math.floor(budgetNum / cplNum) : null;

  function confirm() {
    const payload: TransitionPayload = {};
    if (config!.needsReason) payload.reason = reason.trim();
    if (config!.assign) payload[config!.assign.field] = assigneeId;
    if (config!.needsBudget) {
      payload.budget = budgetNum;
      payload.requiredCpl = cplNum;
    }
    if (config!.needsCampaignId) payload.linkedCampaignId = campaignId.trim();
    onConfirm(payload);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {config.assign && (
            <div className="space-y-1.5">
              <Label htmlFor="assignee">
                {config.assign.label} <span className="text-destructive">*</span>
              </Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="assignee">
                  <SelectValue
                    placeholder={loadingAssignees ? 'Loading…' : `Choose an ${config.assign.label}`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(assignees?.users ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} — {u.roleName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loadingAssignees && (assignees?.users ?? []).length === 0 && (
                <p className="text-xs text-destructive">
                  Nobody holds {config.assign.permission}. Create a user with that permission
                  first.
                </p>
              )}
            </div>
          )}

          {config.needsReason && (
            <div className="space-y-1.5">
              <Label htmlFor="reason">
                Remarks <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reason"
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  target === 'REJECTED'
                    ? 'Why is this being rejected?'
                    : 'What needs correcting before this can be approved?'
                }
              />
            </div>
          )}

          {config.needsBudget && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="budget">
                  Assigned budget (₹) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="budget"
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="250000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cpl">
                  Required CPL (₹) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cpl"
                  inputMode="decimal"
                  value={cpl}
                  onChange={(e) => setCpl(e.target.value)}
                  placeholder="2500"
                />
              </div>
              {impliedLeads !== null && (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {formatCurrency(budgetNum)} at {formatCurrency(cplNum)} per lead implies about{' '}
                  <span className="font-medium tabular-nums">{impliedLeads}</span> leads.
                </p>
              )}
            </div>
          )}

          {config.needsCampaignId && (
            <div className="space-y-1.5">
              <Label htmlFor="campaignId">
                Google Ads campaign ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="campaignId"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                placeholder="e.g. 21345678901"
              />
            </div>
          )}

          {config.confirmNote && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {config.confirmNote}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={config.destructive ? 'destructive' : 'default'}
            disabled={busy || !ready}
            onClick={confirm}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {config.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
