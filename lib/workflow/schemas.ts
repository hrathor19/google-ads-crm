import { z } from 'zod';
import { AdRequestAgeRestriction, AdRequestClientType, AdRequestStatus, CampaignObjective } from '@prisma/client';

/**
 * Request-body shapes for the workflow endpoints.
 *
 * Validation lives here rather than inline so the create and update forms, the
 * API and the tests all agree on what a valid Ad Request is.
 */

// http(s) only: the URL is fetched server-side by the landing-page scorer, and
// allowing another scheme would hand that fetcher an arbitrary target.
const httpUrl = z
  .string()
  .trim()
  .url('Enter a full URL, including https://')
  .refine((v) => /^https?:\/\//i.test(v), 'The URL must start with http:// or https://');

/** An optional free-text box: '' from an untouched input means "not given". */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/** An optional URL — same http(s) rule, but blank is allowed. */
const optionalUrl = z
  .union([httpUrl, z.literal('')])
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

/**
 * An optional whole number typed into a plain text box.
 *
 * Kept numeric rather than stored as text because the flow does arithmetic on
 * these — CPL approval, and pacing delivered leads against the monthly plan.
 * Fields the sheet fills with prose ("End of February") or a dash ("-") stay
 * text, because they are not numbers however they look.
 */
const optionalInt = (label: string, max: number) =>
  z
    .union([z.coerce.number().int().min(0, `${label} cannot be negative`).max(max), z.literal('')])
    .nullable()
    .optional()
    .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v)));

/** One row of the month-by-month lead plan. */
export const leadTargetSchema = z.object({
  /** `YYYY-MM`, rendered as "Sep26" in the sheet. */
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
  leads: z.coerce.number().int().min(0).max(1_000_000),
});

const adRequestFields = z.object({
    // ── Identification ──────────────────────────────────────────────────────
    trackingId: text(100),
    /** The sheet's "Campaign/Client Name". */
    title: z.string().trim().min(3, 'Give the campaign a name').max(200),
    clientType: z.nativeEnum(AdRequestClientType).nullable().optional(),
    accountId: z.coerce.number().int().positive().nullable().optional(),
    objective: z.nativeEnum(CampaignObjective).optional(),
    /** The sheet's "Courses". */
    productService: z.string().trim().min(2, 'Which courses?').max(500),

    // ── Targets ─────────────────────────────────────────────────────────────
    // Budget and CPL are blank in the sheet at submission: they are applied at
    // the budget stage of the flow, so neither is required here.
    budget: z
      .union([z.coerce.number().positive('Enter a budget above zero').max(1_000_000_000), z.literal('')])
      .nullable()
      .optional()
      .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v))),
    requiredCpl: z
      .union([z.coerce.number().positive('CPL must be above zero').max(10_000_000), z.literal('')])
      .nullable()
      .optional()
      .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v))),
    requiredLeads: optionalInt('Required leads', 10_000_000),
    performanceParameter: text(200),
    targetApplication: optionalInt('Target applications', 10_000_000),
    /** Free text: the sheet carries "-" as often as a number. */
    targetAdmission: text(200),

    // ── Dates ───────────────────────────────────────────────────────────────
    /** The sheet's "Client Onboarding Date". */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an onboarding date'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    /** Free text: "End of February" is a valid answer in the sheet. */
    applicationDeadline: text(200),
    focusedMonths: text(200),

    // ── Targeting ───────────────────────────────────────────────────────────
    targetAudience: text(1000),
    ageRestriction: z.nativeEnum(AdRequestAgeRestriction).nullable().optional(),
    /** The sheet's "Location (Need to be run)". */
    location: z.string().trim().min(2, 'Where should the ads run?').max(500),
    blockedLocations: text(5000),
    accountVisibility: text(200),
    reportingPanel: text(200),

    // ── Destination URLs ────────────────────────────────────────────────────
    adUrlKapplpDesktop: optionalUrl,
    adUrlKapplpMobile: optionalUrl,
    adUrlKapplpBing: optionalUrl,
    adUrlClientlpDesktop: optionalUrl,
    adUrlClientlpMobile: optionalUrl,
    adUrlClientlpBing: optionalUrl,

    // ── Free text ───────────────────────────────────────────────────────────
    /** The sheet's "Any Specific Keyword". */
    keywords: z.string().trim().max(5000).nullable().optional(),
    usps: z.string().trim().max(2000).nullable().optional(),
    /** The sheet's "Remarks". */
    notes: z.string().trim().max(5000).nullable().optional(),

    leadTargets: z.array(leadTargetSchema).max(36).optional(),
});

