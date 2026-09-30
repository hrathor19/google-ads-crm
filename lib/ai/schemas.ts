import { z } from 'zod';
import { TONES } from './ad-copy';

export const generateCopySchema = z.object({
  requestId: z.string().cuid().optional(),
  tone: z.enum(TONES),
  /** Supplied directly when generating outside a request (the standalone tool). */
  product: z.string().trim().min(2).max(500).optional(),
  brand: z.string().trim().max(200).nullable().optional(),
  objective: z.string().trim().max(100).optional(),
  targetAudience: z.string().trim().max(1000).optional(),
  location: z.string().trim().max(500).optional(),
  landingPageUrl: z.string().trim().url().optional(),
  usps: z.string().trim().max(2000).nullable().optional(),
  keywords: z.array(z.string()).max(200).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  /** Persist the result as a new version on the request. */
  save: z.boolean().optional(),
});

export const saveCopySchema = z.object({
  requestId: z.string().cuid(),
  tone: z.string().min(1).max(40),
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
