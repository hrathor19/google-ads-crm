import type { AdRequestStatus } from '@prisma/client';

/**
 * The Ad Setup & Approval flow as an explicit state machine.
 *
 * Pure: no database, no session, no I/O. Everything here can be exercised
 * directly in a unit test, including every illegal move, which is the point —
 * a transition table hidden inside a service method only gets tested through
 * whatever path happens to reach it.
 *
 * Numbers in the comments are the steps on the flow diagram.
 */

export type Actor = 'OPS' | 'MANAGER' | 'ACCOUNT_MANAGER' | 'AD_SPECIALIST' | 'SYSTEM';

/** What a transition needs before it is allowed to happen. */
export type Requirement =
  | 'REASON'
  | 'ACCOUNT_MANAGER'
  | 'AD_SPECIALIST'
  | 'BUDGET_AND_CPL'
  | 'CAMPAIGN_ID';

export type Transition = {
  from: AdRequestStatus[];
  to: AdRequestStatus;
  /** Which hat the person is wearing. Documentation, and the UI groups by it. */
  actor: Actor;
  /** `MODULE:ACTION` the actor must hold. Null for a system step. */
  permission: string | null;
  /** Only the person who raised the request may do this. */
  ownerOnly?: boolean;
  requires?: Requirement[];
  /** Past tense, for the timeline: "Ops submitted the requirement". */
  label: string;
  /**
   * A system step that follows immediately, with no human action — the mail
   * going out is what advances it. Steps 2, 4 and 6 on the diagram.
   */
  autoAdvanceTo?: AdRequestStatus;
};

/**
 * Every legal move, in flow order.
 *
 * A list rather than a map keyed by target, because the same target is
 * reachable from different places by different people: ADS_SUBMITTED is both
 * the first submission and every resubmission in the recheck loop.
 */
export const TRANSITIONS: Transition[] = [
  // 1 → 2. Ops submits; the summary mail advances it to awaiting assignment.
  {
    from: ['DRAFT', 'REJECTED'],
    to: 'SUBMITTED',
    actor: 'OPS',
    permission: 'AD_REQUESTS:CREATE',
    ownerOnly: true,
    label: 'submitted the requirement',
    autoAdvanceTo: 'AWAITING_AM_ASSIGNMENT',
  },

  // 3 → 4. A Manager hands the account to an Ad Specialist, who builds the
  // campaign and submits keywords and copy back for approval. Not Ops: the
  // person who raised the requirement does not also choose who staffs it.
  //
  // The state is still called AM_ASSIGNED because renaming an enum value
  // Postgres has in use costs a migration for no behavioural gain; the label
  // below and the UI both say Ad Specialist.
  {
    from: ['AWAITING_AM_ASSIGNMENT'],
    to: 'AM_ASSIGNED',
    actor: 'MANAGER',
    permission: 'AD_REQUESTS:ASSIGN',
    requires: ['AD_SPECIALIST'],
    label: 'assigned the Ad Specialist',
    autoAdvanceTo: 'AWAITING_AD_SUBMISSION',
  },

  // 5 → 6. The Ad Specialist submits keywords and copy; the review mail
  // advances it. Also the return leg of the recheck loop (step 8).
  {
    from: ['AWAITING_AD_SUBMISSION', 'RECHECK_REQUESTED'],
    to: 'ADS_SUBMITTED',
    actor: 'AD_SPECIALIST',
    permission: 'AD_REQUESTS:BUILD',
    label: 'submitted keywords and ad copy',
    autoAdvanceTo: 'UNDER_REVIEW',
  },

  // 7. Ops asks for a recheck. Unlimited rounds; each one is recorded.
  {
    from: ['UNDER_REVIEW'],
    to: 'RECHECK_REQUESTED',
    actor: 'OPS',
    permission: 'AD_REQUESTS:APPROVE',
    requires: ['REASON'],
    label: 'asked for a recheck',
  },

  // 9. Ops approves the review.
  {
    from: ['UNDER_REVIEW'],
    to: 'REVIEW_APPROVED',
    actor: 'OPS',
    permission: 'AD_REQUESTS:APPROVE',
    label: 'approved the review',
  },

  // 10. The Manager applies the budget and CPL. Its own permission, not
  // APPROVE: Ops signs off the keywords and copy at step 9, and that is a
  // different decision from committing the spend.
  {
    from: ['REVIEW_APPROVED'],
    to: 'BUDGET_APPROVED',
    actor: 'MANAGER',
    permission: 'AD_REQUESTS:BUDGET',
    requires: ['BUDGET_AND_CPL'],
    label: 'applied the budget and CPL',
  },

  // 11. A Manager hands the account to an Ad Specialist in full.
  {
    from: ['BUDGET_APPROVED'],
    to: 'ACCOUNT_ASSIGNED',
    actor: 'MANAGER',
    permission: 'AD_REQUESTS:ASSIGN',
    requires: ['AD_SPECIALIST'],
    label: 'assigned the account to the Ad Specialist',
  },

  // 12. The Ad Specialist launches on the ad platform.
  {
    from: ['ACCOUNT_ASSIGNED'],
    to: 'LIVE',
    actor: 'AD_SPECIALIST',
    permission: 'AD_REQUESTS:BUILD',
    requires: ['CAMPAIGN_ID'],
    label: 'launched the campaign',
  },

  // 13. Monitoring is in place and the setup is finished.
  {
    from: ['LIVE'],
    to: 'COMPLETED',
    actor: 'AD_SPECIALIST',
    permission: 'AD_REQUESTS:BUILD',
    label: 'completed the setup',
  },

  // Off-ramp. Not on the diagram, but a requirement that should never have
  // been raised has to be stoppable without inventing a recheck round.
  {
    from: ['SUBMITTED', 'AWAITING_AM_ASSIGNMENT', 'UNDER_REVIEW'],
    to: 'REJECTED',
    actor: 'OPS',
    permission: 'AD_REQUESTS:APPROVE',
    requires: ['REASON'],
    label: 'rejected the request',
  },
];

