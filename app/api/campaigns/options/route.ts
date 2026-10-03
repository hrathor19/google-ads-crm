import { z } from 'zod';
import { handle, parseQuery, prisma, requirePermission, scopeAccountId } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * The campaign picker's list — names and ids, no metrics.
 *
 * The whole scoped list ships in one response (about 1,100 rows on this MCC)
 * so the picker can filter as you type with no round trip, and so a campaign
 * that is already selected stays visible when the search no longer matches
 * it. `limit` is a guard rail, not a pager: if an MCC ever outgrows it the
 * answer is server-side search, not a silently truncated list, which is why
 * the response says whether it was cut.
 */
const schema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CAMPAIGNS', 'VIEW');
    const q = parseQuery(req, schema.passthrough());
    // Both halves matter. `accountIds` is the principal's scope; `accountId`
    // is the one the caller asked to narrow to. Using only the former meant
    // an unrestricted Manager got all 1,087 campaigns back however they
    // filtered, because their scope is "everything".
    const { accountId, accountIds } = scopeAccountId(principal, q.accountId ?? null);

    const limit = q.limit ?? 2000;
    const where = {
      ...(accountId !== null
        ? { account_id: accountId }
        : accountIds === null
          ? {}
          : { account_id: { in: accountIds } }),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
      ...(q.status ? { status: { in: q.status.split(',') } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.campaigns.findMany({
        where,
        select: {
          id: true,
          campaign_id: true,
          name: true,
          status: true,
          advertising_channel_type: true,
          account_id: true,
          accounts: { select: { descriptive_name: true } },
        },
        // Enabled first: picking the campaigns a client is actually running
        // is the common case, and they would otherwise be buried among
        // hundreds of removed ones.
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        take: limit,
      }),
      prisma.campaigns.count({ where }),
    ]);

    return {
      total,
      truncated: total > rows.length,
      campaigns: rows.map((c) => ({
        id: c.id,
        campaignId: String(c.campaign_id),
        name: c.name,
        status: c.status,
        channelType: c.advertising_channel_type,
        accountId: c.account_id,
        accountName: c.accounts?.descriptive_name ?? null,
      })),
    };
  });
}
