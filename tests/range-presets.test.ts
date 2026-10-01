import { describe, expect, it } from 'vitest';
import { RANGE_PRESETS, presetDays, presetLabel, presetOffset } from '@/lib/dates-client';
import { windowOf, utcDay, isoDay, previousWindow } from '@/lib/ops/dates';

const refs = { latest: utcDay('2026-10-01'), prior: utcDay('2026-09-30'), earliest: utcDay('2025-05-16') };
const win = (days: number, offset = 0) => {
  const w = windowOf(refs, days, offset);
  return `${isoDay(w.start)}..${isoDay(w.end)}`;
};

describe('Today and Yesterday presets', () => {
  it('exposes both, ahead of the rolling ranges', () => {
    expect(RANGE_PRESETS.slice(0, 2).map((p) => p.key)).toEqual(['today', 'yesterday']);
    expect(presetLabel('today')).toBe('Today');
    expect(presetLabel('yesterday')).toBe('Yesterday');
  });

  it('Today is the single latest day', () => {
    expect(presetDays('today')).toBe(1);
    expect(presetOffset('today')).toBe(0);
    expect(win(presetDays('today'), presetOffset('today'))).toBe('2026-10-01..2026-10-01');
  });

  it('Yesterday is the single day before, not a two-day span', () => {
    expect(presetDays('yesterday')).toBe(1);
    expect(presetOffset('yesterday')).toBe(1);
    expect(win(presetDays('yesterday'), presetOffset('yesterday'))).toBe('2026-09-30..2026-09-30');
  });

  it('leaves every rolling preset ending on the latest day', () => {
    for (const p of RANGE_PRESETS.filter((x) => x.key !== 'yesterday')) {
      expect(windowOf(refs, p.days, presetOffset(p.key)).end).toEqual(refs.latest);
    }
  });

  it('compares Today against Yesterday, one day each', () => {
    const w = windowOf(refs, 1, 0);
    const prev = previousWindow(w.start, w.end);
    expect(`${isoDay(prev.start)}..${isoDay(prev.end)}`).toBe('2026-09-30..2026-09-30');
  });

  it('compares Yesterday against the day before it', () => {
    const w = windowOf(refs, 1, 1);
    const prev = previousWindow(w.start, w.end);
    expect(`${isoDay(prev.start)}..${isoDay(prev.end)}`).toBe('2026-09-29..2026-09-29');
  });

  it('defaults the offset to 0 for an unknown or custom key', () => {
    expect(presetOffset('custom')).toBe(0);
    expect(presetOffset('nonsense')).toBe(0);
  });

  it('ignores a negative offset rather than running the window forwards', () => {
    expect(win(1, -5)).toBe('2026-10-01..2026-10-01');
  });
});
