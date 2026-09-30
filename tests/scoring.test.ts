import { describe, expect, it } from 'vitest';
import {
  computeCampaignHealth,
  computeKeywordHealth,
  computeBudgetRisk,
  computePriority,
  emptyDay,
  pctChange,
  type CampaignContext,
} from '@/lib/ops/scoring';
import { getOpsRules } from '@/lib/ops/rules';

/**
 * The scoring rules, checked against the penalties declared in
 * `app/config/ops_rules.py`. These are the numbers the console shows humans,
 * so each case pins one rule rather than asserting a composite score.
 */

const rules = getOpsRules();

const day = (o: Partial<ReturnType<typeof emptyDay>>) => ({ ...emptyDay(), ...o });

const baseCtx = (o: Partial<CampaignContext> = {}): CampaignContext => ({
  status: 'ENABLED',
  dailyBudget: 1000,
  spendToday: 100,
  today: day({ impressions: 1000, clicks: 100, cost: 100, conversions: 5 }),
  prior: day({ impressions: 1000, clicks: 100, cost: 100, conversions: 5 }),
  ...o,
});

describe('campaign health', () => {
  it('a healthy campaign keeps the full 100', () => {
    const r = computeCampaignHealth(baseCtx(), rules.health);
    expect(r.score).toBe(100);
    expect(r.level).toBe('healthy');
    expect(r.issues).toHaveLength(0);
  });

  it('ignores a paused campaign rather than penalising it', () => {
    const r = computeCampaignHealth(baseCtx({ status: 'PAUSED' }), rules.health);
    expect(r.level).toBe('ignored');
    expect(r.isActive).toBe(false);
    expect(r.issues).toHaveLength(0);
  });

  it('forces the critical band on zero impressions', () => {
    const r = computeCampaignHealth(
      baseCtx({ today: day({ impressions: 0, clicks: 0, cost: 0 }) }),
      rules.health
    );
    expect(r.level).toBe('critical');
    expect(r.issues.map((i) => i.code)).toContain('NO_IMPRESSIONS');
    expect(r.score).toBeLessThan(rules.health.criticalAt);
  });

  it('subtracts the CTR penalty below the floor', () => {
    // 1% CTR against a 2% floor. The prior day is set to the same CTR and CPC
    // so this isolates the floor rule — leaving the default prior would also
    // trip CTR_DROP and CPC_RISE and the assertion would be testing three
    // penalties at once.
    const flat = day({ impressions: 1000, clicks: 10, cost: 100 });
    const r = computeCampaignHealth(baseCtx({ today: flat, prior: flat }), rules.health);
    expect(r.issues.map((i) => i.code)).toEqual(['LOW_CTR']);
    expect(r.score).toBe(100 - rules.health.ctrPenalty);
  });

  it('stacks the penalties when CTR falls and CPC rises together', () => {
    const r = computeCampaignHealth(
      baseCtx({
        today: day({ impressions: 1000, clicks: 10, cost: 100 }), // 1% CTR, 10.00 CPC
        prior: day({ impressions: 1000, clicks: 100, cost: 100 }), // 10% CTR, 1.00 CPC
      }),
      rules.health
    );
    expect(r.issues.map((i) => i.code).sort()).toEqual(['CPC_RISE', 'CTR_DROP', 'LOW_CTR']);
    expect(r.score).toBe(
      100 - rules.health.ctrPenalty - rules.health.ctrDropPenalty - rules.health.cpcRisePenalty
    );
  });

  it('subtracts the budget penalty at 100% utilisation', () => {
    const r = computeCampaignHealth(
      baseCtx({ dailyBudget: 100, spendToday: 100 }),
      rules.health
    );
    expect(r.issues.map((i) => i.code)).toContain('LIMITED_BY_BUDGET');
    expect(r.score).toBe(100 - rules.health.limitedByBudgetPenalty);
  });

  it('subtracts the warning penalty between 85% and 100%', () => {
    const r = computeCampaignHealth(baseCtx({ dailyBudget: 100, spendToday: 90 }), rules.health);
    expect(r.issues.map((i) => i.code)).toContain('BUDGET_NEARLY_EXHAUSTED');
    expect(r.score).toBe(100 - rules.health.budgetUtilPenalty);
  });

  it('penalises a sharp CTR drop against the prior day', () => {
    const r = computeCampaignHealth(
      baseCtx({
        today: day({ impressions: 1000, clicks: 70, cost: 100 }), // 7%
        prior: day({ impressions: 1000, clicks: 100, cost: 100 }), // 10%, -30%
      }),
      rules.health
    );
    expect(r.issues.map((i) => i.code)).toContain('CTR_DROP');
  });

  it('penalises disapproved ads and names them as the headline reason', () => {
    const r = computeCampaignHealth(baseCtx({ disapprovedAds: 2 }), rules.health);
    expect(r.issues.map((i) => i.code)).toContain('DISAPPROVED_ADS');
    expect(r.score).toBe(100 - rules.health.disapprovedAdsPenalty);
    expect(r.primaryReason).toBe('2 disapproved ad(s)');
  });

  it('never falls below zero however many rules fire', () => {
    const r = computeCampaignHealth(
      baseCtx({
        today: day({ impressions: 1000, clicks: 1, cost: 500 }),
        prior: day({ impressions: 1000, clicks: 100, cost: 10 }),
        dailyBudget: 100,
        spendToday: 500,
        avgQualityScore: 2,
        optimizationScore: 0.1,
        disapprovedAds: 5,
        disapprovedKeywords: 5,
      }),
      rules.health
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.level).toBe('critical');
  });

  it('places scores in the documented bands', () => {
    const at = (score: number) =>
      computeCampaignHealth(
        baseCtx({ today: day({ impressions: 1000, clicks: 100, cost: 100 }) }),
        { ...rules.health, startScore: score }
      ).level;
    expect(at(100)).toBe('healthy');
    expect(at(80)).toBe('healthy');
    expect(at(79)).toBe('warning');
    expect(at(60)).toBe('warning');
    expect(at(59)).toBe('high');
    expect(at(40)).toBe('high');
    expect(at(39)).toBe('critical');
  });
});

