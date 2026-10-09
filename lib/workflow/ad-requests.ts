import 'server-only';
import {
  AdRequestStatus,
  type AdRequestAgeRestriction,
  type AdRequestClientType,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { notify, usersWithPermission } from '@/lib/notifications';
import { mailForTransition } from '@/lib/email/workflow-mail';
import { ApiError, badRequest, conflict, forbidden, notFound } from '@/lib/api';
import type { Principal } from '@/lib/rbac/permissions';
import { canAccessAccount, hasPermission, actorLabel } from '@/lib/rbac/permissions';
import {
  SPECIALIST_QUEUE,
  STATUS_LABELS,
  SYSTEM_STEPS,
  evaluate,
  findTransition,
  nextStates,
} from './state-machine';
import { primaryLandingUrl } from './schemas';

/**
 * The Ad Request lifecycle.
 *
 * The state machine is the workflow: every transition is declared here with
 * the permission it needs and whether it requires a reason, and
 * `transition()` is the only way a request's status changes. Keeping it in one
 * table means a new status can't quietly acquire an unguarded path, and the
 * timeline, the notifications and the audit row are written on the same code
 * path as the status itself — so a status can never move without a trace.
 *
 * Draft → Submitted → (Approved | Rejected | Changes requested)
 * Approved → In progress → Ready → Live → Completed
 */

/**
 * The transition table now lives in `state-machine.ts`, which is pure and
 * tested directly. This module keeps the database side: locking, events,
 * audit and notifications.
 */
export { STATUS_LABELS, SPECIALIST_QUEUE, TRANSITIONS } from './state-machine';
export { evaluate, findTransition, nextStates } from './state-machine';

/** Kept for the Ads team queue page, which imported the old name. */
export const ADS_QUEUE_STATUSES = SPECIALIST_QUEUE;

/** Which statuses the actor can move this request to right now. */
export async function availableTransitions(
  principal: Principal,
  request: { status: AdRequestStatus; createdById: string }
): Promise<AdRequestStatus[]> {
  const out: AdRequestStatus[] = [];
  for (const target of nextStates(request.status)) {
    const rule = findTransition(request.status, target);
    if (!rule) continue;
    if (rule.ownerOnly && request.createdById !== principal.userId && !principal.isSuperAdmin) {
      continue;
    }
    if (rule.permission && !principal.isSuperAdmin && !(await hasPermission(principal, rule.permission))) {
      continue;
    }
    out.push(target);
  }
  return out;
}

/** `AR-0001`, allocated from the current row count under a serialisable retry. */
async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const last = await tx.crmAdRequest.findFirst({
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const n = last ? Number(last.reference.replace('AR-', '')) + 1 : 1;
  return `AR-${String(n).padStart(4, '0')}`;
}

/**
 * The brief as Ops fills it, mirroring the "Ads Campaign Activation
 * Requirement Format" sheet.
 *
 * `landingPageUrl` is not here: it is derived from whichever ads URL is
 * present, so the scorer and the ad-copy generator always have a page to work
 * from without asking for the same URL twice.
 */
export type CreateRequestInput = {
  trackingId: string | null;
  title: string;
  clientType: AdRequestClientType | null;
  accountId: number | null;
  objective?: Prisma.CrmAdRequestCreateInput['objective'];
  productService: string;

  budget: number | null;
  requiredCpl: number | null;
  requiredLeads: number | null;
  performanceParameter: string | null;
  targetApplication: number | null;
  targetAdmission: string | null;

  startDate: Date;
  endDate: Date | null;
  applicationDeadline: string | null;
  focusedMonths: string | null;

  targetAudience: string | null;
  ageRestriction: AdRequestAgeRestriction | null;
  location: string;
  blockedLocations: string | null;
  accountVisibility: string | null;
  reportingPanel: string | null;

  adUrlKapplpDesktop: string | null;
  adUrlKapplpMobile: string | null;
  adUrlKapplpBing: string | null;
  adUrlClientlpDesktop: string | null;
  adUrlClientlpMobile: string | null;
  adUrlClientlpBing: string | null;

  usps: string | null;
  keywords: string | null;
  notes: string | null;

  /** Month-by-month lead plan: `{ month: 'YYYY-MM', leads }`. */
  leadTargets?: Array<{ month: string; leads: number }>;
};

export async function createRequest(
  principal: Principal,
  input: CreateRequestInput,
  opts: { submit?: boolean; ip?: string | null } = {}
) {
  const request = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx);
    return tx.crmAdRequest.create({
      data: {
        reference,
        status: 'DRAFT',
        title: input.title,
        accountId: input.accountId,
        // Falls back to the column default when the form does not ask.
        ...(input.objective ? { objective: input.objective } : {}),
        productService: input.productService,
        targetAudience: input.targetAudience,
        location: input.location,
        budget: input.budget,
        startDate: input.startDate,
        endDate: input.endDate,
        // NOT NULL in the schema, and the refinement on the input guarantees
        // at least one ads URL, so this cannot fall back to ''.
        landingPageUrl: primaryLandingUrl(input) ?? '',
        usps: input.usps,
        keywords: input.keywords,
        notes: input.notes,

        trackingId: input.trackingId,
        clientType: input.clientType,
        ageRestriction: input.ageRestriction,
        requiredCpl: input.requiredCpl,
        requiredLeads: input.requiredLeads,
        performanceParameter: input.performanceParameter,
        targetApplication: input.targetApplication,
        targetAdmission: input.targetAdmission,
        applicationDeadline: input.applicationDeadline,
        focusedMonths: input.focusedMonths,
        blockedLocations: input.blockedLocations,
        accountVisibility: input.accountVisibility,
        reportingPanel: input.reportingPanel,
        adUrlKapplpDesktop: input.adUrlKapplpDesktop,
        adUrlKapplpMobile: input.adUrlKapplpMobile,
        adUrlKapplpBing: input.adUrlKapplpBing,
        adUrlClientlpDesktop: input.adUrlClientlpDesktop,
        adUrlClientlpMobile: input.adUrlClientlpMobile,
        adUrlClientlpBing: input.adUrlClientlpBing,
        leadTargets: input.leadTargets?.length
          ? {
              create: input.leadTargets.map((t) => ({
                month: new Date(`${t.month}-01T00:00:00.000Z`),
                leads: t.leads,
              })),
            }
          : undefined,

        createdById: principal.userId,
        events: {
          create: {
            type: 'CREATED',
            message: `${actorLabel(principal)} created this request.`,
            toStatus: 'DRAFT',
            actorId: principal.userId,
          },
        },
      },
    });
  });

  await logAudit({
    actorId: principal.userId,
    actorEmail: principal.email,
    action: 'REQUEST_CREATED',
    description: `Created ad request ${request.reference} — ${request.title}`,
    targetType: 'CrmAdRequest',
    targetId: request.id,
    ipAddress: opts.ip,
  });

  if (opts.submit) {
    return transition(principal, request.id, 'SUBMITTED', { ip: opts.ip });
  }
  return request;
}

