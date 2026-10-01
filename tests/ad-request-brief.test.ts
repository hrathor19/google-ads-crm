import { describe, expect, it } from 'vitest';
import { adRequestInputSchema, primaryLandingUrl } from '@/lib/workflow/schemas';

const base = {
  title: 'JIMS Rohini',
  productService: 'MBA/PGDM',
  objective: 'LEAD_GENERATION' as const,
  targetAudience: 'MBA aspirants in Delhi',
  location: 'Delhi',
  startDate: '2026-09-18',
  adUrlClientlpDesktop: 'https://www.jimsrohini.org/applynow/?a=1',
};

describe('the campaign activation brief', () => {
  it('accepts the sheet as Ops fills it', () => {
    const r = adRequestInputSchema.safeParse({
      ...base,
      trackingId: '13000047',
      clientType: 'CLIENT',
      ageRestriction: 'AGE_18_24',
      requiredLeads: 100,
      targetApplication: 35,
      targetAdmission: '-',
      applicationDeadline: 'End of February',
      focusedMonths: 'Sep-Jun',
      accountVisibility: 'Hidden',
      reportingPanel: 'NPF 5',
      leadTargets: [
        { month: '2026-09', leads: 5 },
        { month: '2026-10', leads: 12 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('leaves budget and CPL unset at submission, since Ops applies them later', () => {
    const r = adRequestInputSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.budget).toBeNull();
      expect(r.data.requiredCpl).toBeNull();
    }
  });

  it('keeps "-" for target admissions rather than rejecting it as a number', () => {
    const r = adRequestInputSchema.safeParse({ ...base, targetAdmission: '-' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.targetAdmission).toBe('-');
  });

  it('keeps a prose application deadline', () => {
    const r = adRequestInputSchema.safeParse({ ...base, applicationDeadline: 'End of February' });
    expect(r.success).toBe(true);
  });

  it('refuses a brief with no ads URL at all', () => {
    const { adUrlClientlpDesktop: _omit, ...noUrl } = base;
    const r = adRequestInputSchema.safeParse(noUrl);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(/at least one ads URL/i);
  });

  it('refuses the same month twice in the lead plan', () => {
    const r = adRequestInputSchema.safeParse({
      ...base,
      leadTargets: [
        { month: '2026-09', leads: 5 },
        { month: '2026-09', leads: 7 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(/only once/i);
  });

  it('rejects a non-http ads URL', () => {
    const r = adRequestInputSchema.safeParse({
      ...base,
      adUrlClientlpDesktop: 'javascript:alert(1)',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a negative lead target', () => {
    const r = adRequestInputSchema.safeParse({ ...base, requiredLeads: -5 });
    expect(r.success).toBe(false);
  });

  it('only accepts the four client types', () => {
    expect(adRequestInputSchema.safeParse({ ...base, clientType: 'CLIENT' }).success).toBe(true);
    expect(adRequestInputSchema.safeParse({ ...base, clientType: 'EXAM' }).success).toBe(true);
    expect(adRequestInputSchema.safeParse({ ...base, clientType: 'PARTNER' }).success).toBe(false);
  });

  it('only accepts the two age restrictions', () => {
    expect(adRequestInputSchema.safeParse({ ...base, ageRestriction: 'OPEN' }).success).toBe(true);
    expect(adRequestInputSchema.safeParse({ ...base, ageRestriction: 'AGE_18_24' }).success).toBe(
      true
    );
    expect(adRequestInputSchema.safeParse({ ...base, ageRestriction: '25_PLUS' }).success).toBe(
      false
    );
  });
});

describe('primaryLandingUrl', () => {
  it('prefers the client page over our own interstitial', () => {
    expect(
      primaryLandingUrl({
        adUrlKapplpDesktop: 'https://kapp.example/lp',
        adUrlClientlpDesktop: 'https://client.example/apply',
      })
    ).toBe('https://client.example/apply');
  });

  it('falls back through the client variants in order', () => {
    expect(
      primaryLandingUrl({ adUrlClientlpBing: 'https://client.example/bing' })
    ).toBe('https://client.example/bing');
  });

  it('uses a KAPPLP url when no client page was given', () => {
    expect(primaryLandingUrl({ adUrlKapplpMobile: 'https://kapp.example/m' })).toBe(
      'https://kapp.example/m'
    );
  });

  it('treats whitespace as absent', () => {
    expect(primaryLandingUrl({ adUrlClientlpDesktop: '   ' })).toBeNull();
  });

  it('is null when nothing was given', () => {
    expect(primaryLandingUrl({})).toBeNull();
  });
});
