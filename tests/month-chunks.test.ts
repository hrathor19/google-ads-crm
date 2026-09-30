import { describe, expect, it } from 'vitest';
import { monthRange, monthsBetween } from '@/lib/ops/month-chunks';

/**
 * The backfill splits a range into month-sized windows. An off-by-one here
 * loses a day or a month of history, and the only symptom is a total that is
 * quietly a little wrong — so the boundaries are pinned explicitly.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('monthsBetween', () => {
  it('is inclusive at both ends', () => {
    expect(monthsBetween('2026-01', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('returns a single month when from equals to', () => {
    expect(monthsBetween('2026-04', '2026-04')).toEqual(['2026-04']);
  });

  it('rolls over the year boundary', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('spans multiple years without dropping a month', () => {
    const months = monthsBetween('2024-01', '2026-09');
    expect(months).toHaveLength(12 + 12 + 9);
    expect(months[0]).toBe('2024-01');
    expect(months[months.length - 1]).toBe('2026-09');
  });

  it('zero-pads the month so the strings sort correctly', () => {
    const months = monthsBetween('2026-08', '2026-10');
    expect(months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect([...months].sort()).toEqual(months);
  });

  it('returns nothing when the range is inverted', () => {
    expect(monthsBetween('2026-06', '2026-01')).toEqual([]);
  });
});

describe('monthRange', () => {
  it('covers the whole of a 31-day month', () => {
    const { start, end } = monthRange('2026-01');
    expect(iso(start)).toBe('2026-01-01');
    expect(iso(end)).toBe('2026-01-31');
  });

  it('covers the whole of a 30-day month', () => {
    const { start, end } = monthRange('2026-04');
    expect(iso(start)).toBe('2026-04-01');
    expect(iso(end)).toBe('2026-04-30');
  });

  it('handles February in a common year', () => {
    const { start, end } = monthRange('2026-02');
    expect(iso(start)).toBe('2026-02-01');
    expect(iso(end)).toBe('2026-02-28');
  });

  it('handles February in a leap year', () => {
    // 2028 is a leap year; a hardcoded 28 would lose the 29th.
    expect(iso(monthRange('2028-02').end)).toBe('2028-02-29');
  });

  it('handles December without rolling into the wrong year', () => {
    const { start, end } = monthRange('2025-12');
    expect(iso(start)).toBe('2025-12-01');
    expect(iso(end)).toBe('2025-12-31');
  });

  it('leaves no gap between consecutive months', () => {
    const months = monthsBetween('2025-11', '2026-09');
    for (let i = 1; i < months.length; i++) {
      const prevEnd = monthRange(months[i - 1]!).end;
      const thisStart = monthRange(months[i]!).start;
      const gapDays = (thisStart.getTime() - prevEnd.getTime()) / 86_400_000;
      expect(gapDays, `gap between ${months[i - 1]} and ${months[i]}`).toBe(1);
    }
  });

  it('covers every day of the range exactly once', () => {
    const months = monthsBetween('2026-01', '2026-12');
    const days = months.reduce((sum, m) => {
      const { start, end } = monthRange(m);
      return sum + (end.getTime() - start.getTime()) / 86_400_000 + 1;
    }, 0);
    expect(days).toBe(365); // 2026 is not a leap year
  });
});