/**
 * Move a request to `target`.
 *
 * Validates the transition, writes the timeline event, notifies whoever now
 * has to act, and records an audit row — all in one place so none of them can
 * be skipped by a new caller.
 */
export type TransitionOptions = {
  reason?: string | null;
  /** Step 3 and step 11: who owns this next. */
  accountManagerId?: string | null;
  adSpecialistId?: string | null;
  /** The Google Ads account handed over with them. */
  accountId?: number | null;
  /** Step 10. */
  budget?: number | null;
  requiredCpl?: number | null;
  /** Step 12. */
  linkedCampaignId?: string | null;
  /** Step 12, the current way: `campaigns.id` values to link on launch. */
  campaignIds?: number[] | null;
  /** The version the caller last saw. Omit to skip the concurrency check. */
  expectedVersion?: number | null;
  ip?: string | null;
};

/** The most campaigns one brief may claim. Beyond this it is not a brief. */
export const MAX_LINKED_CAMPAIGNS = 50;

export type RequestTargets = {
  /** The Google Ads account. Omit to leave it alone; `null` unlinks it. */
  accountId?: number | null;
  /** `campaigns.id` values, replacing whatever is linked. Omit to leave alone. */
  campaignIds?: number[];
};

/**
 * Point a request at the campaigns — and the account — it reports against.
 *
 * Ops' requirement form asks for neither: the Manager is the one who knows
 * where the work lands, and the brief editor closes the moment a request is
 * reviewed. Between those two facts a request past the handover could never
 * be measured at all. This is the way.
 *
 * Campaigns are a set, not a single value, because a client is rarely one
 * campaign — the same brief routinely runs three or four, and reporting only
 * the first would understate every one of them.
 *
 * It is deliberately not a transition: naming where the work lives is
 * bookkeeping, not a step anybody signs off, and it stays available at every
 * stage. It still takes the optimistic lock, writes a timeline event and an
 * audit row, because it changes which numbers the request is judged by.
 */
