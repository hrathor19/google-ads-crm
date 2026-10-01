import 'server-only';
import type { CrmNotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { usersWithPermission } from '@/lib/notifications';
import { sendViaBrevo, type Address, type SendInput } from './brevo';
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
  reason?: string | null;
  /** Absolute link back into the CRM. */
  link?: string | null;
  /** Lines rendered as a definition list under the intro. */
  facts?: Array<[string, string]>;
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

/** A plain, readable layout. No images, no tracking, nothing to load. */
export function renderBody(
  ctx: EventContext,
  intro: string
): { html: string; text: string } {
  const facts = ctx.facts ?? [];
  const factRows = facts
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#64748b;white-space:nowrap">${escapeHtml(
          k
        )}</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(v)}</td></tr>`
    )
    .join('');

  const button = ctx.link
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(ctx.link)}" style="background:#1e293b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open the request</a></p>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#64748b">${escapeHtml(ctx.reference)}</p>
    <h1 style="margin:0 0 16px;font-size:18px;color:#0f172a">${escapeHtml(ctx.title)}</h1>
    <p style="margin:0;color:#334155;line-height:1.5">${escapeHtml(intro)}</p>
    ${factRows ? `<table style="margin:20px 0 0;border-collapse:collapse;font-size:14px">${factRows}</table>` : ''}
    ${button}
  </div>
  <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">Sent by KollegeApply Ads CRM.</p>
</div></body></html>`;

  const text = [
    ctx.reference,
    ctx.title,
    '',
    intro,
    '',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ctx.link ? `\nOpen the request: ${ctx.link}` : '',
  ]
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
      idempotencyKey: ctx.requestId ? `${ctx.requestId}:${event}` : undefined,
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
      return `${ctx.actor ?? 'Ops'} submitted this ad requirement for approval.`;
    case 'REQUEST_APPROVED':
      return `${ctx.actor ?? 'A manager'} approved this request. It is ready for the Google Ads team.`;
    case 'REQUEST_REJECTED':
      return `${ctx.actor ?? 'A manager'} rejected this request.`;
    case 'REQUEST_CHANGES_REQUESTED':
      return `${ctx.actor ?? 'A manager'} asked for changes before this can be approved.`;
    case 'REQUEST_ASSIGNED':
      return `This request has been assigned to ${ctx.assignee ?? 'you'}.`;
    case 'REQUEST_COMMENTED':
      return `${ctx.actor ?? 'Someone'} commented on this request.`;
    default:
      return `This request is now ${ctx.status ?? 'updated'}.`;
  }
}