/** The system steps, which advance on their own once the mail is away. */
export const SYSTEM_STEPS: Record<string, { label: string }> = {
  AWAITING_AM_ASSIGNMENT: { label: 'sent the summary and quality report' },
  AWAITING_AD_SUBMISSION: { label: 'notified the Ad Specialist' },
  UNDER_REVIEW: { label: 'sent the review request' },
};

export const STATUS_LABELS: Record<AdRequestStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  AWAITING_AM_ASSIGNMENT: 'Awaiting assignment',
  AM_ASSIGNED: 'Ad Specialist assigned',
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
  CHANGES_REQUESTED: 'Changes requested (retired)',
  APPROVED: 'Approved (retired)',
  IN_PROGRESS: 'In progress (retired)',
  READY: 'Ready (retired)',
};

/** Step number on the diagram, for the timeline. */
export const STATUS_STEP: Partial<Record<AdRequestStatus, number>> = {
  SUBMITTED: 1,
  AWAITING_AM_ASSIGNMENT: 2,
  AM_ASSIGNED: 3,
  AWAITING_AD_SUBMISSION: 4,
  ADS_SUBMITTED: 5,
  UNDER_REVIEW: 6,
  RECHECK_REQUESTED: 7,
  REVIEW_APPROVED: 9,
  BUDGET_APPROVED: 10,
  ACCOUNT_ASSIGNED: 11,
  LIVE: 12,
  COMPLETED: 13,
};

/** Statuses the Ad Specialist's queue is built from. */
export const SPECIALIST_QUEUE: AdRequestStatus[] = [
  'AWAITING_AD_SUBMISSION',
  'RECHECK_REQUESTED',
  'ACCOUNT_ASSIGNED',
  'LIVE',
];

/**
 * States a request only passes through.
 *
 * Nothing *declares* a move out of SUBMITTED, AM_ASSIGNED or ADS_SUBMITTED —
 * the system advances past them the moment the mail is away, inside the same
 * transaction. They are the three "System" boxes on the diagram, and treating
 * them as dead ends would be wrong in exactly the way that matters: a stalled
 * request would look finished.
 */
export const TRANSIENT_STATES: AdRequestStatus[] = TRANSITIONS.filter(
  (t) => t.autoAdvanceTo
).map((t) => t.to);

