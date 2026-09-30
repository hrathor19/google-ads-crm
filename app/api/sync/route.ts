import { z } from 'zod';
import { clientIp, forbidden, handle, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { runSync, SYNC_ENTITIES, type SyncEntity } from '@/lib/google-ads/sync';
import { syncHealth } from '@/lib/ops/metrics';

export const dynamic = 'force-dynamic';
// A full sync walks 120 accounts; the default serverless budget is far too short.
export const maxDuration = 300;

const schema = z.object({
  entities: z.array(z.enum(SYNC_ENTITIES as [SyncEntity, ...SyncEntity[]])).optional(),
  customerIds: z.array(z.string()).optional(),
  lookbackDays: z.coerce.number().int().min(1).max(365).optional(),
});

/** The "last synced at" indicator. */
export async function GET() {
  return handle(async () => {
    await requirePermission('SYNC', 'VIEW');
    return syncHealth();
  });
}

/** The manual Refresh button. */
export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('SYNC', 'CREATE');
    const body = await parseBody(req, schema);

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'SYNC_TRIGGERED',
      description: `Triggered a sync (${(body.entities ?? SYNC_ENTITIES).join(', ')})`,
      metadata: { entities: body.entities ?? SYNC_ENTITIES, lookbackDays: body.lookbackDays ?? null },
      ipAddress: clientIp(req),
    });

    // A scoped principal may only refresh their own accounts. Without this
    // narrowing, the Refresh button would pull the whole MCC for a user who
    // cannot even read most of it.
    let customerIds = body.customerIds;
    if (principal.allowedAccountIds !== null) {
      const allowed = await prisma.accounts.findMany({
        where: { id: { in: principal.allowedAccountIds } },
        select: { customer_id: true },
      });
      const allowedIds = allowed.map((a) => a.customer_id);
      customerIds = customerIds
        ? customerIds.filter((c) => allowedIds.includes(c.replace(/-/g, '').trim()))
        : allowedIds;
      if (customerIds.length === 0) {
        throw forbidden('None of those accounts are in your scope.');
      }
    }

    return runSync({
      entities: body.entities,
      customerIds,
      lookbackDays: body.lookbackDays,
    });
  });
}
