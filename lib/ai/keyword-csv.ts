import Papa from 'papaparse';

/**
 * The Keyword Research export, read back in.
 *
 * The Ads team's flow is: research keywords, export the CSV, upload it here.
 * So this has to read the file that screen writes — which carries a dozen
 * columns — while also accepting a two-column file someone typed by hand,
 * because the moment a tool only accepts its own output somebody is blocked
 * for a reason they cannot see.
 *
 * Deliberately forgiving about headers and strict about values: a keyword
 * with no volume is kept (volume 0) because the word itself is still worth
 * targeting, but a row with no keyword is dropped, since there is nothing
 * left of it.
 */

export type KeywordVolume = { keyword: string; volume: number };

export type KeywordCsvResult = {
  rows: KeywordVolume[];
  /** Things worth telling the user that did not stop the parse. */
  warnings: string[];
  /** Set when nothing usable came back; the message explains what was wrong. */
  error: string | null;
  /** Which column the volume was read from, so the UI can say so. */
  volumeColumn: string | null;
};

/** More than this and the prompt is all keyword list and no brief. */
export const MAX_KEYWORDS = 200;

const KEYWORD_HEADERS = ['keyword', 'keywords', 'search term', 'query', 'text'];
const VOLUME_HEADERS = [
  'avg monthly searches',
  'avg. monthly searches',
  'average monthly searches',
  'monthly searches',
  'searches',
  'volume',
  'search volume',
];

const normalise = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');

/** "1,300" and "1300" both arrive; Excel adds the separator back on save. */
function toVolume(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = Number(String(raw).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function parseKeywordCsv(text: string): KeywordCsvResult {
  const empty = (error: string): KeywordCsvResult => ({
    rows: [],
    warnings: [],
    error,
    volumeColumn: null,
  });

  if (!text.trim()) return empty('That file is empty.');

  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => normalise(h),
  });

  const fields = (parsed.meta.fields ?? []).filter(Boolean);
  if (fields.length === 0) return empty('That file has no header row.');

  const keywordCol = fields.find((f) => KEYWORD_HEADERS.includes(f));
  if (!keywordCol) {
    return empty(
      `No keyword column found. Expected a "Keyword" header; this file has: ${fields.slice(0, 6).join(', ')}.`
    );
  }
  const volumeCol = fields.find((f) => VOLUME_HEADERS.includes(f)) ?? null;

  const warnings: string[] = [];
  if (!volumeCol) {
    warnings.push(
      'No "Avg monthly searches" column, so the keywords are passed through unranked.'
    );
  }

  const seen = new Set<string>();
  const rows: KeywordVolume[] = [];
  let blank = 0;
  let duplicates = 0;

  for (const row of parsed.data) {
    const keyword = String(row[keywordCol] ?? '').trim();
    if (!keyword) {
      blank += 1;
      continue;
    }
    const key = keyword.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    rows.push({ keyword, volume: volumeCol ? toVolume(row[volumeCol]) : 0 });
  }

  if (rows.length === 0) return empty('That file has a header but no keyword rows.');

  // Highest volume first, so a truncated list keeps the keywords that matter.
  rows.sort((a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword));

  const total = rows.length;
  const kept = rows.slice(0, MAX_KEYWORDS);

  if (blank > 0) warnings.push(`${blank} row(s) had no keyword and were skipped.`);
  if (duplicates > 0) warnings.push(`${duplicates} duplicate keyword(s) were merged.`);
  if (total > MAX_KEYWORDS) {
    warnings.push(
      `${total} keywords uploaded; the top ${MAX_KEYWORDS} by volume were kept.`
    );
  }

  return { rows: kept, warnings, error: null, volumeColumn: volumeCol };
}

/**
 * The keyword lines the prompt and the ad request store.
 *
 * Volume is dropped here on purpose: the request's keyword field and the
 * brief mail are read by people, and "mba admission (2,900/mo)" in a brief
 * invites someone to quote a number that is a twelve-month banded average.
 */
export function keywordTextOf(rows: KeywordVolume[]): string {
  return rows.map((r) => r.keyword).join('\n');
}
