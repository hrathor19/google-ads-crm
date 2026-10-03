import 'server-only';
import type { CrmNotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { usersWithPermission } from '@/lib/notifications';
import { sendViaBrevo, type Address, type SendInput } from './brevo';
import type { BriefSection } from './brief';
import {
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
};

export type Resolved = {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
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
  const subject = `${prefix}${renderTemplate(route?.subject ?? ctx.title, vars)}`.trim();

  if (!settings.enabled) return { to: [], cc: [], bcc: [], subject, skipped: 'Email is switched off in the settings.' };
  if (!route) return { to: [], cc: [], bcc: [], subject, skipped: `No route configured for ${event}.` };
  if (!route.enabled) return { to: [], cc: [], bcc: [], subject, skipped: `The ${event} route is switched off.` };
  if (!settings.fromEmail) return { to: [], cc: [], bcc: [], subject, skipped: 'No From address is configured.' };

  // Who the audience resolves to, before the fixed addresses are added.
  let audience: Address[] = [];
  if (route.audience === 'ROLE' && route.audiencePermission) {
    const userIds = await usersWithPermission(route.audiencePermission);
    const users = await prisma.crmUser.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { email: true, name: true },
    });
    audience = users.map((u) => ({ email: u.email, name: u.name ?? undefined }));
  } else if (route.audience === 'REQUESTER' && ctx.requester) {
    audience = parseAddressList(ctx.requester);
  } else if (route.audience === 'ASSIGNEE' && ctx.assignee) {
    audience = parseAddressList(ctx.assignee);
  } else if (route.audience === 'AD_SPECIALIST' && ctx.specialist) {
    // One person, named on this request. The whole reason this audience
    // exists: ROLE would resolve to everyone holding AD_REQUESTS:BUILD, and
    // send one client's budget to every Ad Specialist.
    audience = parseAddressList(ctx.specialist);
  }

  let to = dedupe([...audience, ...parseAddressList(route.toEmails)]);
  let cc = dedupe([...parseAddressList(route.cc), ...parseAddressList(settings.globalCc)]);
  let bcc = dedupe([...parseAddressList(route.bcc), ...parseAddressList(settings.globalBcc)]);

  // Test mode wins over everything, so trying the configuration out cannot
  // mail the whole team by accident.
  const testTo = parseAddress(settings.testModeRecipient ?? '');
  if (testTo) {
    to = [testTo];
    cc = [];
    bcc = [];
  }

  if (to.length === 0) {
    return { to, cc, bcc, subject, skipped: 'The route resolved to nobody.' };
  }
  return { to, cc, bcc, subject };
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

  const sectionHtml = sections
    .map(
      (sec) =>
        `<p style="margin:22px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #e2e8f0;padding-bottom:6px">${escapeHtml(sec.heading)}</p>` +
        `<table role="presentation" width="100%" style="border-collapse:collapse;table-layout:fixed">${sec.rows.map(row).join('')}</table>`
    )
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

  const button = ctx.link
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(ctx.link)}" style="background:#1e293b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px">Open the request</a></p>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#64748b">${escapeHtml(ctx.reference)}${ctx.status ? ` · ${escapeHtml(ctx.status)}` : ''}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.3;color:#0f172a">${escapeHtml(ctx.title)}</h1>
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
    '',
    intro,
    ctx.reason ? `\n${ctx.reasonLabel ?? 'Remarks'}: ${ctx.reason}` : '',
    highlights.length ? `\n${highlights.map((h) => `${h.label}: ${h.value}`).join('\n')}` : '',
    facts.length ? `\n${facts.map(([k, v]) => `${k}: ${v}`).join('\n')}` : '',
    ...sections.map(
      (sec) => `\n${sec.heading.toUpperCase()}\n${sec.rows.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
    ),
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

    const { html, text } = renderBody(ctx, intro);
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
      headers: ctx.requestId
        ? {
            References: `<ad-request-${ctx.requestId}@kollegeapply>`,
            'In-Reply-To': `<ad-request-${ctx.requestId}@kollegeapply>`,
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
