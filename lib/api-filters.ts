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
/** The widest window any endpoint will serve, matching the `days` cap. */
export const MAX_WINDOW_DAYS = 3650;

export const filterSchema = z
  .object({
    accountId: z.coerce.number().int().positive().optional(),
    days: z.coerce.number().int().min(1).max(MAX_WINDOW_DAYS).optional(),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  // `days` was bounded but an explicit range was not, so start/end could ask
  // for a span of decades: a wide scan, and a densified series of tens of
  // thousands of points handed to a chart.
  .refine((v) => (v.start === undefined) === (v.end === undefined), {
    message: 'Provide both start and end, or neither.',
    path: ['start'],
  })
  .refine((v) => !v.start || !v.end || v.start <= v.end, {
    message: 'start must not be after end.',
    path: ['start'],
  })
  .refine(
    (v) => {
      if (!v.start || !v.end) return true;
      const span =
        (Date.parse(`${v.end}T00:00:00Z`) - Date.parse(`${v.start}T00:00:00Z`)) / 86_400_000 + 1;
      return span <= MAX_WINDOW_DAYS;
    },
    { message: `A date range cannot exceed ${MAX_WINDOW_DAYS} days.`, path: ['start'] }
  );

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
