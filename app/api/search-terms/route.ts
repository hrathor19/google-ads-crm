import { z } from 'zod';
import { handle, parseQuery, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { searchTermExplore } from '@/lib/ops/metrics';
import { redactRows } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const extraSchema = z.object({
  campaignPk: z.coerce.number().int().positive().optional(),
  adGroupPk: z.coerce.number().int().positive().optional(),
  contains: z.string().optional(),
  minClicks: z.coerce.number().int().min(0).optional(),
  minCost: z.coerce.number().min(0).optional(),
  minCtr: z.coerce.number().min(0).max(1).optional(),
  sort: z.enum(['cost', 'clicks', 'impressions', 'conversions']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('KEYWORDS', 'VIEW');
    const { start, end, scope, accountId } = await resolveFilters(req, principal);
    const extra = parseQuery(req, extraSchema.passthrough());

    const { rows, total } = await searchTermExplore({
      start,
      end,
      scope,
      accountId,
      campaignPk: extra.campaignPk ?? null,
      adGroupPk: extra.adGroupPk ?? null,
      contains: extra.contains ?? null,
      minClicks: extra.minClicks ?? 0,
      minCost: extra.minCost ?? 0,
      minCtr: extra.minCtr ?? null,
      sort: extra.sort ?? 'cost',
      limit: extra.limit ?? 50,
      offset: extra.offset ?? 0,
    });

    const redacted = await redactRows(principal, rows);
    return { ...redacted, total };
  });
}
