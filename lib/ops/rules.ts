/**
 * Single source of truth for every Operations scoring rule.
 *
 * A direct port of `app/config/ops_rules.py`. Every threshold, weight and
 * penalty lives here so the console's behaviour can be tuned in one file, and
 * each group can be overridden from the environment with the `OPS_` prefix and
 * a `__` separator, exactly as pydantic-settings did:
 *
 *     OPS_HEALTH__CTR_FLOOR=0.03
 */

export type HealthRules = {
  startScore: number;
  ctrFloor: number;
  ctrPenalty: number;
  qualityScoreFloor: number;
  qualityScorePenalty: number;
  optimizationScoreFloor: number;
  optimizationScorePenalty: number;
  budgetUtilWarn: number;
  budgetUtilPenalty: number;
  limitedByBudgetPenalty: number;
  disapprovedAdsPenalty: number;
  disapprovedKeywordsPenalty: number;
  ctrDropPct: number;
  ctrDropPenalty: number;
  cpcRisePct: number;
  cpcRisePenalty: number;
  healthyAt: number;
  warningAt: number;
  criticalAt: number;
};

export type KeywordRules = {
  startScore: number;
  qualityScoreFloor: number;
  qualityScorePenalty: number;
  lowQualityScore: number;
  lowQualityPenalty: number;
  ctrFloor: number;
  ctrPenalty: number;
  zeroConversionMinCost: number;
  zeroConversionPenalty: number;
  healthyAt: number;
  warningAt: number;
};

export type BudgetRules = {
  warningUtilization: number;
  criticalUtilization: number;
  projectionMinElapsed: number;
};

export type AlertRules = {
  ctrDropPct: number;
  cpcRisePct: number;
  spendSpikePct: number;
  qualityScoreDrop: number;
  searchTermSpikeCount: number;
  limitedByBudgetUtil: number;
  minImpressionsForCtrAlert: number;
  criticalCtrDropPct: number;
  criticalSpendSpikePct: number;
};

export type PriorityRules = {
  healthWeight: number;
  spendWeight: number;
  highSpendReference: number;
  baseReviewMinutes: number;
  minutesPerIssue: number;
  maxReviewMinutes: number;
};

export type OpsRules = {
  health: HealthRules;
  keyword: KeywordRules;
  budget: BudgetRules;
  alert: AlertRules;
  priority: PriorityRules;
};

const DEFAULTS: OpsRules = {
  health: {
    startScore: 100,
    ctrFloor: 0.02, // 2% — below this the campaign loses points
    ctrPenalty: 15,
    qualityScoreFloor: 5,
    qualityScorePenalty: 15,
    optimizationScoreFloor: 0.6, // 60%
    optimizationScorePenalty: 10,
    budgetUtilWarn: 0.85, // 85% of daily budget spent
    budgetUtilPenalty: 10,
    limitedByBudgetPenalty: 20,
    disapprovedAdsPenalty: 20,
    disapprovedKeywordsPenalty: 10,
    ctrDropPct: 0.2, // a 20% relative CTR drop vs the prior day
    ctrDropPenalty: 15,
    cpcRisePct: 0.2,
    cpcRisePenalty: 10,
    healthyAt: 80,
    warningAt: 60,
    criticalAt: 40,
  },
  keyword: {
    startScore: 100,
    qualityScoreFloor: 5,
    qualityScorePenalty: 25,
    lowQualityScore: 3,
    lowQualityPenalty: 40,
    ctrFloor: 0.01,
    ctrPenalty: 15,
    zeroConversionMinCost: 500.0, // currency units of spend with 0 conversions
    zeroConversionPenalty: 20,
    healthyAt: 80,
    warningAt: 60,
  },
  budget: {
    warningUtilization: 0.85,
    criticalUtilization: 1.0,
    // Fraction of the day elapsed used to project end-of-day spend.
    projectionMinElapsed: 0.05,
  },
  alert: {
    ctrDropPct: 0.2,
    cpcRisePct: 0.25,
    spendSpikePct: 0.5,
    qualityScoreDrop: 1, // avg QS fell by at least this many points
    searchTermSpikeCount: 25, // new search terms since yesterday
    limitedByBudgetUtil: 0.95,
    minImpressionsForCtrAlert: 100, // ignore tiny-volume noise
    criticalCtrDropPct: 0.4,
    criticalSpendSpikePct: 1.0,
  },
  priority: {
    // Priority = healthWeight*(100-health) + spendWeight*spendPressure.
    healthWeight: 0.7,
    spendWeight: 0.3,
    // Spend (currency/day) that represents maximum spend pressure (= 100).
    highSpendReference: 5000.0,
    baseReviewMinutes: 3,
    minutesPerIssue: 2,
    maxReviewMinutes: 30,
  },
};

/** SCREAMING_SNAKE of a camelCase key, for the env override lookup. */
function envName(group: string, key: string): string {
  const snake = key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
  return `OPS_${group.toUpperCase()}__${snake}`;
}

function withOverrides<T extends Record<string, number>>(group: string, defaults: T): T {
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const raw = process.env[envName(group, key)];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) out[key] = parsed as T[keyof T & string];
  }
  return out;
}

let cached: OpsRules | null = null;

/** Process-wide cached rules, with environment overrides applied once. */
export function getOpsRules(): OpsRules {
  if (cached) return cached;
  cached = {
    health: withOverrides('health', DEFAULTS.health),
    keyword: withOverrides('keyword', DEFAULTS.keyword),
    budget: withOverrides('budget', DEFAULTS.budget),
    alert: withOverrides('alert', DEFAULTS.alert),
    priority: withOverrides('priority', DEFAULTS.priority),
  };
  return cached;
}

/** Test seam — drops the cache so an env change is picked up. */
export function resetOpsRulesCache(): void {
  cached = null;
}
