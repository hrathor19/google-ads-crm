import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { clientIp, conflict, handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  roleId: z.string().cuid().optional(),
  isActive: z.boolean().optional(),
  allAccounts: z.boolean().optional(),
  accountIds: z.array(z.coerce.number().int().positive()).optional(),
  /** An admin-set password. Always forces a change on next sign-in. */
  resetPassword: z
    .string()
    .min(10, 'Use at least 10 characters')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number')
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('USERS', 'MANAGE');
    const body = await parseBody(req, patchSchema);

    const user = await prisma.crmUser.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        isActive: true,
        role: { select: { isSuperAdmin: true, name: true } },
      },
    });
    if (!user) throw notFound('User not found.');

    // Locking yourself out is not recoverable from inside the app.
    if (params.id === principal.userId && body.isActive === false) {
      throw conflict('You cannot deactivate your own account.');
    }
    if (params.id === principal.userId && body.roleId) {
      throw conflict('You cannot change your own role.');
    }
    if (user.role.isSuperAdmin && !principal.isSuperAdmin) {
      throw conflict('Only a Super Admin can modify another Super Admin.');
    }

    if (body.roleId) {
      const role = await prisma.crmRole.findUnique({
        where: { id: body.roleId },
        select: { isSuperAdmin: true },
      });
      if (!role) throw conflict('That role no longer exists.');
      if (role.isSuperAdmin && !principal.isSuperAdmin) {
        throw conflict('Only a Super Admin can assign the Super Admin role.');
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.accountIds !== undefined) {
        await tx.crmUserAccount.deleteMany({ where: { userId: params.id } });
        if (body.accountIds.length) {
          await tx.crmUserAccount.createMany({
            data: body.accountIds.map((accountId) => ({ userId: params.id, accountId })),
            skipDuplicates: true,
          });
        }
      }
      return tx.crmUser.update({
        where: { id: params.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.roleId !== undefined && { roleId: body.roleId }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.allAccounts !== undefined && { allAccounts: body.allAccounts }),
          ...(body.resetPassword && {
            password: await bcrypt.hash(body.resetPassword, 12),
            mustChangePassword: true,
          }),
        },
        select: { id: true, email: true, name: true, isActive: true, roleId: true },
      });
    });

    const action =
      body.resetPassword
        ? 'PASSWORD_RESET'
        : body.isActive === false
          ? 'USER_DEACTIVATED'
          : body.isActive === true
            ? 'USER_ACTIVATED'
            : body.accountIds !== undefined
              ? 'ACCOUNT_SCOPE_CHANGED'
              : 'USER_UPDATED';

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action,
      description: `${action.replace(/_/g, ' ').toLowerCase()} for ${user.email}`,
      targetType: 'CrmUser',
      targetId: params.id,
      metadata: { changes: Object.keys(body).filter((k) => k !== 'resetPassword') },
      ipAddress: clientIp(req),
    });

    return updated;
  });
}
