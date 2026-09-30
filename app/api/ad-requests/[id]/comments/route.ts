import { handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { addComment, assertVisible } from '@/lib/workflow/ad-requests';
import { commentSchema } from '@/lib/workflow/schemas';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    const body = await parseBody(req, commentSchema);

    const existing = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: { accountId: true, createdById: true, assignedToId: true },
    });
    if (!existing) throw notFound('Ad request not found.');
    await assertVisible(principal, existing);

    return addComment(principal, params.id, body.message);
  });
}
