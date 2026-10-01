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
import { ApiError, badRequest, conflict, forbidden, notFound } from '@/lib/api';
import type { Principal } from '@/lib/rbac/permissions';
import { hasPermission } from '@/lib/rbac/permissions';
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

type TransitionRule = {
  from: AdRequestStatus[];
  /** `MODULE:ACTION` the actor must hold. */
  permission: string;
  /** A rejection or a change request is meaningless without one. */
  requiresReason?: boolean;
  /** Only the request's owner (or someone who can approve) may do this. */
  ownerOnly?: boolean;
  label: string;
};

export const TRANSITIONS: Record<AdRequestStatus, TransitionRule | null> = {
  DRAFT: null, // the creation state; reached only by createRequest
  SUBMITTED: {
    from: ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'],
    permission: 'AD_REQUESTS:CREATE',
    ownerOnly: true,
    label: 'submitted for approval',
  },
  APPROVED: {
    from: ['SUBMITTED'],
    permission: 'AD_REQUESTS:APPROVE',
    label: 'approved',
  },
  REJECTED: {
    from: ['SUBMITTED'],
    permission: 'AD_REQUESTS:APPROVE',
    requiresReason: true,
    label: 'rejected',
  },
  CHANGES_REQUESTED: {
    from: ['SUBMITTED'],
    permission: 'AD_REQUESTS:APPROVE',
    requiresReason: true,
    label: 'sent back for changes',
  },
  IN_PROGRESS: {
    from: ['APPROVED'],
    permission: 'AD_REQUESTS:EDIT',
    label: 'picked up by the Google Ads team',
  },
  READY: {
    from: ['IN_PROGRESS'],
    permission: 'AD_REQUESTS:EDIT',
    label: 'marked ready',
  },
  LIVE: {
    from: ['READY', 'IN_PROGRESS'],
    permission: 'AD_REQUESTS:EDIT',
    label: 'marked live',
  },
  COMPLETED: {
    from: ['LIVE'],
    permission: 'AD_REQUESTS:EDIT',
    label: 'completed',
  },
};

/** Statuses the Ads team's queue is built from. */
export const ADS_QUEUE_STATUSES: AdRequestStatus[] = [
  'APPROVED',
  'IN_PROGRESS',
  'READY',
  'LIVE',
];

export const STATUS_LABELS: Record<AdRequestStatus, string> = {
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

/** Which statuses the actor can move this request to right now. */
export async function availableTransitions(
  principal: Principal,
  request: { status: AdRequestStatus; createdById: string }
): Promise<AdRequestStatus[]> {
  const out: AdRequestStatus[] = [];
  for (const [target, rule] of Object.entries(TRANSITIONS) as Array<
    [AdRequestStatus, TransitionRule | null]
  >) {
    if (!rule) continue;
    if (!rule.from.includes(request.status)) continue;
    if (rule.ownerOnly && request.createdById !== principal.userId && !principal.isSuperAdmin) {
      continue;
    }
    if (!(await hasPermission(principal, rule.permission))) continue;
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
  objective: Prisma.CrmAdRequestCreateInput['objective'];
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

  targetAudience: string;
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
        objective: input.objective,
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
            message: `${principal.email} created this request.`,
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
export async function transition(
  principal: Principal,
  requestId: string,
  target: AdRequestStatus,
  opts: { reason?: string | null; assignToId?: string | null; ip?: string | null } = {}
) {
  const rule = TRANSITIONS[target];
  if (!rule) throw badRequest(`Cannot move a request to ${target}.`);

  const request = await prisma.crmAdRequest.findUnique({
    where: { id: requestId },
    select: { id: true, reference: true, title: true, status: true, createdById: true, assignedToId: true },
  });
  if (!request) throw notFound('Ad request not found.');

  if (!rule.from.includes(request.status)) {
    throw conflict(
      `A request that is "${STATUS_LABELS[request.status]}" cannot be ${rule.label}.`
    );
  }
  if (rule.ownerOnly && request.createdById !== principal.userId && !principal.isSuperAdmin) {
    throw forbidden('Only the person who raised this request can submit it.');
  }
  if (!(await hasPermission(principal, rule.permission))) {
    throw forbidden(`Requires the "${rule.permission}" permission.`);
  }

  const reason = (opts.reason ?? '').trim();
  if (rule.requiresReason && !reason) {
    throw badRequest(
      target === 'REJECTED'
        ? 'A rejection needs a reason — the person who raised it has to know what to fix.'
        : 'Say what needs changing.'
    );
  }

  const now = new Date();
  const data: Prisma.CrmAdRequestUpdateInput = { status: target };
  if (reason) data.decisionReason = reason;
  if (target === 'SUBMITTED') {
    data.submittedAt = now;
    // A resubmission supersedes the previous decision; leaving the old reason
    // on screen would read as if it still applied.
    data.decisionReason = reason || null;
    data.decidedAt = null;
  }
  if (['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'].includes(target)) data.decidedAt = now;
  if (target === 'COMPLETED') data.completedAt = now;
  if (target === 'IN_PROGRESS' && !request.assignedToId) {
    // Whoever picks a request up owns it, unless it was already assigned.
    data.assignedTo = { connect: { id: opts.assignToId ?? principal.userId } };
  } else if (opts.assignToId) {
    data.assignedTo = { connect: { id: opts.assignToId } };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.crmAdRequest.update({ where: { id: requestId }, data });
    await tx.crmAdRequestEvent.create({
      data: {
        requestId,
        type:
          target === 'SUBMITTED'
            ? request.status === 'DRAFT'
              ? 'SUBMITTED'
              : 'RESUBMITTED'
            : target === 'APPROVED'
              ? 'APPROVED'
              : target === 'REJECTED'
                ? 'REJECTED'
                : target === 'CHANGES_REQUESTED'
                  ? 'CHANGES_REQUESTED'
                  : 'STATUS_CHANGED',
        message: reason
          ? `${principal.email} ${rule.label}: ${reason}`
          : `${principal.email} ${rule.label}.`,
        fromStatus: request.status,
        toStatus: target,
        actorId: principal.userId,
      },
    });
    return row;
  });

  await notifyForTransition(principal, request, target, reason);

  const auditAction =
    target === 'SUBMITTED'
      ? 'REQUEST_SUBMITTED'
      : target === 'APPROVED'
        ? 'REQUEST_APPROVED'
        : target === 'REJECTED'
          ? 'REQUEST_REJECTED'
          : target === 'CHANGES_REQUESTED'
            ? 'REQUEST_CHANGES_REQUESTED'
            : 'REQUEST_STATUS_CHANGED';

  await logAudit({
    actorId: principal.userId,
    actorEmail: principal.email,
    action: auditAction,
    description: `${request.reference} ${rule.label}${reason ? `: ${reason}` : ''}`,
    targetType: 'CrmAdRequest',
    targetId: requestId,
    metadata: { from: request.status, to: target },
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
