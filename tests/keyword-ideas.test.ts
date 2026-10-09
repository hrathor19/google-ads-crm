import { describe, expect, it } from 'vitest';
import {
  competitionOf,
  normaliseIdeas,
  seriesOf,
  sortGeoTargets,
  takeSearchSlot,
  type RawIdea,
} from '@/lib/google-ads/keyword-ideas';

/**
 * Parsing the Keyword Planner response.
 *
 * Everything tested here is a place the API's shape can quietly produce a
 * plausible-looking wrong number rather than an error: int64 fields arrive as
 * strings, the competition enum arrives as a name or an index depending on
 * the decode path, and the twelve-month series is what the trend and the peak
 * month are both derived from. A NaN or an off-by-one here would be read off
 * the screen as a media plan.
 */

const metrics = (over: Partial<NonNullable<RawIdea['keyword_idea_metrics']>> = {}) => ({
  avg_monthly_searches: '2900',
  competition: 'MEDIUM',
  competition_index: '66',
  low_top_of_page_bid_micros: '62326091',
  high_top_of_page_bid_micros: '248862163',
  monthly_search_volumes: [],
  ...over,
});

const volumes = (counts: number[], startMonth = 10, startYear = 2024) =>
  counts.map((n, i) => {
    const names = [
      'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
      'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
    ];
    const abs = startMonth - 1 + i;
    return {
      month: names[abs % 12],
      year: String(startYear + Math.floor(abs / 12)),
      monthly_searches: String(n),
    };
  });

describe('competitionOf', () => {
  it('reads the enum name', () => {
    expect(competitionOf('HIGH')).toBe('HIGH');
    expect(competitionOf('low')).toBe('LOW');
  });

  it('reads the enum index, which is what the SDK returns on some paths', () => {
    expect(competitionOf(0)).toBe('UNSPECIFIED');
    expect(competitionOf(2)).toBe('LOW');
    expect(competitionOf(4)).toBe('HIGH');
  });

  it('falls back rather than inventing a band', () => {
    expect(competitionOf(undefined)).toBe('UNSPECIFIED');
    expect(competitionOf('VERY_HIGH')).toBe('UNSPECIFIED');
    expect(competitionOf(99)).toBe('UNSPECIFIED');
  });
});

describe('seriesOf', () => {
  it('orders the months and labels them', () => {
    const { monthly } = seriesOf(volumes([10, 20, 30]));
    expect(monthly.map((m) => m.label)).toEqual(['Oct 24', 'Nov 24', 'Dec 24']);
    expect(monthly.map((m) => m.searches)).toEqual([10, 20, 30]);
  });

  it('crosses the year boundary in the right order', () => {
    const { monthly } = seriesOf(volumes([1, 2, 3, 4], 11, 2024));
    expect(monthly.map((m) => m.label)).toEqual(['Nov 24', 'Dec 24', 'Jan 25', 'Feb 25']);
  });

  it('sorts a series the API handed back out of order', () => {
    const shuffled = [...volumes([100, 200, 300])].reverse();
    const { monthly, peakMonth } = seriesOf(shuffled);
    expect(monthly.map((m) => m.searches)).toEqual([100, 200, 300]);
    expect(peakMonth).toBe('Dec 24');
  });

  it('finds the peak month, which is the one that decides a flight', () => {
    // A classic admissions shape: nothing all year, then a spike in June.
    const { peakMonth, peakSearches } = seriesOf(
      volumes([10, 10, 10, 10, 10, 10, 10, 10, 90000, 10, 10, 10], 10, 2024)
    );
    expect(peakMonth).toBe('Jun 25');
    expect(peakSearches).toBe(90000);
  });

  it('compares the last quarter against the one before it', () => {
    // 100,100,100 then 150,150,150 — a clean 50% rise.
    const { trend } = seriesOf(volumes([100, 100, 100, 150, 150, 150]));
    expect(trend).toBe(0.5);
  });

  it('refuses a trend from fewer than two quarters', () => {
    expect(seriesOf(volumes([100, 200, 300, 400, 500])).trend).toBeNull();
  });

  it('refuses a trend when the prior quarter was zero, rather than dividing by it', () => {
    const { trend } = seriesOf(volumes([0, 0, 0, 10, 20, 30]));
    expect(trend).toBeNull();
  });

  it('calls a keyword climbing off the reporting floor emerging', () => {
    // Google reports nothing below 10 a month, so 10,10,10 is "under the
    // floor" and a percentage against it would be arithmetic on a band.
    const { trend, emerging } = seriesOf(volumes([10, 10, 10, 200, 200, 200]));
    expect(trend).toBeNull();
    expect(emerging).toBe(true);
  });

  it('leaves a genuinely large rise as a percentage', () => {
    // Real figures for "tnmbamca": a counselling cycle, not a floor
    // artifact, and +1909% is the most actionable row on that page.
    const { trend, emerging } = seriesOf(
      volumes([320, 170, 90, 110, 110, 110, 140, 90, 880, 3600, 12100, 6600])
    );
    expect(emerging).toBe(false);
    expect(trend).toBe(19.09);
  });

  it('does not call a keyword emerging when it is still on the floor', () => {
    const { trend, emerging } = seriesOf(volumes([10, 10, 10, 10, 10, 10]));
    expect(trend).toBeNull();
    expect(emerging).toBe(false);
  });

  it('still reports a percentage once the prior quarter clears the floor', () => {
    // 40 is above the 30 floor, so this is a measurement, not a band.
    const { trend, emerging } = seriesOf(volumes([20, 10, 10, 40, 40, 40]));
    expect(emerging).toBe(false);
    expect(trend).toBe(2);
  });

  it('survives an empty or missing series', () => {
    expect(seriesOf(undefined)).toEqual({
      monthly: [],
      peakMonth: null,
      peakSearches: null,
      trend: null,
      emerging: false,
    });
    expect(seriesOf([]).peakMonth).toBeNull();
  });
});

