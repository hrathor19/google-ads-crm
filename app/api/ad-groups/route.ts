import { z } from 'zod';
import { handle, parseQuery, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { adGroupRollup } from '@/lib/ops/metrics';
import { redactRows } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const extraSchema = z.object({ campaignPk: z.coerce.number().int().positive().optional() });

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CAMPAIGNS', 'VIEW');
    const { start, end, scope, accountId } = await resolveFilters(req, principal);
    const { campaignPk } = parseQuery(req, extraSchema.passthrough());
    const rows = await adGroupRollup(start, end, scope, { campaignPk, accountId });
    return redactRows(principal, rows);
  });
}
