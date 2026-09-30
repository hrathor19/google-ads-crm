import { z } from 'zod';
import { clientIp, conflict, handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  allAccounts: z.boolean().optional(),
  accountIds: z.array(z.coerce.number().int().positive()).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('ROLES', 'MANAGE');
    const body = await parseBody(req, patchSchema);

    const role = await prisma.crmRole.findUnique({ where: { id: params.id } });
    if (!role) throw notFound('Role not found.');

    if (body.name && body.name !== role.name) {
      // A seeded role's slug is referenced by the permission defaults, so its
      // identity stays fixed even though its label can be reworded.
      const clash = await prisma.crmRole.findFirst({
        where: { name: body.name, NOT: { id: role.id } },
        select: { id: true },
      });
      if (clash) throw conflict('Another role already has that name.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.accountIds !== undefined) {
        await tx.crmRoleAccount.deleteMany({ where: { roleId: role.id } });
        if (body.accountIds.length) {
          await tx.crmRoleAccount.createMany({
            data: body.accountIds.map((accountId) => ({ roleId: role.id, accountId })),
            skipDuplicates: true,
          });
        }
      }
      return tx.crmRole.update({
        where: { id: role.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.allAccounts !== undefined && { allAccounts: body.allAccounts }),
        },
      });
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: body.accountIds !== undefined ? 'ACCOUNT_SCOPE_CHANGED' : 'ROLE_UPDATED',
      description: `Updated role "${updated.name}"`,
      targetType: 'CrmRole',
      targetId: role.id,
      metadata: { changes: Object.keys(body) },
      ipAddress: clientIp(req),
    });

    return updated;
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('ROLES', 'MANAGE');

    const role = await prisma.crmRole.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, isSystem: true, _count: { select: { users: true } } },
    });
    if (!role) throw notFound('Role not found.');

    // Both guards exist because both failure modes are silent: deleting a
    // seeded role breaks the permission defaults, and deleting an assigned one
    // would leave users with no role at all.
    if (role.isSystem) throw conflict('Default roles cannot be deleted.');
    if (role._count.users > 0) {
      throw conflict(
        `${role._count.users} user(s) still have this role. Move them to another role first.`
      );
    }

    await prisma.crmRole.delete({ where: { id: role.id } });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'ROLE_DELETED',
      description: `Deleted role "${role.name}"`,
      targetType: 'CrmRole',
      targetId: role.id,
      ipAddress: clientIp(req),
    });

    return { ok: true };
  });
}