/**
 * A partial edit. Built from the unrefined object because the cross-field
 * rules below cannot hold on a patch that carries only one field.
 */
export const adRequestPatchSchema = adRequestFields.partial();

/** The cross-field rules, applied to both the create and the edit-all shapes. */
function withBriefRules<T extends z.ZodTypeAny>(schema: T) {
  return schema
    // The landing-page scorer and the ad-copy generator both need a URL to
    // work from, and `landing_page_url` is NOT NULL. Rather than asking for a
    // seventh URL that duplicates one of the six, require at least one.
    .refine((v: z.infer<T>) => Boolean(primaryLandingUrl(v)), {
      message: 'Give at least one ads URL — it is the page we score and write copy against.',
      path: ['adUrlClientlpDesktop'],
    })
    .refine(
      (v: z.infer<T>) => {
        const months = (v.leadTargets ?? []).map((t: { month: string }) => t.month);
        return months.length === new Set(months).size;
      },
      { message: 'Each month can appear only once.', path: ['leadTargets'] }
    );
}

export const adRequestInputSchema = withBriefRules(adRequestFields);

export const createAdRequestSchema = withBriefRules(
  adRequestFields.extend({
    /** Save as draft, or submit for approval straight away. */
    submit: z.boolean().optional(),
  })
);

/**
 * The URL the landing-page scorer uses.
 *
 * Client pages first: they are the real destination when present, and the
 * KAPPLP variants are our own interstitials.
 */
export function primaryLandingUrl(v: {
  adUrlClientlpDesktop?: string | null;
  adUrlClientlpMobile?: string | null;
  adUrlClientlpBing?: string | null;
  adUrlKapplpDesktop?: string | null;
  adUrlKapplpMobile?: string | null;
  adUrlKapplpBing?: string | null;
}): string | null {
  return (
    [
      v.adUrlClientlpDesktop,
      v.adUrlClientlpMobile,
      v.adUrlClientlpBing,
      v.adUrlKapplpDesktop,
      v.adUrlKapplpMobile,
      v.adUrlKapplpBing,
    ]
      .map((u) => (u ?? '').trim())
      .find((u) => u.length > 0) ?? null
  );
}

export const transitionSchema = z.object({
  target: z.nativeEnum(AdRequestStatus),
  reason: z.string().trim().max(2000).nullable().optional(),
  /** Step 3 and step 11 respectively. */
  accountManagerId: z.string().cuid().nullable().optional(),
  adSpecialistId: z.string().cuid().nullable().optional(),
  /** Step 10. */
  budget: z.coerce.number().positive().max(1_000_000_000).nullable().optional(),
  requiredCpl: z.coerce.number().positive().max(10_000_000).nullable().optional(),
  /** Step 12. */
  linkedCampaignId: z.string().trim().max(64).nullable().optional(),
  /**
   * The version the client last rendered. Sent so two people acting at once
   * cannot both succeed; omitted by scripts that do not track it.
   */
  expectedVersion: z.coerce.number().int().min(0).nullable().optional(),
});

export const commentSchema = z.object({
  message: z.string().trim().min(1, 'Write something').max(4000),
});

/** One keyword per line, as typed in the form. */
export function parseKeywordLines(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((k) => k.trim())
        .filter(Boolean)
    )
  ).slice(0, 200);
}
