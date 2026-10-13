/**
 * The people copied on one request's mail trail.
 *
 * Every other recipient rule in this app is global: a role, an address typed
 * into a route, or the settings-wide CC. All of them apply to every request
 * alike, so there was no way to say "the sales POC for this LPU campaign
 * belongs on this trail and no other". This is that list.
 *
 * Deliberately isomorphic — no `server-only`, no Prisma, no NextAuth — because
 * the requirement form validates the same input in the browser that the API
 * validates on the server. The domain rule is the one part that lives only on
 * the server, in the route: it reads `AUTH_ALLOWED_DOMAINS`, and the browser
 * is told the answer rather than trusted to work it out.
 */

/**
 * Enough for a campaign's stakeholders, small enough that a typo in a paste
 * cannot quietly turn one request's mail into a mailing list.
 */
export const MAX_REQUEST_RECIPIENTS = 20;

/** The longest address RFC 5321 allows, so the column cannot be stuffed. */
export const EMAIL_MAX = 254;

export const RECIPIENT_NAME_MAX = 120;

/**
 * Deliberately permissive, and the single definition of "looks like an
 * address" in the codebase — `lib/email/settings.ts` re-exports it. The mail
 * provider is the real authority, and a strict pattern rejects addresses that
 * work.
 */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export type RequestRecipient = {
  email: string;
  name?: string | null;
};

/** The domain part, lowercased, or `null` when there isn't one. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return domain || null;
}

/**
 * Lowercase the address, trim the name, drop repeats and blanks.
 *
 * Addresses are compared lowercased because `Girish@…` and `girish@…` are one
 * person, and a trail that mails them twice reads as a bug. The first spelling
 * of a name wins, and order is preserved: the list is read by people, and
 * re-sorting it on every save makes diffs unreadable.
 */
export function normaliseRecipients(list: RequestRecipient[]): RequestRecipient[] {
  const seen = new Set<string>();
  const out: RequestRecipient[] = [];
  for (const raw of list) {
    const email = (raw.email ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const name = (raw.name ?? '').trim();
    out.push({ email, name: name || null });
  }
  return out;
}

/**
 * What is wrong with this list, in the words the person who typed it needs —
 * or `null` when nothing is.
 *
 * `allowedDomains` empty means no domain restriction, which is the right
 * reading of "not configured" and matches `isAllowedDomain` in `lib/auth.ts`.
 */
export function validateRecipients(
  list: RequestRecipient[],
  allowedDomains: string[] = []
): string | null {
  if (list.length > MAX_REQUEST_RECIPIENTS) {
    return `At most ${MAX_REQUEST_RECIPIENTS} people can be copied on one request.`;
  }
  for (const r of list) {
    if (r.email.length > EMAIL_MAX) return `${r.email} is too long to be an address.`;
    if (!isEmailAddress(r.email)) return `"${r.email}" is not a valid email address.`;
    if ((r.name ?? '').length > RECIPIENT_NAME_MAX) {
      return `The name for ${r.email} is too long.`;
    }
    if (allowedDomains.length > 0) {
      const domain = domainOf(r.email);
      if (!domain || !allowedDomains.includes(domain)) {
        // Said plainly, because the reason is a policy and not a typo: these
        // mails carry the assigned budget and the required CPL.
        return `${r.email} is outside ${allowedDomains.join(', ')}. These mails carry budget and CPL figures, so only company addresses can be copied.`;
      }
    }
  }
  return null;
}

/**
 * Split on separators that are not inside quotes or angle brackets.
 *
 * A plain `split(/[,;\n\t]/)` tears `"Singh, Girish" <g@x.com>` in half, and
 * that is precisely the shape Outlook and Gmail put on the clipboard when a
 * person's name is "Last, First". The comma inside the quotes is part of the
 * name, not a separator.
 */
function splitOutsideQuotes(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angled = false;
  for (const ch of raw) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (ch === '<' && !quoted) {
      angled = true;
      current += ch;
    } else if (ch === '>' && !quoted) {
      angled = false;
      current += ch;
    } else if (!quoted && !angled && (ch === ',' || ch === ';' || ch === '\n' || ch === '\t')) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Split a pasted block into addresses.
 *
 * People paste from a mail client, a spreadsheet column or a chat message, so
 * commas, semicolons, newlines and tabs all have to mean the same thing. A
 * `Name <addr@host>` pair is kept together, since that is what copying a
 * recipient out of Outlook or Gmail gives you.
 */
export function parseRecipientList(raw: string): RequestRecipient[] {
  const out: RequestRecipient[] = [];
  for (const piece of splitOutsideQuotes(raw)) {
    const part = piece.trim();
    if (!part) continue;
    const angled = /^(.*?)<([^>]+)>$/.exec(part);
    if (angled) {
      out.push({ email: angled[2]!.trim(), name: angled[1]!.trim().replace(/^["']|["']$/g, '') || null });
    } else {
      out.push({ email: part, name: null });
    }
  }
  return normaliseRecipients(out);
}

/** `Name <a@b>` for the mail, or the bare address when no name is known. */
export function formatRecipient(r: RequestRecipient): string {
  const name = (r.name ?? '').trim();
  return name ? `${name} <${r.email}>` : r.email;
}

/**
 * A one-line summary of what changed, for the event feed and the audit log.
 * Phrased in people rather than counts where it is short enough to be useful.
 */
export function describeRecipientChange(
  before: RequestRecipient[],
  after: RequestRecipient[]
): string {
  const had = new Set(before.map((r) => r.email));
  const has = new Set(after.map((r) => r.email));
  const added = after.filter((r) => !had.has(r.email)).map((r) => r.email);
  const removed = before.filter((r) => !has.has(r.email)).map((r) => r.email);

  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.join(', ')}`);
  if (removed.length) parts.push(`removed ${removed.join(', ')}`);
  if (parts.length === 0) return 'left the mail trail unchanged';
  return parts.join(' and ');
}
