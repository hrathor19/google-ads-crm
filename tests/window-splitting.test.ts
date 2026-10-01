import { describe, expect, it, vi } from 'vitest';
import { fetchWindowSplitting } from '@/lib/google-ads/reports';

const TOO_BIG = () => new Error('Cannot create a string longer than 0x1fffffe8 characters');
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('fetchWindowSplitting', () => {
  it('passes the window straight through when it fits', async () => {
    const fetchOne = vi.fn(async () => [1, 2, 3]);
    expect(await fetchWindowSplitting(day('2025-09-01'), day('2025-09-30'), fetchOne)).toEqual([1, 2, 3]);
    expect(fetchOne).toHaveBeenCalledTimes(1);
  });

  it('halves an oversized window and returns both halves', async () => {
    const seen: string[] = [];
    const fetchOne = vi.fn(async (s: Date, e: Date) => {
      if (iso(s) === '2025-09-01' && iso(e) === '2025-09-30') throw TOO_BIG();
      seen.push(`${iso(s)}..${iso(e)}`);
      return [iso(s)];
    });
    const out = await fetchWindowSplitting(day('2025-09-01'), day('2025-09-30'), fetchOne);
    expect(seen.sort()).toEqual(['2025-09-01..2025-09-15', '2025-09-16..2025-09-30']);
    expect(out.sort()).toEqual(['2025-09-01', '2025-09-16']);
  });

  it('covers every day exactly once when it has to split repeatedly', async () => {
    // Anything wider than 3 days is "too large", forcing several levels.
    const covered: string[] = [];
    const fetchOne = async (s: Date, e: Date) => {
      const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
      if (days > 3) throw TOO_BIG();
      for (let i = 0; i < days; i += 1) covered.push(iso(new Date(s.getTime() + i * 86_400_000)));
      return [days];
    };
    await fetchWindowSplitting(day('2025-09-01'), day('2025-09-30'), fetchOne);
    const expected = Array.from({ length: 30 }, (_, i) => `2025-09-${String(i + 1).padStart(2, '0')}`);
    // No day missed and none fetched twice — a split that drops or duplicates
    // a boundary day is the whole risk of this function.
    expect(covered.sort()).toEqual(expected);
  });

  it('rethrows when a single day is still too large, rather than losing it', async () => {
    const fetchOne = async () => { throw TOO_BIG(); };
    await expect(fetchWindowSplitting(day('2025-09-05'), day('2025-09-05'), fetchOne)).rejects.toThrow(
      /Cannot create a string longer/
    );
  });

  it('does not split on an unrelated error', async () => {
    const fetchOne = vi.fn(async () => { throw new Error('PERMISSION_DENIED'); });
    await expect(fetchWindowSplitting(day('2025-09-01'), day('2025-09-30'), fetchOne)).rejects.toThrow(
      /PERMISSION_DENIED/
    );
    expect(fetchOne).toHaveBeenCalledTimes(1);
  });

  it('handles a two-day window, the smallest splittable case', async () => {
    const seen: string[] = [];
    const fetchOne = async (s: Date, e: Date) => {
      if (s.getTime() !== e.getTime()) throw TOO_BIG();
      seen.push(iso(s));
      return [iso(s)];
    };
    await fetchWindowSplitting(day('2025-09-01'), day('2025-09-02'), fetchOne);
    expect(seen.sort()).toEqual(['2025-09-01', '2025-09-02']);
  });
});
