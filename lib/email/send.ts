import 'server-only';
import type { CrmNotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { usersWithPermission } from '@/lib/notifications';
import { sendViaBrevo, type Address, type SendInput } from './brevo';
import type { BriefRow, BriefSection } from './brief';
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
 * network call, and so swapping Brevo for something else touches one file.
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
  /** Budget / CPL / leads, shown as a strip so they are readable at a glance. */
  highlights?: Array<{ label: string; value: string; muted: boolean }>;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A plain, readable layout. No images, no tracking, nothing to load.
 *
 * Inline styles and tables throughout, because that is the only thing every
 * mail client agrees on — Outlook strips a `<style>` block and knows nothing
 * of flexbox. A long URL gets `word-break`, or one landing page URL widens
 * the whole table past the reading pane.
 */
export function renderBody(
  ctx: EventContext,
  intro: string
): { html: string; text: string } {
  const facts = ctx.facts ?? [];
  const sections = ctx.sections ?? [];
  const highlights = ctx.highlights ?? [];

  // A fixed label column, not one sized to its content. Each section is its
  // own table, so content-sized labels made every section start its values
  // at a different x — "Location" at 225px and "Blocked locations" at 550px
  // down the same page, which reads as a broken layout rather than a list.
  const row = ([k, v]: [string, string]) =>
    `<tr>` +
    `<td width="180" style="width:180px;padding:6px 16px 6px 0;color:#64748b;font-size:13px;vertical-align:top">${escapeHtml(k)}</td>` +
    `<td style="padding:6px 0;color:#0f172a;font-size:13px;vertical-align:top;word-break:break-word">${escapeHtml(v)}</td>` +
    `</tr>`;

  const factRows = facts.map(row).join('');

  // Two facts per line, not one. The brief ran to thirty-odd stacked rows
  // and needed three screens on a phone; paired up and with the blanks
  // dropped it fits in one view, which is the only way anyone reads it
  // before acting on it.
  const EMPTY = new Set(['—', '', '-']);
  const cell = (r: BriefRow, span: number) =>
    `<td colspan="${span}" style="padding:5px 12px 5px 0;vertical-align:top">` +
    `<div style="font-size:11px;color:#94a3b8;letter-spacing:.02em">${escapeHtml(r.label)}</div>` +
    `<div style="font-size:13px;color:#0f172a;word-break:break-word">${escapeHtml(r.value)}</div>` +
    `</td>`;

  const sectionHtml = sections
    .map((sec) => {
      const kept = sec.rows.filter((r) => r.always || !EMPTY.has(r.value.trim()));
      if (kept.length === 0) return '';

      // Narrow facts first so they pair up without gaps, then the
      // full-width ones. Interleaved, a single wide row in the middle of a
      // section orphans the fact on either side of it and leaves a column of
      // white space down the right.
      const narrow = kept.filter((r) => !r.wide);
      const wide = kept.filter((r) => r.wide);

      const lines: string[] = [];
      for (let i = 0; i < narrow.length; i += 2) {
        const left = narrow[i]!;
        const right = narrow[i + 1];
        lines.push(`<tr>${cell(left, 1)}${right ? cell(right, 1) : '<td></td>'}</tr>`);
      }
      for (const r of wide) lines.push(`<tr>${cell(r, 2)}</tr>`);

      return (
        `<p style="margin:18px 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #e2e8f0;padding-bottom:5px">${escapeHtml(sec.heading)}</p>` +
        `<table role="presentation" width="100%" style="border-collapse:collapse;table-layout:fixed">${lines.join('')}</table>`
      );
    })
    .join('');

  // The three figures the flow turns on, side by side. A muted one is the
  // honest rendering of "not decided yet" — the row is there, the value
  // is an em dash, and nobody has to wonder whether it was forgotten.
  const highlightHtml = highlights.length
    ? `<table role="presentation" width="100%" style="margin:18px 0 0;border-collapse:separate;border-spacing:8px 0"><tr>${highlights
        .map(
          (h) =>
            `<td width="33%" style="background:${h.muted ? '#f8fafc' : '#f1f5f9'};border:1px solid ${h.muted ? '#e2e8f0' : '#cbd5e1'};border-radius:6px;padding:10px 12px">` +
            `<div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8">${escapeHtml(h.label)}</div>` +
            `<div style="margin-top:3px;font-size:16px;font-weight:600;color:${h.muted ? '#94a3b8' : '#0f172a'}">${escapeHtml(h.value)}</div>` +
            `</td>`
        )
        .join('')}</tr></table>`
    : '';

  const reasonHtml = ctx.reason
    ? `<div style="margin:18px 0 0;border-left:3px solid #f59e0b;background:#fffbeb;padding:10px 14px">` +
      `<p style="margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#b45309">${escapeHtml(ctx.reasonLabel ?? 'Remarks')}</p>` +
      `<p style="margin:0;color:#78350f;font-size:13px;line-height:1.5;white-space:pre-wrap">${escapeHtml(ctx.reason)}</p>` +
      `</div>`
    : '';

  // Every mail in a trail now shares a subject, so this is the only thing
  // telling them apart in the reading pane. It is deliberately the most
  // prominent element after the title.
  // The stored label reads "MICA — budget and CPL approved", which is right
  // for a subject line but says the client's name twice under a heading that
  // is already the client's name. Trimmed here rather than changed in the
  // database, so a subject still reads correctly if one-trail is switched
  // off and the label becomes the subject again.
  const step = ctx.stepLine ? trimLeadingTitle(ctx.stepLine, ctx.title) : null;
  const stepBadge = step
    ? `<p style="margin:0 0 14px"><span style="display:inline-block;background:#1e293b;color:#fff;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;letter-spacing:.01em">${escapeHtml(step)}</span></p>`
    : '';

  const button = ctx.link
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(ctx.link)}" style="background:#1e293b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px">Open the request</a></p>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#64748b">${escapeHtml(ctx.reference)}${ctx.status ? ` · ${escapeHtml(ctx.status)}` : ''}</p>
    <h1 style="margin:0 0 10px;font-size:19px;line-height:1.3;color:#0f172a">${escapeHtml(ctx.title)}</h1>
    ${stepBadge}
    <p style="margin:0;color:#334155;line-height:1.55;font-size:14px">${escapeHtml(intro)}</p>
    ${reasonHtml}
    ${highlightHtml}
    ${factRows ? `<table role="presentation" width="100%" style="margin:18px 0 0;border-collapse:collapse;table-layout:fixed">${factRows}</table>` : ''}
    ${sectionHtml}
    ${button}
  </div>
  <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">Sent by KollegeApply Ads CRM. You are receiving this because of how notifications are configured for this step.</p>
</div></body></html>`;

  const text = [
    `${ctx.reference}${ctx.status ? ` · ${ctx.status}` : ''}`,
    ctx.title,
    step ? `>> ${step}` : '',
    '',
    intro,
    ctx.reason ? `\n${ctx.reasonLabel ?? 'Remarks'}: ${ctx.reason}` : '',
    highlights.length ? `\n${highlights.map((h) => `${h.label}: ${h.value}`).join('\n')}` : '',
    facts.length ? `\n${facts.map(([k, v]) => `${k}: ${v}`).join('\n')}` : '',
    ...sections.map((sec) => {
      const kept = sec.rows.filter((r) => r.always || !['—', '', '-'].includes(r.value.trim()));
      if (kept.length === 0) return '';
      return `\n${sec.heading.toUpperCase()}\n${kept.map((r) => `  ${r.label}: ${r.value}`).join('\n')}`;
    }),
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

    const vars: Record<string, string> = {
      reference: ctx.reference,
      title: ctx.title,
      status: ctx.status ?? '',
      actor: ctx.actor ?? '',
      reason: ctx.reason ?? '',
    };
    const intro = route?.intro
      ? renderTemplate(route.intro, vars)
      : defaultIntro(event, ctx);

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

    const { messageId } = await sendViaBrevo(input);
    return { sent: true, detail: `Sent to ${resolved.to.length} recipient(s). ${messageId}`.trim() };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Logged, not thrown: the workflow has already moved on.
    console.error('[email] send failed', detail);
    return { sent: false, detail };
  }
}

function defaultIntro(event: CrmNotificationType, ctx: EventContext): string {
  switch (event) {
    case 'REQUEST_SUBMITTED':
      return `${ctx.actor ?? 'Operations'} raised this ad requirement. The brief is below — the budget and CPL are still to be decided.`;
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
