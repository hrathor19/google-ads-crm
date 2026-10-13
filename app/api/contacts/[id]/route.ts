import { z } from 'zod';
import {
  badRequest,
  clientIp,
  conflict,
  handle,
  notFound,
  parseBody,
  prisma,
  requirePermission,
} from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { EMAIL_MAX, RECIPIENT_NAME_MAX, validateRecipients } from '@/lib/workflow/recipients';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(RECIPIENT_NAME_MAX).optional(),
    email: z.string().trim().min(1).max(EMAIL_MAX).optional(),
    /** Switched off rather than removed, which is the reversible thing. */
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('CONTACTS', 'EDIT');
    const body = await parseBody(req, patchSchema);

    const existing = await prisma.crmMailContact.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!existing) throw notFound('That contact no longer exists.');

    const email = body.email ? body.email.toLowerCase() : existing.email;
    const name = body.name ?? existing.name;

    if (body.email && email !== existing.email) {
      const problem = validateRecipients([{ email, name }], env.auth().allowedDomains);
      if (problem) throw badRequest(problem);
      const clash = await prisma.crmMailContact.findUnique({
        where: { email },
        select: { name: true },
      });
      if (clash) throw conflict(`${email} is already in the list as "${clash.name}".`);
    }

    const contact = await prisma.crmMailContact.update({
      where: { id: params.id },
      data: { name, email, isActive: body.isActive ?? existing.isActive },
      select: { id: true, name: true, email: true, isActive: true },
    });

    // Said as a change rather than a new state, because "renamed X to Y" is
    // what somebody reading the trail six months later needs.
    const changes: string[] = [];
    if (contact.name !== existing.name) changes.push(`renamed "${existing.name}" to "${contact.name}"`);
    if (contact.email !== existing.email) changes.push(`moved ${existing.email} to ${contact.email}`);
    if (contact.isActive !== existing.isActive) {
      changes.push(contact.isActive ? 'switched back on' : 'switched off');
    }

    if (changes.length > 0) {
      await logAudit({
        actorId: principal.userId,
        actorEmail: principal.email,
        action: 'CONTACT_UPDATED',
        description: `Mail contact: ${changes.join(', ')}`,
        targetType: 'CrmMailContact',
        targetId: contact.id,
        metadata: { before: existing, after: contact },
        ipAddress: clientIp(req),
      });
    }

    return { contact };
  });
}

/**
 * Remove somebody from the directory for good.
 *
 * Trails already carrying them are untouched: `crm_ad_request_recipients`
 * stores the name and address it was given rather than pointing here, exactly
 * so that tidying the directory cannot rewrite who was copied on a campaign
 * that already ran.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('CONTACTS', 'DELETE');

    const existing = await prisma.crmMailContact.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, email: true },
    });
    if (!existing) throw notFound('That contact no longer exists.');

    await prisma.crmMailContact.delete({ where: { id: params.id } });

    // Said plainly in the response, because the screen should be able to tell
    // somebody their removal did not un-copy anyone from a live campaign.
    const stillOn = await prisma.crmAdRequestRecipient.count({
      where: { email: existing.email },
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'CONTACT_DELETED',
      description: `Removed ${existing.name} <${existing.email}> from the mail contacts`,
      targetType: 'CrmMailContact',
      targetId: existing.id,
      metadata: { stillOnRequests: stillOn },
      ipAddress: clientIp(req),
    });

    return { removed: existing.email, stillOnRequests: stillOn };
  });
}
