import { z } from 'zod';
import { AdRequestStatus, CampaignObjective } from '@prisma/client';

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

export const adRequestInputSchema = z.object({
  title: z.string().trim().min(3, 'Give the request a title').max(200),
  accountId: z.coerce.number().int().positive().nullable().optional(),
  objective: z.nativeEnum(CampaignObjective),
  productService: z.string().trim().min(2, 'What is being advertised?').max(500),
  targetAudience: z.string().trim().min(2, 'Describe the target audience').max(1000),
  location: z.string().trim().min(2, 'Where should the ads run?').max(500),
  budget: z.coerce.number().positive('Enter a budget above zero').max(1_000_000_000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  landingPageUrl: httpUrl,
  usps: z.string().trim().max(2000).nullable().optional(),
  keywords: z.string().trim().max(5000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export const createAdRequestSchema = adRequestInputSchema.extend({
  /** Save as draft, or submit for approval straight away. */
  submit: z.boolean().optional(),
});

export const transitionSchema = z.object({
  target: z.nativeEnum(AdRequestStatus),
  reason: z.string().trim().max(2000).nullable().optional(),
  assignToId: z.string().cuid().nullable().optional(),
  linkedCampaignId: z.string().trim().max(64).nullable().optional(),
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
