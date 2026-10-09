import { describe, expect, it } from 'vitest';
import { adRequestFormSchema } from '@/components/data/ad-request-form';

/**
 * The month-by-month lead plan.
 *
 * Rows used to be dropped on the way out if they were not complete — pick a
 * month, forget the number, save, and the month was simply gone with no
 * error anywhere. That is indistinguishable from the app losing data, and
 * it is what "I divided the leads across four months and only January is
 * there" looks like from the outside.
 */

const base = {
  title: 'LPU',
  productService: 'MBA',
  location: 'Delhi',
  startDate: '2026-10-01',
  adUrlClientlpDesktop: 'https://client.kollegeapply.com/x',
};

const parse = (leadTargets: Array<{ month: string; leads: string }>) =>
  adRequestFormSchema.safeParse({ ...base, leadTargets });

const errorFor = (r: ReturnType<typeof parse>) =>
  r.success ? null : r.error.issues.find((i) => i.path[0] === 'leadTargets')?.message ?? null;

describe('the monthly lead plan', () => {
  it('accepts four complete months', () => {
    const r = parse([
      { month: '2026-10', leads: '250' },
      { month: '2026-11', leads: '250' },
      { month: '2026-12', leads: '250' },
      { month: '2027-01', leads: '250' },
    ]);
    expect(r.success).toBe(true);
  });

  it('refuses a month with no lead number instead of dropping it', () => {
    const r = parse([
      { month: '2026-10', leads: '' },
      { month: '2027-01', leads: '150' },
    ]);
    expect(errorFor(r)).toMatch(/Every month needs a lead number/);
  });

  it('refuses a lead number with no month', () => {
    const r = parse([{ month: '', leads: '150' }]);
    expect(errorFor(r)).toMatch(/every lead number needs a month/);
  });

  it('still ignores a row the user added and never touched', () => {
    // "Add month" leaves an empty pair; that is not an error, it is a row
    // they changed their mind about.
    const r = parse([
      { month: '2027-01', leads: '150' },
      { month: '', leads: '' },
    ]);
    expect(r.success).toBe(true);
  });

  it('still refuses the same month twice', () => {
    const r = parse([
      { month: '2027-01', leads: '100' },
      { month: '2027-01', leads: '50' },
    ]);
    expect(errorFor(r)).toMatch(/only once/);
  });

  it('accepts no plan at all, since it is optional', () => {
    expect(parse([]).success).toBe(true);
    expect(adRequestFormSchema.safeParse(base).success).toBe(true);
  });

  it('treats whitespace as empty, not as a filled row', () => {
    const r = parse([{ month: '2026-10', leads: '   ' }]);
    expect(errorFor(r)).toMatch(/Every month needs a lead number/);
  });
});

// ─── The month picker ───────────────────────────────────────────────────────

import { MONTH_OPTIONS, YEAR_OPTIONS } from '@/components/data/ad-request-form';

describe('the month and year options', () => {
  it('maps every month to the number the stored value needs', () => {
    expect(MONTH_OPTIONS).toHaveLength(12);
    expect(MONTH_OPTIONS[0]).toEqual({ value: '01', label: 'January' });
    expect(MONTH_OPTIONS[11]).toEqual({ value: '12', label: 'December' });
    // Zero-padded, because `YYYY-MM` is what the API's regex accepts and
    // "2026-9" would be rejected as malformed.
    expect(MONTH_OPTIONS.every((m) => /^\d{2}$/.test(m.value))).toBe(true);
  });

  it('is in calendar order, not alphabetical', () => {
    expect(MONTH_OPTIONS.map((m) => m.value)).toEqual([
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
    ]);
  });

  it('offers the current year plus a few intakes either side', () => {
    const thisYear = new Date().getUTCFullYear();
    expect(YEAR_OPTIONS).toContain(thisYear);
    expect(YEAR_OPTIONS).toContain(thisYear + 1);
    // A plan raised in December routinely runs into the next intake year.
    expect(Math.max(...YEAR_OPTIONS)).toBeGreaterThan(thisYear);
  });

  it('builds a value the API accepts', () => {
    // What the two selects compose, checked against the server's own rule.
    const composed = `${YEAR_OPTIONS[1]}-${MONTH_OPTIONS[11]!.value}`;
    expect(composed).toMatch(/^\d{4}-\d{2}$/);
  });
});
