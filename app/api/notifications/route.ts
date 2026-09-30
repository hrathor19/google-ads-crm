import { z } from 'zod';
import { handle, parseQuery, prisma, requireUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

const schema = z.object({ limit: z.coerce.number().int().min(1).max(50).optional() });

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requireUser();
    const { limit } = parseQuery(req, schema.passthrough());

    const [items, unread] = await Promise.all([
      prisma.crmNotification.findMany({
        where: { userId: principal.userId },
        orderBy: { createdAt: 'desc' },
        take: limit ?? 20,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.crmNotification.count({ where: { userId: principal.userId, readAt: null } }),
    ]);

    return { items, unread };
  });
}