describe('normaliseIdeas', () => {
  it('converts the string ints and the bid micros', () => {
    const [idea] = normaliseIdeas(
      [{ text: 'mba admission', keyword_idea_metrics: metrics() }],
      new Set()
    );
    expect(idea.avgMonthlySearches).toBe(2900);
    expect(idea.competitionIndex).toBe(66);
    // 62326091 micros is ₹62.33, not ₹62,326,091.
    expect(idea.lowTopOfPageBid).toBe(62.33);
    expect(idea.highTopOfPageBid).toBe(248.86);
  });

  it('treats a zero bid as "no estimate", not as free', () => {
    const [idea] = normaliseIdeas(
      [
        {
          text: 'obscure term',
          keyword_idea_metrics: metrics({
            low_top_of_page_bid_micros: '0',
            high_top_of_page_bid_micros: undefined,
          }),
        },
      ],
      new Set()
    );
    expect(idea.lowTopOfPageBid).toBeNull();
    expect(idea.highTopOfPageBid).toBeNull();
  });

  it('flags the keywords already being bid on, ignoring case', () => {
    const ideas = normaliseIdeas(
      [
        { text: 'MBA Admission', keyword_idea_metrics: metrics() },
        { text: 'bba colleges', keyword_idea_metrics: metrics() },
      ],
      new Set(['mba admission'])
    );
    expect(ideas.find((i) => i.keyword === 'MBA Admission')?.alreadyRunning).toBe(true);
    expect(ideas.find((i) => i.keyword === 'bba colleges')?.alreadyRunning).toBe(false);
  });

  it('sorts by volume, so the useful rows are on the first page', () => {
    const ideas = normaliseIdeas(
      [
        { text: 'small', keyword_idea_metrics: metrics({ avg_monthly_searches: '10' }) },
        { text: 'big', keyword_idea_metrics: metrics({ avg_monthly_searches: '90500' }) },
        { text: 'medium', keyword_idea_metrics: metrics({ avg_monthly_searches: '1300' }) },
      ],
      new Set()
    );
    expect(ideas.map((i) => i.keyword)).toEqual(['big', 'medium', 'small']);
  });

  it('handles an idea with no metrics at all rather than throwing', () => {
    const [idea] = normaliseIdeas([{ text: 'bare', keyword_idea_metrics: null }], new Set());
    expect(idea.avgMonthlySearches).toBe(0);
    expect(idea.competition).toBe('UNSPECIFIED');
    expect(idea.competitionIndex).toBeNull();
    expect(idea.monthly).toEqual([]);
  });

  it('never produces NaN from a non-numeric field', () => {
    const [idea] = normaliseIdeas(
      [
        {
          text: 'junk',
          keyword_idea_metrics: metrics({
            avg_monthly_searches: 'not a number',
            competition_index: 'nope',
          }),
        },
      ],
      new Set()
    );
    expect(Number.isNaN(idea.avgMonthlySearches)).toBe(false);
    expect(Number.isNaN(idea.competitionIndex as number)).toBe(false);
  });
});

describe('sortGeoTargets', () => {
  it('puts the country first, then states, then cities, alphabetically', () => {
    const sorted = sortGeoTargets([
      { id: '3', name: 'Pune', type: 'City' },
      { id: '2', name: 'Karnataka', type: 'State' },
      { id: '1', name: 'India', type: 'Country' },
      { id: '4', name: 'Assam', type: 'State' },
      { id: '5', name: 'Mumbai', type: 'City' },
    ]);
    expect(sorted.map((g) => g.name)).toEqual([
      'India',
      'Assam',
      'Karnataka',
      'Mumbai',
      'Pune',
    ]);
  });
});

describe('takeSearchSlot', () => {
  it('allows the first sixty searches in an hour and holds the sixty-first', () => {
    const t0 = 1_700_000_000_000;
    const user = 'rate-limit-user-a';
    for (let i = 0; i < 60; i++) expect(takeSearchSlot(user, t0 + i)).toBeNull();
    const wait = takeSearchSlot(user, t0 + 60);
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThan(0);
    expect(wait!).toBeLessThanOrEqual(3600);
  });

  it('forgets attempts once the window has passed', () => {
    const t0 = 1_700_000_000_000;
    const user = 'rate-limit-user-b';
    for (let i = 0; i < 60; i++) takeSearchSlot(user, t0 + i);
    expect(takeSearchSlot(user, t0 + 61 * 60 * 1000)).toBeNull();
  });

  it('counts each user separately', () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 60; i++) takeSearchSlot('rate-limit-user-c', t0 + i);
    expect(takeSearchSlot('rate-limit-user-d', t0 + 60)).toBeNull();
  });
});
