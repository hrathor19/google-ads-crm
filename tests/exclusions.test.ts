import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCLUDED_TERMS,
  MAX_EXCLUDED_TERMS,
  excludedTermIn,
  filterClean,
  isClean,
  parseExcludedTerms,
} from '@/lib/ai/exclusions';
import { validateAssets } from '@/lib/ai/rsa-validator';
import { generateDeterministic, subjectOf, type AdCopyBrief, type LandingFacts } from '@/lib/ai/ad-copy';

/**
 * The "Never mention" field.
 *
 * The matching is where this is easy to get wrong in both directions: too
 * loose and "fee" censors "coffee" and "feedback"; too strict and it misses
 * "Fees", which is the form the word almost always takes on a landing page.
 */

describe('parseExcludedTerms', () => {
  it('splits on commas and newlines, lower-cases and de-duplicates', () => {
    expect(parseExcludedTerms('Fee, hostel\n FEE ,placement guarantee')).toEqual([
      'fee',
      'hostel',
      'placement guarantee',
    ]);
  });

  it('ignores one-character noise rather than banning a letter', () => {
    // A stray "a" would match almost every headline ever written.
    expect(parseExcludedTerms('fee, a, , x')).toEqual(['fee']);
  });

  it('is empty for an empty field', () => {
    expect(parseExcludedTerms('')).toEqual([]);
    expect(parseExcludedTerms(null)).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_EXCLUDED_TERMS + 10 }, (_, i) => `term${i}`).join(',');
    expect(parseExcludedTerms(many)).toHaveLength(MAX_EXCLUDED_TERMS);
  });
});

describe('excludedTermIn', () => {
  const fee = ['fee'];

  it('catches the word and its plural, in any case', () => {
    expect(excludedTermIn('Low fee programme', fee)).toBe('fee');
    expect(excludedTermIn('See the fees', fee)).toBe('fee');
    expect(excludedTermIn('FEE STRUCTURE', fee)).toBe('fee');
    expect(excludedTermIn('Fees & Funding', fee)).toBe('fee');
  });

  it('does not catch a word that merely contains it', () => {
    // The whole reason for word boundaries: these are ordinary words.
    expect(excludedTermIn('Free coffee on campus', fee)).toBeNull();
    expect(excludedTermIn('Send us your feedback', fee)).toBeNull();
    expect(excludedTermIn('Fee-free' /* hyphen is a boundary */, [])).toBeNull();
  });

  it('matches a multi-word term as a phrase', () => {
    const terms = ['placement guarantee'];
    expect(excludedTermIn('100% placement guarantee', terms)).toBe('placement guarantee');
    // Wrapped across a line break in the source text.
    expect(excludedTermIn('placement   guarantee here', terms)).toBe('placement guarantee');
    expect(excludedTermIn('placement record', terms)).toBeNull();
    expect(excludedTermIn('guarantee of placement', terms)).toBeNull();
  });

  it('treats regex characters in a term as literal text', () => {
    expect(excludedTermIn('50% off', ['50%'])).toBe('50%');
    expect(() => excludedTermIn('anything', ['a(b'])).not.toThrow();
  });

  it('returns null when nothing is excluded', () => {
    expect(excludedTermIn('Low fees here', [])).toBeNull();
    expect(isClean('Low fees here', [])).toBe(true);
  });

  it('names which term matched, so the message can say why', () => {
    expect(excludedTermIn('Hostel and fees', ['fee', 'hostel'])).toBe('fee');
    expect(excludedTermIn('Hostel rooms', ['fee', 'hostel'])).toBe('hostel');
  });
});

describe('filterClean', () => {
  it('drops only the entries carrying a term', () => {
    expect(filterClean(['INR 12,00,000 fees', 'NAAC A++', 'Hostel available'], ['fee'])).toEqual([
      'NAAC A++',
      'Hostel available',
    ]);
  });
});

// ─── The ban, applied ───────────────────────────────────────────────────────

const brief: AdCopyBrief = {
  product: 'MBA/PGDM',
  institution: 'Christ University',
  objective: 'LEAD_GENERATION',
  targetAudience: null,
  location: 'Bangalore, India',
  landingPageUrl: 'https://example.com/mba',
  usps: null,
};

