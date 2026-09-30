import { handle, requirePermission } from '@/lib/api';
import { integrationStatuses } from '@/lib/env';
import { syncHealth } from '@/lib/ops/metrics';

export const dynamic = 'force-dynamic';

/**
 * Integration status. Reports only whether each credential is *present* and a
 * redacted hint — never a secret, not even partially beyond the last four
 * characters, which identify a key without being usable.
 */
export async function GET() {
  return handle(async () => {
    await requirePermission('INTEGRATIONS', 'VIEW');
    return { integrations: integrationStatuses(), sync: await syncHealth() };
  });
}
