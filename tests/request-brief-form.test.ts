import { describe, expect, it } from 'vitest';
import { AD_REQUEST_FORM_FIELDS } from '@/components/data/ad-request-form';
import { toFormDefaults, type RequestFormSource } from '@/lib/workflow/form-defaults';

/**
 * The read-only brief is the requirement form, filled in.
 *
 * It used to be a hand-written list of nine fields, and had quietly fallen
 * six behind the form — tracking id, client type, required leads, the
 * targets and the per-platform destinations were captured from Operations
 * and then shown to nobody. One mapper now feeds both the editor and the
 * brief, and this pins that it covers the whole form.
 */

const sample: RequestFormSource = {
  title: 'JMS College',
  productService: 'MBA/PGDM',
  location: 'Delhi',
  startDate: '2026-10-05T00:00:00.000Z',
  notes: 'Test',
  trackingId: '12976352',
  clientType: 'CLIENT',
  ageRestriction: 'OPEN',
  requiredLeads: 1000,
  performanceParameter: 'Admission',
  targetApplication: null,
  targetAdmission: '10',
  applicationDeadline: 'EOY',
  focusedMonths: 'Oct - Nov',
  blockedLocations: null,
  accountVisibility: 'Open',
  reportingPanel: 'NPF',
  adUrlKapplpDesktop: null,
  adUrlKapplpMobile: null,
  adUrlKapplpBing: null,
  adUrlClientlpDesktop: 'https://client.kollegeapply.com/MICA2027',
  adUrlClientlpMobile: null,
  adUrlClientlpBing: null,
  leadTargets: [{ month: '2026-10-01', leads: 500 }],
};

describe('filling the form back in from a saved request', () => {
  it('maps every field the form captures', () => {
    const mapped = toFormDefaults(sample);
    const missing = AD_REQUEST_FORM_FIELDS.filter((f) => !(f in mapped));
    expect(missing, `not shown on the brief: ${missing.join(', ')}`).toEqual([]);
  });

  it('turns numbers into the strings the text inputs expect', () => {
    const mapped = toFormDefaults(sample);
    expect(mapped.requiredLeads).toBe('1000');
    expect(mapped.leadTargets).toEqual([{ month: '2026-10', leads: '500' }]);
  });

  it('turns an unanswered field into an empty box, not the string "null"', () => {
    const mapped = toFormDefaults(sample);
    expect(mapped.targetApplication).toBe('');
    expect(mapped.blockedLocations).toBe('');
    expect(mapped.adUrlKapplpDesktop).toBe('');
  });

  it('trims the date to what a date input accepts', () => {
    expect(toFormDefaults(sample).startDate).toBe('2026-10-05');
  });

  it('defaults the age restriction rather than leaving the select blank', () => {
    expect(toFormDefaults({ ...sample, ageRestriction: null }).ageRestriction).toBe('OPEN');
  });

  it('survives a request with nothing optional filled in', () => {
    const bare: RequestFormSource = {
      title: 'Bare',
      productService: 'x',
      location: 'y',
      startDate: '2026-01-01',
      notes: null,
      trackingId: null,
      clientType: null,
      ageRestriction: null,
      requiredLeads: null,
      performanceParameter: null,
      targetApplication: null,
      targetAdmission: null,
      applicationDeadline: null,
      focusedMonths: null,
      blockedLocations: null,
      accountVisibility: null,
      reportingPanel: null,
      adUrlKapplpDesktop: null,
      adUrlKapplpMobile: null,
      adUrlKapplpBing: null,
      adUrlClientlpDesktop: null,
      adUrlClientlpMobile: null,
      adUrlClientlpBing: null,
    };
    expect(() => toFormDefaults(bare)).not.toThrow();
    expect(toFormDefaults(bare).leadTargets).toEqual([]);
  });
});
