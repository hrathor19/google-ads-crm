import { handle, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { buildPriorityQueue } from '@/lib/ops/services';
import { canSeeFinancials } from '@/lib/redact';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CAMPAIGNS', 'VIEW');
    const { scope } = await resolveFilters(req, principal);
    const queue = await buildPriorityQueue({ scope, limit: 50 });

    const canSeeMoney = await canSeeFinancials(principal);
    if (canSeeMoney) return { ...queue, canSeeMoney };
    return {
      ...queue,
      canSeeMoney,
      estimatedWastedSpend: null,
      rows: queue.rows.map((r) => ({
        ...r,
        spendToday: null,
        budget: null,
        priority: { ...r.priority, estimatedWastedSpend: null },
      })),
    };
  });
}
