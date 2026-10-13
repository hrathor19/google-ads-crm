import { z } from 'zod';
import { badRequest, clientIp, conflict, handle, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import {
  EMAIL_MAX,
  RECIPIENT_NAME_MAX,
  validateRecipients,
} from '@/lib/workflow/recipients';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(1, 'A name is needed.').max(RECIPIENT_NAME_MAX),
  email: z.string().trim().min(1).max(EMAIL_MAX),
});

/**
 * The address book the requirement form picks from.
 *
 * Listed whole rather than searched on the server: this is a company contact
 * list, so hundreds rather than millions, and the picker filters in the
 * browser where it costs nothing and feels instant.
 */
export async function GET() {
  return handle(async () => {
    await requirePermission('CONTACTS', 'VIEW');
    const contacts = await prisma.crmMailContact.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdByEmail: true,
        createdAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return { contacts, allowedDomains: env.auth().allowedDomains };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CONTACTS', 'CREATE');
    const body = await parseBody(req, createSchema);

    const email = body.email.toLowerCase();
    // The same rule the mail trail enforces, applied at the source: these
    // people receive mail carrying the assigned budget and the required CPL.
    const problem = validateRecipients([{ email, name: body.name }], env.auth().allowedDomains);
    if (problem) throw badRequest(problem);

    const existing = await prisma.crmMailContact.findUnique({
      where: { email },
      select: { id: true, name: true, isActive: true },
    });
    if (existing) {
      throw conflict(
        existing.isActive
          ? `${body.name} is already in the list as "${existing.name}".`
          : `${existing.name} is in the list but switched off. Turn them back on instead of adding them again.`
      );
    }

    const contact = await prisma.crmMailContact.create({
      data: {
        name: body.name,
        email,
        createdById: principal.userId,
        createdByEmail: principal.email,
      },
      select: { id: true, name: true, email: true, isActive: true },
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'CONTACT_CREATED',
      description: `Added ${contact.name} <${contact.email}> to the mail contacts`,
      targetType: 'CrmMailContact',
      targetId: contact.id,
      ipAddress: clientIp(req),
    });

    return { contact };
  });
}
