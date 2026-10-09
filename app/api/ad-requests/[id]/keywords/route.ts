import { z } from 'zod';
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
import { actorLabel, hasPermission } from '@/lib/rbac/permissions';
import { assertVisible } from '@/lib/workflow/ad-requests';

export const dynamic = 'force-dynamic';

const schema = z.object({
  keywords: z.array(z.string().trim().min(1).max(200)).max(500),
});

/**
 * Who may change the keyword list, and when.
 *
 * Two different jobs share this endpoint. The Ad Specialist builds the list
 * while the request is theirs; the reviewer prunes it while deciding whether
 * to approve — striking a keyword they know will not convert is the whole
 * point of the review, and before this they could only reject the lot and
 * explain in prose what to drop.
 *
 * Not the ordinary brief edit: that is closed once a request is submitted,
 * for good reason. This is narrower — one field, at the two moments it is
 * genuinely somebody's to change.
 */
const WINDOWS: Array<{ permission: string; statuses: string[] }> = [
  { permission: 'AD_REQUESTS:BUILD', statuses: ['AWAITING_AD_SUBMISSION', 'RECHECK_REQUESTED'] },
  { permission: 'AD_REQUESTS:APPROVE', statuses: ['UNDER_REVIEW'] },
];

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    const body = await parseBody(req, schema);

    const request = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        reference: true,
        status: true,
        keywords: true,
        accountId: true,
        createdById: true,
        assignedToId: true,
      },
    });
    if (!request) throw notFound('Ad request not found.');
    await assertVisible(principal, request);

    const allowed: string[] = [];
    for (const w of WINDOWS) {
      if (await hasPermission(principal, w.permission)) allowed.push(...w.statuses);
    }
    if (allowed.length === 0) {
      throw forbidden('Changing the keyword list needs the build or the approve permission.');
    }
    if (!allowed.includes(request.status)) {
      throw conflict(
        `The keyword list cannot be changed while this request is "${request.status}".`
      );
    }

    // De-duplicated case-insensitively, order preserved: the list is read by
    // people, and the same keyword twice reads as an oversight.
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const raw of body.keywords) {
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      keywords.push(raw);
    }

    const before = (request.keywords ?? '').split('\n').filter(Boolean).length;
    const removed = Math.max(0, before - keywords.length);

    await prisma.crmAdRequest.update({
      where: { id: params.id },
      data: { keywords: keywords.length > 0 ? keywords.join('\n') : null },
    });

    await prisma.crmAdRequestEvent.create({
      data: {
        requestId: params.id,
        type: 'STATUS_CHANGED',
        message:
          removed > 0
            ? `${actorLabel(principal)} removed ${removed} keyword(s) during review; ${keywords.length} left.`
            : `${actorLabel(principal)} updated the keyword list to ${keywords.length} keyword(s).`,
        actorId: principal.userId,
      },
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'REQUEST_STATUS_CHANGED',
      description: `Keywords on ${request.reference}: ${before} → ${keywords.length}`,
      targetType: 'CrmAdRequest',
      targetId: params.id,
      metadata: { before, after: keywords.length },
      ipAddress: clientIp(req),
    });

    return { keywords, removed };
  });
}
