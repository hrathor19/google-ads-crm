import { z } from 'zod';
import { clientIp, conflict, handle, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getRolePermissions } from '@/lib/rbac/permissions';
import { ACTION_LABELS, MODULES, isValidFeature } from '@/lib/rbac/features';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(2, 'Give the role a name').max(60),
  description: z.string().trim().max(400).nullable().optional(),
  allAccounts: z.boolean().optional(),
  accountIds: z.array(z.coerce.number().int().positive()).optional(),
  /** Feature strings to grant on creation. */
  features: z.array(z.string().refine(isValidFeature, 'Unknown permission')).optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export async function GET() {
  return handle(async () => {
    await requirePermission('ROLES', 'VIEW');

    const roles = await prisma.crmRole.findMany({
      orderBy: [{ isSuperAdmin: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        isSystem: true,
        isSuperAdmin: true,
        allAccounts: true,
        createdAt: true,
        _count: { select: { users: true } },
        accountScopes: { select: { accountId: true } },
      },
    });

    // The matrix is resolved per role so the UI shows the effective value,
    // including the seeded defaults for rows nobody has toggled yet.
    const matrix: Record<string, Record<string, boolean>> = {};
    for (const role of roles) {
      matrix[role.id] = await getRolePermissions(role.id);
    }

    return {
      roles: roles.map((r) => ({
        ...r,
        userCount: r._count.users,
        accountIds: r.accountScopes.map((a) => a.accountId),
        _count: undefined,
        accountScopes: undefined,
      })),
      matrix,
      modules: MODULES,
      actionLabels: ACTION_LABELS,
    };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('ROLES', 'MANAGE');
    const body = await parseBody(req, createSchema);

    const slug = slugify(body.name);
    if (!slug) throw conflict('That name does not produce a usable identifier.');

    const clash = await prisma.crmRole.findFirst({
      where: { OR: [{ slug }, { name: body.name }] },
      select: { id: true },
    });
    if (clash) throw conflict('A role with that name already exists.');

    const role = await prisma.crmRole.create({
      data: {
        slug,
        name: body.name,
        description: body.description ?? null,
        // A role created in the UI is never a system role and never a Super
        // Admin: privilege escalation has to go through the seed, not a form.
        isSystem: false,
        isSuperAdmin: false,
        allAccounts: body.allAccounts ?? true,
        permissions: {
          create: (body.features ?? []).map((feature) => ({ feature, allowed: true })),
        },
        accountScopes:
          body.allAccounts === false && body.accountIds?.length
            ? { create: body.accountIds.map((accountId) => ({ accountId })) }
            : undefined,
      },
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'ROLE_CREATED',
      description: `Created role "${role.name}"`,
      targetType: 'CrmRole',
      targetId: role.id,
      metadata: { features: body.features ?? [] },
      ipAddress: clientIp(req),
    });

    return role;
  });
}
