import { handle, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { deviceBreakdown, geoBreakdown } from '@/lib/ops/metrics';
import { canSeeFinancials, stripMoney } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/** Device and geo splits — the two segment dimensions the sync captures. */
export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CAMPAIGNS', 'VIEW');
    const { start, end, scope, accountId } = await resolveFilters(req, principal);

    const [devices, geo] = await Promise.all([
      deviceBreakdown(start, end, scope, accountId),
      geoBreakdown(start, end, scope, accountId),
    ]);

    const canSeeMoney = await canSeeFinancials(principal);
    return {
      canSeeMoney,
      devices: canSeeMoney ? devices : devices.map(stripMoney),
      geo: canSeeMoney ? geo : geo.map(stripMoney),
    };
  });
}
