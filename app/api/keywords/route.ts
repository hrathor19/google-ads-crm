import { z } from 'zod';
import { handle, parseQuery, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { buildKeywordHealth } from '@/lib/ops/services';
import { redactRows } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const extraSchema = z.object({
  campaignPk: z.coerce.number().int().positive().optional(),
  adGroupPk: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('KEYWORDS', 'VIEW');
    const { start, end, scope, accountId } = await resolveFilters(req, principal);
    const extra = parseQuery(req, extraSchema.passthrough());

    const { rows, summary } = await buildKeywordHealth({
      start,
      end,
      scope,
      accountId,
      campaignPk: extra.campaignPk ?? null,
      search: extra.search ?? null,
      limit: extra.limit ?? 1000,
    });

    const redacted = await redactRows(principal, rows);
    return { ...redacted, summary };
  });
}
