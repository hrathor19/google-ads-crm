/**
 * Guard for bulk inserts built from a row's own keys.
 *
 * `replaceWindow` takes the column list from the first row and then reads that
 * same list out of every other row. If the rows are not identically shaped the
 * insert does not fail — a row missing a key contributes an undefined in that
 * column's position, and a row with an extra key has it silently dropped. Both
 * write wrong data quietly, which is the worst way for a sync to break.
 *
 * Returns the column list so callers use the checked value.
 */
export function uniformColumns(rows: Array<Record<string, unknown>>, table: string): string[] {
  const columns = Object.keys(rows[0]!);
  const expected = new Set(columns);

  for (let i = 1; i < rows.length; i += 1) {
    const keys = Object.keys(rows[i]!);
    if (keys.length === expected.size && keys.every((k) => expected.has(k))) continue;

    const missing = columns.filter((c) => !(c in rows[i]!));
    const extra = keys.filter((k) => !expected.has(k));
    throw new Error(
      `${table}: row ${i} does not match the shape of row 0` +
        (missing.length ? `; missing ${missing.join(', ')}` : '') +
        (extra.length ? `; unexpected ${extra.join(', ')}` : '')
    );
  }
  return columns;
}
