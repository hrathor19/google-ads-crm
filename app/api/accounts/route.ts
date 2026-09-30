import { handle, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { buildAccountsView } from '@/lib/ops/services';
import { hasPermission } from '@/lib/rbac/permissions';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('ACCOUNTS', 'VIEW');
    const { start, end, scope } = await resolveFilters(req, principal);
    const { rows, totals } = await buildAccountsView({ start, end, scope });

    const canSeeMoney = await hasPermission(principal, 'FINANCIALS:VIEW');
    if (!canSeeMoney) {
      return {
        canSeeMoney,
        totals: { ...totals, cost: null, avgCpc: null, costPerConversion: null },
        rows: rows.map((r) => ({ ...r, cost: null, avgCpc: null, costPerConversion: null })),
      };
    }
    return { canSeeMoney, rows, totals };
  });
}
