import { describe, expect, it } from 'vitest';
import { MAX_KEYWORDS, keywordTextOf, parseKeywordCsv } from '@/lib/ai/keyword-csv';

/**
 * Reading the Keyword Research export back into the ad copy generator.
 *
 * This is the join between two screens, so the thing worth testing is that
 * it accepts what the other screen actually writes — the full thirteen-column
 * export, not a tidy two-column fixture — and that it refuses, loudly, a file
 * it cannot make sense of rather than generating copy from nothing.
 */

/** Exactly what the Export CSV button produces, header for header. */
const REAL_EXPORT = [
  'Keyword,Avg monthly searches,Competition,Competition index,Top of page bid (low),Top of page bid (high),Three-month change,Peak month,Peak searches,Already running,Sep 25,Oct 25,Nov 25',
  '"ignou admission mba",3600,High,88,46.63,150.95,33%,Jan 26,5400,No,2900,3600,2900',
  '"mba admission",2900,Medium,62,62.33,248.86,15%,May 26,3600,Yes,2400,2900,2400',
  '"mba, distance",1300,Low,24,27.31,83.15,Emerging,May 26,1600,No,880,1300,1600',
].join('\n');

describe('parseKeywordCsv', () => {
  it('reads the export this app writes', () => {
    const { rows, error, volumeColumn } = parseKeywordCsv(REAL_EXPORT);
    expect(error).toBeNull();
    expect(volumeColumn).toBe('avg monthly searches');
    expect(rows).toEqual([
      { keyword: 'ignou admission mba', volume: 3600 },
      { keyword: 'mba admission', volume: 2900 },
      // The quoted comma inside the keyword must not split the row.
      { keyword: 'mba, distance', volume: 1300 },
    ]);
  });

  it('accepts a two-column file somebody typed by hand', () => {
    const { rows, error } = parseKeywordCsv('keyword,volume\nmba admission,2900\nbba pune,480');
    expect(error).toBeNull();
    expect(rows).toEqual([
      { keyword: 'mba admission', volume: 2900 },
      { keyword: 'bba pune', volume: 480 },
    ]);
  });

  it('does not care about header case or spacing', () => {
    const { rows, error } = parseKeywordCsv('  KEYWORD , Avg   Monthly Searches \nmba,10');
    expect(error).toBeNull();
    expect(rows).toEqual([{ keyword: 'mba', volume: 10 }]);
  });

  it('strips the thousands separator Excel puts back on save', () => {
    const { rows } = parseKeywordCsv('Keyword,Avg monthly searches\nmba admission,"12,100"');
    expect(rows[0]).toEqual({ keyword: 'mba admission', volume: 12100 });
  });

  it('sorts by volume so a truncated list keeps what matters', () => {
    const { rows } = parseKeywordCsv('Keyword,Volume\nsmall,10\nbig,90500\nmid,1300');
    expect(rows.map((r) => r.keyword)).toEqual(['big', 'mid', 'small']);
  });

  it('keeps a keyword with no volume rather than dropping the word', () => {
    const { rows, warnings } = parseKeywordCsv('Keyword\nmba admission\nbba pune');
    expect(rows).toEqual([
      { keyword: 'bba pune', volume: 0 },
      { keyword: 'mba admission', volume: 0 },
    ]);
    expect(warnings.join(' ')).toMatch(/unranked/);
  });

  it('merges duplicates and skips blank rows, and says so', () => {
    const { rows, warnings } = parseKeywordCsv(
      'Keyword,Volume\nmba,100\nMBA,50\n,999\nbba,20'
    );
    expect(rows.map((r) => r.keyword)).toEqual(['mba', 'bba']);
    expect(warnings.join(' ')).toMatch(/1 duplicate/);
    expect(warnings.join(' ')).toMatch(/1 row\(s\) had no keyword/);
  });

  it('caps the list and keeps the busiest', () => {
    const lines = ['Keyword,Volume'];
    for (let i = 0; i < MAX_KEYWORDS + 25; i++) lines.push(`keyword ${i},${i}`);
    const { rows, warnings } = parseKeywordCsv(lines.join('\n'));
    expect(rows).toHaveLength(MAX_KEYWORDS);
    expect(rows[0]!.volume).toBe(MAX_KEYWORDS + 24);
    expect(warnings.join(' ')).toMatch(new RegExp(`top ${MAX_KEYWORDS}`));
  });

  it('refuses a file with no keyword column, naming what it found instead', () => {
    const { error, rows } = parseKeywordCsv('campaign,clicks\nBrand,42');
    expect(rows).toEqual([]);
    expect(error).toMatch(/No keyword column/);
    expect(error).toMatch(/campaign, clicks/);
  });

  it('refuses an empty file and a header with no rows', () => {
    expect(parseKeywordCsv('   ').error).toMatch(/empty/);
    expect(parseKeywordCsv('Keyword,Volume').error).toMatch(/no keyword rows/);
  });

  it('drops a negative or non-numeric volume to zero rather than to NaN', () => {
    const { rows } = parseKeywordCsv('Keyword,Volume\na,-5\nb,n/a');
    expect(rows.every((r) => Number.isFinite(r.volume) && r.volume >= 0)).toBe(true);
  });
});

describe('keywordTextOf', () => {
  it('writes one keyword per line and leaves the volumes behind', () => {
    const text = keywordTextOf([
      { keyword: 'mba admission', volume: 2900 },
      { keyword: 'bba pune', volume: 480 },
    ]);
    expect(text).toBe('mba admission\nbba pune');
    expect(text).not.toMatch(/2900/);
  });
});
