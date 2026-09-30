import 'server-only';
import { getOpsRules } from './rules';
import {
  computeBudgetRisk,
  computeCampaignHealth,
  computeKeywordHealth,
  computePriority,
  emptyDay,
  pctChange,
  type CampaignContext,
  type DayMetrics,
  type HealthResult,
} from './scoring';
import {
  accountRollup,
  avgQualityScoreByCampaign,
  campaignMetricsByDay,
  campaignMeta,
  campaignRollup,
  campaignsLimitedByBudgetCount,
  dailySeries,
  disapprovedAdsByCampaign,
  disapprovedAdsTotal,
  entityCounts,
  keywordRollup,
  latestBudgetSnapshots,
  lowQualityKeywordCount,
  newSearchTermsCount,
  syncHealth,
  windowTotals,
  zeroImpressionCampaigns,
  type Scope,
  type Totals,
} from './metrics';
import {
  addDays,
  fractionOfDayElapsed,
  isoDay,
  previousWindow,
  resolveRefDates,
  type RefDates,
} from './dates';

/**
 * The services the console reads through. Ports of `app/services/ops/*.py`:
 * each one composes the grouped aggregations with the pure scoring functions
 * and returns a plain object ready to serialise.
 */

// ─── Executive overview ──────────────────────────────────────────────────────

export type OverviewAlert = {
  code: string;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  detail: string;
  count: number;
};

export type Overview = {
  referenceDate: string;
  window: { start: string; end: string };
  previousWindow: { start: string; end: string };
  counts: Awaited<ReturnType<typeof entityCounts>>;
  totals: Totals;
  previousTotals: Totals;
  /** Relative change per metric, null where the previous period was zero. */
  deltas: Record<keyof Totals, number | null>;
  series: Awaited<ReturnType<typeof dailySeries>>;
  alerts: OverviewAlert[];
  sync: Awaited<ReturnType<typeof syncHealth>>;
};

function computeDeltas(current: Totals, previous: Totals): Record<keyof Totals, number | null> {
  const keys = Object.keys(current) as Array<keyof Totals>;
  const out = {} as Record<keyof Totals, number | null>;
  for (const k of keys) {
    const c = current[k];
    const p = previous[k];
    out[k] = c === null || p === null ? null : pctChange(c, p);
  }
  return out;
}

export async function buildOverview(params: {
  start: Date;
  end: Date;
  scope: Scope;
}): Promise<Overview> {
  const rules = getOpsRules();
  const { start, end, scope } = params;
  const prev = previousWindow(start, end);
  const refs = await resolveRefDates();

  const [counts, totals, previousTotals, series, sync, limitedByBudget, disapproved, lowQs, newTerms, zeroImp] =
    await Promise.all([
      entityCounts(scope),
      windowTotals(start, end, scope),
      windowTotals(prev.start, prev.end, scope),
      dailySeries(start, end, scope),
      syncHealth(),
      campaignsLimitedByBudgetCount(refs.latest, scope),
      disapprovedAdsTotal(scope),
      lowQualityKeywordCount(refs.latest, rules.health.qualityScoreFloor, scope),
      newSearchTermsCount(refs.latest, scope),
      zeroImpressionCampaigns(refs.latest, scope, 50),
    ]);

  const alerts: OverviewAlert[] = [];
  if (limitedByBudget > 0) {
    alerts.push({
      code: 'LIMITED_BY_BUDGET',
      severity: 'high',
      title: 'Campaigns limited by budget',
      detail: `${limitedByBudget} campaign(s) spent their full daily budget on ${isoDay(refs.latest)}. They stopped serving early.`,
      count: limitedByBudget,
    });
  }
  if (zeroImp.length > 0) {
    alerts.push({
      code: 'NO_IMPRESSIONS',
      severity: 'critical',
      title: 'Enabled campaigns with zero impressions',
      detail: `${zeroImp.length} enabled campaign(s) recorded no impressions on ${isoDay(refs.latest)}.`,
      count: zeroImp.length,
    });
  }
  if (disapproved > 0) {
    alerts.push({
      code: 'DISAPPROVED_ADS',
      severity: 'critical',
      title: 'Disapproved ads',
      detail: `${disapproved} ad(s) are disapproved and are not serving.`,
      count: disapproved,
    });
  }
  if (lowQs > 0) {
    alerts.push({
      code: 'LOW_QUALITY_SCORE',
      severity: 'medium',
      title: 'Keywords below the Quality Score floor',
      detail: `${lowQs} keyword(s) scored under ${rules.health.qualityScoreFloor}, which raises their CPC.`,
      count: lowQs,
    });
  }
  if (newTerms >= rules.alert.searchTermSpikeCount) {
    alerts.push({
      code: 'SEARCH_TERM_SPIKE',
      severity: 'medium',
      title: 'New search terms to review',
      detail: `${newTerms} new search term(s) appeared. Check for negatives worth adding.`,
      count: newTerms,
    });
  }

  return {
    referenceDate: isoDay(refs.latest),
    window: { start: isoDay(start), end: isoDay(end) },
    previousWindow: { start: isoDay(prev.start), end: isoDay(prev.end) },
    counts,
    totals,
    previousTotals,
    deltas: computeDeltas(totals, previousTotals),
    series,
    alerts,
    sync,
  };
}

