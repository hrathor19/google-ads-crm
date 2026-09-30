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
  const row = await prisma.campaign_snapshots.aggregate({ _max: { snapshot_date: true } });
  const latest = row._max.snapshot_date
    ? utcDay(row._max.snapshot_date)
    : addDays(utcDay(new Date()), -1);
  return { latest, prior: addDays(latest, -1) };
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
  return { start: addDays(start, -lengthDays), end: addDays(end, -1) };
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
  return { refs, start, end };
}