export async function setRequestTargets(
  principal: Principal,
  requestId: string,
  targets: RequestTargets,
  opts: { expectedVersion?: number | null; ip?: string | null } = {}
) {
  // ASSIGN, not EDIT: this is the same decision as choosing who the work goes
  // to, and Ops — who may edit a brief — deliberately does not hold it.
  if (!principal.isSuperAdmin && !(await hasPermission(principal, 'AD_REQUESTS:ASSIGN'))) {
    throw forbidden('Only a Manager can change the campaigns on a request.');
  }

  const request = await prisma.crmAdRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      reference: true,
      version: true,
      accountId: true,
      createdById: true,
      assignedToId: true,
      account: { select: { descriptive_name: true } },
      campaignLinks: { select: { campaignId: true } },
    },
  });
  if (!request) throw notFound('Ad request not found.');
  await assertVisible(principal, request);

  if (
    opts.expectedVersion !== undefined &&
    opts.expectedVersion !== null &&
    opts.expectedVersion !== request.version
  ) {
    throw conflict('Someone else changed this request while you were looking at it. Reload and try again.');
  }

  // ── The campaigns ─────────────────────────────────────────────────────────
  const before = new Set(request.campaignLinks.map((l) => l.campaignId));
  let after: Set<number> | null = null;
  let derivedAccountId: number | null = null;

  if (targets.campaignIds !== undefined) {
    const wanted = Array.from(new Set(targets.campaignIds));
    if (wanted.length > MAX_LINKED_CAMPAIGNS) {
      throw badRequest(`A request can link at most ${MAX_LINKED_CAMPAIGNS} campaigns.`);
    }

    const found = wanted.length
      ? await prisma.campaigns.findMany({
          where: { id: { in: wanted } },
          select: { id: true, account_id: true, name: true },
        })
      : [];
    if (found.length !== wanted.length) {
      throw badRequest('One of those campaigns no longer exists. Reload and pick again.');
    }
    // Scope is checked per campaign, through its account: picking a campaign
    // is picking a window onto that account's spend.
    for (const c of found) {
      if (!canAccessAccount(principal, c.account_id)) {
        throw forbidden('One of those campaigns belongs to an account outside your scope.');
      }
    }

    after = new Set(wanted);

    // When every campaign sits in one account and the request has none, the
    // account is not a second question worth asking.
    const accounts = new Set(found.map((c) => c.account_id));
    if (accounts.size === 1 && targets.accountId === undefined && request.accountId === null) {
      derivedAccountId = found[0]!.account_id;
    }
  }

  // ── The account ───────────────────────────────────────────────────────────
  const nextAccountId =
    targets.accountId !== undefined ? targets.accountId : derivedAccountId;
  let nextAccountName: string | null = null;

  if (nextAccountId !== null && nextAccountId !== undefined) {
    if (!canAccessAccount(principal, nextAccountId)) {
      throw forbidden('That account is not in your assigned scope.');
    }
    const account = await prisma.accounts.findUnique({
      where: { id: nextAccountId },
      select: { descriptive_name: true },
    });
    if (!account) throw badRequest('That Google Ads account no longer exists.');
    nextAccountName = account.descriptive_name;
  }

  const accountChanged =
    (targets.accountId !== undefined && targets.accountId !== request.accountId) ||
    (derivedAccountId !== null && derivedAccountId !== request.accountId);
  const added = after ? Array.from(after).filter((id) => !before.has(id)) : [];
  const removed = after ? Array.from(before).filter((id) => !after!.has(id)) : [];

  if (!accountChanged && added.length === 0 && removed.length === 0) {
    throw badRequest('Nothing to change — that is already what this request is linked to.');
  }

  const parts: string[] = [];
  if (added.length) parts.push(`linked ${added.length} campaign${added.length === 1 ? '' : 's'}`);
  if (removed.length) parts.push(`unlinked ${removed.length}`);
  if (accountChanged) {
    const previousName = request.account?.descriptive_name ?? null;
    parts.push(
      nextAccountId === null || nextAccountId === undefined
        ? `unlinked the account${previousName ? ` (${previousName})` : ''}`
        : `set the account to ${nextAccountName ?? nextAccountId}`
    );
  }
  const message = parts.join(', ').replace(/^./, (ch) => ch.toUpperCase());

  const updated = await prisma.$transaction(async (tx) => {
    const data: Prisma.CrmAdRequestUncheckedUpdateInput = { version: { increment: 1 } };
    if (accountChanged) data.accountId = nextAccountId ?? null;

    const count = await tx.crmAdRequest.updateMany({
      where: { id: requestId, version: request.version },
      data,
    });
    if (count.count === 0) {
      throw conflict('Someone else moved this request while you were acting on it. Reload and try again.');
    }

    if (after) {
      if (removed.length) {
        await tx.crmAdRequestCampaign.deleteMany({
          where: { requestId, campaignId: { in: removed } },
        });
      }
      if (added.length) {
        await tx.crmAdRequestCampaign.createMany({
          data: added.map((campaignId) => ({
            requestId,
            campaignId,
            linkedById: principal.userId,
          })),
          skipDuplicates: true,
        });
      }
    }

    await tx.crmAdRequestEvent.create({
      data: { requestId, type: 'CAMPAIGN_LINKED', message, actorId: principal.userId },
    });

    return tx.crmAdRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        id: true,
        reference: true,
        version: true,
        accountId: true,
        account: { select: { id: true, descriptive_name: true, customer_id: true } },
        campaignLinks: {
          select: {
            campaignId: true,
            campaign: {
              select: { id: true, campaign_id: true, name: true, status: true, account_id: true },
            },
          },
        },
      },
    });
  });

  await logAudit({
    actorId: principal.userId,
    actorEmail: principal.email,
    action: 'REQUEST_ACCOUNT_CHANGED',
    description: `${request.reference}: ${message}`,
    targetType: 'CrmAdRequest',
    targetId: requestId,
    metadata: {
      accountFrom: request.accountId,
      accountTo: accountChanged ? (nextAccountId ?? null) : request.accountId,
      campaignsAdded: added,
      campaignsRemoved: removed,
    },
    ipAddress: opts.ip ?? null,
  });

  return {
    id: updated.id,
    reference: updated.reference,
    version: updated.version,
    accountId: updated.accountId,
    accountName: updated.account?.descriptive_name ?? null,
    campaigns: updated.campaignLinks.map((l) => ({
      id: l.campaign.id,
      campaignId: String(l.campaign.campaign_id),
      name: l.campaign.name,
      status: l.campaign.status,
      accountId: l.campaign.account_id,
    })),
  };
}

