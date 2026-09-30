import 'server-only';
import { prisma } from './prisma';
import type { CrmAuditAction, Prisma } from '@prisma/client';

/**
 * Audit trail. Mirrors Counselling CRM's `logActivity` helper, including the
 * deliberate choice to denormalise the actor's email onto the row so the trail
 * still reads correctly after a user is removed.
 *
 * Writes are best-effort: an audit failure must never take down the action it
 * was recording.
 */
export async function logAudit(params: {
  actorId?: string | null;
  actorEmail?: string | null;
  action: CrmAuditAction;
  description: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await prisma.crmAuditLog.create({
      data: {
        actorId: params.actorId ?? null,
        actorEmail: params.actorEmail ?? null,
        action: params.action,
        description: params.description,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadata: params.metadata,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit row', err);
  }
}
