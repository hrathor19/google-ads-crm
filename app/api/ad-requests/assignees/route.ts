import { z } from 'zod';
import { handle, parseQuery, prisma, requirePermission } from '@/lib/api';
import { usersWithPermission } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * People a request can be handed to.
 *
 * Separate from `/api/admin/users` because assigning work is not
 * administering accounts: Ops names the Account Manager at step 3 and the Ad
 * Specialist at step 11, and should not need USERS:VIEW — which would also
 * show them deactivated accounts, last-login times and everyone's role.
 *
 * Returns only what a picker needs, for people who actually hold the
 * permission the step requires.
 */
const schema = z.object({
  /** `MODULE:ACTION` the candidate must hold, e.g. AD_REQUESTS:EDIT. */
  permission: z
    .string()
    .trim()
    .regex(/^[A-Z_]+:[A-Z_]+$/, 'Expected a MODULE:ACTION permission'),
});

export async function GET(req: Request) {
  return handle(async () => {
    await requirePermission('AD_REQUESTS', 'ASSIGN');
    const { permission } = parseQuery(req, schema);

    const userIds = await usersWithPermission(permission);
    const users = await prisma.crmUser.findMany({
      // Deactivated accounts are excluded: assigning work to someone who
      // cannot sign in strands the request.
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, name: true, email: true, role: { select: { name: true } } },
      orderBy: [{ name: 'asc' }],
    });

    return {
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        roleName: u.role.name,
      })),
    };
  });
}