const facts: LandingFacts = {
  title: 'MBA Fees and Admissions',
  metaDescription: 'Full fee structure for 2026',
  h1: ['MBA Admissions'],
  highlights: ['Lowest fees in Bangalore'],
  courses: ['MBA'],
  fees: ['INR 12,00,000'],
  placements: ['Average 14 LPA'],
  accreditations: ['NAAC A++'],
  rankings: [],
  deadlines: ['30 June 2026'],
  scholarships: ['Merit scholarships'],
  ctas: [],
};

const everyAsset = (r: ReturnType<typeof generateDeterministic>) =>
  [
    ...r.headlines.map((h) => h.text),
    ...r.descriptions.map((d) => d.text),
    ...r.sitelinks.flatMap((s) => [s.text, s.description1, s.description2]),
  ].filter(Boolean);

describe('generating with terms excluded', () => {
  it('produces no asset mentioning the banned word', () => {
    const r = generateDeterministic({ ...brief, excludedTerms: DEFAULT_EXCLUDED_TERMS }, facts);
    expect(everyAsset(r).filter((t) => excludedTermIn(t, DEFAULT_EXCLUDED_TERMS))).toEqual([]);
  });

  it('still delivers the full set with the fee templates removed', () => {
    const r = generateDeterministic({ ...brief, excludedTerms: ['fee'] }, facts);
    expect(r.headlines).toHaveLength(15);
    expect(r.descriptions).toHaveLength(4);
    expect(r.sitelinks).toHaveLength(6);
  });

  it('drops the Fees sitelink but keeps it when nothing is banned', () => {
    const banned = generateDeterministic({ ...brief, excludedTerms: ['fee'] }, facts);
    const open = generateDeterministic(brief, facts);
    expect(banned.sitelinks.map((s) => s.text)).not.toContain('Fees & Funding');
    expect(open.sitelinks.map((s) => s.text)).toContain('Fees & Funding');
  });

  it('survives banning a word the whole brief is about', () => {
    // Nothing here should throw or return an empty set, even though most
    // candidates reference the course.
    const r = generateDeterministic({ ...brief, excludedTerms: ['mba', 'fee'] }, facts);
    expect(everyAsset(r).filter((t) => excludedTermIn(t, ['mba', 'fee']))).toEqual([]);
    expect(r.headlines.length).toBeGreaterThan(0);
  });
});

describe('validating against the ban', () => {
  it('is an error when an edit puts a banned word back', () => {
    const v = validateAssets({
      headlines: ['Christ University MBA', 'Low Fees This Year', 'Apply Online'],
      descriptions: ['Study at Christ University.', 'Apply in minutes.'],
      subject: subjectOf(brief),
      excludedTerms: ['fee'],
    });
    expect(v.excludedTermHits).toBe(1);
    expect(
      v.flags.some((f) => f.level === 'error' && /excludes/.test(f.message) && /fee/.test(f.message))
    ).toBe(true);
  });

  it('checks sitelink text and both description lines', () => {
    const v = validateAssets({
      headlines: ['Christ University MBA', 'Apply Online', 'Enquire Today'],
      descriptions: ['Study at Christ University.', 'Apply in minutes.'],
      sitelinks: [
        { text: 'Fees', description1: 'Clean line', description2: 'Also clean' },
        { text: 'Eligibility', description1: 'See the fee structure', description2: 'Clean' },
      ],
      excludedTerms: ['fee'],
    });
    expect(v.excludedTermHits).toBe(2);
  });

  it('reports nothing when the copy is clean', () => {
    const v = validateAssets({
      headlines: ['Christ University MBA', 'Apply Online', 'Enquire Today'],
      descriptions: ['Study at Christ University.', 'Apply in minutes.'],
      excludedTerms: ['fee'],
    });
    expect(v.excludedTermHits).toBe(0);
  });

  it('reports nothing when no terms are excluded', () => {
    const v = validateAssets({
      headlines: ['Low Fees This Year', 'Apply Online', 'Enquire Today'],
      descriptions: ['Fees from INR 12,00,000.', 'Apply in minutes.'],
    });
    expect(v.excludedTermHits).toBe(0);
  });
});