/** Back-compat wrapper: the account-only route still speaks this shape. */
export async function setRequestAccount(
  principal: Principal,
  requestId: string,
  accountId: number | null,
  opts: { expectedVersion?: number | null; ip?: string | null } = {}
) {
  return setRequestTargets(principal, requestId, { accountId }, opts);
}

/**
 * Move a request one step, then follow any system step that comes after.
 *
 * Concurrency: the UPDATE matches on `version` as well as `id`, so two people
 * approving the same request at once cannot both succeed — the second finds
 * zero rows affected and is told the request moved on. Previously this read
 * the row, validated, then wrote, with nothing between the two.
 */
export async function transition(
  principal: Principal,
  requestId: string,
  target: AdRequestStatus,
  opts: TransitionOptions = {}
) {
  const request = await prisma.crmAdRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, reference: true, title: true, status: true, version: true,
      createdById: true, assignedToId: true, accountManagerId: true,
      adSpecialistId: true, budget: true, requiredCpl: true,
      linkedCampaignId: true, reviewRound: true,
      campaignLinks: { select: { campaignId: true } },
    },
  });
  if (!request) throw notFound('Ad request not found.');

  if (
    opts.expectedVersion !== undefined &&
    opts.expectedVersion !== null &&
    opts.expectedVersion !== request.version
  ) {
    throw conflict('Someone else changed this request while you were looking at it. Reload and try again.');
  }

  // What the request will look like once the payload is applied, so a
  // requirement can be satisfied by this very call.
  const provided = {
    reason: opts.reason ?? null,
    accountManagerId: opts.accountManagerId ?? request.accountManagerId,
    adSpecialistId: opts.adSpecialistId ?? request.adSpecialistId,
    budget: opts.budget ?? (request.budget != null ? Number(request.budget) : null),
    requiredCpl: opts.requiredCpl ?? (request.requiredCpl != null ? Number(request.requiredCpl) : null),
    linkedCampaignId: opts.linkedCampaignId ?? request.linkedCampaignId,
    // Counted after the payload, so "Mark live" can satisfy the requirement
    // with the campaigns it is linking in this very call.
    linkedCampaignCount: new Set([
      ...request.campaignLinks.map((l) => l.campaignId),
      ...(opts.campaignIds ?? []),
    ]).size,
  };

  // Scope every campaign the payload names, before it reaches a write.
  // Marking live needs AD_REQUESTS:BUILD, which an Ad Specialist holds for
  // their own accounts — without this, the same call would let them attach a
  // campaign from an account they cannot see and then read its spend.
  if (opts.campaignIds?.length) {
    const wanted = Array.from(new Set(opts.campaignIds));
    if (wanted.length > MAX_LINKED_CAMPAIGNS) {
      throw badRequest(`A request can link at most ${MAX_LINKED_CAMPAIGNS} campaigns.`);
    }
    const found = await prisma.campaigns.findMany({
      where: { id: { in: wanted } },
      select: { id: true, account_id: true },
    });
    if (found.length !== wanted.length) {
      throw badRequest('One of those campaigns no longer exists. Reload and pick again.');
    }
    for (const c of found) {
      if (!canAccessAccount(principal, c.account_id)) {
        throw forbidden('One of those campaigns belongs to an account outside your scope.');
      }
    }
  }

  const granted = new Map<string, boolean>();
  const rule = findTransition(request.status, target);
  if (rule?.permission) {
    granted.set(rule.permission, await hasPermission(principal, rule.permission));
  }

  const verdict = evaluate({
    from: request.status,
    to: target,
    isOwner: request.createdById === principal.userId,
    isSuperAdmin: principal.isSuperAdmin,
    hasPermission: (f) => granted.get(f) ?? false,
    provided,
  });

  if (!verdict.ok) {
    if (verdict.code === 'ILLEGAL') throw conflict(verdict.message);
    if (verdict.code === 'FORBIDDEN') throw forbidden(verdict.message);
    throw badRequest(verdict.message);
  }

  // Naming an account is how the request becomes measurable, so it is also a
  // way to point a request at an account the actor cannot see. Check both
  // that it exists and that it is theirs before it is written.
  if (opts.accountId != null) {
    if (!canAccessAccount(principal, opts.accountId)) {
      throw forbidden('That account is not in your assigned scope.');
    }
    const account = await prisma.accounts.findUnique({
      where: { id: opts.accountId },
      select: { id: true },
    });
    if (!account) throw badRequest('That Google Ads account no longer exists.');
  }

  const reason = (opts.reason ?? '').trim();
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const data: Prisma.CrmAdRequestUncheckedUpdateInput = {
      status: target,
      version: { increment: 1 },
    };
    if (reason) data.decisionReason = reason;
    if (target === 'SUBMITTED') {
      data.submittedAt = now;
      // A resubmission supersedes the previous decision; leaving the old
      // reason on screen would read as if it still applied.
      data.decisionReason = reason || null;
      data.decidedAt = null;
    }
    if (['REVIEW_APPROVED', 'REJECTED', 'RECHECK_REQUESTED'].includes(target)) data.decidedAt = now;
    if (target === 'COMPLETED') data.completedAt = now;

    if (opts.accountManagerId) {
      data.accountManagerId = opts.accountManagerId;
      data.assignedToId = opts.accountManagerId;
    }
    if (opts.adSpecialistId) {
      data.adSpecialistId = opts.adSpecialistId;
      data.assignedToId = opts.adSpecialistId;
    }
    if (opts.accountId != null) data.accountId = opts.accountId;
    if (opts.budget != null) data.budget = opts.budget;
    if (opts.requiredCpl != null) data.requiredCpl = opts.requiredCpl;
    if (opts.linkedCampaignId) data.linkedCampaignId = opts.linkedCampaignId;

    // A new review round opens each time the ads are submitted.
    if (target === 'ADS_SUBMITTED') data.reviewRound = { increment: 1 };

    // The lock: only update the row still at the version we validated.
    const count = await tx.crmAdRequest.updateMany({
      where: { id: requestId, version: request.version },
      data,
    });
    if (count.count === 0) {
      throw conflict('Someone else moved this request while you were acting on it. Reload and try again.');
    }

    // Linked inside the transition, not after it: the launch requirement was
    // validated against these campaigns, so a failure here has to take the
    // status change with it rather than leave a live request linked to
    // nothing.
    if (opts.campaignIds?.length) {
      await tx.crmAdRequestCampaign.createMany({
        data: Array.from(new Set(opts.campaignIds)).map((campaignId) => ({
          requestId,
          campaignId,
          linkedById: principal.userId,
        })),
        skipDuplicates: true,
      });
    }

    // Steps 7 and 9 close a review round, with its remarks and the draft it
    // applied to, so the history survives the next recheck.
    if (target === 'RECHECK_REQUESTED' || target === 'REVIEW_APPROVED') {
      await tx.crmAdRequestReview.upsert({
        where: { requestId_round: { requestId, round: Math.max(1, request.reviewRound) } },
        create: {
          requestId,
          round: Math.max(1, request.reviewRound),
          outcome: target === 'REVIEW_APPROVED' ? 'APPROVED' : 'RECHECK_REQUESTED',
          remarks: reason || null,
          reviewerId: principal.userId,
        },
        update: {
          outcome: target === 'REVIEW_APPROVED' ? 'APPROVED' : 'RECHECK_REQUESTED',
          remarks: reason || null,
          reviewerId: principal.userId,
        },
      });
    }

    await tx.crmAdRequestEvent.create({
      data: {
        requestId,
        type:
          target === 'SUBMITTED'
            ? request.status === 'DRAFT'
              ? 'SUBMITTED'
              : 'RESUBMITTED'
            : target === 'REVIEW_APPROVED'
              ? 'APPROVED'
              : target === 'REJECTED'
                ? 'REJECTED'
                : target === 'RECHECK_REQUESTED'
                  ? 'CHANGES_REQUESTED'
                  : 'STATUS_CHANGED',
        message: reason
          ? `${actorLabel(principal)} ${rule!.label}: ${reason}`
          : `${actorLabel(principal)} ${rule!.label}.`,
        fromStatus: request.status,
        toStatus: target,
        actorId: principal.userId,
      },
    });

    // Steps 2, 4 and 6: the mail going out is what advances these, so they
    // follow in the same transaction rather than waiting for a click.
    const auto = rule!.autoAdvanceTo;
    if (auto) {
      await tx.crmAdRequest.updateMany({
        where: { id: requestId },
        data: { status: auto, version: { increment: 1 } },
      });
      await tx.crmAdRequestEvent.create({
        data: {
          requestId,
          type: 'STATUS_CHANGED',
          message: `The system ${SYSTEM_STEPS[auto]?.label ?? 'advanced the request'}.`,
          fromStatus: target,
          toStatus: auto,
          actorId: null,
        },
      });
    }

    return tx.crmAdRequest.findUniqueOrThrow({ where: { id: requestId } });
  });

  await notifyForTransition(principal, request, target, reason);

  // Mailed after the commit, deliberately. The transition is done; the mail provider
  // being slow or down must not roll it back, and `mailForTransition`
  // swallows its own failures for the same reason. The review round is
  // passed so three rechecks send three mails rather than one.
  await mailForTransition({
    requestId,
    target,
    actorEmail: principal.email,
    reason,
    round: request.reviewRound,
  });

  const auditAction =
    target === 'SUBMITTED'
      ? 'REQUEST_SUBMITTED'
      : target === 'REVIEW_APPROVED'
        ? 'REQUEST_APPROVED'
        : target === 'REJECTED'
          ? 'REQUEST_REJECTED'
          : target === 'RECHECK_REQUESTED'
            ? 'REQUEST_CHANGES_REQUESTED'
            : 'REQUEST_STATUS_CHANGED';

  await logAudit({
    actorId: principal.userId,
    actorEmail: principal.email,
    action: auditAction,
    description: `${request.reference} — ${actorLabel(principal)} ${rule!.label}${reason ? `: ${reason}` : ''}`,
    targetType: 'CrmAdRequest',
    targetId: requestId,
    metadata: {
      from: request.status,
      to: target,
      autoAdvancedTo: rule!.autoAdvanceTo ?? null,
      round: request.reviewRound,
    },
    ipAddress: opts.ip,
  });

  return updated;
}

