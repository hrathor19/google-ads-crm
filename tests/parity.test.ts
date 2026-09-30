import { describe, expect, it, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  windowTotals,
  entityCounts,
  dailySeries,
  campaignsLimitedByBudgetCount,
  lowQualityKeywordCount,
  accountRollup,
  campaignRollup,
  keywordRollup,
  deriveCtr,
  deriveAvgCpc,
  microsToCurrency,
} from '@/lib/ops/metrics';
import { resolveRefDates, utcDay, isoDay, previousWindow, addDays } from '@/lib/ops/dates';

/**
 * Metric parity.
 *
 * The aggregation layer is checked against the same arithmetic run directly on
 * the database, rather than against hardcoded expectations: the source project
 * writes into this database and the figures move with every sync, so a frozen
 * snapshot would fail for the wrong reason. What must never drift is the
 * *relationship* — micros divided by a million, CTR derived after summing, and
 * null rather than zero where a denominator is zero.
 */

const prisma = new PrismaClient();
const ALL = { accountIds: null };

afterAll(async () => {
  await prisma.$disconnect();
});

describe('micros conversion', () => {
  it('divides by 1,000,000 and rounds to 2dp, matching the Python read path', () => {
    expect(microsToCurrency(5_307_120_000)).toBe(5307.12);
    expect(microsToCurrency(1)).toBe(0);
    expect(microsToCurrency(1_500_000)).toBe(1.5);
    expect(microsToCurrency(0)).toBe(0);
    expect(microsToCurrency(null)).toBe(0);
  });
});

describe('derived metrics', () => {
  it('computes CTR after summing, not as an average of per-row CTRs', () => {
    // Two days: 1 click / 100 impressions and 99 clicks / 100 impressions.
    // Averaging the daily CTRs gives 50%; the correct blended figure is 50%
    // only because the denominators match — with uneven volume they diverge.
    expect(deriveCtr(1 + 99, 100 + 900)).toBeCloseTo(0.1, 10);
  });

  it('returns null, not zero, when the denominator is zero', () => {
    expect(deriveCtr(0, 0)).toBeNull();
    expect(deriveAvgCpc(500, 0)).toBeNull();
  });
});

describe('date windows', () => {
  it('anchors the previous window so it never overlaps the current one', () => {
    const start = utcDay('2026-09-01');
    const end = utcDay('2026-09-30');
    const prev = previousWindow(start, end);
    expect(isoDay(prev.start)).toBe('2026-08-02');
    expect(isoDay(prev.end)).toBe('2026-08-31');
    expect(prev.end.getTime()).toBeLessThan(start.getTime());
  });

  it('gives the previous window the same length as the current one', () => {
    const start = utcDay('2026-09-01');
    const end = utcDay('2026-09-07');
    const prev = previousWindow(start, end);
    const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
    expect(days(prev.start, prev.end)).toBe(days(start, end));
  });
});

