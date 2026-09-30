/**
 * Pure scoring functions. A direct port of `app/services/ops/scoring.py`.
 *
 * No database, no I/O — deterministic math over plain objects, so the health,
 * keyword, budget and priority rules stay trivially unit-testable and the
 * numbers the console shows can be reproduced from the same inputs.
 *
 * Monetary inputs are in **account currency units**, already converted from
 * micros by the calling aggregation.
 */

import type { BudgetRules, HealthRules, KeywordRules, PriorityRules } from './rules';

// Severity ladder shared across issues and alerts.
export const CRITICAL = 'critical';
export const HIGH = 'high';
export const MEDIUM = 'medium';
export const LOW = 'low';

export type Severity = typeof CRITICAL | typeof HIGH | typeof MEDIUM | typeof LOW;

// Statuses we never score (paused/removed campaigns are intentionally ignored).
const INACTIVE_STATUSES = new Set(['PAUSED', 'REMOVED', 'UNKNOWN', 'UNSPECIFIED']);

/** Relative change from `previous` to `current` (0.2 == +20%). */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

export type DayMetrics = {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
};

export const emptyDay = (): DayMetrics => ({
  impressions: 0,
  clicks: 0,
  cost: 0,
  conversions: 0,
});

export function ctrOf(m: DayMetrics): number | null {
  return m.impressions ? m.clicks / m.impressions : null;
}

export function avgCpcOf(m: DayMetrics): number | null {
  return m.clicks ? m.cost / m.clicks : null;
}

export type CampaignContext = {
  status: string;
  dailyBudget: number;
  spendToday: number;
  optimizationScore?: number | null;
  avgQualityScore?: number | null;
  disapprovedAds?: number;
  disapprovedKeywords?: number;
  today: DayMetrics;
  prior: DayMetrics;
};

export function isActive(ctx: CampaignContext): boolean {
  return !INACTIVE_STATUSES.has((ctx.status || '').toUpperCase());
}

export function budgetUtilization(ctx: CampaignContext): number | null {
  return ctx.dailyBudget ? ctx.spendToday / ctx.dailyBudget : null;
}

export type Issue = { code: string; label: string; severity: Severity };

export type HealthLevel = 'healthy' | 'warning' | 'high' | 'critical' | 'ignored';

export type HealthResult = {
  score: number;
  level: HealthLevel;
  issues: Issue[];
  primaryReason: string | null;
  isActive: boolean;
};

// Formatting helpers matching Python's f-string specs, so issue labels read
// identically to the ones the old console produced.
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const pct2 = (v: number) => `${(v * 100).toFixed(2)}%`;
const one = (v: number) => v.toFixed(1);

function levelFromScore(score: number, rules: HealthRules): HealthLevel {
  if (score >= rules.healthyAt) return 'healthy';
  if (score >= rules.warningAt) return 'warning';
  if (score >= rules.criticalAt) return 'high';
  return 'critical';
}

/** Pick the highest-severity issue as the headline reason. */
function primaryReason(issues: Issue[]): string | null {
  if (issues.length === 0) return null;
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...issues].sort(
    (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9)
  )[0]!.label;
}

