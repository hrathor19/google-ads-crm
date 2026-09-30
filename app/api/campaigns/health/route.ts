import { handle, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { buildCampaignHealth } from '@/lib/ops/services';
import { redactRows } from '@/lib/redact';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CAMPAIGNS', 'VIEW');
    const { scope } = await resolveFilters(req, principal);
    const { referenceDate, rows } = await buildCampaignHealth({ scope });
    // `spendToday` is the money on this view; surface it under `cost` so the
    // shared redaction helper strips it like every other monetary column.
    const redacted = await redactRows(
      principal,
      rows.map((r) => ({ ...r, cost: r.spendToday }))
    );
    return { referenceDate, ...redacted };
  });
}
