import { z } from 'zod';
import { badRequest, clientIp, handle, parseBody, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email/infinito';
import { getEmailSettings, isEmail, parseAddress, renderTemplate } from '@/lib/email/settings';
import { renderBody, resolveRecipients } from '@/lib/email/send';
import type { CrmNotificationType } from '@prisma/client';

export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Send a real mail here, instead of to whoever the route resolves to. */
  to: z.string().trim().min(1, 'Who should the test go to?').refine(isEmail, 'Not a valid address'),
  /** Preview this event's subject and body. */
  event: z.string().default('REQUEST_SUBMITTED'),
});

/**
 * Send one real mail, to one address the operator names.
 *
 * Deliberately not "send to the configured recipients": the point is to prove
 * the credentials and the sender work before anything reaches a client. It
 * uses the configured subject and layout so what arrives is what the workflow
 * would send.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('INTEGRATIONS', 'MANAGE');
    const body = await parseBody(req, schema);

    const settings = await getEmailSettings();
    if (!settings.fromEmail) {
      throw badRequest('Set a From address and save before sending a test.');
    }

    const event = body.event as CrmNotificationType;
    const ctx = {
      reference: 'AR-0000',
      title: 'Test — JIMS Rohini, MBA/PGDM',
      status: 'Pending approval',
      actor: principal.email,
      requester: principal.email,
      link: null,
      facts: [
        ['Courses', 'MBA/PGDM'],
        ['Required leads', '100'],
        ['Location', 'Delhi'],
        ['Sent by', principal.email],
      ] as Array<[string, string]>,
    };

    // The subject the real event would carry, prefix and all.
    const resolved = await resolveRecipients(event, ctx);
    const subject = resolved.subject || 'Ads CRM test';

    const { html, text } = renderBody(
      ctx,
      renderTemplate(
        'This is a test from the Ads CRM email configuration. If it reached you, the ' +
          'The Infinito credentials and the sender address are working.',
        {}
      )
    );

    const to = parseAddress(body.to);
    if (!to) throw badRequest('Not a valid address.');

    const { messageId } = await sendEmail({
      from: { email: settings.fromEmail, name: settings.fromName },
      to: [to],
      replyTo: parseAddress(settings.replyTo ?? '') ?? undefined,
      subject,
      html,
      text,
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'EMAIL_TEST_SENT',
      description: `Sent a test email to ${to.email}`,
      metadata: { to: to.email, event, messageId },
      ipAddress: clientIp(req),
    });

    return {
      ok: true,
      subject,
      messageId,
      detail: `Sent to ${to.email}.`,
      // So the operator can see who the real event would have gone to.
      wouldSendTo: resolved.to.map((a) => a.email),
      skipped: resolved.skipped ?? null,
    };
  });
}
