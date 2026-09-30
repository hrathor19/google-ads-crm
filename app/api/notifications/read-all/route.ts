import { handle, prisma, requireUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(async () => {
    const principal = await requireUser();
    const { count } = await prisma.crmNotification.updateMany({
      where: { userId: principal.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: count };
  });
}