async function notifyForTransition(
  principal: Principal,
  request: { id: string; reference: string; title: string; createdById: string; assignedToId: string | null },
  target: AdRequestStatus,
  reason: string
): Promise<void> {
  const link = `/dashboard/ad-requests/${request.id}`;
  const heading = `${request.reference} — ${request.title}`;

  if (target === 'SUBMITTED') {
    // Everyone who can approve, resolved from the matrix rather than a
    // hardcoded role name, so a custom reviewer role works without a change here.
    const approvers = await usersWithPermission('AD_REQUESTS:APPROVE');
    await notify({
      userIds: approvers.filter((id) => id !== principal.userId),
      type: 'REQUEST_SUBMITTED',
      title: 'Ad request awaiting approval',
      body: heading,
      link,
      requestId: request.id,
    });
    return;
  }

  if (target === 'APPROVED') {
    const adsTeam = await usersWithPermission('AD_COPY:GENERATE_AI');
    await notify({
      userIds: [request.createdById],
      type: 'REQUEST_APPROVED',
      title: 'Your ad request was approved',
      body: heading,
      link,
      requestId: request.id,
    });
    await notify({
      userIds: adsTeam.filter((id) => id !== principal.userId),
      type: 'REQUEST_ASSIGNED',
      title: 'New approved request in the queue',
      body: heading,
      link,
      requestId: request.id,
    });
    return;
  }

  if (target === 'REJECTED' || target === 'CHANGES_REQUESTED') {
    await notify({
      userIds: [request.createdById],
      type: target === 'REJECTED' ? 'REQUEST_REJECTED' : 'REQUEST_CHANGES_REQUESTED',
      title: target === 'REJECTED' ? 'Your ad request was rejected' : 'Changes requested',
      body: `${heading}${reason ? ` — ${reason}` : ''}`,
      link,
      requestId: request.id,
    });
    return;
  }

  await notify({
    userIds: [request.createdById, request.assignedToId].filter(
      (id): id is string => Boolean(id) && id !== principal.userId
    ),
    type: 'REQUEST_STATUS_CHANGED',
    title: `Request is now ${STATUS_LABELS[target].toLowerCase()}`,
    body: heading,
    link,
    requestId: request.id,
  });
}

