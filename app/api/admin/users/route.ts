import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { clientIp, conflict, handle, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  name: z.string().trim().min(2, 'Enter a name').max(120),
  roleId: z.string().cuid('Pick a role'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
  allAccounts: z.boolean().optional(),
  accountIds: z.array(z.coerce.number().int().positive()).optional(),
});

export async function GET() {
  return handle(async () => {
    await requirePermission('USERS', 'VIEW');

    const users = await prisma.crmUser.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        mustChangePassword: true,
        allAccounts: true,
        lastLoginAt: true,
        createdAt: true,
        roleId: true,
        role: { select: { id: true, name: true, slug: true, isSuperAdmin: true } },
        accountScopes: { select: { accountId: true } },
      },
    });

    return {
      // No password hash is selected above, so it cannot leak through this
      // endpoint by someone adding a field later.
      users: users.map((u) => ({
        ...u,
        accountIds: u.accountScopes.map((a) => a.accountId),
        accountScopes: undefined,
      })),
    };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('USERS', 'MANAGE');
    const body = await parseBody(req, createSchema);

    const existing = await prisma.crmUser.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    if (existing) throw conflict('Someone already has that email address.');

    const role = await prisma.crmRole.findUnique({
      where: { id: body.roleId },
      select: { id: true, name: true, isSuperAdmin: true },
    });
    if (!role) throw conflict('That role no longer exists.');

    // Only a Super Admin can mint another Super Admin. Otherwise anyone with
    // USERS:MANAGE could promote themselves by creating a second account.
    if (role.isSuperAdmin && !principal.isSuperAdmin) {
      throw conflict('Only a Super Admin can assign the Super Admin role.');
    }

    const user = await prisma.crmUser.create({
      data: {
        email: body.email,
        name: body.name,
        password: await bcrypt.hash(body.password, 12),
        roleId: role.id,
        isActive: true,
        // Whoever created the account knows this password, so it must be
        // replaced before the user can do anything else.
        mustChangePassword: true,
        allAccounts: body.allAccounts ?? true,
        accountScopes:
          body.allAccounts === false && body.accountIds?.length
            ? { create: body.accountIds.map((accountId) => ({ accountId })) }
            : undefined,
      },
      select: { id: true, email: true, name: true },
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'USER_CREATED',
      description: `Created user ${user.email} with role "${role.name}"`,
      targetType: 'CrmUser',
      targetId: user.id,
      ipAddress: clientIp(req),
    });

    return user;
  });
}
