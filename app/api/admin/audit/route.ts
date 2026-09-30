import { z } from 'zod';
import { CrmAuditAction } from '@prisma/client';
import { handle, parseQuery, prisma, requirePermission } from '@/lib/api';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.string().optional(),
  actorId: z.string().optional(),
  search: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    await requirePermission('AUDIT', 'VIEW');
    const q = parseQuery(req, schema.passthrough());

    const actions = q.action
      ? (q.action.split(',').filter((a) => a in CrmAuditAction) as CrmAuditAction[])
      : undefined;

    const where = {
      AND: [
        actions?.length ? { action: { in: actions } } : {},
        q.actorId ? { actorId: q.actorId } : {},
        q.search ? { description: { contains: q.search, mode: 'insensitive' as const } } : {},
        q.from ? { createdAt: { gte: new Date(`${q.from}T00:00:00.000Z`) } } : {},
        q.to ? { createdAt: { lte: new Date(`${q.to}T23:59:59.999Z`) } } : {},
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.crmAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit ?? 50,
        skip: q.offset ?? 0,
        select: {
          id: true,
          action: true,
          description: true,
          actorEmail: true,
          targetType: true,
          targetId: true,
          metadata: true,
          ipAddress: true,
          createdAt: true,
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.crmAuditLog.count({ where }),
    ]);

    return { rows, total, actions: Object.values(CrmAuditAction) };
  });
}