/** Add a comment to the timeline. */
export async function addComment(
  principal: Principal,
  requestId: string,
  message: string
) {
  const text = message.trim();
  if (!text) throw badRequest('A comment cannot be empty.');

  const request = await prisma.crmAdRequest.findUnique({
    where: { id: requestId },
    select: { id: true, reference: true, title: true, createdById: true, assignedToId: true },
  });
  if (!request) throw notFound('Ad request not found.');

  const event = await prisma.crmAdRequestEvent.create({
    data: { requestId, type: 'COMMENT', message: text, actorId: principal.userId },
  });

  await notify({
    userIds: [request.createdById, request.assignedToId].filter(
      (id): id is string => Boolean(id) && id !== principal.userId
    ),
    type: 'REQUEST_COMMENTED',
    title: `New comment on ${request.reference}`,
    body: text.slice(0, 160),
    link: `/dashboard/ad-requests/${request.id}`,
    requestId: request.id,
  });

  return event;
}

/**
 * A `where` clause that hides requests the principal has no business seeing.
 *
 * Account scoping applies here too: a user restricted to two accounts should
 * not read the brief, budget or landing page of a request raised for a third.
 * Requests with no account attached stay visible to their own author and to
 * anyone who can approve, since there is no account to scope them by.
 */
export async function visibilityWhere(
  principal: Principal
): Promise<Prisma.CrmAdRequestWhereInput> {
  if (principal.isSuperAdmin || principal.allowedAccountIds === null) return {};
  return {
    OR: [
      { accountId: { in: principal.allowedAccountIds } },
      { accountId: null },
      { createdById: principal.userId },
      { assignedToId: principal.userId },
    ],
  };
}

/** Throw unless the principal may read this request. */
export async function assertVisible(
  principal: Principal,
  request: { accountId: number | null; createdById: string; assignedToId: string | null }
): Promise<void> {
  if (principal.isSuperAdmin || principal.allowedAccountIds === null) return;
  const own =
    request.createdById === principal.userId || request.assignedToId === principal.userId;
  if (own || request.accountId === null) return;
  if (!principal.allowedAccountIds.includes(request.accountId)) {
    throw new ApiError(403, 'That request belongs to an account outside your scope.');
  }
}