/** Score a campaign 0-100 and enumerate the issues that lowered it. */
export function computeCampaignHealth(
  ctx: CampaignContext,
  rules: HealthRules
): HealthResult {
  // Paused / removed campaigns are ignored, not penalised.
  if (!isActive(ctx)) {
    return { score: 100, level: 'ignored', issues: [], primaryReason: null, isActive: false };
  }

  let score = rules.startScore;
  const issues: Issue[] = [];

  const penalise = (points: number, code: string, label: string, severity: Severity) => {
    score -= points;
    issues.push({ code, label, severity });
  };

  // Zero impressions on an active campaign is a critical, immediate problem.
  if (ctx.today.impressions === 0) {
    penalise(0, 'NO_IMPRESSIONS', 'No impressions today', CRITICAL);
    score = Math.min(score, rules.criticalAt - 5);
  }

  const todayCtr = ctrOf(ctx.today);
  const priorCtr = ctrOf(ctx.prior);
  const todayCpc = avgCpcOf(ctx.today);
  const priorCpc = avgCpcOf(ctx.prior);

  // Low CTR (only meaningful with some impressions).
  if (todayCtr !== null && todayCtr < rules.ctrFloor) {
    penalise(
      rules.ctrPenalty,
      'LOW_CTR',
      `CTR ${pct2(todayCtr)} below ${pct0(rules.ctrFloor)}`,
      HIGH
    );
  }

  // CTR dropped sharply vs the prior day.
  const ctrDelta = todayCtr !== null && priorCtr !== null ? pctChange(todayCtr, priorCtr) : null;
  if (ctrDelta !== null && ctrDelta <= -rules.ctrDropPct) {
    penalise(rules.ctrDropPenalty, 'CTR_DROP', `CTR dropped ${pct0(Math.abs(ctrDelta))}`, HIGH);
  }

  // CPC rose sharply vs the prior day.
  const cpcDelta = todayCpc !== null && priorCpc !== null ? pctChange(todayCpc, priorCpc) : null;
  if (cpcDelta !== null && cpcDelta >= rules.cpcRisePct) {
    penalise(rules.cpcRisePenalty, 'CPC_RISE', `CPC up ${pct0(cpcDelta)}`, MEDIUM);
  }

  // Quality score.
  if (
    ctx.avgQualityScore !== null &&
    ctx.avgQualityScore !== undefined &&
    ctx.avgQualityScore < rules.qualityScoreFloor
  ) {
    penalise(
      rules.qualityScorePenalty,
      'LOW_QS',
      `Avg quality score ${one(ctx.avgQualityScore)} < ${rules.qualityScoreFloor}`,
      HIGH
    );
  }

  // Budget pressure.
  const util = budgetUtilization(ctx);
  if (util !== null) {
    if (util >= 1.0) {
      penalise(
        rules.limitedByBudgetPenalty,
        'LIMITED_BY_BUDGET',
        'Limited by budget (100%+ spent)',
        HIGH
      );
    } else if (util >= rules.budgetUtilWarn) {
      penalise(
        rules.budgetUtilPenalty,
        'BUDGET_NEARLY_EXHAUSTED',
        `Budget ${pct0(util)} spent`,
        MEDIUM
      );
    }
  }

  // Optimization score.
  if (
    ctx.optimizationScore !== null &&
    ctx.optimizationScore !== undefined &&
    ctx.optimizationScore < rules.optimizationScoreFloor
  ) {
    penalise(
      rules.optimizationScorePenalty,
      'LOW_OPT_SCORE',
      `Optimization score ${pct0(ctx.optimizationScore)}`,
      MEDIUM
    );
  }

  // Policy disapprovals.
  const disapprovedAds = ctx.disapprovedAds ?? 0;
  const disapprovedKeywords = ctx.disapprovedKeywords ?? 0;
  if (disapprovedAds > 0) {
    penalise(
      rules.disapprovedAdsPenalty,
      'DISAPPROVED_ADS',
      `${disapprovedAds} disapproved ad(s)`,
      HIGH
    );
  }
  if (disapprovedKeywords > 0) {
    penalise(
      rules.disapprovedKeywordsPenalty,
      'DISAPPROVED_KEYWORDS',
      `${disapprovedKeywords} disapproved keyword(s)`,
      MEDIUM
    );
  }

  score = Math.max(0, Math.min(100, score));
  let level = levelFromScore(score, rules);
  // A NO_IMPRESSIONS issue always forces the critical band.
  if (issues.some((i) => i.code === 'NO_IMPRESSIONS')) level = 'critical';

  return { score, level, issues, primaryReason: primaryReason(issues), isActive: true };
}

// ─── Keyword health ──────────────────────────────────────────────────────────

export type KeywordContext = {
  qualityScore: number | null;
  cost: number;
  conversions: number;
  metrics: DayMetrics;
};

export type KeywordHealthResult = {
  score: number;
  level: 'healthy' | 'warning' | 'critical';
  issues: Issue[];
};

