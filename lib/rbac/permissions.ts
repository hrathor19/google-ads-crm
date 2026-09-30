import 'server-only';
import { prisma } from '@/lib/prisma';
import { ALL_FEATURES, SEED_ROLES, type Action } from './features';

/**
 * The permission engine.
 *
 * Shape is Counselling CRM's: a `(role, feature) -> allowed` table, a hardcoded
 * per-role default for rows that don't exist yet, and a Super Admin
 * short-circuit. What differs is that roles are rows rather than enum members,
 * so the defaults are keyed by role *slug* and only apply to the seeded roles —
 * a custom role starts with nothing granted, which is the safe direction.
 */

const DEFAULTS_BY_SLUG: Record<string, Set<string>> = Object.fromEntries(
  SEED_ROLES.map((r) => [r.slug, new Set(r.features)])
);

export type Principal = {
  userId: string;
  email: string;
  roleId: string;
  roleSlug: string;
  roleName: string;
  isSuperAdmin: boolean;
  /**
   * `null` means every account. Otherwise the internal `accounts.id` values
   * this principal may read — the user's own scope when they have one, else
   * the role's.
   */
  allowedAccountIds: number[] | null;
  mustChangePassword: boolean;
};

/**
 * Resolve every permission for a role into a flat map.
 *
 * A DB row always wins. A missing row falls back to the seeded default for that
 * slug, so a fresh install behaves sensibly before anyone opens the matrix, and
 * an explicit `false` is never silently upgraded back to the default.
 */
export async function getRolePermissions(roleId: string): Promise<Record<string, boolean>> {
  const role = await prisma.crmRole.findUnique({
    where: { id: roleId },
    include: { permissions: true },
  });
  if (!role) return Object.fromEntries(ALL_FEATURES.map((f) => [f, false]));

  if (role.isSuperAdmin) {
    return Object.fromEntries(ALL_FEATURES.map((f) => [f, true]));
  }

  const rows = new Map(role.permissions.map((p) => [p.feature, p.allowed]));
  const defaults = DEFAULTS_BY_SLUG[role.slug] ?? new Set<string>();

  return Object.fromEntries(
    ALL_FEATURES.map((f) => [f, rows.has(f) ? rows.get(f)! : defaults.has(f)])
  );
}

/** Single-permission check. Super Admin is true for everything. */
export async function hasPermission(principal: Principal, feature: string): Promise<boolean> {
  if (principal.isSuperAdmin) return true;
  const perms = await getRolePermissions(principal.roleId);
  return perms[feature] ?? false;
}

export async function can(
  principal: Principal,
  module: string,
  action: Action
): Promise<boolean> {
  return hasPermission(principal, `${module}:${action}`);
}

/** Every granted feature, for seeding the client-side permission context. */
export async function grantedFeatures(principal: Principal): Promise<string[]> {
  if (principal.isSuperAdmin) return [...ALL_FEATURES];
  const perms = await getRolePermissions(principal.roleId);
  return ALL_FEATURES.filter((f) => perms[f]);
}

// ─── Account scoping ─────────────────────────────────────────────────────────

/**
 * The account ids a principal may read, or `null` for all of them.
 *
 * The user's own scope takes precedence over the role's: assigning one account
 * to a single Operations user shouldn't require cloning the Operations role.
 */
export async function resolveAllowedAccountIds(userId: string): Promise<number[] | null> {
  const user = await prisma.crmUser.findUnique({
    where: { id: userId },
    select: {
      allAccounts: true,
      accountScopes: { select: { accountId: true } },
      role: {
        select: {
          isSuperAdmin: true,
          allAccounts: true,
          accountScopes: { select: { accountId: true } },
        },
      },
    },
  });
  if (!user) return [];
  if (user.role.isSuperAdmin) return null;

  if (!user.allAccounts) return user.accountScopes.map((a) => a.accountId);
  if (!user.role.allAccounts) return user.role.accountScopes.map((a) => a.accountId);
  return null;
}

/**
 * A Prisma `where` fragment that pins a query to the principal's accounts.
 *
 * Returns `{}` for unrestricted principals so it can be spread unconditionally.
 * An empty allow-list yields `{ id: { in: [] } }`, which correctly returns
 * nothing rather than everything — the failure mode that matters.
 */
export function accountScopeWhere(
  principal: Principal,
  column: 'id' | 'account_id' | 'accountId' = 'id'
): Record<string, unknown> {
  if (principal.allowedAccountIds === null) return {};
  return { [column]: { in: principal.allowedAccountIds } };
}

/** Whether a principal may read one specific account. */
export function canAccessAccount(principal: Principal, accountId: number | null): boolean {
  if (principal.allowedAccountIds === null) return true;
  if (accountId === null) return false;
  return principal.allowedAccountIds.includes(accountId);
}
