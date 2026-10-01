import 'server-only';
import type { CrmNotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import type { Address } from './brevo';

/**
 * Who gets which mail, and what it says in the subject line.
 *
 * All of it lives in the database rather than in code, because this is the
 * part a Super Admin needs to change without a deploy: the Ops mailbox moves,
 * a manager wants a copy, a client asks to be dropped from a thread.
 */

/** Every workflow event a mail can be attached to, with a plain description. */
export const EMAIL_EVENTS: Array<{
  event: CrmNotificationType;
  label: string;
  description: string;
  /** Sensible default audience for a fresh install. */
  defaultPermission: string;
  defaultSubject: string;
}> = [
  {
    event: 'REQUEST_SUBMITTED',
    label: 'Requirement submitted',
    description: 'Ops has sent a new ad requirement for approval.',
    defaultPermission: 'AD_REQUESTS:APPROVE',
    defaultSubject: '{{title}} — new ad requirement awaiting approval',
  },
  {
    event: 'REQUEST_APPROVED',
    label: 'Request approved',
    description: 'A manager approved the requirement; it moves to the Ads team.',
    defaultPermission: 'AD_REQUESTS:EDIT',
    defaultSubject: '{{title}} — approved, ready to build',
  },
  {
    event: 'REQUEST_REJECTED',
    label: 'Request rejected',
    description: 'A manager rejected the requirement, with a reason.',
    defaultPermission: 'AD_REQUESTS:CREATE',
    defaultSubject: '{{title}} — rejected',
  },
  {
    event: 'REQUEST_CHANGES_REQUESTED',
    label: 'Changes requested',
    description: 'Sent back for a recheck, with remarks.',
    defaultPermission: 'AD_REQUESTS:CREATE',
    defaultSubject: '{{title}} — changes requested',
  },
  {
    event: 'REQUEST_ASSIGNED',
    label: 'Assigned',
    description: 'The request was assigned to someone.',
    defaultPermission: 'AD_REQUESTS:EDIT',
    defaultSubject: '{{title}} — assigned to you',
  },
  {
    event: 'REQUEST_COMMENTED',
    label: 'Comment added',
    description: 'Someone commented on the request.',
    defaultPermission: 'AD_REQUESTS:VIEW',
    defaultSubject: '{{title}} — new comment',
  },
  {
    event: 'REQUEST_STATUS_CHANGED',
    label: 'Status changed',
    description: 'Any other move through the pipeline — ready, live, completed.',
    defaultPermission: 'AD_REQUESTS:VIEW',
    defaultSubject: '{{title}} — now {{status}}',
  },
];

export type EmailSettings = {
  enabled: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  subjectPrefix: string | null;
  globalCc: string | null;
  globalBcc: string | null;
  testModeRecipient: string | null;
};

/**
 * Read the settings, creating the row on first use.
 *
 * Seeded from EMAIL_FROM so a fresh install starts with the sender the Python
 * project already uses, but `enabled` stays false: nothing goes out until
 * someone has looked at the configuration and turned it on deliberately.
 */
export async function getEmailSettings() {
  const existing = await prisma.crmEmailSetting.findUnique({ where: { id: 1 } });
  if (existing) return existing;

  const parsed = parseAddress(env.email().defaultFrom ?? '');
  return prisma.crmEmailSetting.create({
    data: {
      id: 1,
      enabled: false,
      fromName: parsed?.name ?? 'KollegeApply Ads CRM',
      fromEmail: parsed?.email ?? '',
    },
  });
}

/** Read the routes, creating any that are missing from the defaults above. */
export async function getEmailRoutes() {
  const rows = await prisma.crmEmailRoute.findMany();
  const have = new Set(rows.map((r) => r.event));
  const missing = EMAIL_EVENTS.filter((e) => !have.has(e.event));

  if (missing.length) {
    await prisma.crmEmailRoute.createMany({
      data: missing.map((e) => ({
        event: e.event,
        enabled: true,
        audience: 'ROLE' as const,
        audiencePermission: e.defaultPermission,
        subject: e.defaultSubject,
      })),
      skipDuplicates: true,
    });
    return prisma.crmEmailRoute.findMany();
  }
  return rows;
}

/**
 * Parse `Name <a@b.com>` or a bare address.
 *
 * Returns null rather than throwing: an operator half-way through typing a
 * value in the settings form should see a validation message, not a crash.
 */
export function parseAddress(value: string): Address | null {
  const raw = value.trim().replace(/^"|"$/g, '');
  if (!raw) return null;
  const angled = /^(.*?)\s*<([^>]+)>$/.exec(raw);
  const email = (angled ? angled[2] : raw).trim();
  const name = angled ? angled[1]!.trim().replace(/^"|"$/g, '') : '';
  if (!isEmail(email)) return null;
  return name ? { email, name } : { email };
}

export function isEmail(value: string): boolean {
  // Deliberately permissive: the provider is the real authority, and a strict
  // pattern rejects addresses that work.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Split a comma- or newline-separated list into addresses, dropping blanks. */
export function parseAddressList(value: string | null | undefined): Address[] {
  if (!value) return [];
  return value
    .split(/[,\n;]/)
    .map((p) => parseAddress(p))
    .filter((a): a is Address => a !== null);
}

/** Every malformed entry in a list, for a validation message. */
export function invalidAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n;]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && parseAddress(p) === null);
}

/**
 * Fill `{{token}}` placeholders.
 *
 * An unknown token is left as it was written rather than replaced with an
 * empty string, so a typo in the subject shows up in the test mail instead of
 * silently producing a half-blank line.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) =>
    key in vars ? vars[key]! : whole
  );
}

export const TEMPLATE_TOKENS = [
  ['reference', 'AR-0042'],
  ['title', 'the campaign name'],
  ['status', 'the new status'],
  ['actor', 'who did it'],
  ['requester', 'who raised the request'],
  ['assignee', 'who it is assigned to'],
  ['reason', 'the rejection or recheck remark'],
  ['link', 'a link back to the request'],
] as const;
