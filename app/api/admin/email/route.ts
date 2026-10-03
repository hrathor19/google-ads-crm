import { z } from 'zod';
import { clientIp, handle, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { testBrevoConnection } from '@/lib/email/brevo';
import {
  EMAIL_EVENTS,
  getEmailRoutes,
  getEmailSettings,
  invalidAddresses,
  isEmail,
  parseAddress,
} from '@/lib/email/settings';

export const dynamic = 'force-dynamic';

/**
 * Read and write the email configuration.
 *
 * Gated on INTEGRATIONS:MANAGE rather than a new permission: this decides
 * where client budgets and rejection reasons get mailed, which is the same
 * level of trust as holding the API keys.
 */

/** Rejects a list where any entry is malformed, naming the bad ones. */
const addressList = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .superRefine((v, ctx) => {
    const bad = invalidAddresses(v);
    if (bad.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Not a valid address: ${bad.slice(0, 3).join(', ')}`,
      });
    }
  });

const settingsSchema = z.object({
  enabled: z.boolean(),
  fromName: z.string().trim().min(1, 'Give the sender a name').max(120),
  fromEmail: z
    .string()
    .trim()
    .min(1, 'A From address is required')
    .refine(isEmail, 'That is not a valid email address'),
  replyTo: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || parseAddress(v) !== null, 'That is not a valid email address'),
  subjectPrefix: z.string().trim().max(120).nullable().optional().transform((v) => (v ? v : null)),
  globalCc: addressList,
  globalBcc: addressList,
  testModeRecipient: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || parseAddress(v) !== null, 'That is not a valid email address'),
  routes: z
    .array(
      z.object({
        event: z.string(),
        enabled: z.boolean(),
        audience: z.enum(['ROLE', 'REQUESTER', 'ASSIGNEE', 'AD_SPECIALIST', 'FIXED']),
        audiencePermission: z.string().trim().max(100).nullable().optional(),
        toEmails: addressList,
        cc: addressList,
        bcc: addressList,
        subject: z.string().trim().min(1, 'A subject is required').max(300),
        intro: z.string().trim().max(1000).nullable().optional().transform((v) => (v ? v : null)),
      })
    )
    .max(50),
});

export async function GET() {
  return handle(async () => {
    await requirePermission('INTEGRATIONS', 'MANAGE');
    const [settings, routes] = await Promise.all([getEmailSettings(), getEmailRoutes()]);
    const connection = await testBrevoConnection();
    return {
      settings,
      // Filtered to the catalogue, not just sorted by it: a route row for a
      // retired event would otherwise render as a bare enum name with no
      // description, and an operator could configure something that nothing
      // fires.
      routes: routes
        .filter((r) => EMAIL_EVENTS.some((e) => e.event === r.event))
        .sort(
          (a, b) =>
            EMAIL_EVENTS.findIndex((e) => e.event === a.event) -
            EMAIL_EVENTS.findIndex((e) => e.event === b.event)
        ),
      events: EMAIL_EVENTS,
      connection,
    };
  });
}

export async function PUT(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('INTEGRATIONS', 'MANAGE');
    const body = await parseBody(req, settingsSchema);

    await prisma.$transaction(async (tx) => {
      await tx.crmEmailSetting.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          enabled: body.enabled,
          fromName: body.fromName,
          fromEmail: body.fromEmail,
          replyTo: body.replyTo ?? null,
          subjectPrefix: body.subjectPrefix ?? null,
          globalCc: body.globalCc ?? null,
          globalBcc: body.globalBcc ?? null,
          testModeRecipient: body.testModeRecipient ?? null,
          updatedById: principal.userId,
        },
        update: {
          enabled: body.enabled,
          fromName: body.fromName,
          fromEmail: body.fromEmail,
          replyTo: body.replyTo ?? null,
          subjectPrefix: body.subjectPrefix ?? null,
          globalCc: body.globalCc ?? null,
          globalBcc: body.globalBcc ?? null,
          testModeRecipient: body.testModeRecipient ?? null,
          updatedById: principal.userId,
        },
      });

      for (const r of body.routes) {
        await tx.crmEmailRoute.updateMany({
          where: { event: r.event as never },
          data: {
            enabled: r.enabled,
            audience: r.audience,
            audiencePermission: r.audiencePermission ?? null,
            toEmails: r.toEmails ?? null,
            cc: r.cc ?? null,
            bcc: r.bcc ?? null,
            subject: r.subject,
            intro: r.intro ?? null,
          },
        });
      }
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'EMAIL_SETTINGS_UPDATED',
      description: `Updated the email configuration (${body.enabled ? 'enabled' : 'disabled'})`,
      metadata: {
        enabled: body.enabled,
        // The addresses themselves are the point of the change, so they are
        // worth recording; nothing here is a credential.
        from: `${body.fromName} <${body.fromEmail}>`,
        testMode: Boolean(body.testModeRecipient),
        routesEnabled: body.routes.filter((r) => r.enabled).length,
      },
      ipAddress: clientIp(req),
    });

    return { ok: true };
  });
}
