import {
  clientIp,
  conflict,
  forbidden,
  handle,
  notFound,
  parseBody,
  prisma,
  requirePermission,
} from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { assertVisible, availableTransitions } from '@/lib/workflow/ad-requests';
import { Prisma } from '@prisma/client';
import { adRequestPatchSchema, primaryLandingUrl } from '@/lib/workflow/schemas';
import { canSeeFinancials } from '@/lib/redact';
import { urlVariants } from '@/lib/ai/landing-score-store';

export const dynamic = 'force-dynamic';

const detailSelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  objective: true,
  productService: true,
  targetAudience: true,
  location: true,
  budget: true,
  startDate: true,
  endDate: true,
  landingPageUrl: true,
  usps: true,
  keywords: true,
  notes: true,

  // The campaign activation requirement fields.
  trackingId: true,
  clientType: true,
  ageRestriction: true,
  requiredLeads: true,
  requiredCpl: true,
  performanceParameter: true,
  targetApplication: true,
  targetAdmission: true,
  applicationDeadline: true,
  focusedMonths: true,
  blockedLocations: true,
  accountVisibility: true,
  reportingPanel: true,
  adUrlKapplpDesktop: true,
  adUrlKapplpMobile: true,
  adUrlKapplpBing: true,
  adUrlClientlpDesktop: true,
  adUrlClientlpMobile: true,
  adUrlClientlpBing: true,
  leadTargets: { orderBy: { month: 'asc' }, select: { month: true, leads: true } },

  linkedCampaignId: true,
  campaignLinks: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      campaignId: true,
      campaign: {
        select: { id: true, campaign_id: true, name: true, status: true, account_id: true },
      },
    },
  },
  decisionReason: true,
  submittedAt: true,
  decidedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  accountId: true,
  createdById: true,
  assignedToId: true,
  accountManagerId: true,
  adSpecialistId: true,
  version: true,
  reviewRound: true,
  account: { select: { id: true, descriptive_name: true, customer_id: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  accountManager: { select: { id: true, name: true, email: true } },
  adSpecialist: { select: { id: true, name: true, email: true } },
  reviewRounds: {
    orderBy: { round: 'asc' },
    select: {
      round: true,
      outcome: true,
      remarks: true,
      reviewedAt: true,
      reviewer: { select: { name: true, email: true } },
    },
  },
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');

    const request = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: {
        ...detailSelect,
        events: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            message: true,
            fromStatus: true,
            toStatus: true,
            createdAt: true,
            actor: { select: { id: true, name: true, email: true } },
          },
        },
        adCopyVersions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            tone: true,
            headlines: true,
            descriptions: true,
            sitelinks: true,
            keywords: true,
            excludedTerms: true,
            validation: true,
            backend: true,
            isFinal: true,
            createdAt: true,
            createdBy: { select: { name: true, email: true } },
          },
        },
        landingScores: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            url: true,
            score: true,
            grade: true,
            pageType: true,
            passed: true,
            maxPoints: true,
            checks: true,
            categories: true,
            suggestions: true,
            tracking: true,
            links: true,
            createdAt: true,
            createdBy: { select: { name: true, email: true } },
          },
        },
        attachments: {
          select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
        },
      },
    });

    if (!request) throw notFound('Ad request not found.');
    await assertVisible(principal, request);

    const canSeeMoney = await canSeeFinancials(principal);
    const transitions = await availableTransitions(principal, request);

    // A score taken from the Landing Page Scorer menu saves with no request
    // id, so a request whose page has been scored still showed "No score
    // yet" here while the brief mail displayed the score perfectly well.
    // Matched on the URL, exactly as the mail does, and flagged so the
    // screen can say where it came from rather than implying someone ran it
    // for this request.
    const landingScores =
      request.landingScores.length > 0
        ? request.landingScores.map((s) => ({ ...s, matchedByUrl: false }))
        : request.landingPageUrl
          ? (
              await prisma.crmLandingScore.findMany({
                where: { url: { in: urlVariants(request.landingPageUrl), mode: 'insensitive' } },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: {
                  id: true,
                  url: true,
                  score: true,
                  grade: true,
                  pageType: true,
                  passed: true,
                  maxPoints: true,
                  checks: true,
                  categories: true,
                  suggestions: true,
                  tracking: true,
                  links: true,
                  createdAt: true,
                  createdBy: { select: { name: true, email: true } },
                },
              })
            ).map((s) => ({ ...s, matchedByUrl: true }))
          : [];

    return {
      request: {
        ...request,
        landingScores,
        budget: canSeeMoney && request.budget != null ? Number(request.budget) : null,
        requiredCpl:
          canSeeMoney && request.requiredCpl != null ? Number(request.requiredCpl) : null,
        accountName: request.account?.descriptive_name ?? null,
        linkedCampaigns: request.campaignLinks.map((l) => ({
          id: l.campaign.id,
          campaignId: String(l.campaign.campaign_id),
          name: l.campaign.name,
          status: l.campaign.status,
          accountId: l.campaign.account_id,
        })),
        campaignLinks: undefined,
      },
      transitions,
      canSeeMoney,
    };
  });
}

