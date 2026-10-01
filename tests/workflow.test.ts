import { describe, expect, it } from 'vitest';
import { adRequestInputSchema, parseKeywordLines } from '@/lib/workflow/schemas';

/**
 * Input validation for the request brief. The state machine itself is
 * covered in tests/state-machine.test.ts.
 */

describe('request validation', () => {
  const valid = {
    title: 'MBA Admissions 2026',
    objective: 'LEAD_GENERATION' as const,
    productService: 'Two-year MBA',
    targetAudience: 'Graduates 21-26',
    location: 'Bangalore',
    budget: 100000,
    startDate: '2026-10-01',
    adUrlClientlpDesktop: 'https://example.com/mba',
  };

  it('accepts a complete brief', () => {
    expect(adRequestInputSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a non-http scheme on an ads URL', () => {
    // The URL is fetched server-side by the scorer, so anything else would
    // hand that fetcher an arbitrary target.
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com']) {
      expect(
        adRequestInputSchema.safeParse({ ...valid, adUrlClientlpDesktop: url }).success
      ).toBe(false);
    }
  });

  it('refuses a zero or negative budget', () => {
    expect(adRequestInputSchema.safeParse({ ...valid, budget: 0 }).success).toBe(false);
    expect(adRequestInputSchema.safeParse({ ...valid, budget: -5 }).success).toBe(false);
  });

  it('refuses a malformed start date', () => {
    expect(adRequestInputSchema.safeParse({ ...valid, startDate: '01/10/2026' }).success).toBe(false);
  });

  it('refuses an unknown objective', () => {
    expect(adRequestInputSchema.safeParse({ ...valid, objective: 'WORLD_PEACE' }).success).toBe(false);
  });
});

describe('keyword parsing', () => {
  it('splits on newlines and commas, trimming and de-duplicating', () => {
    expect(parseKeywordLines('mba admission\n best mba , mba admission')).toEqual([
      'mba admission',
      'best mba',
    ]);
  });

  it('handles empty input', () => {
    expect(parseKeywordLines(null)).toEqual([]);
    expect(parseKeywordLines('   ')).toEqual([]);
  });

  it('caps the list so a paste of thousands cannot reach the model', () => {
    const many = Array.from({ length: 500 }, (_, i) => `kw${i}`).join('\n');
    expect(parseKeywordLines(many)).toHaveLength(200);
  });
});
