import { describe, expect, it } from 'vitest';
import {
  campaignsFor,
  classifyPacing,
  summarise,
  sumTotals,
  type AssignmentRow,
} from '@/lib/ops/assignments';
import type { CampaignRow } from '@/lib/ops/metrics';

/**
 * The assigned-campaign page's arithmetic.
 *
 * Three things here are easy to get wrong and expensive to get wrong, because
 * somebody's performance is read off them: which campaigns count as an
 * assignment's, whether a derived metric is summed or averaged, and whether a
 * campaign covered by two assignments is counted once or twice.
 */

const campaign = (o: Partial<CampaignRow> & { id: number }): CampaignRow => ({
  campaignId: String(2_000_000_000 + o.id),
  name: `Campaign ${o.id}`,
  status: 'ENABLED',
  channelType: 'SEARCH',
  biddingStrategy: 'MAXIMIZE_CONVERSIONS',
  optimizationScore: null,
  accountId: 1,
  accountName: 'Acme',
  budget: 0,
  impressions: 0,
  clicks: 0,
  cost: 0,
  conversions: 0,
  conversionsValue: 0,
  ctr: null,
  avgCpc: null,
  costPerConversion: null,
  conversionRate: null,
  ...o,
});

const assignment = (o: Partial<AssignmentRow> & { id: string }): AssignmentRow => ({
  reference: `AR-${o.id}`,
  title: `Request ${o.id}`,
  status: 'LIVE',
  accountId: 1,
  accountName: 'Acme',
  specialistId: 'u1',
  specialistName: 'Lakshmi',
  accountManagerName: null,
  linkedCampaignId: null,
  requiredCpl: null,
  requiredLeads: null,
  budget: null,
  campaignCount: 0,
  enabledCampaignCount: 0,
  dailyBudget: 0,
  pacing: 'NO_SPEND',
  leadProgress: null,
  assignedAt: null,
  campaignIds: [],
  impressions: 0,
  clicks: 0,
  cost: 0,
  conversions: 0,
  conversionsValue: 0,
  ctr: null,
  avgCpc: null,
  costPerConversion: null,
  conversionRate: null,
  ...o,
});

describe('pacing', () => {
  it('a campaign that never started is "no delivery", not a CPL miss', () => {
    expect(classifyPacing({ cost: 0, conversions: 0, requiredCpl: 2500 })).toBe('NO_SPEND');
  });

  it('spend with nothing to show is its own state, even without a target', () => {
    expect(classifyPacing({ cost: 40_000, conversions: 0, requiredCpl: 2500 })).toBe('NO_LEADS');
    expect(classifyPacing({ cost: 40_000, conversions: 0, requiredCpl: null })).toBe('NO_LEADS');
  });

  it('cannot be over a target that was never set', () => {
    expect(classifyPacing({ cost: 100_000, conversions: 2, requiredCpl: null })).toBe('NO_TARGET');
    expect(classifyPacing({ cost: 100_000, conversions: 2, requiredCpl: 0 })).toBe('NO_TARGET');
  });

  it('compares cost per lead against the approved CPL', () => {
    // 50,000 / 25 = 2,000 — inside a 2,500 target.
    expect(classifyPacing({ cost: 50_000, conversions: 25, requiredCpl: 2500 })).toBe('ON_TRACK');
    // 75,000 / 25 = 3,000 — outside it.
    expect(classifyPacing({ cost: 75_000, conversions: 25, requiredCpl: 2500 })).toBe('OVER_CPL');
  });

  it('treats landing exactly on the target as meeting it', () => {
    expect(classifyPacing({ cost: 62_500, conversions: 25, requiredCpl: 2500 })).toBe('ON_TRACK');
  });
});

describe('sumTotals', () => {
  it('derives CTR from the summed counts, not from an average of the rows', () => {
    const totals = sumTotals([
      campaign({ id: 1, impressions: 1000, clicks: 10 }), // 1%
      campaign({ id: 2, impressions: 1, clicks: 1 }), // 100%
    ]);
    // Averaging the two rates would give 50.5%; the honest figure is 11/1001.
    expect(totals.ctr).toBeCloseTo(11 / 1001, 10);
  });

  it('has no CTR or CPC when the denominator is zero', () => {
    const totals = sumTotals([campaign({ id: 1 })]);
    expect(totals.ctr).toBeNull();
    expect(totals.avgCpc).toBeNull();
    expect(totals.costPerConversion).toBeNull();
  });

  it('rounds the float dust off a sum of fractional conversions', () => {
    const totals = sumTotals([
      campaign({ id: 1, conversions: 0.1 }),
      campaign({ id: 2, conversions: 0.2 }),
    ]);
    expect(totals.conversions).toBe(0.3);
  });

  it('sums an empty set to zeroes rather than throwing', () => {
    expect(sumTotals([]).impressions).toBe(0);
  });
});

