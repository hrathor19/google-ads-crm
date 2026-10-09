import 'server-only';
import type { CrmNotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { usersWithPermission } from '@/lib/notifications';
import { sendEmail, type Address, type SendInput } from './infinito';
import type {
  BriefAdCopy,
  BriefHighlight,
  BriefRow,
  BriefSection,
  BriefTable,
} from './brief';
import {
  RECIPIENT_PERMISSION,
  type Recipient,
  getEmailRoutes,
  getEmailSettings,
  parseAddress,
  parseAddressList,
  renderTemplate,
} from './settings';

/**
 * Turning a workflow event into an addressed, rendered mail.
 *
 * Separate from the transport so the addressing can be tested without a
 * network call, and so swapping the provider touches one file — which it
 * has already had to, from Brevo to Infinito.
 */

export type EventContext = {
  requestId?: string;
  reference: string;
  title: string;
  status?: string;
  actor?: string | null;
  requester?: string | null;
  assignee?: string | null;
  /** The Ad Specialist on this request, as `Name <a@b>`. */
  specialist?: string | null;
  reason?: string | null;
  /** Absolute link back into the CRM. */
  link?: string | null;
  /** Lines rendered as a definition list under the intro. */
  facts?: Array<[string, string]>;
  /** The full requirement, laid out in sections under the intro. */
  sections?: BriefSection[];
  /** Genuine tables — the month-by-month lead plan and anything like it. */
  tables?: BriefTable[];
  /** The KPI strip — budget, leads, CPL, applications, admissions. */
  highlights?: BriefHighlight[];
  /** The line under the title: what, where, and what for. */
  subtitle?: string[];
  /** Start date, location, age — the chips beside the status. */
  meta?: Array<{ icon: string; label: string; value: string }>;
  /** Who raised it and who is building it. */
  ownership?: Array<{ role: string; name: string }>;
  /** The finished copy, once a version has been marked final. */
  adCopy?: BriefAdCopy | null;
  /** Label for the reason block, e.g. "Why it came back". */
  reasonLabel?: string;
  /** Distinguishes repeats of the same event, e.g. the review round. */
  dedupeKey?: string;
  /** What this mail is about — the heading, since the subject is shared. */
  stepLine?: string;
};

/**
 * The one event that opens a trail.
 *
 * Everything else is a reply to it. When the opening mail is switched off
 * the next one carries `Re:` with nothing to reply to, which is harmless —
 * clients thread on the subject regardless.
 */
function isFirstMail(event: CrmNotificationType): boolean {
  return event === 'REQUEST_SUBMITTED';
}

export type Resolved = {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  /** What this particular mail is about, for the body heading. */
  stepLine?: string;
  /** Why it would not send, when it would not. */
  skipped?: string;
};

function dedupe(list: Address[]): Address[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const key = a.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Work out who a given event's mail goes to.
 *
 * Exported because this is the part worth testing exhaustively: a mistake
 * here sends a client's budget to the wrong mailbox.
 */
export async function resolveRecipients(
  event: CrmNotificationType,
  ctx: EventContext
): Promise<Resolved> {
  const settings = await getEmailSettings();
  const routes = await getEmailRoutes();
  const route = routes.find((r) => r.event === event);

  const vars: Record<string, string> = {
    reference: ctx.reference,
    title: ctx.title,
    status: ctx.status ?? '',
    actor: ctx.actor ?? '',
    requester: ctx.requester ?? '',
    assignee: ctx.assignee ?? '',
    specialist: ctx.specialist ?? '',
    reason: ctx.reason ?? '',
    link: ctx.link ?? '',
  };

  const prefix = settings.subjectPrefix ? `${renderTemplate(settings.subjectPrefix, vars)} ` : '';

  // Threading is a property of the subject, not of the headers. Gmail
  // normalises the subject and groups on that first; References only
  // reinforces a grouping it has already made. So every mail about one
  // request gets the same line, and what happened moves into the body.
  const stepLine = renderTemplate(route?.subject ?? ctx.title, vars);
  const threadLine = renderTemplate(settings.threadSubject || '{{title}}', vars);
  const subject = settings.threadPerRequest
    ? `${isFirstMail(event) ? '' : 'Re: '}${prefix}${threadLine}`.trim()
    : `${prefix}${stepLine}`.trim();

  if (!settings.enabled) return { to: [], cc: [], bcc: [], subject, stepLine, skipped: 'Email is switched off in the settings.' };
  if (!route) return { to: [], cc: [], bcc: [], subject, stepLine, skipped: `No route configured for ${event}.` };
  if (!route.enabled) return { to: [], cc: [], bcc: [], subject, stepLine, skipped: `The ${event} route is switched off.` };
  if (!settings.fromEmail) return { to: [], cc: [], bcc: [], subject, stepLine, skipped: 'No From address is configured.' };

  // Each side of the mail is a set of people, resolved fresh. Three kinds
  // come from the request, two from the permission matrix — so "the
  // Manager" keeps working when somebody joins that role, which a typed-in
  // address does not.
  const resolveRoles = async (roles: string[]): Promise<Address[]> => {
    const out: Address[] = [];
    for (const role of roles) {
      if (role === 'REQUESTER') out.push(...parseAddressList(ctx.requester));
      else if (role === 'AD_SPECIALIST') out.push(...parseAddressList(ctx.specialist));
      else {
        const permission = RECIPIENT_PERMISSION[role as Recipient];
        if (!permission) continue;
        const userIds = await usersWithPermission(permission);
        const users = await prisma.crmUser.findMany({
          where: { id: { in: userIds }, isActive: true },
          select: { email: true, name: true },
        });
        out.push(...users.map((u) => ({ email: u.email, name: u.name ?? undefined })));
      }
    }
    return out;
  };

  let to = dedupe([...(await resolveRoles(route.toRoles)), ...parseAddressList(route.toEmails)]);
  let cc = dedupe([
    ...(await resolveRoles(route.ccRoles)),
    ...parseAddressList(route.cc),
    ...parseAddressList(settings.globalCc),
  ]);
  let bcc = dedupe([...parseAddressList(route.bcc), ...parseAddressList(settings.globalBcc)]);

  // Addresses nobody wants swept in by a role. A shared admin login holds
  // every permission by definition, so it lands in every role-based
  // recipient list and there is no way to take it out by editing a rule.
  const suppressed = new Set(
    parseAddressList(settings.suppressedEmails).map((a) => a.email.toLowerCase())
  );
  if (suppressed.size) {
    const keep = (list: Address[]) => list.filter((a) => !suppressed.has(a.email.toLowerCase()));
    to = keep(to);
    cc = keep(cc);
    bcc = keep(bcc);
  }

  // Nobody is told twice. A CC that is already in To reads as a mistake,
  // and some clients show the address in both headers.
  const inTo = new Set(to.map((a) => a.email.toLowerCase()));
  cc = cc.filter((a) => !inTo.has(a.email.toLowerCase()));
  const inEither = new Set(Array.from(inTo).concat(cc.map((a) => a.email.toLowerCase())));
  bcc = bcc.filter((a) => !inEither.has(a.email.toLowerCase()));

  // Test mode wins over everything, so trying the configuration out cannot
  // mail the whole team by accident.
  const testTo = parseAddress(settings.testModeRecipient ?? '');
  if (testTo) {
    to = [testTo];
    cc = [];
    bcc = [];
  }

  if (to.length === 0) {
    return { to, cc, bcc, subject, stepLine, skipped: 'The route resolved to nobody.' };
  }
  return { to, cc, bcc, subject, stepLine };
}

/**
 * The mail body: a header band, a summary strip, and bordered tables.
 *
 * Inline styles and nested tables throughout, because that is the only
 * thing every client agrees on — Outlook strips a `<style>` block and knows
 * nothing of flexbox or CSS grid. Nothing loads from the network at all —
 * the wordmark is text — so the mail renders identically with images
 * blocked, which is the default in most corporate clients.
 *
 * The layout is deliberately tabular. An earlier version laid the brief out
 * as borderless label/value pairs, which read as a wall of text at a glance
 * and made it hard to tell where one fact ended and the next began. Ruled
 * cells with a tinted label column let someone find a single figure without
 * reading the whole thing, which is what people actually do with these.
 */

const C = {
  navy: '#14365d',
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  tint: '#f8fafc',
  page: '#eef2f7',
} as const;

/**
 * A colour per section, so the eye can find the same block in two mails.
 *
 * Head is the card's header strip, edge its border. Deliberately pale: the
 * colour is for navigation, and anything stronger competes with the figures
 * it is supposed to be framing.
 */
const TONES = {
  blue: { head: '#eff6ff', edge: '#bfdbfe', text: '#1d4ed8' },
  green: { head: '#ecfdf5', edge: '#a7f3d0', text: '#047857' },
  amber: { head: '#fffbeb', edge: '#fde68a', text: '#b45309' },
  violet: { head: '#f5f3ff', edge: '#ddd6fe', text: '#6d28d9' },
  rose: { head: '#fdf2f8', edge: '#fbcfe8', text: '#be185d' },
  cyan: { head: '#ecfeff', edge: '#a5f3fc', text: '#0e7490' },
  slate: { head: '#f8fafc', edge: '#e2e8f0', text: '#475569' },
} as const;
type Tone = keyof typeof TONES;

/** Sections are coloured by name so the same block looks the same every time. */
const SECTION_TONE: Record<string, Tone> = {
  Campaign: 'blue',
  'Targeting and timing': 'cyan',
  Targets: 'violet',
  Destinations: 'slate',
  'Landing page score': 'green',
  Notes: 'amber',
};

/**
 * A glyph per section, as HTML entities rather than literal emoji.
 *
 * Entities survive every encoding step between here and the client; a raw
 * emoji in a template literal has to make it through the JSON body and the
 * provider intact, and one mangled byte shows as a replacement character in
 * the header of every mail.
 */
const SECTION_ICON: Record<string, string> = {
  Campaign: '&#128203;',
  'Targeting and timing': '&#127919;',
  Targets: '&#128200;',
  Destinations: '&#128279;',
  'Landing page score': '&#9889;',
  Notes: '&#128221;',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Values that mean "nothing here" and should not take up a row. */
const EMPTY_VALUES = new Set(['—', '', '-']);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Drop a leading "<title> — " and capitalise what is left. */
function trimLeadingTitle(line: string, title: string): string {
  let out = line.trim();
  for (const sep of [' — ', ' - ', ': ']) {
    const prefix = `${title}${sep}`;
    if (out.toLowerCase().startsWith(prefix.toLowerCase())) {
      out = out.slice(prefix.length).trim();
      break;
    }
  }
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : line;
}

/** A card: coloured header strip with a title, then whatever it frames. */
function card(tone: Tone, icon: string, title: string, inner: string, note?: string): string {
  const t = TONES[tone];
  return (
    `<tr><td style="padding:0 0 14px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${t.edge};border-radius:8px;overflow:hidden">` +
    `<tr><td style="background:${t.head};padding:9px 14px;border-bottom:1px solid ${t.edge}">` +
    `<span style="font-family:${FONT};font-size:13px;font-weight:700;color:${t.text}">${icon} ${escapeHtml(title)}</span>` +
    (note
      ? `<span style="font-family:${FONT};font-size:11px;color:${t.text};opacity:.75"> · ${escapeHtml(note)}</span>`
      : '') +
    `</td></tr>` +
    `<tr><td style="padding:0;background:#ffffff">${inner}</td></tr>` +
    `</table></td></tr>`
  );
}

/**
 * One label/value pair as two ruled cells.
 *
 * The label column is a fixed width and tinted, so every section lines up
 * down the page. Sized to content, "Location" and "Blocked locations" put
 * their values at different x positions in adjacent sections, which reads
 * as a broken layout rather than a list.
 */
function pair(label: string, value: string, lastInRow: boolean): string {
  const edge = lastInRow ? '' : `border-right:1px solid ${C.line};`;
  return (
    `<td width="22%" style="width:22%;background:${C.tint};border-bottom:1px solid ${C.line};padding:8px 12px;font-family:${FONT};font-size:11px;line-height:1.35;color:${C.muted};vertical-align:top">${escapeHtml(label)}</td>` +
    `<td width="28%" style="width:28%;border-bottom:1px solid ${C.line};${edge}padding:8px 12px;font-family:${FONT};font-size:13px;line-height:1.4;color:${C.ink};vertical-align:top;word-break:break-word">${escapeHtml(value) || '&nbsp;'}</td>`
  );
}

/** A full-width pair, for URLs and prose that cannot share a line. */
function wholePair(label: string, value: string): string {
  return (
    `<td width="22%" style="width:22%;background:${C.tint};border-bottom:1px solid ${C.line};padding:8px 12px;font-family:${FONT};font-size:11px;line-height:1.35;color:${C.muted};vertical-align:top">${escapeHtml(label)}</td>` +
    `<td colspan="3" style="border-bottom:1px solid ${C.line};padding:8px 12px;font-family:${FONT};font-size:13px;line-height:1.4;color:${C.ink};vertical-align:top;word-break:break-word">${escapeHtml(value) || '&nbsp;'}</td>`
  );
}

function factGrid(rows: BriefRow[]): string {
  const kept = rows.filter((r) => r.always || !EMPTY_VALUES.has(r.value.trim()));
  if (kept.length === 0) return '';

  // Narrow facts first so they pair up without gaps, then the full-width
  // ones. Interleaved, one wide row in the middle of a section orphans the
  // fact beside it and leaves a column of white space down the right.
  const narrow = kept.filter((r) => !r.wide);
  const wide = kept.filter((r) => r.wide);

  const lines: string[] = [];
  for (let i = 0; i < narrow.length; i += 2) {
    const left = narrow[i]!;
    const right = narrow[i + 1];
    lines.push(
      `<tr>${pair(left.label, left.value, !right)}${
        right
          ? pair(right.label, right.value, true)
          : `<td colspan="2" style="border-bottom:1px solid ${C.line}">&nbsp;</td>`
      }</tr>`
    );
  }
  for (const r of wide) lines.push(`<tr>${wholePair(r.label, r.value)}</tr>`);

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">${lines.join('')}</table>`;
}

/** A genuine data table — the monthly lead plan, with its total. */
function dataTable(t: BriefTable): string {
  const align = (i: number) => (t.numeric && i > 0 ? 'right' : 'left');

  const head =
    `<tr>` +
    t.head
      .map(
        (h, i) =>
          `<td align="${align(i)}" style="background:${C.navy};padding:8px 14px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#ffffff">${escapeHtml(h)}</td>`
      )
      .join('') +
    `</tr>`;

  const body = t.body
    .map((cells, rowIndex) => {
      const bg = rowIndex % 2 ? C.tint : '#ffffff';
      return (
        `<tr>` +
        cells
          .map(
            (c, i) =>
              `<td align="${align(i)}" style="background:${bg};border-bottom:1px solid ${C.line};padding:8px 14px;font-family:${FONT};font-size:13px;color:${C.ink}">${escapeHtml(c)}</td>`
          )
          .join('') +
        `</tr>`
      );
    })
    .join('');

  const foot = t.foot
    ? `<tr>` +
      t.foot
        .map(
          (c, i) =>
            `<td align="${align(i)}" style="background:#e8eef6;padding:8px 14px;font-family:${FONT};font-size:13px;font-weight:700;color:${C.ink}">${escapeHtml(c)}</td>`
        )
        .join('') +
      `</tr>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">${head}${body}${foot}</table>`;
}

/** A tick list, two across — headlines, descriptions, sitelinks. */
function tickList(items: string[], columns: 1 | 2 = 1): string {
  if (items.length === 0) return '';
  const cell = (text: string) =>
    `<td width="${columns === 2 ? '50%' : '100%'}" style="padding:4px 14px;font-family:${FONT};font-size:12.5px;line-height:1.45;color:${C.ink};vertical-align:top">` +
    `<span style="color:#16a34a">&#10003;</span> ${escapeHtml(text)}</td>`;
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += columns) {
    const a = items[i]!;
    const b = columns === 2 ? items[i + 1] : undefined;
    rows.push(`<tr>${cell(a)}${columns === 2 ? (b ? cell(b) : '<td></td>') : ''}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;padding:6px 0">${rows.join('')}</table>`;
}

export function renderBody(ctx: EventContext, intro: string): { html: string; text: string } {
  const facts = ctx.facts ?? [];
  const sections = ctx.sections ?? [];
  const tables = ctx.tables ?? [];
  const highlights = ctx.highlights ?? [];
  const subtitle = (ctx.subtitle ?? []).filter(Boolean);
  const meta = ctx.meta ?? [];
  const ownership = ctx.ownership ?? [];
  const adCopy = ctx.adCopy ?? null;

  const step = ctx.stepLine ? trimLeadingTitle(ctx.stepLine, ctx.title) : null;

  // ── Hero: what this is, and who owns it ──
  const ownershipPanel = ownership.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${TONES.amber.edge};border-radius:8px;overflow:hidden;min-width:200px">` +
      `<tr><td style="background:${TONES.amber.head};padding:7px 12px;font-family:${FONT};font-size:11px;font-weight:700;color:${TONES.amber.text}">&#128101; Ownership</td></tr>` +
      ownership
        .map(
          (o) =>
            `<tr><td style="padding:6px 12px;font-family:${FONT};font-size:12px;color:${C.ink}">` +
            `<span style="display:block;font-size:10px;color:${C.faint}">${escapeHtml(o.role)}</span>` +
            `${escapeHtml(o.name)}</td></tr>`
        )
        .join('') +
      `</table>`
    : '';

  const metaChips = meta
    .map(
      (m) =>
        `<span style="display:inline-block;margin:0 14px 0 0;font-family:${FONT};font-size:12px;color:${C.body};white-space:nowrap">` +
        `${m.icon} <span style="color:${C.faint}">${escapeHtml(m.label)}:</span> ${escapeHtml(m.value)}</span>`
    )
    .join('');

  const hero =
    `<tr><td style="padding:0 0 14px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="vertical-align:top">` +
    `<div style="font-family:${FONT};font-size:23px;font-weight:700;line-height:1.25;color:${C.ink}">${escapeHtml(ctx.title)}</div>` +
    (subtitle.length
      ? `<div style="font-family:${FONT};margin-top:4px;font-size:13px;color:${C.muted}">${subtitle.map(escapeHtml).join(' &nbsp;|&nbsp; ')}</div>`
      : '') +
    `<div style="margin-top:10px">` +
    (step
      ? `<span style="display:inline-block;background:${C.navy};color:#ffffff;border-radius:999px;padding:5px 13px;font-family:${FONT};font-size:12px;font-weight:600">${escapeHtml(step)}</span>`
      : '') +
    (ctx.status
      ? `<span style="display:inline-block;margin-left:8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.faint}">${escapeHtml(ctx.status)}</span>`
      : '') +
    `</div>` +
    (metaChips ? `<div style="margin-top:10px">${metaChips}</div>` : '') +
    `</td>` +
    (ownershipPanel ? `<td width="210" style="width:210px;padding-left:16px;vertical-align:top">${ownershipPanel}</td>` : '') +
    `</tr></table></td></tr>`;

  // ── KPI tiles ──
  // Width from the count, not a fixed fifth: three tiles on the Ops mail
  // stretched across a five-column grid left two empty cells that read as
  // figures somebody had forgotten to fill in.
  const tileWidth = `${Math.floor(100 / Math.max(1, highlights.length))}%`;
  const highlightHtml = highlights.length
    ? `<tr><td style="padding:0 0 14px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:6px 0;table-layout:fixed"><tr>` +
      highlights
        .map((h) => {
          const t = TONES[h.tone ?? 'slate'];
          return (
            `<td width="${tileWidth}" style="background:${t.head};border:1px solid ${t.edge};border-radius:8px;padding:11px 12px;vertical-align:top">` +
            `<div style="font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:${t.text};white-space:nowrap">${h.icon ?? ''} ${escapeHtml(h.label)}</div>` +
            `<div style="font-family:${FONT};margin-top:5px;font-size:18px;font-weight:700;color:${h.muted ? C.faint : C.ink}">${escapeHtml(h.value)}</div>` +
            `</td>`
          );
        })
        .join('') +
      `</tr></table></td></tr>`
    : '';

  const reasonHtml = ctx.reason
    ? `<tr><td style="padding:0 0 14px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
      `<tr><td style="border-left:3px solid #f59e0b;background:#fffbeb;padding:11px 14px">` +
      `<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#b45309">${escapeHtml(ctx.reasonLabel ?? 'Remarks')}</div>` +
      `<div style="font-family:${FONT};margin-top:4px;color:#78350f;font-size:13px;line-height:1.5;white-space:pre-wrap">${escapeHtml(ctx.reason)}</div>` +
      `</td></tr></table></td></tr>`
    : '';

  const factsHtml = facts.length
    ? card('slate', '&#128203;', 'Summary', factGrid(facts.map(([label, value]) => ({ label, value }))))
    : '';

  const sectionCards = sections
    .map((sec) => {
      const inner = factGrid(sec.rows);
      return inner
        ? card(
            SECTION_TONE[sec.heading] ?? 'slate',
            SECTION_ICON[sec.heading] ?? '&#9632;',
            sec.heading,
            inner
          )
        : '';
    })
    .join('');

  const tableCards = tables
    .map((t) => card('blue', '&#128202;', t.heading, dataTable(t)))
    .join('');

  // ── The finished copy, as it went into Google ──
  const adCopyCards = adCopy
    ? card(
        'green',
        '&#9998;',
        'Ad copy',
        `<div style="padding:8px 14px 2px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${C.faint}">Headlines</div>` +
          tickList(adCopy.headlines, 2) +
          `<div style="padding:10px 14px 2px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${C.faint}">Descriptions</div>` +
          tickList(adCopy.descriptions, 1) +
          `<div style="height:8px"></div>`,
        `version ${adCopy.version} · ${adCopy.isFinal ? 'final' : 'draft, not yet marked final'}`
      ) +
      (adCopy.sitelinks.length
        ? card(
            'violet',
            '&#128279;',
            'Sitelinks',
            tickList(
              adCopy.sitelinks.map((sl) =>
                [sl.text, sl.description1, sl.description2].filter(Boolean).join(' — ')
              ),
              1
            ) + `<div style="height:8px"></div>`
          )
        : '') +
      (adCopy.keywords.length
        ? card(
            'cyan',
            '&#128269;',
            'Keywords',
            dataTable({
              heading: 'Keywords',
              head: ['Keyword', 'Monthly searches'],
              body: adCopy.keywords
                .slice(0, 25)
                .map((k) => [k.keyword, k.volume > 0 ? k.volume.toLocaleString('en-IN') : '—']),
              numeric: true,
            }),
            adCopy.keywords.length > 25 ? `top 25 of ${adCopy.keywords.length}` : undefined
          )
        : '')
    : '';

  const button = ctx.link
    ? `<tr><td style="padding:6px 0 0">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>` +
      `<td style="background:${C.navy};border-radius:7px"><a href="${escapeHtml(ctx.link)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">Open the campaign request &rarr;</a></td>` +
      `</tr></table></td></tr>`
    : '';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(ctx.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}">
<tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="880" cellpadding="0" cellspacing="0" style="width:880px;max-width:100%;background:#ffffff;border:1px solid ${C.line};border-radius:10px;overflow:hidden">

  <tr><td style="background:${C.navy};padding:14px 20px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="left" style="font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff">KollegeApply <span style="font-weight:400;color:#9bb4d1">Ads CRM</span><span style="font-weight:400;color:#9bb4d1;font-size:12px"> &nbsp;·&nbsp; Campaign Request &amp; Performance Plan</span></td>
      <td align="right" style="white-space:nowrap"><span style="display:inline-block;background:#ffffff;border-radius:5px;padding:4px 10px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.05em;color:${C.navy}">${escapeHtml(ctx.reference)}</span></td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:18px 20px 20px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${hero}
      <tr><td style="padding:0 0 14px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.body}">${escapeHtml(intro)}</td></tr>
      ${reasonHtml}
      ${highlightHtml}
      ${factsHtml}
      ${sectionCards}
      ${tableCards}
      ${adCopyCards}
      ${button}
    </table>
  </td></tr>

  <tr><td style="background:${C.tint};border-top:1px solid ${C.line};padding:13px 20px;font-family:${FONT};font-size:11px;line-height:1.5;color:${C.faint}">
    Sent by KollegeApply Ads CRM. You are receiving this because of how notifications are configured for this step.
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));

  const text = [
    `${ctx.reference}${ctx.status ? ` · ${ctx.status}` : ''}`,
    ctx.title,
    subtitle.length ? subtitle.join(' | ') : '',
    step ? `>> ${step}` : '',
    '',
    intro,
    ctx.reason ? `\n${ctx.reasonLabel ?? 'Remarks'}: ${ctx.reason}` : '',
    ownership.length ? `\n${ownership.map((o) => `${o.role}: ${o.name}`).join('\n')}` : '',
    meta.length ? `\n${meta.map((m) => `${m.label}: ${m.value}`).join('\n')}` : '',
    highlights.length ? `\n${highlights.map((h) => `${h.label}: ${h.value}`).join('\n')}` : '',
    facts.length ? `\n${facts.map(([k, v]) => `${k}: ${v}`).join('\n')}` : '',
    ...sections.map((sec) => {
      const kept = sec.rows.filter((r) => r.always || !EMPTY_VALUES.has(r.value.trim()));
      if (kept.length === 0) return '';
      return `\n${sec.heading.toUpperCase()}\n${kept.map((r) => `  ${r.label}: ${r.value}`).join('\n')}`;
    }),
    // Column-aligned, so the plain part is a table too rather than a list
    // of colons that loses its shape the moment a month name is longer.
    ...tables.map((t) => {
      const widths = t.head.map((h, i) =>
        Math.max(h.length, ...t.body.map((r) => (r[i] ?? '').length), (t.foot?.[i] ?? '').length)
      );
      const line = (cells: string[]) =>
        '  ' + cells.map((c, i) => pad(c, widths[i] ?? 0)).join('  ').trimEnd();
      return [
        `\n${t.heading.toUpperCase()}`,
        line(t.head),
        line(widths.map((w) => '-'.repeat(w))),
        ...t.body.map(line),
        ...(t.foot ? [line(t.foot)] : []),
      ].join('\n');
    }),
    adCopy
      ? `\nAD COPY (version ${adCopy.version}, ${adCopy.isFinal ? 'final' : 'draft'})\n` +
        `  Headlines:\n${adCopy.headlines.map((h) => `    - ${h}`).join('\n')}\n` +
        `  Descriptions:\n${adCopy.descriptions.map((d) => `    - ${d}`).join('\n')}` +
        (adCopy.sitelinks.length
          ? `\n  Sitelinks:\n${adCopy.sitelinks
              .map((sl) => `    - ${[sl.text, sl.description1, sl.description2].filter(Boolean).join(' — ')}`)
              .join('\n')}`
          : '')
      : '',
    ctx.link ? `\nOpen the request: ${ctx.link}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  return { html, text };
}

/**
 * Send the mail for one workflow event.
 *
 * Never throws. A mail failure must not roll back a state transition that has
 * already been committed — the move happened whether or not the notification
 * reached anyone, and the in-app notification is written separately.
 */
export async function sendEventEmail(
  event: CrmNotificationType,
  ctx: EventContext
): Promise<{ sent: boolean; detail: string }> {
  try {
    const resolved = await resolveRecipients(event, ctx);
    if (resolved.skipped) return { sent: false, detail: resolved.skipped };

    const settings = await getEmailSettings();
    const routes = await getEmailRoutes();
    const route = routes.find((r) => r.event === event);

    const intro = await introFor(event, ctx);

    const { html, text } = renderBody({ ...ctx, stepLine: resolved.stepLine }, intro);
    const input: SendInput = {
      from: { email: settings.fromEmail, name: settings.fromName },
      to: resolved.to,
      cc: resolved.cc,
      bcc: resolved.bcc,
      replyTo: parseAddress(settings.replyTo ?? '') ?? undefined,
      subject: resolved.subject,
      html,
      text,
      // Every mail about one request shares a References value, so a client
      // files the whole conversation as one thread.
      // References on every mail, In-Reply-To only on a reply: claiming the
      // opening mail is a reply to a message that was never sent makes some
      // clients start a second thread rather than join one.
      headers: ctx.requestId
        ? {
            References: `<ad-request-${ctx.requestId}@kollegeapply>`,
            ...(isFirstMail(event)
              ? {}
              : { 'In-Reply-To': `<ad-request-${ctx.requestId}@kollegeapply>` }),
          }
        : undefined,
      // Round and status are in the key because a request legitimately hits
      // the same event more than once — three recheck rounds is normal — and
      // `requestId:event` alone would silently drop every repeat.
      idempotencyKey: ctx.requestId
        ? `${ctx.requestId}:${event}:${ctx.dedupeKey ?? ''}`
        : undefined,
    };

    const { messageId } = await sendEmail(input);
    return { sent: true, detail: `Sent to ${resolved.to.length} recipient(s). ${messageId}`.trim() };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Logged, not thrown: the workflow has already moved on.
    console.error('[email] send failed', detail);
    return { sent: false, detail };
  }
}

/**
 * The opening line a mail will carry — the route's own, or the default.
 *
 * Exported so the preview renders the same sentence the send would. It used
 * to show the catalogue's description of the event instead, which is written
 * for the settings page and promised things the mail did not say.
 */
export async function introFor(
  event: CrmNotificationType,
  ctx: EventContext
): Promise<string> {
  const routes = await getEmailRoutes();
  const route = routes.find((r) => r.event === event);
  if (!route?.intro) return defaultIntro(event, ctx);
  return renderTemplate(route.intro, {
    reference: ctx.reference,
    title: ctx.title,
    status: ctx.status ?? '',
    actor: ctx.actor ?? '',
    reason: ctx.reason ?? '',
  });
}

function defaultIntro(event: CrmNotificationType, ctx: EventContext): string {
  switch (event) {
    case 'REQUEST_SUBMITTED':
      return `${ctx.actor ?? 'Operations'} raised this ad requirement. Everything they specified is below; the budget, CPL and the Ad Specialist are still to be decided.`;
    case 'REQUEST_SPECIALIST_ASSIGNED':
      return `You have been assigned to this requirement by ${ctx.actor ?? 'a manager'}. The brief is below.`;
    case 'REQUEST_BUDGET_APPROVED':
      return `${ctx.actor ?? 'A manager'} approved the budget and CPL. This is the brief to build against.`;
    case 'REQUEST_ADS_SUBMITTED':
      return `${ctx.actor ?? 'The Ad Specialist'} submitted the keywords and ad copy for review.`;
    case 'REQUEST_APPROVED':
      return `${ctx.actor ?? 'The reviewer'} approved the keywords and ad copy.`;
    case 'REQUEST_LIVE':
      return `${ctx.actor ?? 'The Ad Specialist'} took this campaign live.`;
    case 'REQUEST_REJECTED':
      return `${ctx.actor ?? 'A reviewer'} stopped this requirement.`;
    case 'REQUEST_CHANGES_REQUESTED':
      return `${ctx.actor ?? 'The reviewer'} sent this back for a recheck. What needs changing is quoted above.`;
    case 'REQUEST_ASSIGNED':
      return `This request has been assigned to ${ctx.assignee ?? 'you'}.`;
    case 'REQUEST_COMMENTED':
      return `${ctx.actor ?? 'Someone'} commented on this request.`;
    default:
      return `This request is now ${ctx.status ?? 'updated'}.`;
  }
}
