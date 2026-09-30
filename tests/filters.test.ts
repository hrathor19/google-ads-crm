import { describe, expect, it } from 'vitest';
import { filterSchema, MAX_WINDOW_DAYS } from '@/lib/api-filters';

/**
 * The shared account + window filter every reporting endpoint accepts.
 *
 * `days` was bounded from the start, but an explicit start/end was not — so a
 * request could ask for a span of decades, which means a wide table scan and a
 * densified series of tens of thousands of points handed to a chart. Bounds on
 * one input and not the equivalent other is the kind of gap that only shows up
 * under a hostile or careless caller.
 */

const ok = (input: unknown) => filterSchema.safeParse(input).success;

describe('date range validation', () => {
  it('accepts a well-formed range', () => {
    expect(ok({ start: '2026-04-01', end: '2026-04-30' })).toBe(true);
  });

  it('accepts a rolling window', () => {
    expect(ok({ days: '30' })).toBe(true);
    expect(ok({})).toBe(true);
  });

  it('rejects an inverted range', () => {
    expect(ok({ start: '2026-09-01', end: '2026-01-01' })).toBe(false);
  });

  it('accepts a single-day range', () => {
    expect(ok({ start: '2026-04-01', end: '2026-04-01' })).toBe(true);
  });

  it('rejects half a range', () => {
    expect(ok({ start: '2026-04-01' })).toBe(false);
    expect(ok({ end: '2026-04-30' })).toBe(false);
  });

  it('rejects a span wider than the days cap', () => {
    expect(ok({ start: '1990-01-01', end: '2040-01-01' })).toBe(false);
  });

  it('allows a span exactly at the cap', () => {
    const start = new Date(Date.UTC(2020, 0, 1));
    const end = new Date(start.getTime() + (MAX_WINDOW_DAYS - 1) * 86_400_000);
    expect(ok({ start: '2020-01-01', end: end.toISOString().slice(0, 10) })).toBe(true);
  });

  it('rejects a malformed date rather than coercing it', () => {
    expect(ok({ start: '01/04/2026', end: '30/04/2026' })).toBe(false);
    expect(ok({ start: '2026-4-1', end: '2026-4-30' })).toBe(false);
  });

  it('bounds the rolling window too', () => {
    expect(ok({ days: '0' })).toBe(false);
    expect(ok({ days: String(MAX_WINDOW_DAYS + 1) })).toBe(false);
    expect(ok({ days: '-5' })).toBe(false);
  });

  it('rejects a non-positive account id', () => {
    expect(ok({ accountId: '0' })).toBe(false);
    expect(ok({ accountId: '-1' })).toBe(false);
    expect(ok({ accountId: '70' })).toBe(true);
  });
});
