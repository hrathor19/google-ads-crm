import { handle, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { evaluateAlerts } from '@/lib/ops/services';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('DASHBOARD', 'VIEW');
    const { scope } = await resolveFilters(req, principal);
    return evaluateAlerts({ scope });
  });
}
