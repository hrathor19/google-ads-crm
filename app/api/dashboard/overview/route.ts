import { handle, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { buildOverview, topAndBottomCampaigns } from '@/lib/ops/services';
import { hasPermission } from '@/lib/rbac/permissions';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('DASHBOARD', 'VIEW');
    const { start, end, scope } = await resolveFilters(req, principal);

    const [overview, campaigns] = await Promise.all([
      buildOverview({ start, end, scope }),
      topAndBottomCampaigns({ start, end, scope }),
    ]);

    // FINANCIALS:VIEW is a separate toggle in the matrix. Without it, money
    // is stripped server-side rather than hidden in the component, so the
    // numbers never reach the browser at all.
    const canSeeMoney = await hasPermission(principal, 'FINANCIALS:VIEW');
    if (!canSeeMoney) {
      return { ...redactTotals(overview), ...redactCampaigns(campaigns), canSeeMoney };
    }
    return { ...overview, ...campaigns, canSeeMoney };
  });
}

type Money = { cost: number | null; avgCpc: number | null; costPerConversion: number | null };

function stripMoney<T extends Partial<Money>>(obj: T): T {
  return { ...obj, cost: null, avgCpc: null, costPerConversion: null };
}

function redactTotals(overview: Awaited<ReturnType<typeof buildOverview>>) {
  return {
    ...overview,
    totals: stripMoney(overview.totals),
    previousTotals: stripMoney(overview.previousTotals),
    deltas: stripMoney(overview.deltas),
    series: overview.series.map((p) => ({ ...p, cost: 0, avgCpc: null })),
  };
}

function redactCampaigns(c: Awaited<ReturnType<typeof topAndBottomCampaigns>>) {
  return {
    topSpenders: c.topSpenders.map(stripMoney),
    worstPerformers: c.worstPerformers.map(stripMoney),
  };
}
