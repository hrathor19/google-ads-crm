import { z } from 'zod';
import { handle, parseQuery, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { campaignRollup } from '@/lib/ops/metrics';
import { buildCampaignHealth } from '@/lib/ops/services';
import { redactRows } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const extraSchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  /** Attach the health score — the campaign health view asks for it. */
  withHealth: z.enum(['true', 'false']).optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CAMPAIGNS', 'VIEW');
    const { start, end, scope, accountId } = await resolveFilters(req, principal);
    const extra = parseQuery(req, extraSchema.passthrough());

    const rows = await campaignRollup(start, end, scope, {
      accountId,
      statuses: extra.status ? extra.status.split(',') : undefined,
      search: extra.search ?? null,
    });

    let health: Record<number, { score: number; level: string; primaryReason: string | null }> = {};
    if (extra.withHealth === 'true') {
      const built = await buildCampaignHealth({ scope });
      health = Object.fromEntries(
        built.rows.map((r) => [
          r.campaignPk,
          { score: r.score, level: r.level, primaryReason: r.primaryReason },
        ])
      );
    }

    const withHealth = rows.map((r) => ({ ...r, health: health[r.id] ?? null }));
    return redactRows(principal, withHealth);
  });
}