describe('aggregations against raw SQL', () => {
  it('window totals equal a direct SUM over campaign_snapshots', async () => {
    const refs = await resolveRefDates();
    const start = addDays(refs.latest, -29);

    const totals = await windowTotals(start, refs.latest, ALL);

    const [raw] = await prisma.$queryRaw<
      Array<{
        impressions: bigint;
        clicks: bigint;
        cost_micros: bigint;
        conversions: Prisma.Decimal;
      }>
    >`
      SELECT COALESCE(SUM(impressions),0) AS impressions,
             COALESCE(SUM(clicks),0)      AS clicks,
             COALESCE(SUM(cost_micros),0) AS cost_micros,
             COALESCE(SUM(conversions),0) AS conversions
      FROM campaign_snapshots
      WHERE snapshot_date BETWEEN ${isoDay(start)}::date AND ${isoDay(refs.latest)}::date
    `;

    expect(totals.impressions).toBe(Number(raw!.impressions));
    expect(totals.clicks).toBe(Number(raw!.clicks));
    expect(totals.cost).toBe(Math.round((Number(raw!.cost_micros) / 1e6) * 100) / 100);
    expect(totals.conversions).toBeCloseTo(Number(raw!.conversions), 4);
  });

  it('CTR and CPC are derived from the summed totals', async () => {
    const refs = await resolveRefDates();
    const start = addDays(refs.latest, -29);
    const totals = await windowTotals(start, refs.latest, ALL);

    if (totals.impressions > 0) {
      expect(totals.ctr).toBeCloseTo(totals.clicks / totals.impressions, 10);
    } else {
      expect(totals.ctr).toBeNull();
    }
    if (totals.clicks > 0) {
      expect(totals.avgCpc).toBeCloseTo(totals.cost / totals.clicks, 10);
    } else {
      expect(totals.avgCpc).toBeNull();
    }
  });

  it('entity counts exclude managers and count only ENABLED rows', async () => {
    const counts = await entityCounts(ALL);

    const [raw] = await prisma.$queryRaw<
      Array<{ accounts: bigint; campaigns: bigint; ad_groups: bigint; keywords: bigint }>
    >`
      SELECT
        (SELECT COUNT(*) FROM accounts WHERE is_manager = FALSE)     AS accounts,
        (SELECT COUNT(*) FROM campaigns WHERE status = 'ENABLED')    AS campaigns,
        (SELECT COUNT(*) FROM ad_groups WHERE status = 'ENABLED')    AS ad_groups,
        (SELECT COUNT(*) FROM keywords  WHERE status = 'ENABLED')    AS keywords
    `;

    expect(counts.accounts).toBe(Number(raw!.accounts));
    expect(counts.campaignsActive).toBe(Number(raw!.campaigns));
    expect(counts.adGroupsActive).toBe(Number(raw!.ad_groups));
    expect(counts.keywordsActive).toBe(Number(raw!.keywords));
  });

  it('the daily series sums back to the window total', async () => {
    const refs = await resolveRefDates();
    const start = addDays(refs.latest, -29);

    const [series, totals] = await Promise.all([
      dailySeries(start, refs.latest, ALL),
      windowTotals(start, refs.latest, ALL),
    ]);

    const summed = series.reduce(
      (acc, p) => ({
        impressions: acc.impressions + p.impressions,
        clicks: acc.clicks + p.clicks,
      }),
      { impressions: 0, clicks: 0 }
    );

    expect(summed.impressions).toBe(totals.impressions);
    expect(summed.clicks).toBe(totals.clicks);
  });

  it('the account rollup sums back to the window total', async () => {
    const refs = await resolveRefDates();
    const start = addDays(refs.latest, -29);

    const [rows, totals] = await Promise.all([
      accountRollup(start, refs.latest, ALL),
      windowTotals(start, refs.latest, ALL),
    ]);

    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);

    expect(clicks).toBe(totals.clicks);
    expect(impressions).toBe(totals.impressions);
  });

  it('the campaign rollup sums back to the window total', async () => {
    const refs = await resolveRefDates();
    const start = addDays(refs.latest, -29);

    const [rows, totals] = await Promise.all([
      campaignRollup(start, refs.latest, ALL),
      windowTotals(start, refs.latest, ALL),
    ]);

    expect(rows.reduce((s, r) => s + r.clicks, 0)).toBe(totals.clicks);
    expect(rows.reduce((s, r) => s + r.impressions, 0)).toBe(totals.impressions);
  });

  it('budget-limited and low-QS counts match a direct query', async () => {
    const refs = await resolveRefDates();

    const limited = await campaignsLimitedByBudgetCount(refs.latest, ALL);
    const [rawLimited] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(id) AS n FROM campaign_snapshots
      WHERE snapshot_date = ${isoDay(refs.latest)}::date
        AND budget_micros IS NOT NULL AND budget_micros > 0
        AND cost_micros >= budget_micros
    `;
    expect(limited).toBe(Number(rawLimited!.n));

    const lowQs = await lowQualityKeywordCount(refs.latest, 5, ALL);
    const [rawQs] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT keyword_id) AS n FROM keyword_snapshots
      WHERE snapshot_date = ${isoDay(refs.latest)}::date
        AND quality_score IS NOT NULL AND quality_score < 5
    `;
    expect(lowQs).toBe(Number(rawQs!.n));
  });

  it('keyword Quality Score is the rounded average over the window', async () => {
    const refs = await resolveRefDates();
    const start = addDays(refs.latest, -29);

    const rows = await keywordRollup(start, refs.latest, ALL, { limit: 50 });
    const scored = rows.filter((r) => r.qualityScore !== null);
    if (scored.length === 0) return; // nothing scored in this window

    for (const row of scored.slice(0, 5)) {
      const [raw] = await prisma.$queryRaw<Array<{ avg: Prisma.Decimal | null }>>`
        SELECT ROUND(AVG(quality_score)) AS avg FROM keyword_snapshots
        WHERE keyword_id = ${row.id}
          AND snapshot_date BETWEEN ${isoDay(start)}::date AND ${isoDay(refs.latest)}::date
      `;
      expect(row.qualityScore).toBe(Number(raw!.avg));
      // Quality Score is an integer 1-10; a fractional average would be
      // false precision.
      expect(Number.isInteger(row.qualityScore)).toBe(true);
    }
  });

  it('account scoping returns nothing for an empty allow-list, not everything', async () => {
    const refs = await resolveRefDates();
    const start = addDays(refs.latest, -29);

    const scoped = await windowTotals(start, refs.latest, { accountIds: [] });
    expect(scoped.clicks).toBe(0);
    expect(scoped.impressions).toBe(0);
    expect(scoped.cost).toBe(0);
  });

  it('a scoped total never exceeds the unscoped total', async () => {
    const refs = await resolveRefDates();
    const start = addDays(refs.latest, -29);

    const all = await accountRollup(start, refs.latest, ALL);
    const busiest = [...all].sort((a, b) => b.clicks - a.clicks)[0];
    if (!busiest) return;

    const scoped = await windowTotals(start, refs.latest, { accountIds: [busiest.id] });
    const total = await windowTotals(start, refs.latest, ALL);

    expect(scoped.clicks).toBe(busiest.clicks);
    expect(scoped.clicks).toBeLessThanOrEqual(total.clicks);
  });
});