export function computeKeywordHealth(
  ctx: KeywordContext,
  rules: KeywordRules
): KeywordHealthResult {
  let score = rules.startScore;
  const issues: Issue[] = [];

  const penalise = (points: number, code: string, label: string, severity: Severity) => {
    score -= points;
    issues.push({ code, label, severity });
  };

  if (ctx.qualityScore !== null) {
    if (ctx.qualityScore <= rules.lowQualityScore) {
      penalise(
        rules.lowQualityPenalty,
        'VERY_LOW_QS',
        `Quality score ${ctx.qualityScore}`,
        CRITICAL
      );
    } else if (ctx.qualityScore < rules.qualityScoreFloor) {
      penalise(rules.qualityScorePenalty, 'LOW_QS', `Quality score ${ctx.qualityScore}`, HIGH);
    }
  }

  const ctr = ctrOf(ctx.metrics);
  if (ctr !== null && ctr < rules.ctrFloor) {
    penalise(rules.ctrPenalty, 'LOW_CTR', `CTR ${pct2(ctr)}`, MEDIUM);
  }

  if (ctx.cost >= rules.zeroConversionMinCost && ctx.conversions === 0) {
    penalise(rules.zeroConversionPenalty, 'SPEND_NO_CONV', 'Spend with 0 conversions', HIGH);
  }

  score = Math.max(0, Math.min(100, score));
  const level =
    score >= rules.healthyAt ? 'healthy' : score >= rules.warningAt ? 'warning' : 'critical';
  return { score, level, issues };
}

// ─── Budget risk ─────────────────────────────────────────────────────────────

export type BudgetRiskResult = {
  risk: 'healthy' | 'warning' | 'critical';
  projectedEodSpend: number;
  utilization: number | null;
};

/** Assess budget risk and project end-of-day spend by linear extrapolation. */
export function computeBudgetRisk(params: {
  dailyBudget: number;
  spendSoFar: number;
  fractionOfDayElapsed: number;
  rules: BudgetRules;
}): BudgetRiskResult {
  const { dailyBudget, spendSoFar, fractionOfDayElapsed, rules } = params;

  const util = dailyBudget ? spendSoFar / dailyBudget : null;
  const elapsed = Math.max(rules.projectionMinElapsed, Math.min(1.0, fractionOfDayElapsed));
  const projected = spendSoFar ? spendSoFar / elapsed : 0;

  let risk: BudgetRiskResult['risk'];
  if (util === null) {
    risk = 'healthy';
  } else if (util >= rules.criticalUtilization) {
    risk = 'critical';
  } else if (util >= rules.warningUtilization) {
    risk = 'warning';
  } else {
    // Also warn if the projection will blow the budget even if it hasn't yet.
    const projUtil = dailyBudget ? projected / dailyBudget : 0;
    risk = projUtil >= rules.criticalUtilization ? 'warning' : 'healthy';
  }

  return { risk, projectedEodSpend: round2(projected), utilization: util };
}

// ─── Priority engine ─────────────────────────────────────────────────────────

export type PriorityResult = {
  score: number;
  reasons: string[];
  estimatedReviewMinutes: number;
  estimatedWastedSpend: number;
};

/** Turn a health result + spend into an actionable priority (0-100). */
export function computePriority(
  health: HealthResult,
  spendToday: number,
  rules: PriorityRules
): PriorityResult {
  if (!health.isActive) {
    return { score: 0, reasons: [], estimatedReviewMinutes: 0, estimatedWastedSpend: 0 };
  }

  const spendPressure = Math.min(100, (spendToday / rules.highSpendReference) * 100);
  const raw = rules.healthWeight * (100 - health.score) + rules.spendWeight * spendPressure;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const minutes = Math.min(
    rules.maxReviewMinutes,
    rules.baseReviewMinutes + rules.minutesPerIssue * health.issues.length
  );

  // Wasted-spend estimate: scale today's spend by how unhealthy the campaign is.
  const wasteFactor = (100 - health.score) / 100;

  return {
    score,
    reasons: health.issues.map((i) => i.label),
    estimatedReviewMinutes: minutes,
    estimatedWastedSpend: round2(spendToday * wasteFactor),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
