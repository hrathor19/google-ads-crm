import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Reference-date resolution. A port of `app/services/ops/dates.py`.
 *
 * The sync stores complete days (the current calendar day's metrics are still
 * accumulating), so "today" operationally means *the latest day we have data
 * for*. Resolving dates from the data rather than the wall clock keeps
 * day-over-day comparisons correct regardless of when the last sync ran.
 */

export type RefDates = {
  /** Most recent day any account has data for ("today"). */
  latest: Date;
  /** The day before ("yesterday"). */
  prior: Date;
  /** The first day any account has data for, or null when there is none. */
  earliest: Date | null;
};

/** A UTC midnight Date for a `YYYY-MM-DD` day — snapshot_date is a bare DATE. */
export function utcDay(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

export function addDays(day: Date, delta: number): Date {
  const out = new Date(day.getTime());
  out.setUTCDate(out.getUTCDate() + delta);
  return out;
}

export function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/**
 * Latest and prior snapshot dates — anchored to the GLOBAL freshest day any
 * account has data for, not the selected account's own latest.
 *
 * Why global: a dormant account's most recent snapshot may be months old (its
 * last active day). Anchoring "last N days" to that stale date shows old data
 * and makes the account look active when it isn't. Anchoring to the freshest
 * day across all accounts means a dormant account correctly reports ~0 for the
 * recent window, matching Google Ads.
 */
export async function resolveRefDates(): Promise<RefDates> {
  const row = await prisma.campaign_snapshots.aggregate({
    _max: { snapshot_date: true },
    _min: { snapshot_date: true },
  });
  const latest = row._max.snapshot_date
    ? utcDay(row._max.snapshot_date)
    : addDays(utcDay(new Date()), -1);
  const earliest = row._min.snapshot_date ? utcDay(row._min.snapshot_date) : null;
  return { latest, prior: addDays(latest, -1), earliest };
}

/** Inclusive (start, end) window of `days` ending at `latest`. */
export function windowOf(refs: RefDates, days: number): { start: Date; end: Date } {
  return { start: addDays(refs.latest, -Math.max(0, days - 1)), end: refs.latest };
}

/**
 * The window immediately before `[start, end]`, of equal length — what the
 * dashboard compares against for "vs previous period".
 */
export function previousWindow(start: Date, end: Date): { start: Date; end: Date } {
  const lengthDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  // The comparison window ends the day before the current one *starts*, not
  // the day before it ends — anchoring on `end` would overlap the two periods
  // and quietly compare the window against most of itself.
  return { start: addDays(start, -lengthDays), end: addDays(start, -1) };
}

/** Fraction of the current UTC day elapsed (for end-of-day projections). */
export function fractionOfDayElapsed(now: Date = new Date()): number {
  const seconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  return seconds / 86_400;
}

/**
 * Resolve the filter a request sent into a concrete window.
 *
 * Mirrors the old `OpsFilters` contract: an explicit `start`/`end` beats the
 * rolling `days` preset when both are present.
 */
export async function resolveWindow(params: {
  days?: number;
  start?: string | null;
  end?: string | null;
}): Promise<{ refs: RefDates; start: Date; end: Date }> {
  const refs = await resolveRefDates();
  if (params.start && params.end) {
    return { refs, start: utcDay(params.start), end: utcDay(params.end) };
  }
  const { start, end } = windowOf(refs, params.days ?? 30);

  // Clamp a preset that reaches past the data to the first day there is any.
  // "All time" is a 10-year rolling window, so without this it reported a
  // window starting in 2016 and compared it against 2006-2016 — dates with no
  // possible meaning, and a previous-period row that looked like a real
  // comparison rather than an absence.
  const clamped = refs.earliest && start < refs.earliest ? refs.earliest : start;
  return { refs, start: clamped, end };
}