describe('which campaigns belong to an assignment', () => {
  const campaigns = [
    campaign({ id: 1, accountId: 1, campaignId: '111' }),
    campaign({ id: 2, accountId: 1, campaignId: '222' }),
    campaign({ id: 3, accountId: 2, campaignId: '333' }),
  ];

  it('a linked campaign wins over the account', () => {
    const got = campaignsFor({ linkedCampaignId: '222', accountId: 1 }, campaigns);
    expect(got.map((c) => c.id)).toEqual([2]);
  });

  it('falls back to every campaign in the account before launch', () => {
    const got = campaignsFor({ linkedCampaignId: null, accountId: 1 }, campaigns);
    expect(got.map((c) => c.id)).toEqual([1, 2]);
  });

  it('claims nothing when the request has neither', () => {
    expect(campaignsFor({ linkedCampaignId: null, accountId: null }, campaigns)).toEqual([]);
  });

  it('falls back to the account when the linked ID matches nothing', () => {
    // A transposed digit at launch must not blank the account's performance.
    const got = campaignsFor({ linkedCampaignId: '999', accountId: 1 }, campaigns);
    expect(got.map((c) => c.id)).toEqual([1, 2]);
  });

  it('claims nothing when an unresolvable link has no account behind it', () => {
    expect(campaignsFor({ linkedCampaignId: '999', accountId: null }, campaigns)).toEqual([]);
  });
});

describe('summarise', () => {
  const catalogue = [
    campaign({ id: 1, accountId: 1, cost: 60_000, conversions: 30, clicks: 100 }),
    campaign({ id: 2, accountId: 1, cost: 40_000, conversions: 10, clicks: 50 }),
    campaign({ id: 3, accountId: 2, cost: 10_000, conversions: 5, clicks: 20 }),
  ];

  it('counts a campaign once even when two assignments cover its account', () => {
    const totals = summarise(
      [
        assignment({ id: 'a', campaignIds: [1, 2] }),
        assignment({ id: 'b', campaignIds: [1, 2] }),
      ],
      catalogue
    ).totals;
    // Summing the two assignment rows would report 200,000.
    expect(totals.cost).toBe(100_000);
    expect(totals.campaigns).toBe(2);
    expect(totals.assignments).toBe(2);
    expect(totals.accounts).toBe(1);
  });

  it('drops campaigns whose only assignment was filtered out', () => {
    const { campaigns, totals } = summarise(
      [assignment({ id: 'a', campaignIds: [1] })],
      catalogue
    );
    expect(campaigns.map((c) => c.id)).toEqual([1]);
    expect(totals.cost).toBe(60_000);
  });

  it('never labels a campaign with an assignment that was filtered out', () => {
    const { campaigns } = summarise(
      [assignment({ id: 'a', reference: 'AR-0001', campaignIds: [1] })],
      catalogue
    );
    expect(campaigns[0]!.references).toEqual(['AR-0001']);
  });

  it('holds a shared campaign to the strictest CPL of its assignments', () => {
    const { campaigns } = summarise(
      [
        assignment({ id: 'a', requiredCpl: 3000, campaignIds: [1] }),
        assignment({ id: 'b', requiredCpl: 1500, campaignIds: [1] }),
      ],
      catalogue
    );
    expect(campaigns[0]!.requiredCpl).toBe(1500);
    // 60,000 / 30 = 2,000 — inside 3,000 but outside 1,500.
    expect(campaigns[0]!.pacing).toBe('OVER_CPL');
  });

  it('reports no campaigns, and no spend, when nothing is assigned', () => {
    const { campaigns, totals } = summarise([], catalogue);
    expect(campaigns).toEqual([]);
    expect(totals.cost).toBe(0);
    expect(totals.campaigns).toBe(0);
  });
});
