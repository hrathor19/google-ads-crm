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
import { adRequestInputSchema } from '@/lib/workflow/schemas';
import { canSeeFinancials } from '@/lib/redact';

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
  linkedCampaignId: true,
  decisionReason: true,
  submittedAt: true,
  decidedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  accountId: true,
  createdById: true,
  assignedToId: true,
  account: { select: { id: true, descriptive_name: true, customer_id: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
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

    return {
      request: {
        ...request,
        budget: canSeeMoney ? Number(request.budget) : null,
        accountName: request.account?.descriptive_name ?? null,
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
    const body = await parseBody(req, adRequestInputSchema.partial());

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

    const updated = await prisma.crmAdRequest.update({
      where: { id: params.id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.accountId !== undefined && { accountId: body.accountId }),
        ...(body.objective !== undefined && { objective: body.objective }),
        ...(body.productService !== undefined && { productService: body.productService }),
        ...(body.targetAudience !== undefined && { targetAudience: body.targetAudience }),
        ...(body.location !== undefined && { location: body.location }),
        ...(body.budget !== undefined && { budget: body.budget }),
        ...(body.startDate !== undefined && {
          startDate: new Date(`${body.startDate}T00:00:00.000Z`),
        }),
        ...(body.endDate !== undefined && {
          endDate: body.endDate ? new Date(`${body.endDate}T00:00:00.000Z`) : null,
        }),
        ...(body.landingPageUrl !== undefined && { landingPageUrl: body.landingPageUrl }),
        ...(body.usps !== undefined && { usps: body.usps }),
        ...(body.keywords !== undefined && { keywords: body.keywords }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
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
