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
      accountManagerId: body.accountManagerId ?? null,
      adSpecialistId: body.adSpecialistId ?? null,
      accountId: body.accountId ?? null,
      budget: body.budget ?? null,
      requiredCpl: body.requiredCpl ?? null,
      // Goes *into* the transition, not after it: going live requires the
      // campaign id, so writing it afterwards left the check looking at a
      // request that did not have one yet.
      linkedCampaignId: body.linkedCampaignId ?? null,
      expectedVersion: body.expectedVersion ?? null,
      ip: clientIp(req),
    });

    return updated;
  });
}
