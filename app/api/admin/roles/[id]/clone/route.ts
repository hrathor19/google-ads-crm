import { z } from 'zod';
import { clientIp, conflict, handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getRolePermissions } from '@/lib/rbac/permissions';

export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().trim().min(2).max(60) });

/**
 * Clone a role.
 *
 * The clone is materialised from the *effective* matrix, not from the source's
 * stored rows: a seeded role's grants mostly live in the defaults, so copying
 * only its rows would produce an empty role that looks identical in the UI.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('ROLES', 'MANAGE');
    const body = await parseBody(req, schema);

    const source = await prisma.crmRole.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        description: true,
        allAccounts: true,
        accountScopes: { select: { accountId: true } },
      },
    });
    if (!source) throw notFound('Role not found.');

    const slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    const clash = await prisma.crmRole.findFirst({
      where: { OR: [{ slug }, { name: body.name }] },
      select: { id: true },
    });
    if (clash) throw conflict('A role with that name already exists.');

    const effective = await getRolePermissions(source.id);

    const clone = await prisma.crmRole.create({
      data: {
        slug,
        name: body.name,
        description: source.description ? `${source.description} (copy)` : null,
        isSystem: false,
        isSuperAdmin: false,
        allAccounts: source.allAccounts,
        permissions: {
          create: Object.entries(effective).map(([feature, allowed]) => ({ feature, allowed })),
        },
        accountScopes: source.accountScopes.length
          ? { create: source.accountScopes.map((a) => ({ accountId: a.accountId })) }
          : undefined,
      },
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'ROLE_CLONED',
      description: `Cloned "${source.name}" into "${clone.name}"`,
      targetType: 'CrmRole',
      targetId: clone.id,
      metadata: { sourceRoleId: source.id },
      ipAddress: clientIp(req),
    });

    return clone;
  });
}
