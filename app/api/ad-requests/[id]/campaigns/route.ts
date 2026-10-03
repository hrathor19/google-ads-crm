import { z } from 'zod';
import { clientIp, handle, parseBody, requirePermission } from '@/lib/api';
import { MAX_LINKED_CAMPAIGNS, setRequestTargets } from '@/lib/workflow/ad-requests';

export const dynamic = 'force-dynamic';

/**
 * Replace the campaigns a request reports against.
 *
 * A whole-set PUT rather than add/remove calls: the picker is a multi-select
 * and sends what it now shows, so the server never has to reconcile two
 * half-applied edits, and the optimistic lock covers the change as one thing.
 */
const schema = z.object({
  campaignIds: z.array(z.coerce.number().int().positive()).max(MAX_LINKED_CAMPAIGNS),
  /** Optional: the picker also carries the account it filtered by. */
  accountId: z.coerce.number().int().positive().nullable().optional(),
  expectedVersion: z.coerce.number().int().min(0).nullable().optional(),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    // The specific permission is checked inside, against the request named,
    // so the guard and the rule cannot drift.
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    const body = await parseBody(req, schema);

    return setRequestTargets(
      principal,
      params.id,
      {
        campaignIds: body.campaignIds,
        ...(body.accountId === undefined ? {} : { accountId: body.accountId }),
      },
      { expectedVersion: body.expectedVersion ?? null, ip: clientIp(req) }
    );
  });
}