export function isTransient(status: AdRequestStatus): boolean {
  return TRANSIENT_STATES.includes(status);
}

/** A terminal state: nothing moves out of it, and nothing moves it on. */
export function isTerminal(status: AdRequestStatus): boolean {
  if (isTransient(status)) return false;
  return !TRANSITIONS.some((t) => t.from.includes(status));
}

/** The rule for moving `from` → `to`, or null when there is no such move. */
export function findTransition(
  from: AdRequestStatus,
  to: AdRequestStatus
): Transition | null {
  return TRANSITIONS.find((t) => t.to === to && t.from.includes(from)) ?? null;
}

/** Every state reachable from here, ignoring who is asking. */
export function nextStates(from: AdRequestStatus): AdRequestStatus[] {
  return TRANSITIONS.filter((t) => t.from.includes(from)).map((t) => t.to);
}

export type Denial =
  | { ok: true; transition: Transition }
  | { ok: false; code: 'ILLEGAL'; message: string }
  | { ok: false; code: 'FORBIDDEN'; message: string }
  | { ok: false; code: 'MISSING'; message: string; requirement: Requirement };

/**
 * Decide whether a move is allowed, and say precisely why not when it is not.
 *
 * A typed refusal rather than a boolean: the caller turns `ILLEGAL` into a
 * 409 and `FORBIDDEN` into a 403, and the message is what the user reads.
 */
export function evaluate(params: {
  from: AdRequestStatus;
  to: AdRequestStatus;
  isOwner: boolean;
  isSuperAdmin: boolean;
  hasPermission: (feature: string) => boolean;
  /** What the request will look like after the caller's payload is applied. */
  provided: {
    reason?: string | null;
    accountManagerId?: string | null;
    adSpecialistId?: string | null;
    budget?: number | null;
    requiredCpl?: number | null;
    linkedCampaignId?: string | null;
    /** Campaigns linked through the relation, once the payload is applied. */
    linkedCampaignCount?: number;
  };
}): Denial {
  const rule = findTransition(params.from, params.to);
  if (!rule) {
    return {
      ok: false,
      code: 'ILLEGAL',
      message: `A request that is "${STATUS_LABELS[params.from]}" cannot move to "${
        STATUS_LABELS[params.to]
      }".`,
    };
  }

  if (rule.ownerOnly && !params.isOwner && !params.isSuperAdmin) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Only the person who raised this request can do that.',
    };
  }

  if (rule.permission && !params.isSuperAdmin && !params.hasPermission(rule.permission)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `Requires the "${rule.permission}" permission.`,
    };
  }

  for (const requirement of rule.requires ?? []) {
    const missing = missingRequirement(requirement, params.provided);
    if (missing) return { ok: false, code: 'MISSING', message: missing, requirement };
  }

  return { ok: true, transition: rule };
}

function missingRequirement(
  requirement: Requirement,
  provided: Parameters<typeof evaluate>[0]['provided']
): string | null {
  switch (requirement) {
    case 'REASON':
      return (provided.reason ?? '').trim()
        ? null
        : 'Say what needs changing — the other side has to know what to fix.';
    case 'ACCOUNT_MANAGER':
      return provided.accountManagerId ? null : 'Choose an Account Manager.';
    case 'AD_SPECIALIST':
      return provided.adSpecialistId ? null : 'Choose an Ad Specialist.';
    case 'BUDGET_AND_CPL':
      if (provided.budget == null || provided.budget <= 0) return 'Set a budget above zero.';
      if (provided.requiredCpl == null || provided.requiredCpl <= 0) return 'Set the required CPL.';
      return null;
    case 'CAMPAIGN_ID':
      // Either way of linking satisfies this. The relation is how campaigns
      // are picked now; the hand-typed id is still accepted so a request
      // mid-flight when that changed is not stranded.
      if ((provided.linkedCampaignCount ?? 0) > 0) return null;
      return (provided.linkedCampaignId ?? '').trim()
        ? null
        : 'Link at least one Google Ads campaign before marking it live.';
    default:
      return null;
  }
}