/** Best and worst campaigns by spend over the window, for the overview cards. */
export async function topAndBottomCampaigns(params: {
  start: Date;
  end: Date;
  scope: Scope;
  limit?: number;
}) {
  const limit = params.limit ?? 5;
  const rows = await campaignRollup(params.start, params.end, params.scope);
  const withSpend = rows.filter((r) => r.cost > 0);
  return {
    topSpenders: withSpend.slice(0, limit),
    // Worst = spending with the least to show for it. Ranked by cost per
    // conversion where there is one, else by lowest CTR among spenders, so the
    // card surfaces waste rather than merely small campaigns.
    worstPerformers: [...withSpend]
      .sort((a, b) => {
        const aKey = a.costPerConversion ?? Number.POSITIVE_INFINITY;
        const bKey = b.costPerConversion ?? Number.POSITIVE_INFINITY;
        if (aKey !== bKey) return bKey - aKey;
        return (a.ctr ?? 0) - (b.ctr ?? 0);
      })
      .slice(0, limit),
  };
}

// ─── Campaign health ─────────────────────────────────────────────────────────

export type CampaignHealthRow = {
  campaignPk: number;
  campaignId: string;
  name: string | null;
  accountId: number;
  accountName: string | null;
  status: string | null;
  score: number;
  level: HealthResult['level'];
  issues: HealthResult['issues'];
  primaryReason: string | null;
  spendToday: number;
  budget: number;
  budgetUtilization: number | null;
  today: DayMetrics;
  prior: DayMetrics;
  priority: ReturnType<typeof computePriority>;
};

export async function buildCampaignHealth(params: {
  scope: Scope;
  refs?: RefDates;
}): Promise<{ referenceDate: string; rows: CampaignHealthRow[] }> {
  const rules = getOpsRules();
  const refs = params.refs ?? (await resolveRefDates());
  const { scope } = params;

  const [meta, byDay, qsByCampaign, disapproved] = await Promise.all([
    campaignMeta(scope),
    campaignMetricsByDay([refs.latest, refs.prior], scope),
    avgQualityScoreByCampaign(refs.latest, scope),
    disapprovedAdsByCampaign(scope),
  ]);

  const latestKey = isoDay(refs.latest);
  const priorKey = isoDay(refs.prior);

  const rows: CampaignHealthRow[] = meta.map((m) => {
    const days = byDay.get(m.campaignPk);
    const todayRaw = days?.get(latestKey);
    const priorRaw = days?.get(priorKey);

    const today: DayMetrics = todayRaw
      ? {
          impressions: todayRaw.impressions,
          clicks: todayRaw.clicks,
          cost: todayRaw.cost,
          conversions: todayRaw.conversions,
        }
      : emptyDay();
    const prior: DayMetrics = priorRaw
      ? {
          impressions: priorRaw.impressions,
          clicks: priorRaw.clicks,
          cost: priorRaw.cost,
          conversions: priorRaw.conversions,
        }
      : emptyDay();

    const ctx: CampaignContext = {
      status: m.status ?? '',
      dailyBudget: todayRaw?.budget ?? 0,
      spendToday: today.cost,
      optimizationScore: m.optimizationScore,
      avgQualityScore: qsByCampaign.get(m.campaignPk) ?? null,
      disapprovedAds: disapproved.get(m.campaignPk) ?? 0,
      disapprovedKeywords: 0, // keyword policy status is not captured by the sync
      today,
      prior,
    };

    const health = computeCampaignHealth(ctx, rules.health);
    const budget = todayRaw?.budget ?? 0;

    return {
      campaignPk: m.campaignPk,
      campaignId: m.campaignId,
      name: m.name,
      accountId: m.accountId,
      accountName: m.accountName,
      status: m.status,
      score: health.score,
      level: health.level,
      issues: health.issues,
      primaryReason: health.primaryReason,
      spendToday: Math.round(today.cost * 100) / 100,
      budget: Math.round(budget * 100) / 100,
      budgetUtilization: budget ? today.cost / budget : null,
      today,
      prior,
      priority: computePriority(health, today.cost, rules.priority),
    };
  });

  return { referenceDate: latestKey, rows };
}

