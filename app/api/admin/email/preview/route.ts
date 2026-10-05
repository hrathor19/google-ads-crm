import { z } from 'zod';
import { handle, parseQuery, prisma, requirePermission } from '@/lib/api';
import { EMAIL_EVENTS } from '@/lib/email/settings';
import { resolveRecipients, renderBody } from '@/lib/email/send';
import { buildRequestBrief } from '@/lib/email/brief';
import { env } from '@/lib/env';
import type { CrmNotificationType } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * What a mail would look like, and who would actually get it.
 *
 * Configuring recipients blind and finding out by sending is the wrong way
 * round: the first real send of a budget mail is the one you cannot take
 * back. This resolves the route exactly as a send would — same audience
 * rules, same test-mode override, same suppression when the event is off —
 * and renders the body, without touching the provider.
 *
 * It reports what it *would* do, including why it would not send.
 */
const schema = z.object({
  event: z.string().trim().min(1),
  /** Preview against a real request; otherwise the most recent one. */
  requestId: z.string().trim().max(64).optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    await requirePermission('INTEGRATIONS', 'MANAGE');
    const q = parseQuery(req, schema);

    const known = EMAIL_EVENTS.find((e) => e.event === q.event);
    if (!known) {
      return { error: `Unknown event ${q.event}.`, events: EMAIL_EVENTS.map((e) => e.event) };
    }
    const event = known.event as CrmNotificationType;

    // A real request, so the preview shows the real brief rather than
    // placeholder text that hides a formatting problem.
    const sample = q.requestId
      ? await prisma.crmAdRequest.findUnique({ where: { id: q.requestId }, select: { id: true } })
      : await prisma.crmAdRequest.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
    if (!sample) {
      return { error: 'There is no ad request to preview against yet.' };
    }

    const brief = await buildRequestBrief(sample.id);
    if (!brief) return { error: 'That request no longer exists.' };

    const base = env.email().publicBaseUrl.replace(/\/$/, '');
    const address = (name: string | null, email: string | null) =>
      email ? (name ? `${name} <${email}>` : email) : null;

    const ctx = {
      requestId: sample.id,
      reference: brief.reference,
      title: brief.title,
      status: brief.statusLabel,
      actor: 'preview@kollegeapply.com',
      requester: address(brief.requesterName, brief.requesterEmail),
      specialist: address(brief.specialistName, brief.specialistEmail),
      assignee: address(brief.specialistName, brief.specialistEmail),
      reason:
        event === 'REQUEST_CHANGES_REQUESTED' || event === 'REQUEST_REJECTED'
          ? 'Example remark — this is where the reviewer’s words appear.'
          : null,
      reasonLabel:
        event === 'REQUEST_CHANGES_REQUESTED' ? 'What needs changing' : 'Why it was stopped',
      link: base ? `${base}/dashboard/ad-requests/${sample.id}` : null,
      highlights: brief.highlights,
      sections: brief.sections,
    };

    const resolved = await resolveRecipients(event, ctx);
    // The step label comes back from the resolver, exactly as the real send
    // takes it. Rendering without it showed a preview missing the one thing
    // that distinguishes mails once they share a subject — a preview that
    // differs from the send is worse than none.
    const { html, text } = renderBody(
      { ...ctx, stepLine: resolved.stepLine },
      known.description
    );

    return {
      event,
      label: known.label,
      step: known.step,
      previewOf: { id: sample.id, reference: brief.reference, title: brief.title },
      subject: resolved.subject,
      stepLine: resolved.stepLine ?? null,
      to: resolved.to,
      cc: resolved.cc,
      bcc: resolved.bcc,
      // Present whenever it would not send — switched off, no From address,
      // or a route that resolves to nobody.
      skipped: resolved.skipped ?? null,
      html,
      text,
    };
  });
}
