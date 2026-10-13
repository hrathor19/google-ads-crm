import { z } from 'zod';
import {
  badRequest,
  clientIp,
  handle,
  notFound,
  parseBody,
  prisma,
  requirePermission,
} from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { actorLabel } from '@/lib/rbac/permissions';
import { assertVisible } from '@/lib/workflow/ad-requests';
import {
  MAX_REQUEST_RECIPIENTS,
  EMAIL_MAX,
  RECIPIENT_NAME_MAX,
  describeRecipientChange,
  normaliseRecipients,
  validateRecipients,
} from '@/lib/workflow/recipients';

export const dynamic = 'force-dynamic';

const schema = z.object({
  recipients: z
    .array(
      z.object({
        email: z.string().trim().min(1).max(EMAIL_MAX),
        name: z.string().trim().max(RECIPIENT_NAME_MAX).nullish(),
      })
    )
    .max(MAX_REQUEST_RECIPIENTS),
});

/** The shape both verbs return, so the client never has to re-fetch. */
async function listFor(requestId: string) {
  const rows = await prisma.crmAdRequestRecipient.findMany({
    where: { requestId },
    select: { id: true, email: true, name: true, addedByEmail: true, addedAt: true },
    orderBy: { addedAt: 'asc' },
  });
  // The domains go back with the list so the screen can refuse an outside
  // address inline, with the same message the server would give. Not a
  // secret: the login page already tells people which domain to use.
  return {
    recipients: rows,
    max: MAX_REQUEST_RECIPIENTS,
    allowedDomains: env.auth().allowedDomains,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    const request = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: { id: true, accountId: true, createdById: true, assignedToId: true },
    });
    if (!request) throw notFound('Ad request not found.');
    await assertVisible(principal, request);
    return listFor(params.id);
  });
}

/**
 * Replace the list of people copied on this request's mail.
 *
 * Open at every status, unlike the ordinary brief edit which closes once a
 * request is submitted. That is the point of a separate endpoint: a sales POC
 * is often only named at approval or when the campaign goes live, and the
 * alternative was rejecting a request and re-raising it to add one person to
 * a mail thread.
 *
 * Whole-list replacement rather than add/remove verbs, because the screen
 * edits a list and sending the result is the honest representation of that —
 * two people editing at once then last-write-wins on a list, instead of
 * interleaving into a state neither of them chose.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'EDIT');
    const body = await parseBody(req, schema);

    const request = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        reference: true,
        accountId: true,
        createdById: true,
        assignedToId: true,
        recipients: { select: { email: true, name: true }, orderBy: { addedAt: 'asc' } },
      },
    });
    if (!request) throw notFound('Ad request not found.');
    await assertVisible(principal, request);

    const next = normaliseRecipients(body.recipients);

    // The domain gate is the server's alone: the browser is told the answer
    // rather than trusted to work it out, and these mails carry the assigned
    // budget and the required CPL.
    const problem = validateRecipients(next, env.auth().allowedDomains);
    if (problem) throw badRequest(problem);

    const before = request.recipients;
    const summary = describeRecipientChange(before, next);

    // Replaced wholesale in one transaction, so a failure cannot leave the
    // trail half-rewritten and mailing a mixture of both lists.
    await prisma.$transaction([
      prisma.crmAdRequestRecipient.deleteMany({ where: { requestId: params.id } }),
      ...(next.length > 0
        ? [
            prisma.crmAdRequestRecipient.createMany({
              data: next.map((r) => ({
                requestId: params.id,
                email: r.email,
                name: r.name,
                addedById: principal.userId,
                addedByEmail: principal.email,
              })),
            }),
          ]
        : []),
    ]);

    // Only when something actually moved: re-saving an unchanged list should
    // not litter the request's history.
    if (before.length !== next.length || summary !== 'left the mail trail unchanged') {
      await prisma.crmAdRequestEvent.create({
        data: {
          requestId: params.id,
          type: 'STATUS_CHANGED',
          message: `${actorLabel(principal)} ${summary}.`,
          actorId: principal.userId,
        },
      });

      await logAudit({
        actorId: principal.userId,
        actorEmail: principal.email,
        action: 'REQUEST_RECIPIENTS_CHANGED',
        description: `Mail trail on ${request.reference}: ${summary}`,
        targetType: 'CrmAdRequest',
        targetId: params.id,
        metadata: {
          before: before.map((r) => r.email),
          after: next.map((r) => r.email),
        },
        ipAddress: clientIp(req),
      });
    }

    return listFor(params.id);
  });
}
