import Papa from 'papaparse';
import { isEmailAddress } from '@/lib/workflow/recipients';

/**
 * A list of people, read out of a spreadsheet.
 *
 * The file this reads is whatever somebody exported from Outlook, typed in
 * Excel or pasted out of a shared sheet, so the headers are matched loosely
 * and a file with no header row at all still works. What it will not do is
 * guess silently: every row it refuses comes back with its line number and
 * the reason, because a directory that quietly drops four of forty people is
 * worse than one that refuses the file.
 */

export type ContactRow = { name: string; email: string };

export type ContactCsvResult = {
  rows: ContactRow[];
  /** Line number and reason for everything that did not make it. */
  skipped: Array<{ line: number; value: string; reason: string }>;
  /** Set when nothing usable came back; the message explains what was wrong. */
  error: string | null;
};

/** A paste big enough to be a mistake rather than a directory. */
export const MAX_CONTACTS_PER_IMPORT = 500;

const NAME_HEADERS = ['name', 'full name', 'contact', 'contact name', 'person', 'display name'];
const EMAIL_HEADERS = ['email', 'e-mail', 'email address', 'mail', 'email id', 'emailid'];

const normalise = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');

/** The header whose name matches, or null when the file has no such column. */
function findColumn(headers: string[], wanted: string[]): string | null {
  for (const h of headers) {
    if (wanted.includes(normalise(h))) return h;
  }
  return null;
}

/**
 * Derive a readable name from an address, for a file that has only addresses.
 *
 * `girish.singh@kollegeapply.com` becomes "Girish Singh". Wrong for a few
 * people, and trivially correctable in the UI — but far better than showing a
 * picker full of bare addresses, which is what the alternative amounts to.
 *
 * Digits are stripped from the END of a word only. Removing them wherever
 * they appear turns `rahul99` into "Rahul" correctly but also shreds `e2e`
 * into "E E" and `k2consulting` into "K Consulting" — a digit inside a word
 * is part of it, while one trailing it is almost always a disambiguator.
 */
export function nameFromEmail(email: string): string {
  const local = email.slice(0, email.lastIndexOf('@'));
  const words = local
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/\d+$/, ''))
    .filter(Boolean);
  if (words.length === 0) return email;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

export function parseContactCsv(text: string): ContactCsvResult {
  const skipped: ContactCsvResult['skipped'] = [];
  const empty = (error: string): ContactCsvResult => ({ rows: [], skipped, error });

  if (!text.trim()) return empty('That file is empty.');

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  let emailCol = findColumn(headers, EMAIL_HEADERS);
  let nameCol = findColumn(headers, NAME_HEADERS);

  // No recognised header. Re-read without one and work the columns out from
  // the data, so a bare two-column paste is not rejected over its first line.
  let records: string[][];
  if (!emailCol) {
    const raw = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    records = (raw.data ?? []).filter((r) => Array.isArray(r));
    // If the first row looks like a header rather than data, drop it.
    const first = records[0] ?? [];
    if (first.length && !first.some((c) => isEmailAddress(String(c ?? '')))) {
      const looksLikeHeader = first.some((c) =>
        [...NAME_HEADERS, ...EMAIL_HEADERS].includes(normalise(String(c ?? '')))
      );
      if (looksLikeHeader) records = records.slice(1);
    }
    return fromColumns(records, skipped);
  }

  records = [];
  const rows: ContactRow[] = [];
  const seen = new Set<string>();
  const data = parsed.data ?? [];
  for (let i = 0; i < data.length; i += 1) {
    const record = data[i] as Record<string, string>;
    // +2: one for the header row, one because people count from 1.
    const line = i + 2;
    const email = String(record[emailCol] ?? '').trim().toLowerCase();
    const name = nameCol ? String(record[nameCol] ?? '').trim() : '';
    const problem = check(email, name, seen);
    if (problem) {
      if (email || name) skipped.push({ line, value: email || name, reason: problem });
      continue;
    }
    seen.add(email);
    rows.push({ email, name: name || nameFromEmail(email) });
    if (rows.length >= MAX_CONTACTS_PER_IMPORT) break;
  }

  if (rows.length === 0) {
    return empty(
      skipped.length > 0
        ? 'No usable rows — every line was skipped. See the reasons below.'
        : `No rows found. The file needs an "Email" column${nameCol ? '' : ' and ideally a "Name" one'}.`
    );
  }
  return { rows, skipped, error: null };
}

/** Headerless: find the address in each row and treat the rest as the name. */
function fromColumns(
  records: string[][],
  skipped: ContactCsvResult['skipped']
): ContactCsvResult {
  const rows: ContactRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < records.length; i += 1) {
    const cells: string[] = records[i] ?? [];
    const line = i + 1;
    const emailCell = cells.find((c: string) => isEmailAddress(String(c ?? '')));
    const email = String(emailCell ?? '').trim().toLowerCase();
    const name = cells
      .filter((c: string) => c !== emailCell)
      .map((c: string) => String(c ?? '').trim())
      .filter(Boolean)
      .join(' ');
    const problem = check(email, name, seen);
    if (problem) {
      const shown = email || name || cells.join(' ').trim();
      if (shown) skipped.push({ line, value: shown, reason: problem });
      continue;
    }
    seen.add(email);
    rows.push({ email, name: name || nameFromEmail(email) });
    if (rows.length >= MAX_CONTACTS_PER_IMPORT) break;
  }
  if (rows.length === 0) {
    return {
      rows,
      skipped,
      error:
        skipped.length > 0
          ? 'No usable rows — every line was skipped. See the reasons below.'
          : 'No email addresses found in that file.',
    };
  }
  return { rows, skipped, error: null };
}

/** Why this row cannot be used, or null when it can. */
function check(email: string, _name: string, seen: Set<string>): string | null {
  if (!email) return 'No email address in this row.';
  if (!isEmailAddress(email)) return 'Not a valid email address.';
  if (seen.has(email)) return 'Already listed earlier in this file.';
  return null;
}
