import { handle, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { buildBudgetMonitor } from '@/lib/ops/services';

export const dynamic = 'force-dynamic';

/**
 * Budget monitoring. Gated on FINANCIALS:VIEW rather than CAMPAIGNS:VIEW —
 * the entire page is money, so there is nothing left to show a role without it.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('FINANCIALS', 'VIEW');
    const { scope } = await resolveFilters(req, principal);
    return buildBudgetMonitor({ scope });
  });
}
