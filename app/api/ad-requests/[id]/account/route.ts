import { z } from 'zod';
import { clientIp, handle, parseBody, requirePermission } from '@/lib/api';
import { setRequestAccount } from '@/lib/workflow/ad-requests';

export const dynamic = 'force-dynamic';

/**
 * Point a request at a Google Ads account.
 *
 * Its own route rather than part of the brief editor, because the two are
 * governed differently: the brief belongs to whoever raised it and locks once
 * the request is reviewed, while the account is a Manager's call and stays
 * changeable for as long as the work is running. `setRequestAccount` enforces
 * both the permission and the account scope.
 */
const schema = z.object({
  /** `null` unlinks it. */
  accountId: z.coerce.number().int().positive().nullable(),
  expectedVersion: z.coerce.number().int().min(0).nullable().optional(),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    // VIEW only here: the specific permission is checked inside, against the
    // request the caller named, so the guard and the rule cannot drift.
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    const body = await parseBody(req, schema);

    return setRequestAccount(principal, params.id, body.accountId, {
      expectedVersion: body.expectedVersion ?? null,
      ip: clientIp(req),
    });
  });
}
