'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Action } from '@/lib/rbac/features';

/**
 * The client-side view of the signed-in user's permissions.
 *
 * This exists to hide menus and buttons, nothing more. Every endpoint enforces
 * the same permission server-side, because a hidden button is a courtesy and a
 * guard is a control — someone with the URL and a fetch call must still be
 * refused.
 */

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  roleName: string;
  roleSlug: string;
  isSuperAdmin: boolean;
  allAccounts: boolean;
  allowedAccountIds: number[] | null;
};

type PermissionContextValue = {
  user: SessionUser;
  features: Set<string>;
  can: (module: string, action: Action) => boolean;
  canAny: (...pairs: Array<[string, Action]>) => boolean;
};

const PermissionContext = createContext<PermissionContextValue | null>(null);

export function PermissionProvider({
  user,
  features,
  children,
}: {
  user: SessionUser;
  features: string[];
  children: ReactNode;
}) {
  const value = useMemo<PermissionContextValue>(() => {
    const set = new Set(features);
    const can = (module: string, action: Action) =>
      user.isSuperAdmin || set.has(`${module}:${action}`);
    return {
      user,
      features: set,
      can,
      canAny: (...pairs) => pairs.some(([m, a]) => can(m, a)),
    };
  }, [user, features]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions(): PermissionContextValue {
  const ctx = useContext(PermissionContext);
  if (!ctx) throw new Error('usePermissions must be used inside a PermissionProvider.');
  return ctx;
}

/** Renders children only when the permission is held. */
export function Can({
  module,
  action,
  children,
  fallback = null,
}: {
  module: string;
  action: Action;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = usePermissions();
  return <>{can(module, action) ? children : fallback}</>;
}
