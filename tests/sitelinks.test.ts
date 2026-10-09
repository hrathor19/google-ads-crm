import { describe, expect, it } from 'vitest';
import {
  MIN_SUBJECT_HEADLINES,
  SITELINK_COUNT,
  SITELINK_DESC_MAX,
  SITELINK_TEXT_MAX,
  validateAssets,
  type Sitelink,
} from '@/lib/ai/rsa-validator';
import {
  generateDeterministic,
  subjectOf,
  titlecase,
  type AdCopyBrief,
  type LandingFacts,
} from '@/lib/ai/ad-copy';

/**
 * Sitelinks: three caps that are easy to confuse, and one rule that is not
 * obvious — Google rejects a sitelink carrying only its first description
 * line. A half-filled sitelink looks finished on screen and is refused at
 * upload, which is the kind of failure that costs a launch slot.
 */

const sitelink = (over: Partial<Sitelink> = {}): Sitelink => ({
  text: 'Fees & Funding',
  description1: 'See the full fee structure',
  description2: 'Payment plans and deadlines',
  ...over,
});

const flagsFor = (sitelinks: Sitelink[]) =>
  validateAssets({
    headlines: ['One', 'Two', 'Three'],
    descriptions: ['A description.', 'Another description.'],
    sitelinks,
  }).flags.filter((f) => f.field === 'sitelink');

/**
 * Errors only. A short set also raises the "Google needs at least 4" warning,
 * which is correct and has its own test — asserting on every flag here would
 * make each limit test fail for an unrelated reason.
 */
const errorsFor = (sitelinks: Sitelink[]) =>
  flagsFor(sitelinks).filter((f) => f.level === 'error');

describe('sitelink validation', () => {
  it('passes a well-formed set', () => {
    expect(errorsFor([sitelink(), sitelink({ text: 'Eligibility' })])).toHaveLength(0);
  });

  it('catches link text one character over', () => {
    const text = 'x'.repeat(SITELINK_TEXT_MAX + 1);
    const flags = errorsFor([sitelink({ text })]);
    expect(flags.some((f) => f.level === 'error' && f.message.includes(String(text.length)))).toBe(
      true
    );
  });

  it('accepts link text exactly at the cap', () => {
    expect(errorsFor([sitelink({ text: 'x'.repeat(SITELINK_TEXT_MAX) })])).toHaveLength(0);
  });

  it('catches each description line separately', () => {
    const long = 'y'.repeat(SITELINK_DESC_MAX + 1);
    expect(errorsFor([sitelink({ description1: long })]).some((f) => f.level === 'error')).toBe(
      true
    );
    expect(errorsFor([sitelink({ description2: long })]).some((f) => f.level === 'error')).toBe(
      true
    );
  });

  it('rejects one description line without the other, which Google refuses', () => {
    const flags = flagsFor([sitelink({ description2: '' })]);
    expect(flags.some((f) => f.level === 'error' && /both description lines/.test(f.message))).toBe(
      true
    );
  });

  it('allows a bare sitelink with neither description', () => {
    expect(errorsFor([sitelink({ description1: '', description2: '' })])).toHaveLength(0);
  });

  it('refuses a sitelink with no link text', () => {
    const flags = flagsFor([sitelink({ text: '   ' })]);
    expect(flags.some((f) => f.level === 'error' && /no link text/.test(f.message))).toBe(true);
  });

  it('warns about duplicate link text', () => {
    const flags = flagsFor([sitelink(), sitelink()]);
    expect(flags.some((f) => f.level === 'warning' && /same link text/.test(f.message))).toBe(true);
  });

  it('warns that fewer than four will never be shown', () => {
    const flags = flagsFor([sitelink(), sitelink({ text: 'Eligibility' })]);
    expect(flags.some((f) => /at least 4/.test(f.message))).toBe(true);
  });

  it('counts them into the result and does not warn at six', () => {
    const six = Array.from({ length: SITELINK_COUNT }, (_, i) => sitelink({ text: `Link ${i}` }));
    const result = validateAssets({
      headlines: ['One', 'Two', 'Three'],
      descriptions: ['A description.', 'Another.'],
      sitelinks: six,
    });
    expect(result.sitelinkCount).toBe(SITELINK_COUNT);
    expect(flagsFor(six)).toHaveLength(0);
  });

  it('reports zero when no sitelinks are supplied at all', () => {
    const result = validateAssets({ headlines: ['a'], descriptions: ['b'] });
    expect(result.sitelinkCount).toBe(0);
    expect(result.flags.filter((f) => f.field === 'sitelink')).toHaveLength(0);
  });
});

// ─── The deterministic fallback ─────────────────────────────────────────────

