import { describe, expect, it } from 'vitest';
import { urlVariants } from '@/lib/ai/landing-score-store';
import { renderBody } from '@/lib/email/send';

/**
 * The landing page score in the brief mail.
 *
 * The scorer is reachable from the menu as well as from inside a request,
 * and a run started from the menu saves with no request id — so the brief
 * falls back to matching on the URL. That match has to survive the ways the
 * same page gets written down twice.
 */

describe('urlVariants', () => {
  it('matches the same page with and without a trailing slash', () => {
    expect(urlVariants('https://lp.kollegeapply.com/MICA2027')).toEqual([
      'https://lp.kollegeapply.com/MICA2027',
      'https://lp.kollegeapply.com/MICA2027/',
    ]);
    expect(urlVariants('https://lp.kollegeapply.com/MICA2027/')).toContain(
      'https://lp.kollegeapply.com/MICA2027'
    );
  });

  it('ignores surrounding whitespace, which a paste leaves behind', () => {
    expect(urlVariants('  https://a.test/x  ')).toContain('https://a.test/x');
  });

  it('collapses repeated trailing slashes rather than offering a third form', () => {
    const v = urlVariants('https://a.test/x///');
    expect(v).toContain('https://a.test/x');
    expect(v).toContain('https://a.test/x/');
  });

  it('never returns an empty candidate, which would match every row', () => {
    expect(urlVariants('')).toEqual([]);
    expect(urlVariants('   ').every(Boolean)).toBe(true);
  });
});

describe('the score section in the mail', () => {
  const section = {
    heading: 'Landing page score',
    rows: [
      { label: 'Score', value: '97 / 100', always: true },
      { label: 'Grade', value: 'A', always: true },
      { label: 'Weighted points', value: '136 of 140' },
      { label: 'Content', value: '100%' },
      { label: 'Tracking', value: '100%' },
      { label: 'Links', value: '60%' },
      { label: 'Page scored', value: 'https://lp.kollegeapply.com/MICA2027', wide: true },
    ],
  };

  it('shows the score and the grade', () => {
    const { html } = renderBody({ reference: 'AR-0003', title: 'MICA', sections: [section] }, 'x');
    expect(html).toContain('Landing page score');
    expect(html).toContain('97 / 100');
    // The raw weights explain where the percentage came from; they must
    // never stand in for it.
    expect(html).toContain('136 of 140');
    expect(html).not.toContain('97 of 140');
    expect(html).toContain('Grade');
    expect(html).toMatch(/>A</);
  });

  it('keeps the score and grade even when a run scored zero', () => {
    // `always` on both: a 0 is a result, and dropping the row would read as
    // "not scored" when it means "scored badly".
    const zeroed = {
      ...section,
      rows: [
        { label: 'Score', value: '0 / 100', always: true },
        { label: 'Grade', value: 'F', always: true },
      ],
    };
    const { html } = renderBody({ reference: 'AR-0003', title: 'MICA', sections: [zeroed] }, 'x');
    expect(html).toContain('0 / 100');
    expect(html).toMatch(/>F</);
  });

  it('carries into the plain-text part too', () => {
    const { text } = renderBody({ reference: 'AR-0003', title: 'MICA', sections: [section] }, 'x');
    expect(text).toContain('LANDING PAGE SCORE');
    expect(text).toContain('Score: 97 / 100');
    expect(text).toContain('Grade: A');
  });

  it('is absent entirely when nothing has been scored', () => {
    const { html } = renderBody({ reference: 'AR-0003', title: 'MICA', sections: [] }, 'x');
    expect(html).not.toContain('Landing page score');
  });
});

describe('when the page has not been scored', () => {
  const unscored = {
    heading: 'Landing page score',
    rows: [
      { label: 'Score', value: 'Not scored yet', always: true },
      { label: 'Grade', value: '—', always: true },
      { label: 'Page to score', value: 'https://lp.kollegeapply.com/x', wide: true },
    ],
  };

  it('still shows the card, so it reads as a job to do', () => {
    // An absent section reads as "this app does not check landing pages".
    const { html } = renderBody({ reference: 'AR-0007', title: 'Graphic Era', sections: [unscored] }, 'x');
    expect(html).toContain('Landing page score');
    expect(html).toContain('Not scored yet');
    expect(html).toContain('https://lp.kollegeapply.com/x');
  });

  it('keeps the empty grade row rather than dropping it', () => {
    // `always` on Score and Grade: an em dash is "no result", a missing row
    // is indistinguishable from the feature not existing.
    const { text } = renderBody({ reference: 'AR-0007', title: 'Graphic Era', sections: [unscored] }, 'x');
    expect(text).toContain('Score: Not scored yet');
    expect(text).toContain('Grade: —');
  });
});
