import { z } from 'zod';
import { handle, parseQuery, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { adRollup } from '@/lib/ops/metrics';
import { redactRows } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const extraSchema = z.object({
  adGroupPk: z.coerce.number().int().positive().optional(),
  campaignPk: z.coerce.number().int().positive().optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CAMPAIGNS', 'VIEW');
    const { start, end, scope, accountId } = await resolveFilters(req, principal);
    const { adGroupPk, campaignPk } = parseQuery(req, extraSchema.passthrough());
    const rows = await adRollup(start, end, scope, { adGroupPk, campaignPk, accountId });
    return redactRows(principal, rows);
  });
}
