import { z } from 'zod';
import { MAX_EXCLUDED_TERMS } from './exclusions';

/**
 * No tone and no brand.
 *
 * The tone picker made the Ads person choose a voice for all fifteen
 * headlines, which is the opposite of what a responsive search ad wants —
 * the generator now spreads them across angles itself. Brand was the Google
 * Ads account name, an internal label like "EDUGROWTH 2" that should never
 * have reached a headline; the advertiser's name comes from the landing
 * page the model is already given.
 */
export const generateCopySchema = z.object({
  requestId: z.string().cuid().optional(),
  /**
   * The college, university or course.
   *
   * Required by the standalone tool, and optional alongside a `requestId`,
   * where it overrides what the request stored. The Ads person generating
   * the copy is the one who can see that Ops typed the course name three
   * different ways, and making them edit the request first to fix a
   * headline is a detour nobody takes.
   */
  product: z.string().trim().min(2).max(500).optional(),
  /** The institution, when it is held separately from the course. */
  institution: z.string().trim().max(300).nullable().optional(),
  objective: z.string().trim().max(100).optional(),
  targetAudience: z.string().trim().max(1000).optional(),
  location: z.string().trim().max(500).optional(),
  landingPageUrl: z.string().trim().url().optional(),
  usps: z.string().trim().max(2000).nullable().optional(),
  keywords: z.array(z.string()).max(200).optional(),
  /**
   * The parsed Keyword Research export. Sent as JSON rather than the file
   * itself: the browser already parses the CSV to preview it, and re-posting
   * the raw file would mean two parsers that can disagree about the same row.
   */
  keywordVolumes: z
    .array(
      z.object({
        keyword: z.string().trim().min(1).max(200),
        volume: z.number().int().min(0).max(100_000_000),
      })
    )
    .max(200)
    .optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  /** Words no asset may contain. Defaults to ["fee"] in the UI. */
  excludedTerms: z
    .array(z.string().trim().min(2).max(60))
    .max(MAX_EXCLUDED_TERMS)
    .optional(),
  /** Persist the result as a new version on the request. */
  save: z.boolean().optional(),
});

export const saveCopySchema = z.object({
  requestId: z.string().cuid(),
  backend: z.string().min(1).max(40),
  headlines: z.array(z.object({ text: z.string().trim().min(1).max(200) })).min(1).max(30),
  descriptions: z.array(z.object({ text: z.string().trim().min(1).max(400) })).min(1).max(10),
});

export const landingScoreSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Enter a full URL, including https://')
    .refine((v) => /^https?:\/\//i.test(v), 'The URL must start with http:// or https://'),
  requestId: z.string().cuid().nullable().optional(),
});
