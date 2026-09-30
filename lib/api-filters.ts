import 'server-only';
import { z } from 'zod';
import { parseQuery, scopeAccountId, type ApiError } from './api';
import { resolveWindow } from './ops/dates';
import type { Principal } from './rbac/permissions';
import type { Scope } from './ops/metrics';

/**
 * The shared account + window filter every reporting endpoint accepts.
 *
 * Mirrors the source's `OpsFilters`: an explicit `start`/`end` overrides the
 * rolling `days` preset. The resolved `scope` already has the principal's
 * account restriction folded in, so a handler cannot forget to apply it —
 * it has to go out of its way to query without one.
 */
export const filterSchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ResolvedFilters = {
  start: Date;
  end: Date;
  scope: Scope;
  /** The single account asked for, or null for "everything in scope". */
  accountId: number | null;
};

export async function resolveFilters(
  req: Request,
  principal: Principal
): Promise<ResolvedFilters> {
  const q = parseQuery(req, filterSchema);
  const { accountId, accountIds } = scopeAccountId(principal, q.accountId ?? null);
  const { start, end } = await resolveWindow({
    days: q.days,
    start: q.start ?? null,
    end: q.end ?? null,
  });
  return {
    start,
    end,
    accountId,
    scope: { accountIds: accountId !== null ? [accountId] : accountIds },
  };
}

export type { ApiError };
