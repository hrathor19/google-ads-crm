import 'server-only';
import type { AdRequestStatus, CrmNotificationType } from '@prisma/client';
import { env } from '@/lib/env';
import { buildRequestBrief } from './brief';
import { sendEventEmail, type EventContext } from './send';

/**
 * Which step of the flow sends which mail.
 *
 * One table rather than conditionals scattered through `transition()`, so
 * "what gets mailed when" is answerable by reading eight lines, and adding a
 * step to the flow makes the gap obvious.
 *
 * Note the two entries for the assignment: a Manager names the Ad Specialist
 * at step 3 and approves the money at step 10, so the brief goes to them
 * twice — once to say it is theirs, once carrying the Budget and CPL they
 * build against. They are separate events precisely so either can be
 * switched off on the Email page.
 *
 * The transient statuses are deliberately absent. SUBMITTED, AM_ASSIGNED and
 * ADS_SUBMITTED auto-advance in the same transaction, so mailing on both the
 * step and the state it lands in would send everything twice.
 */
const MAIL_FOR_STATUS: Partial<Record<AdRequestStatus, CrmNotificationType>> = {
  SUBMITTED: 'REQUEST_SUBMITTED',
  AM_ASSIGNED: 'REQUEST_SPECIALIST_ASSIGNED',
  ADS_SUBMITTED: 'REQUEST_ADS_SUBMITTED',
  RECHECK_REQUESTED: 'REQUEST_CHANGES_REQUESTED',
  REVIEW_APPROVED: 'REQUEST_APPROVED',
  BUDGET_APPROVED: 'REQUEST_BUDGET_APPROVED',
  LIVE: 'REQUEST_LIVE',
  REJECTED: 'REQUEST_REJECTED',
};

export function mailEventFor(target: AdRequestStatus): CrmNotificationType | null {
  return MAIL_FOR_STATUS[target] ?? null;
}

/** What the reason block is called, which differs by why it was written. */
function reasonLabel(event: CrmNotificationType): string {
  if (event === 'REQUEST_CHANGES_REQUESTED') return 'What needs changing';
  if (event === 'REQUEST_REJECTED') return 'Why it was stopped';
  return 'Remarks';
}

/**
 * Send the mail for a transition that has already committed.
 *
 * Never throws and never blocks the caller's result: the status changed
 * whether or not Brevo was reachable, and a 500 here would tell the user
 * their approval failed when it did not.
 */
export async function mailForTransition(params: {
  requestId: string;
  target: AdRequestStatus;
  actorEmail: string;
  actorName?: string | null;
  reason?: string | null;
  /** Review round, so three rechecks send three mails rather than one. */
  round?: number;
}): Promise<{ sent: boolean; detail: string }> {
  const event = mailEventFor(params.target);
  if (!event) return { sent: false, detail: `No mail is configured for ${params.target}.` };

  try {
    const brief = await buildRequestBrief(params.requestId);
    if (!brief) return { sent: false, detail: 'The request no longer exists.' };

    const base = env.email().publicBaseUrl.replace(/\/$/, '');
    const address = (name: string | null, email: string | null) =>
      email ? (name ? `${name} <${email}>` : email) : null;

    const ctx: EventContext = {
      requestId: params.requestId,
      reference: brief.reference,
      title: brief.title,
      status: brief.statusLabel,
      actor: params.actorName || params.actorEmail,
      requester: address(brief.requesterName, brief.requesterEmail),
      specialist: address(brief.specialistName, brief.specialistEmail),
      assignee: address(brief.specialistName, brief.specialistEmail),
      reason: params.reason?.trim() || null,
      reasonLabel: reasonLabel(event),
      link: base ? `${base}/dashboard/ad-requests/${params.requestId}` : null,
      highlights: brief.highlights,
      sections: brief.sections,
      dedupeKey: `${params.round ?? 0}`,
    };

    return await sendEventEmail(event, ctx);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[email] workflow mail failed', detail);
    return { sent: false, detail };
  }
}