/** The Priority Queue: unhealthy campaigns ranked by what to fix first. */
export async function buildPriorityQueue(params: { scope: Scope; limit?: number }) {
  const { rows, referenceDate } = await buildCampaignHealth({ scope: params.scope });
  const ranked = rows
    .filter((r) => r.level !== 'ignored' && r.priority.score > 0)
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, params.limit ?? 50);

  return {
    referenceDate,
    totalReviewMinutes: ranked.reduce((sum, r) => sum + r.priority.estimatedReviewMinutes, 0),
    estimatedWastedSpend:
      Math.round(ranked.reduce((sum, r) => sum + r.priority.estimatedWastedSpend, 0) * 100) / 100,
    rows: ranked,
  };
}

// ─── Keyword health ──────────────────────────────────────────────────────────

export async function buildKeywordHealth(params: {
  start: Date;
  end: Date;
  scope: Scope;
  accountId?: number | null;
  campaignPk?: number | null;
  search?: string | null;
  limit?: number;
}) {
  const rules = getOpsRules();
  const keywords = await keywordRollup(params.start, params.end, params.scope, {
    accountId: params.accountId ?? null,
    campaignPk: params.campaignPk ?? null,
    search: params.search ?? null,
    limit: params.limit ?? 2000,
  });

  const rows = keywords.map((k) => {
    const health = computeKeywordHealth(
      {
        qualityScore: k.qualityScore,
        cost: k.cost,
        conversions: k.conversions,
        metrics: {
          impressions: k.impressions,
          clicks: k.clicks,
          cost: k.cost,
          conversions: k.conversions,
        },
      },
      rules.keyword
    );
    return { ...k, score: health.score, level: health.level, issues: health.issues };
  });

  return {
    rows,
    summary: {
      total: rows.length,
      healthy: rows.filter((r) => r.level === 'healthy').length,
      warning: rows.filter((r) => r.level === 'warning').length,
      critical: rows.filter((r) => r.level === 'critical').length,
    },
  };
}

// ─── Budget monitoring ───────────────────────────────────────────────────────

export async function buildBudgetMonitor(params: { scope: Scope }) {
  const rules = getOpsRules();
  const budgets = await latestBudgetSnapshots(params.scope);
  const elapsed = fractionOfDayElapsed();

  const rows = budgets.map((b) => {
    const risk = computeBudgetRisk({
      dailyBudget: b.amount,
      spendSoFar: b.spend,
      fractionOfDayElapsed: elapsed,
      rules: rules.budget,
    });
    return { ...b, ...risk };
  });

  return {
    rows,
    summary: {
      total: rows.length,
      healthy: rows.filter((r) => r.risk === 'healthy').length,
      warning: rows.filter((r) => r.risk === 'warning').length,
      critical: rows.filter((r) => r.risk === 'critical').length,
    },
  };
}

// ─── Trends ──────────────────────────────────────────────────────────────────

