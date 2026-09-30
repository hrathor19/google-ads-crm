import { describe, expect, it } from 'vitest';
import { uniformColumns } from '@/lib/google-ads/row-shape';

describe('uniformColumns', () => {
  it('returns the column list when every row matches', () => {
    expect(uniformColumns([{ a: 1, b: 2 }, { a: 3, b: 4 }], 'snaps')).toEqual(['a', 'b']);
  });

  it('accepts keys declared in a different order', () => {
    expect(uniformColumns([{ a: 1, b: 2 }, { b: 4, a: 3 }], 'snaps')).toEqual(['a', 'b']);
  });

  it('rejects a row missing a column rather than inserting undefined for it', () => {
    expect(() => uniformColumns([{ a: 1, b: 2 }, { a: 3 }], 'keyword_snapshots')).toThrow(
      /keyword_snapshots: row 1 .*missing b/
    );
  });

  it('rejects a row with an extra column rather than dropping it', () => {
    expect(() => uniformColumns([{ a: 1 }, { a: 2, cost_micros: 9 }], 'ad_snapshots')).toThrow(
      /unexpected cost_micros/
    );
  });

  it('counts a same-size but differently-keyed row as a mismatch', () => {
    // Equal key counts would pass a naive length check while writing the
    // wrong column entirely.
    expect(() => uniformColumns([{ a: 1, b: 2 }, { a: 3, c: 4 }], 'snaps')).toThrow(/row 1/);
  });

  it('handles a single row', () => {
    expect(uniformColumns([{ a: 1 }], 'snaps')).toEqual(['a']);
  });
});
