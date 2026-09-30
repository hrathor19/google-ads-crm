import { z } from 'zod';
import { clientIp, conflict, handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { isValidFeature } from '@/lib/rbac/features';

export const dynamic = 'force-dynamic';

const schema = z.object({
  feature: z.string().refine(isValidFeature, 'Unknown permission'),
  allowed: z.boolean(),
});

/**
 * Flip one toggle in the permission matrix.
 *
 * Takes effect immediately: `getRolePermissions` reads the table on every
 * check and the JWT is re-validated every five minutes, so nobody has to sign
 * out for a revoked permission to bite.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('ROLES', 'MANAGE');
    const body = await parseBody(req, schema);

    const role = await prisma.crmRole.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, isSuperAdmin: true },
    });
    if (!role) throw notFound('Role not found.');

    // Super Admin short-circuits every check, so a row here would be stored
    // and then ignored — better to refuse than to show a toggle that lies.
    if (role.isSuperAdmin) {
      throw conflict('The Super Admin role always has every permission.');
    }

    const existing = await prisma.crmRolePermission.findUnique({
      where: { roleId_feature: { roleId: role.id, feature: body.feature } },
      select: { allowed: true },
    });

    await prisma.crmRolePermission.upsert({
      where: { roleId_feature: { roleId: role.id, feature: body.feature } },
      create: { roleId: role.id, feature: body.feature, allowed: body.allowed },
      update: { allowed: body.allowed },
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'PERMISSION_CHANGED',
      description: `${body.allowed ? 'Granted' : 'Revoked'} ${body.feature} for "${role.name}"`,
      targetType: 'CrmRole',
      targetId: role.id,
      metadata: { feature: body.feature, from: existing?.allowed ?? null, to: body.allowed },
      ipAddress: clientIp(req),
    });

    return { ok: true, feature: body.feature, allowed: body.allowed };
  });
}