describe('keyword health', () => {
  it('applies the heavier penalty at or below the very-low threshold', () => {
    const r = computeKeywordHealth(
      { qualityScore: 3, cost: 0, conversions: 0, metrics: day({ impressions: 100, clicks: 10 }) },
      rules.keyword
    );
    expect(r.issues.map((i) => i.code)).toContain('VERY_LOW_QS');
    expect(r.score).toBe(100 - rules.keyword.lowQualityPenalty);
  });

  it('applies the lighter penalty between the two thresholds', () => {
    const r = computeKeywordHealth(
      { qualityScore: 4, cost: 0, conversions: 0, metrics: day({ impressions: 100, clicks: 10 }) },
      rules.keyword
    );
    expect(r.issues.map((i) => i.code)).toContain('LOW_QS');
    expect(r.score).toBe(100 - rules.keyword.qualityScorePenalty);
  });

  it('flags spend with no conversions once past the cost floor', () => {
    const r = computeKeywordHealth(
      {
        qualityScore: 8,
        cost: rules.keyword.zeroConversionMinCost,
        conversions: 0,
        metrics: day({ impressions: 1000, clicks: 100 }),
      },
      rules.keyword
    );
    expect(r.issues.map((i) => i.code)).toContain('SPEND_NO_CONV');
  });

  it('does not flag spend below the cost floor', () => {
    const r = computeKeywordHealth(
      {
        qualityScore: 8,
        cost: rules.keyword.zeroConversionMinCost - 1,
        conversions: 0,
        metrics: day({ impressions: 1000, clicks: 100 }),
      },
      rules.keyword
    );
    expect(r.issues.map((i) => i.code)).not.toContain('SPEND_NO_CONV');
  });

  it('ignores Quality Score entirely when it is unknown', () => {
    const r = computeKeywordHealth(
      { qualityScore: null, cost: 0, conversions: 0, metrics: day({ impressions: 1000, clicks: 100 }) },
      rules.keyword
    );
    expect(r.score).toBe(100);
  });
});