export async function buildTrends(params: { start: Date; end: Date; scope: Scope }) {
  const prev = previousWindow(params.start, params.end);
  const [series, previousSeries, totals, previousTotals] = await Promise.all([
    dailySeries(params.start, params.end, params.scope),
    dailySeries(prev.start, prev.end, params.scope),
    windowTotals(params.start, params.end, params.scope),
    windowTotals(prev.start, prev.end, params.scope),
  ]);

  return {
    window: { start: isoDay(params.start), end: isoDay(params.end) },
    previousWindow: { start: isoDay(prev.start), end: isoDay(prev.end) },
    series,
    previousSeries,
    totals,
    previousTotals,
    deltas: computeDeltas(totals, previousTotals),
  };
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export type OpsAlert = {
  code: string;
  severity: 'critical' | 'high' | 'medium';
  entity: 'campaign' | 'account';
  entityId: number;
  entityName: string | null;
  accountName: string | null;
  title: string;
  detail: string;
  metric: string | null;
  value: number | null;
};

/**
 * Day-over-day alert evaluation. A port of `alerts_service.py`'s rules, run on
 * read rather than persisted, because the inputs are two days of grouped
 * snapshots and recomputing them is cheaper than keeping an alerts table in
 * step with a re-run sync.
 */
export async function evaluateAlerts(params: { scope: Scope }): Promise<{
  referenceDate: string;
  alerts: OpsAlert[];
}> {
  const rules = getOpsRules();
  const refs = await resolveRefDates();
  const { rows, referenceDate } = await buildCampaignHealth({ scope: params.scope, refs });

  const alerts: OpsAlert[] = [];

  for (const r of rows) {
    if (r.level === 'ignored') continue;

    const base = {
      entity: 'campaign' as const,
      entityId: r.campaignPk,
      entityName: r.name,
      accountName: r.accountName,
    };

    const todayCtr = r.today.impressions ? r.today.clicks / r.today.impressions : null;
    const priorCtr = r.prior.impressions ? r.prior.clicks / r.prior.impressions : null;
    const todayCpc = r.today.clicks ? r.today.cost / r.today.clicks : null;
    const priorCpc = r.prior.clicks ? r.prior.cost / r.prior.clicks : null;

    // CTR drop — suppressed under the minimum-impressions floor so a campaign
    // with a handful of impressions can't generate noise every morning.
    if (
      todayCtr !== null &&
      priorCtr !== null &&
      r.today.impressions >= rules.alert.minImpressionsForCtrAlert
    ) {
      const delta = pctChange(todayCtr, priorCtr);
      if (delta !== null && delta <= -rules.alert.ctrDropPct) {
        alerts.push({
          ...base,
          code: 'CTR_DROP',
          severity: delta <= -rules.alert.criticalCtrDropPct ? 'critical' : 'high',
          title: 'CTR dropped',
          detail: `CTR fell ${Math.round(Math.abs(delta) * 100)}% vs the previous day.`,
          metric: 'ctr',
          value: todayCtr,
        });
      }
    }

    if (todayCpc !== null && priorCpc !== null) {
      const delta = pctChange(todayCpc, priorCpc);
      if (delta !== null && delta >= rules.alert.cpcRisePct) {
        alerts.push({
          ...base,
          code: 'CPC_RISE',
          severity: 'medium',
          title: 'CPC rose',
          detail: `Average CPC rose ${Math.round(delta * 100)}% vs the previous day.`,
          metric: 'avgCpc',
          value: todayCpc,
        });
      }
    }

    const spendDelta = pctChange(r.today.cost, r.prior.cost);
    if (spendDelta !== null && spendDelta >= rules.alert.spendSpikePct) {
      alerts.push({
        ...base,
        code: 'SPEND_SPIKE',
        severity: spendDelta >= rules.alert.criticalSpendSpikePct ? 'critical' : 'high',
        title: 'Spend spiked',
        detail: `Spend rose ${Math.round(spendDelta * 100)}% vs the previous day.`,
        metric: 'cost',
        value: r.today.cost,
      });
    }

    if (r.budgetUtilization !== null && r.budgetUtilization >= rules.alert.limitedByBudgetUtil) {
      alerts.push({
        ...base,
        code: 'LIMITED_BY_BUDGET',
        severity: r.budgetUtilization >= 1 ? 'high' : 'medium',
        title: 'Budget nearly exhausted',
        detail: `${Math.round(r.budgetUtilization * 100)}% of the daily budget is spent.`,
        metric: 'budgetUtilization',
        value: r.budgetUtilization,
      });
    }

    if (r.issues.some((i) => i.code === 'NO_IMPRESSIONS')) {
      alerts.push({
        ...base,
        code: 'NO_IMPRESSIONS',
        severity: 'critical',
        title: 'No impressions',
        detail: 'An enabled campaign served nothing on the reference day.',
        metric: 'impressions',
        value: 0,
      });
    }

    if (r.issues.some((i) => i.code === 'DISAPPROVED_ADS')) {
      alerts.push({
        ...base,
        code: 'DISAPPROVED_ADS',
        severity: 'critical',
        title: 'Disapproved ads',
        detail: r.issues.find((i) => i.code === 'DISAPPROVED_ADS')!.label,
        metric: null,
        value: null,
      });
    }
  }

  const order = { critical: 0, high: 1, medium: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);

  return { referenceDate, alerts };
}

// ─── Account drill-down ──────────────────────────────────────────────────────

export async function buildAccountsView(params: { start: Date; end: Date; scope: Scope }) {
  const [rows, totals] = await Promise.all([
    accountRollup(params.start, params.end, params.scope),
    windowTotals(params.start, params.end, params.scope),
  ]);
  return { rows, totals };
}

export { addDays, isoDay, resolveRefDates };