const brief: AdCopyBrief = {
  product: 'two-year full-time MBA',
  objective: 'LEAD_GENERATION',
  targetAudience: 'graduates aged 21-26',
  location: 'Bangalore, India',
  landingPageUrl: 'https://example.com/mba',
  usps: 'NAAC A++',
};

const facts: LandingFacts = {
  title: 'MBA Admissions',
  metaDescription: null,
  h1: ['MBA Admissions 2026'],
  highlights: [],
  courses: ['MBA', 'PGDM'],
  fees: ['INR 12,00,000'],
  placements: ['Average package 14 LPA'],
  accreditations: ['NAAC A++'],
  rankings: [],
  deadlines: ['30 June 2026'],
  scholarships: ['Merit scholarships up to 50%'],
  ctas: ['Apply now'],
};

describe('generateDeterministic sitelinks', () => {
  it('produces exactly six, all within every cap', () => {
    const { sitelinks } = generateDeterministic(brief, facts);
    expect(sitelinks).toHaveLength(SITELINK_COUNT);
    for (const sl of sitelinks) {
      expect(sl.text.length).toBeLessThanOrEqual(SITELINK_TEXT_MAX);
      expect(sl.description1.length).toBeLessThanOrEqual(SITELINK_DESC_MAX);
      expect(sl.description2.length).toBeLessThanOrEqual(SITELINK_DESC_MAX);
      expect(sl.text.trim()).not.toBe('');
    }
    expect(errorsFor(sitelinks)).toHaveLength(0);
  });

  it('still fills six when the landing page could not be read', () => {
    // Every fact-gated candidate drops out here, so this is the test that the
    // generic backfill is deep enough to reach six rather than stopping at two.
    const { sitelinks } = generateDeterministic(brief, null);
    expect(sitelinks).toHaveLength(SITELINK_COUNT);
    expect(errorsFor(sitelinks)).toHaveLength(0);
  });

  it('leads with the facts the page actually carried', () => {
    const { sitelinks } = generateDeterministic(brief, facts);
    expect(sitelinks[0]!.text).toBe('Fees & Funding');
    expect(sitelinks.map((s) => s.text)).toContain('Scholarships');
  });

  it('offers no fee sitelink when the page mentioned no fee', () => {
    const { sitelinks } = generateDeterministic(brief, { ...facts, fees: [] });
    expect(sitelinks.map((s) => s.text)).not.toContain('Fees & Funding');
  });

  it('never repeats a link text', () => {
    const { sitelinks } = generateDeterministic(brief, facts);
    const texts = sitelinks.map((s) => s.text.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('produces the full 15 headlines and 4 descriptions', () => {
    const { headlines, descriptions } = generateDeterministic(brief, facts);
    expect(headlines).toHaveLength(15);
    expect(descriptions).toHaveLength(4);
    expect(headlines.every((h) => h.text.length <= 30)).toBe(true);
    expect(descriptions.every((d) => d.text.length <= 90)).toBe(true);
  });

  it('still reaches fifteen when the landing page could not be read', () => {
    // This pool is now both the fallback and the top-up for a model that
    // answers short, so it has to stand up on the brief alone.
    const { headlines, descriptions, sitelinks } = generateDeterministic(brief, null);
    expect(headlines).toHaveLength(15);
    expect(descriptions).toHaveLength(4);
    expect(sitelinks).toHaveLength(6);
  });

  it('never truncates a product name mid-word', () => {
    // "Two-year full-time MBA" clamped to 16 used to yield "Two-year
    // Full-ti", which shipped inside a headline.
    const { headlines } = generateDeterministic(brief, facts);
    const words = headlines.flatMap((h) => h.text.split(/[\s—:]+/)).filter(Boolean);
    expect(words).not.toContain('Full-ti');
    expect(headlines.map((h) => h.text)).toContain('MBA in Bangalore');
  });

  it('prefers the programme acronym over a prefix of a long name', () => {
    const { headlines } = generateDeterministic(
      { ...brief, product: 'two-year full-time MBA' },
      null
    );
    expect(headlines.map((h) => h.text)).toContain('Apply for MBA');
  });

  it('leaves no headline ending on a dangling preposition', () => {
    const { headlines } = generateDeterministic(
      { ...brief, product: 'postgraduate diploma in management' },
      null
    );
    const dangling = /\b(in|of|for|and|the|at|to|with|on|by|or|from)$/i;
    expect(headlines.filter((h) => dangling.test(h.text.trim()))).toEqual([]);
  });
});

// ─── Naming the college, university or course ───────────────────────────────

describe('naming the advertiser', () => {
  const named = { ...brief, product: 'MBA/PGDM', institution: 'Christ University' };

  it('counts the headlines and descriptions that carry the name', () => {
    const r = generateDeterministic(named, null);
    const v = validateAssets({
      headlines: r.headlines.map((h) => h.text),
      descriptions: r.descriptions.map((d) => d.text),
      subject: subjectOf(named),
    });
    expect(v.subjectInHeadlines).toBeGreaterThanOrEqual(MIN_SUBJECT_HEADLINES);
    expect(v.subjectInDescriptions).toBeGreaterThan(0);
  });

  it('is an error when no headline names it at all', () => {
    const v = validateAssets({
      headlines: ['Apply Online Today', 'Book Free Counselling', 'Download the Brochure'],
      descriptions: ['Start your application in minutes.', 'Talk to an advisor free.'],
      subject: 'Christ University MBA',
    });
    expect(v.flags.some((f) => f.level === 'error' && /No headline names/.test(f.message))).toBe(
      true
    );
  });

  it('is only a note when one or two headlines name it', () => {
    const v = validateAssets({
      headlines: ['Christ University MBA', 'Apply Online Today', 'Book Free Counselling'],
      descriptions: ['Study at Christ University. Apply online in minutes.', 'Talk to an advisor.'],
      subject: 'Christ University MBA',
    });
    expect(v.flags.some((f) => f.level === 'error')).toBe(false);
    expect(v.flags.some((f) => /Only 1 headline/.test(f.message))).toBe(true);
  });

  it('says nothing when no subject was supplied', () => {
    const v = validateAssets({ headlines: ['One', 'Two', 'Three'], descriptions: ['A.', 'B.'] });
    expect(v.subjectInHeadlines).toBe(0);
    expect(v.flags.some((f) => /names the college/.test(f.message))).toBe(false);
  });

  it('does not count filler words as the name', () => {
    // "admissions" and "course" are in the name but are not what identifies
    // it; counting them would score a generic ad as naming the college.
    const v = validateAssets({
      headlines: ['Admissions Open Now', 'Course Details Inside', 'Apply This Year'],
      descriptions: ['See the course details.', 'Admissions close soon.'],
      subject: 'Christ University MBA course admissions',
    });
    expect(v.subjectInHeadlines).toBe(0);
  });

  it('never truncates the institution name into something that is not a name', () => {
    const long = {
      ...brief,
      product: 'MBA',
      institution: 'Indian Institute of Management Bangalore',
    };
    const r = generateDeterministic(long, null);
    for (const h of r.headlines) {
      // Either the whole name, or no attempt at it.
      expect(h.text).not.toMatch(/^(Apply to )?Indian( Institute( of Management)?)?$/i);
    }
    expect(r.headlines).toHaveLength(15);
  });

  it('keeps acronyms the writer typed in upper case', () => {
    expect(titlecase('VIT Vellore')).toBe('VIT Vellore');
    expect(titlecase('NMIMS')).toBe('NMIMS');
    // Two acronyms joined by a slash, not one word.
    expect(titlecase('MBA/PGDM')).toBe('MBA/PGDM');
    expect(titlecase('mba/pgdm')).toBe('MBA/PGDM');
    expect(titlecase('christ university')).toBe('Christ University');
    // Minor words stay lower case unless they open the name.
    expect(titlecase('indian institute of management')).toBe('Indian Institute of Management');
    expect(titlecase('of management')).toBe('Of Management');
  });

  it('drops the institution when it only repeats the course', () => {
    const r = generateDeterministic({ ...brief, product: 'MBA', institution: 'MBA' }, null);
    expect(r.headlines.map((h) => h.text)).not.toContain('MBA MBA');
    expect(r.headlines).toHaveLength(15);
  });
});

// ─── The naming guarantee ───────────────────────────────────────────────────

describe('ensureNamed, through generateAdCopy-style assembly', () => {
  // The swap itself is exercised through the deterministic pool, which is
  // what the orchestrator hands it.
  const named = { ...brief, product: 'MBA/PGDM', institution: 'Christ University' };

  it('the template pool always has enough named headlines to repair a short set', () => {
    const pool = generateDeterministic(named, null).headlines;
    const tokens = ['christ', 'university', 'mba', 'pgdm'];
    const namedInPool = pool.filter((h) =>
      tokens.some((t) => h.text.toLowerCase().includes(t))
    );
    expect(namedInPool.length).toBeGreaterThanOrEqual(MIN_SUBJECT_HEADLINES);
  });

  it('and they are whole names, not fragments', () => {
    const pool = generateDeterministic(named, null).headlines;
    for (const h of pool) {
      if (/christ/i.test(h.text)) expect(h.text).toMatch(/Christ University/);
    }
  });
});
