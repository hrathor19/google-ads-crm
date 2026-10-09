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
import { MultiSelect } from '@/components/data/multi-select';
import { cn } from '@/lib/utils';
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

/** Google refuses more than this on one request, and so does the API. */
const MAX_LINKED_CAMPAIGNS = 50;

export type TransitionPayload = {
  reason?: string;
  accountManagerId?: string;
  adSpecialistId?: string;
  accountId?: number;
  budget?: number;
  requiredCpl?: number;
  linkedCampaignId?: string;
  campaignIds?: number[];
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
    /**
     * Offer the Google Ads account.
     *
     * Only at launch. The Ops requirement form does not ask for one and the
     * Manager assigning the work does not know it yet — which account a
     * campaign ends up in is the Ad Specialist's decision, taken when they
     * build it. Asking at assignment made the Manager guess, and a guess
     * here points the Assigned campaigns page at the wrong account's
     * performance.
     */
    offersAccount?: boolean;
    needsBudget?: boolean;
    needsCampaignId?: boolean;
    confirmLabel: string;
    destructive?: boolean;
    /** Shown above the buttons when the step is hard to undo. */
    confirmNote?: string;
  }
> = {
  AM_ASSIGNED: {
    title: 'Assign the work',
    description:
      'Name the Ad Specialist and the money they build against. They receive all of ' +
      'it in one mail and start from there.',
    assign: {
      // BUILD, not VIEW or EDIT: those filled the list with managers and ops
      // staff, who can read or edit a brief but are not the people who build
      // campaigns. BUILD is exactly what the build steps require.
      field: 'adSpecialistId',
      permission: 'AD_REQUESTS:BUILD',
      label: 'Ad Specialist',
    },
    // Asked here rather than after the review: the Ad Specialist cannot
    // sensibly build without knowing the budget and the CPL they are
    // building to.
    needsBudget: true,
    confirmLabel: 'Assign',
    confirmNote: 'Check both figures. The Ad Specialist builds against them.',
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

  LIVE: {
    title: 'Mark the campaign live',
    description: 'Link the Google Ads campaign you created, so the two stay connected.',
    needsCampaignId: true,
    // The one place it is asked. By now the Ad Specialist has built the
    // campaign and knows which account it lives in, and the account is what
    // keeps the reporting working if the campaign is later rebuilt under a
    // new ID.
    offersAccount: true,
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
  return Boolean(
    c.assign ||
      c.offersAccount ||
      c.needsReason ||
      c.needsBudget ||
      c.needsCampaignId ||
      c.confirmNote
  );
}

export function TransitionDialog({
  target,
  busy,
  currentAccountId,
  linkedCampaignCount = 0,
  onCancel,
  onConfirm,
}: {
  target: string | null;
  busy: boolean;
  /** The account already on the request, so the picker opens on it. */
  currentAccountId?: number | null;
  /** Campaigns already linked. When there are any, launch needs no typed id. */
  linkedCampaignCount?: number;
  onCancel: () => void;
  onConfirm: (payload: TransitionPayload) => void;
}) {
  const config = target ? STEP_CONFIG[target] : undefined;

  const [reason, setReason] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [budget, setBudget] = useState('');
  const [cpl, setCpl] = useState('');
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [onlyEnabled, setOnlyEnabled] = useState(true);
  const [accountId, setAccountId] = useState('');

  // Clear between openings, so yesterday's rejection reason cannot be sent
  // with today's approval. The account is the exception: it reopens on
  // whatever the request already carries, because re-picking it on every
  // visit is how it gets changed by accident.
  useEffect(() => {
    setReason('');
    setAssigneeId('');
    setBudget('');
    setCpl('');
    setCampaignIds([]);
    setOnlyEnabled(true);
    setAccountId(currentAccountId != null ? String(currentAccountId) : '');
  }, [target, currentAccountId]);

  const { data: assignees, isLoading: loadingAssignees } = useApi<{
    users: Array<{ id: string; name: string; email: string; roleName: string }>;
  }>(
    ['assignees', config?.assign?.permission ?? 'none'],
    `/api/ad-requests/assignees?permission=${encodeURIComponent(config?.assign?.permission ?? '')}`,
    { enabled: Boolean(config?.assign) }
  );

  const { data: accounts, isLoading: loadingAccounts } = useApi<{
    accounts: Array<{ id: number; name: string | null; customerId: string }>;
  }>(['account-options'], '/api/accounts/options', {
    enabled: Boolean(config?.offersAccount),
    staleTime: 5 * 60_000,
  });

  // The campaigns in the chosen account. Fetched per account rather than
  // all at once: an MCC's full campaign list is thousands of rows, and the
  // only ones that can be linked are the ones in the account being launched
  // into.
  const { data: campaignData, isLoading: loadingCampaigns } = useApi<{
    campaigns: Array<{
      id: number;
      campaignId: string;
      name: string | null;
      status: string | null;
    }>;
  }>(['campaign-options', accountId], `/api/campaigns/options?accountId=${accountId}`, {
    enabled: Boolean(config?.needsCampaignId) && accountId !== '',
    staleTime: 5 * 60_000,
  });

  if (!target || !config) return null;

  const budgetNum = Number(budget);
  const cplNum = Number(cpl);
  // Campaigns picked from the list satisfy the launch requirement, so the
  // hand-typed id is only asked for when nothing is linked — it is the
  // fallback for a request that was mid-flight when picking replaced typing.
  const campaignIdRequired = Boolean(config.needsCampaignId) && linkedCampaignCount === 0;
  const ready =
    (!config.assign || assigneeId !== '') &&
    (!config.needsReason || reason.trim().length > 0) &&
    (!config.needsBudget || (budgetNum > 0 && cplNum > 0)) &&
    (!campaignIdRequired || campaignIds.length > 0);

  // A ticked campaign is always shown, whatever the filter says — hiding a
  // selection behind a filter is how one gets unticked without being seen.
  const campaignOptions = (campaignData?.campaigns ?? [])
    .filter(
      (c) => campaignIds.includes(String(c.id)) || !onlyEnabled || c.status === 'ENABLED'
    )
    .map((c) => ({
      value: String(c.id),
      label: c.name ?? c.campaignId,
      group: c.status ?? 'Unknown',
    }));

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
    if (config!.offersAccount && accountId) payload.accountId = Number(accountId);
    if (config!.needsCampaignId && campaignIds.length > 0) {
      payload.campaignIds = campaignIds.map(Number);
    }
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

          {config.offersAccount && (
            <div className="space-y-1.5">
              <Label htmlFor="account">Google Ads account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="account">
                  <SelectValue
                    placeholder={loadingAccounts ? 'Loading…' : 'Choose the account'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(accounts?.accounts ?? []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name ?? a.customerId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {config.needsCampaignId
                  ? 'Keeps the Assigned campaigns page reporting even if the campaign is later rebuilt under a new ID.'
                  : 'Optional, but until it is set the request has no performance to report on the Assigned campaigns page.'}
              </p>
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

          {config.needsCampaignId &&
            (linkedCampaignCount > 0 ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {linkedCampaignCount} campaign{linkedCampaignCount === 1 ? '' : 's'} linked
                </span>{' '}
                — performance for this request is already reading from them. Use
                &ldquo;Change campaigns&rdquo; if that is not the full set.
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="campaigns">
                    Campaigns <span className="text-destructive">*</span>
                  </Label>
                  {accountId !== '' && (
                    <button
                      type="button"
                      aria-pressed={onlyEnabled}
                      onClick={() => setOnlyEnabled((v) => !v)}
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                        onlyEnabled
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/70'
                      )}
                    >
                      Enabled only
                    </button>
                  )}
                </div>
                {/* Picked from the account, not typed. A campaign ID is an
                    eleven-digit number copied from another tab, and one
                    wrong digit silently pointed the request's reporting at
                    somebody else's campaign. */}
                <MultiSelect
                  id="campaigns"
                  options={campaignOptions}
                  selected={campaignIds}
                  onChange={setCampaignIds}
                  disabled={accountId === ''}
                  placeholder={
                    accountId === ''
                      ? 'Choose the account first'
                      : loadingCampaigns
                        ? 'Loading campaigns…'
                        : 'Pick the campaigns you built'
                  }
                  searchPlaceholder="Campaign name…"
                  emptyMessage={
                    loadingCampaigns
                      ? 'Loading…'
                      : onlyEnabled
                        ? 'No enabled campaigns in this account. Turn off "Enabled only" to see the rest.'
                        : 'No campaigns in this account yet.'
                  }
                  maxSelected={MAX_LINKED_CAMPAIGNS}
                />
                <p className="text-xs text-muted-foreground">
                  A client usually runs more than one — pick every campaign this request should
                  report on.
                </p>
              </div>
            ))}

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