describe('budget risk', () => {
  it('is critical at or above full utilisation', () => {
    const r = computeBudgetRisk({
      dailyBudget: 100,
      spendSoFar: 100,
      fractionOfDayElapsed: 0.5,
      rules: rules.budget,
    });
    expect(r.risk).toBe('critical');
    expect(r.utilization).toBe(1);
  });

  it('warns between the warning threshold and full', () => {
    const r = computeBudgetRisk({
      dailyBudget: 100,
      spendSoFar: 90,
      fractionOfDayElapsed: 1,
      rules: rules.budget,
    });
    expect(r.risk).toBe('warning');
  });

  it('warns on the projection even when the spend is still low', () => {
    // 50 spent with 10% of the day gone projects to 500 against a 100 budget.
    const r = computeBudgetRisk({
      dailyBudget: 100,
      spendSoFar: 50,
      fractionOfDayElapsed: 0.1,
      rules: rules.budget,
    });
    expect(r.risk).toBe('warning');
    expect(r.projectedEodSpend).toBe(500);
  });

  it('floors the elapsed fraction so an early spend cannot project to infinity', () => {
    const r = computeBudgetRisk({
      dailyBudget: 1000,
      spendSoFar: 10,
      fractionOfDayElapsed: 0,
      rules: rules.budget,
    });
    expect(Number.isFinite(r.projectedEodSpend)).toBe(true);
    expect(r.projectedEodSpend).toBe(200); // 10 / 0.05
  });
});

describe('priority engine', () => {
  it('weights health at 0.7 and spend pressure at 0.3', () => {
    const health = computeCampaignHealth(
      baseCtx({ today: day({ impressions: 1000, clicks: 10, cost: 100 }) }),
      rules.health
    );
    // health 85 → 0.7 * 15 = 10.5; spend 5000 → pressure 100 → 0.3 * 100 = 30.
    const p = computePriority(health, rules.priority.highSpendReference, rules.priority);
    expect(p.score).toBe(Math.round(0.7 * (100 - health.score) + 0.3 * 100));
  });

  it('gives a paused campaign no priority at all', () => {
    const health = computeCampaignHealth(baseCtx({ status: 'PAUSED' }), rules.health);
    const p = computePriority(health, 10_000, rules.priority);
    expect(p.score).toBe(0);
    expect(p.estimatedReviewMinutes).toBe(0);
  });

  it('caps the review estimate', () => {
    const health = computeCampaignHealth(
      baseCtx({
        today: day({ impressions: 1000, clicks: 1, cost: 500 }),
        prior: day({ impressions: 1000, clicks: 100, cost: 10 }),
        dailyBudget: 100,
        spendToday: 500,
        avgQualityScore: 1,
        optimizationScore: 0.1,
        disapprovedAds: 3,
        disapprovedKeywords: 3,
      }),
      rules.health
    );
    const p = computePriority(health, 5000, rules.priority);
    expect(p.estimatedReviewMinutes).toBeLessThanOrEqual(rules.priority.maxReviewMinutes);
  });
});

describe('pctChange', () => {
  it('returns null rather than infinity when the base is zero', () => {
    expect(pctChange(100, 0)).toBeNull();
  });

  it('is a relative change, so 0.2 means +20%', () => {
    expect(pctChange(120, 100)).toBeCloseTo(0.2, 10);
    expect(pctChange(80, 100)).toBeCloseTo(-0.2, 10);
  });
});
