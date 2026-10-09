import 'server-only';
import type { CrmNotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import type { Address } from './infinito';

/**
 * Who gets which mail, and what it says in the subject line.
 *
 * All of it lives in the database rather than in code, because this is the
 * part a Super Admin needs to change without a deploy: the Ops mailbox moves,
 * a manager wants a copy, a client asks to be dropped from a thread.
 */

/**
 * Who a mail can be addressed to.
 *
 * Three resolve against the request itself, two against the permission
 * matrix — so "the Manager" keeps working when somebody new joins that role,
 * which a typed-in address does not.
 */
export const RECIPIENTS = [
  'MANAGER',
  'REQUESTER',
  'AD_SPECIALIST',
  'OPS_TEAM',
  'ADS_TEAM',
] as const;
export type Recipient = (typeof RECIPIENTS)[number];

export const RECIPIENT_LABELS: Record<Recipient, string> = {
  MANAGER: 'Manager',
  REQUESTER: 'Operations — whoever raised it',
  AD_SPECIALIST: 'Ad Specialist on this request',
  OPS_TEAM: 'Everyone in Operations',
  ADS_TEAM: 'Everyone in the Ads team',
};

/** The permission each role-based recipient resolves through. */
export const RECIPIENT_PERMISSION: Partial<Record<Recipient, string>> = {
  MANAGER: 'AD_REQUESTS:ASSIGN',
  OPS_TEAM: 'AD_REQUESTS:CREATE',
  ADS_TEAM: 'AD_REQUESTS:BUILD',
};

/** Every workflow event a mail can be attached to, with a plain description. */
export const EMAIL_EVENTS: Array<{
  event: CrmNotificationType;
  label: string;
  description: string;
  /** Which step of the 13-step flow fires it, for the settings page. */
  step: string;
  /** Who it is for, on a fresh install. Both are sets: a step can address
   *  the person who raised the work and the one doing it. */
  defaultTo: Recipient[];
  defaultCc: Recipient[];
  defaultSubject: string;
}> = [
  {
    event: 'REQUEST_SUBMITTED',
    label: '1. Requirement raised',
    description:
      'Operations submitted a new ad requirement. The mail is a transcript of their form — only what they filled in, so nothing reads as an omission on their part.',
    step: 'Step 1',
    // Whoever staffs the work, not whoever can approve: this mail exists to
    // get a Manager to assign somebody.
    defaultTo: ['MANAGER'],
    defaultCc: [],
    defaultSubject: '{{title}} — new ad requirement raised',
  },
  {
    event: 'REQUEST_SPECIALIST_ASSIGNED',
    label: '2. Assigned, with the budget and CPL',
    description:
      'A Manager put somebody on it and set the money. The brief now carries the Budget and Required CPL — this is the one to build against. Goes to that one person, not everyone who could have been picked.',
    step: 'Step 3',
    defaultTo: ['REQUESTER', 'AD_SPECIALIST'],
    defaultCc: ['MANAGER'],
    defaultSubject: '{{title}} — assigned to you, with budget and CPL',
  },
  {
    event: 'REQUEST_BUDGET_APPROVED',
    label: 'Budget and CPL set (retired)',
    description:
      'Was a separate step after the review. The budget is now agreed at assignment, so nothing reaches this any more — it stays only for requests that were already past it.',
    step: 'Retired',
    defaultTo: ['AD_SPECIALIST'],
    defaultCc: ['MANAGER'],
    defaultSubject: '{{title}} — budget and CPL approved',
  },
  {
    event: 'REQUEST_ADS_SUBMITTED',
    label: '3. Keywords and ad copy submitted',
    description:
      'The Ad Specialist sent the keywords and copy back for review. Goes to whoever reviews them.',
    step: 'Step 5',
    defaultTo: ['MANAGER'],
    defaultCc: ['REQUESTER'],
    defaultSubject: '{{title}} — keywords and ad copy ready for review',
  },
  {
    event: 'REQUEST_APPROVED',
    label: '4. Review approved',
    description: 'The review passed. The Ad Specialist can take it live.',
    step: 'Step 8',
    defaultTo: ['REQUESTER', 'AD_SPECIALIST'],
    defaultCc: ['MANAGER'],
    defaultSubject: '{{title}} — review approved',
  },
  {
    event: 'REQUEST_LIVE',
    label: '5. Campaign live',
    description: 'The campaigns are running. Goes to everyone who has been following the request.',
    step: 'Step 9',
    defaultTo: ['MANAGER'],
    defaultCc: ['AD_SPECIALIST', 'REQUESTER'],
    defaultSubject: '{{title}} — live',
  },

  // ── The review mails. Both carry the remark that was typed, which is the
  // entire point of sending them. ──
  {
    event: 'REQUEST_CHANGES_REQUESTED',
    label: 'Recheck requested',
    description:
      'The review sent it back. The remark is quoted in the mail, so the Ad Specialist knows what to change without opening anything.',
    step: 'Step 7',
    defaultTo: ['AD_SPECIALIST'],
    defaultCc: ['REQUESTER', 'MANAGER'],
    defaultSubject: '{{title}} — recheck requested',
  },
  {
    event: 'REQUEST_REJECTED',
    label: 'Request rejected',
    description: 'The requirement was stopped. Goes back to whoever raised it, with the reason.',
    step: 'Off-ramp',
    defaultTo: ['REQUESTER'],
    defaultCc: ['MANAGER', 'AD_SPECIALIST'],
    defaultSubject: '{{title}} — rejected',
  },

  // ── Retained. Not part of the five, and off by default. ──
  {
    event: 'REQUEST_COMMENTED',
    label: 'Comment added',
    description: 'Someone commented on a request. Off by default — it is chatty.',
    step: 'Any',
    defaultTo: ['REQUESTER', 'AD_SPECIALIST'],
    defaultCc: [],
    defaultSubject: '{{title}} — new comment',
  },
];

/** Events switched off until somebody turns them on. */
const OFF_BY_DEFAULT = new Set<CrmNotificationType>([
  'REQUEST_COMMENTED',
  'REQUEST_BUDGET_APPROVED',
]);

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
      // Each event brings its own default audience. Defaulting everything to
      // ROLE would have mailed the assignment to every Ad Specialist, which
      // is the one thing it must not do.
      data: missing.map((e) => ({
        event: e.event,
        enabled: !OFF_BY_DEFAULT.has(e.event),
        toRoles: e.defaultTo,
        ccRoles: e.defaultCc,
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
