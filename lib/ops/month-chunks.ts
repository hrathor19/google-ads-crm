/**
 * Month chunking for the historical backfill.
 *
 * Extracted from the script so it can be tested: an off-by-one here silently
 * skips a day or a whole month, and the symptom — a slightly wrong total
 * months later — is close to undiagnosable after the fact.
 */

/** Inclusive list of `YYYY-MM` from `from` to `to`. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The inclusive first and last day of a `YYYY-MM`, in UTC. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    // Day 0 of the *next* month is the last day of this one — which is how
    // February and the 30/31-day split stay correct without a lookup table.
    end: new Date(Date.UTC(y, m, 0)),
  };
}
