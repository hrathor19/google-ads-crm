import 'server-only';
import { prisma } from './prisma';
import type { CrmNotificationType } from '@prisma/client';

/**
 * In-app notifications. Delivery is a DB row plus a poll from the bell menu —
 * no websocket, matching Counselling CRM's notification model.
 */
export async function notify(params: {
  userIds: string[];
  type: CrmNotificationType;
  title: string;
  body: string;
  link?: string;
  requestId?: string;
}): Promise<void> {
  const recipients = Array.from(new Set(params.userIds.filter(Boolean)));
  if (recipients.length === 0) return;

  try {
    await prisma.crmNotification.createMany({
      data: recipients.map((userId) => ({
        userId,
        type: params.type,
        title: params.title,
        body: params.body,
        link: params.link ?? null,
        requestId: params.requestId ?? null,
      })),
    });
  } catch (err) {
    console.error('[notifications] failed to create notifications', err);
  }
}

/**
 * Everyone who can act on a request at its current stage.
 *
 * Resolved from the permission matrix rather than a hardcoded role list, so a
 * custom role with AD_REQUESTS:APPROVE receives approval notifications without
 * anyone editing this file.
 */
export async function usersWithPermission(feature: string): Promise<string[]> {
  const roles = await prisma.crmRole.findMany({
    select: {
      id: true,
      slug: true,
      isSuperAdmin: true,
      permissions: { where: { feature }, select: { allowed: true } },
    },
  });

  const { SEED_ROLES } = await import('./rbac/features');
  const defaults = new Map(SEED_ROLES.map((r) => [r.slug, new Set(r.features)]));

  const roleIds = roles
    .filter((r) => {
      if (r.isSuperAdmin) return true;
      const row = r.permissions[0];
      if (row) return row.allowed;
      return defaults.get(r.slug)?.has(feature) ?? false;
    })
    .map((r) => r.id);

  if (roleIds.length === 0) return [];

  const users = await prisma.crmUser.findMany({
    where: { roleId: { in: roleIds }, isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
