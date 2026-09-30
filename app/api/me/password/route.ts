import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { badRequest, clientIp, handle, parseBody, prisma, requireUser } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(10, 'Use at least 10 characters')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
});

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requireUser();
    const body = await parseBody(req, schema);

    const user = await prisma.crmUser.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { password: true },
    });

    if (!(await bcrypt.compare(body.currentPassword, user.password))) {
      throw badRequest('That is not your current password.');
    }
    if (await bcrypt.compare(body.newPassword, user.password)) {
      throw badRequest('The new password must be different from the current one.');
    }

    await prisma.crmUser.update({
      where: { id: principal.userId },
      data: {
        password: await bcrypt.hash(body.newPassword, 12),
        mustChangePassword: false,
      },
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'PASSWORD_CHANGED',
      description: 'Changed their own password',
      ipAddress: clientIp(req),
    });

    return { ok: true };
  });
}
