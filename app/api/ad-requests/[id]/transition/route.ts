import { clientIp, handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { assertVisible, transition } from '@/lib/workflow/ad-requests';
import { transitionSchema } from '@/lib/workflow/schemas';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    // The transition itself re-checks the specific permission its rule
    // declares; this only establishes who is asking.
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    const body = await parseBody(req, transitionSchema);

    const existing = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: { accountId: true, createdById: true, assignedToId: true },
    });
    if (!existing) throw notFound('Ad request not found.');
    await assertVisible(principal, existing);

    const updated = await transition(principal, params.id, body.target, {
      reason: body.reason ?? null,
      assignToId: body.assignToId ?? null,
      ip: clientIp(req),
    });

    // The Google Ads campaign id is captured on the same screen the Ads team
    // marks a request live from, so it rides along with the transition.
    if (body.linkedCampaignId !== undefined) {
      await prisma.crmAdRequest.update({
        where: { id: params.id },
        data: { linkedCampaignId: body.linkedCampaignId || null },
      });
    }

    return updated;
  });
}
