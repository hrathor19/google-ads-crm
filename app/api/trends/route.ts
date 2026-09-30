import { handle, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { buildTrends } from '@/lib/ops/services';
import { canSeeFinancials } from '@/lib/redact';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('DASHBOARD', 'VIEW');
    const { start, end, scope } = await resolveFilters(req, principal);
    const trends = await buildTrends({ start, end, scope });

    const canSeeMoney = await canSeeFinancials(principal);
    if (canSeeMoney) return { ...trends, canSeeMoney };

    const strip = (s: typeof trends.series) => s.map((p) => ({ ...p, cost: 0, avgCpc: null }));
    return {
      ...trends,
      canSeeMoney,
      series: strip(trends.series),
      previousSeries: strip(trends.previousSeries),
      totals: { ...trends.totals, cost: null, avgCpc: null, costPerConversion: null },
      previousTotals: {
        ...trends.previousTotals,
        cost: null,
        avgCpc: null,
        costPerConversion: null,
      },
    };
  });
}
