'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * The small slice of Markdown the assistant actually produces.
 *
 * It builds React elements and never touches `dangerouslySetInnerHTML`. That
 * is the whole point: the text here is written by a language model from live
 * client data, so it is untrusted by construction. A campaign named
 * `<img onerror=...>` reaching an HTML sink would be a stored XSS with the
 * attacker's payload sitting in the Google Ads account — React escaping every
 * text node removes that class of bug rather than filtering for it.
 *
 * Supported, because it is what the model emits when asked for an answer and
 * a small ranking table: paragraphs, bullet and numbered lists, tables,
 * `**bold**` and `` `code` ``. Anything else renders as its literal text,
 * which is a dull failure rather than a broken one.
 */

/** `**bold**` and `` `code` ``, applied to one line. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass over both markers, longest-first so `**` never matches as `*`.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      out.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    last = match.index + token.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|');
/** The `|---|:--:|` line under a table's header. */
const isTableRule = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-');

const cells = (line: string) =>
  line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());

export function Markdown({ children }: { children: string }) {
  const lines = children.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];

  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // ── Table ──
    if (isTableRow(line) && i + 1 < lines.length && isTableRule(lines[i + 1]!)) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) {
        rows.push(cells(lines[i]!));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                {header.map((h, c) => (
                  <th
                    key={c}
                    className={cellAlign(c, header.length, 'px-2 py-1.5 font-semibold')}
                    scope="col"
                  >
                    {inline(h, `h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-0">
                  {r.map((cell, ci) => (
                    <td key={ci} className={cellAlign(ci, header.length, 'px-2 py-1.5 tabular-nums')}>
                      {inline(cell, `r${ri}c${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // ── Bullet list ──
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="my-1.5 list-disc space-y-0.5 pl-5">
          {items.map((it, n) => (
            <li key={n}>{inline(it, `u${n}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // ── Numbered list ──
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={key++} className="my-1.5 list-decimal space-y-0.5 pl-5">
          {items.map((it, n) => (
            <li key={n}>{inline(it, `o${n}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // ── Heading, flattened: a chat bubble is not a document ──
    if (/^#{1,6}\s+/.test(line)) {
      blocks.push(
        <p key={key++} className="mt-2 font-semibold first:mt-0">
          {inline(line.replace(/^#{1,6}\s+/, ''), `hd${key}`)}
        </p>
      );
      i += 1;
      continue;
    }

    // ── Paragraph: consecutive plain lines ──
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !/^#{1,6}\s+/.test(lines[i]!) &&
      !isTableRow(lines[i]!)
    ) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push(
      <p key={key++} className="my-1.5 first:mt-0 last:mb-0">
        {para.map((l, n) => (
          <Fragment key={n}>
            {n > 0 && ' '}
            {inline(l, `p${key}-${n}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}

/** Numbers read better right-aligned, and in these tables they are last. */
function cellAlign(index: number, total: number, base: string): string {
  return index > 0 && index === total - 1 ? `${base} text-right` : `${base} text-left`;
}