/**
 * Edit a request.
 *
 * Only an editable status accepts changes: once a request is approved its
 * brief is what the Ads team is building against, and a silent edit would
 * make the approval meaningless.
 */
const EDITABLE = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'EDIT');
    const body = await parseBody(req, adRequestPatchSchema);

    const existing = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        reference: true,
        status: true,
        createdById: true,
        assignedToId: true,
        accountId: true,
      },
    });
    if (!existing) throw notFound('Ad request not found.');
    await assertVisible(principal, existing);

    const isOwner = existing.createdById === principal.userId;
    if (!isOwner && !principal.isSuperAdmin) {
      throw forbidden('Only the person who raised this request can edit its brief.');
    }
    if (!EDITABLE.includes(existing.status as (typeof EDITABLE)[number])) {
      throw conflict(
        'This request has already been reviewed. Ask for changes to reopen it for editing.'
      );
    }

    // Every scalar the brief carries, patched only when the caller sent it.
    // Listed explicitly rather than spread wholesale so a stray key in the
    // body can never reach the database.
    const patch: Prisma.CrmAdRequestUncheckedUpdateInput = {};
    const setIf = <K extends keyof typeof body>(key: K, to?: keyof Prisma.CrmAdRequestUncheckedUpdateInput) => {
      if (body[key] !== undefined) {
        (patch as Record<string, unknown>)[(to as string) ?? (key as string)] = body[key];
      }
    };
    for (const k of [
      'trackingId', 'title', 'clientType', 'accountId', 'objective', 'productService',
      'budget', 'requiredCpl', 'requiredLeads', 'performanceParameter', 'targetApplication',
      'targetAdmission', 'applicationDeadline', 'focusedMonths', 'targetAudience',
      'ageRestriction', 'location', 'blockedLocations', 'accountVisibility', 'reportingPanel',
      'adUrlKapplpDesktop', 'adUrlKapplpMobile', 'adUrlKapplpBing',
      'adUrlClientlpDesktop', 'adUrlClientlpMobile', 'adUrlClientlpBing',
      'keywords', 'usps', 'notes',
    ] as const) {
      setIf(k);
    }
    if (body.startDate !== undefined) patch.startDate = new Date(`${body.startDate}T00:00:00.000Z`);
    if (body.endDate !== undefined) {
      patch.endDate = body.endDate ? new Date(`${body.endDate}T00:00:00.000Z`) : null;
    }
    // The scored page follows whichever ads URL survives the edit.
    const derived = primaryLandingUrl({ ...existing, ...body });
    if (derived) patch.landingPageUrl = derived;

    // Monthly lead targets are a relation, so they are not in the scalar
    // loop above — and nothing else was writing them, which meant every
    // edit silently discarded the month-by-month plan Ops had typed. They
    // were then missing from the brief mail, with no error anywhere to say
    // why. Replaced wholesale rather than merged: the form submits the
    // complete table, so a month the user deleted has to disappear.
    const updated = await prisma.$transaction(async (tx) => {
      if (body.leadTargets !== undefined) {
        await tx.crmAdRequestLeadTarget.deleteMany({ where: { requestId: params.id } });
        if (body.leadTargets.length > 0) {
          await tx.crmAdRequestLeadTarget.createMany({
            data: body.leadTargets.map((t) => ({
              requestId: params.id,
              month: new Date(`${t.month}-01T00:00:00.000Z`),
              leads: t.leads,
            })),
          });
        }
      }
      return tx.crmAdRequest.update({ where: { id: params.id }, data: patch });
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'REQUEST_STATUS_CHANGED',
      description: `Edited the brief for ${existing.reference}`,
      targetType: 'CrmAdRequest',
      targetId: params.id,
      metadata: { fields: Object.keys(body) },
      ipAddress: clientIp(req),
    });

    return updated;
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'DELETE');
    const existing = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: { id: true, reference: true, status: true, createdById: true, assignedToId: true, accountId: true },
    });
    if (!existing) throw notFound('Ad request not found.');
    await assertVisible(principal, existing);

    // A request that has been through review is part of the record. Deleting
    // one would remove its approval trail along with it.
    if (existing.status !== 'DRAFT' && !principal.isSuperAdmin) {
      throw conflict('Only a draft can be deleted. Reject the request instead.');
    }

    await prisma.crmAdRequest.delete({ where: { id: params.id } });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'REQUEST_STATUS_CHANGED',
      description: `Deleted ad request ${existing.reference}`,
      targetType: 'CrmAdRequest',
      targetId: params.id,
      ipAddress: clientIp(req),
    });

    return { ok: true };
  });
}
