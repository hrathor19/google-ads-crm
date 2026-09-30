/**
 * Side-by-side parity check against the Python app.
 *
 *   npm run parity
 *
 * Runs the same figures through this app's aggregation layer and prints them
 * next to the source project's, computed from the identical rows in the
 * identical database. Anything that differs is a real divergence, not noise.
 */
import { readFileSync } from 'node:fs';
import { resolveRefDates, addDays, isoDay } from '@/lib/ops/dates';
import {
  entityCounts,
  windowTotals,
  dailySeries,
  campaignsLimitedByBudgetCount,
  lowQualityKeywordCount,
  keywordRollup,
  searchTermExplore,
} from '@/lib/ops/metrics';

const ALL = { accountIds: null };
const REFERENCE = process.argv.find((a) => a.startsWith('--reference='))?.split('=')[1];

type Row = { metric: string; python: unknown; node: unknown; match: boolean };

/** Compare with a tolerance, since float summation order differs by engine. */
function near(a: unknown, b: unknown, tolerance = 0.011): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tolerance;
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const refs = await resolveRefDates();
  const start = addDays(refs.latest, -29);

  const [counts, totals, series, limited, lowQs, keywords, terms] = await Promise.all([
    entityCounts(ALL),
    windowTotals(start, refs.latest, ALL),
    dailySeries(start, refs.latest, ALL),
    campaignsLimitedByBudgetCount(refs.latest, ALL),
    lowQualityKeywordCount(refs.latest, 5, ALL),
    keywordRollup(start, refs.latest, ALL, { limit: 5000 }),
    searchTermExplore({ start, end: refs.latest, scope: ALL, limit: 10, sort: 'cost' }),
  ]);
  const dayTotals = await windowTotals(refs.latest, refs.latest, ALL);

  const node = {
    window: [isoDay(start), isoDay(refs.latest)],
    counts: {
      accounts: counts.accounts,
      campaigns_active: counts.campaignsActive,
      ad_groups_active: counts.adGroupsActive,
      keywords_active: counts.keywordsActive,
    },
    window_totals: {
      impressions: totals.impressions,
      clicks: totals.clicks,
      cost: totals.cost,
      conversions: totals.conversions,
      ctr: totals.ctr,
      avg_cpc: totals.avgCpc,
      cost_per_conv: totals.costPerConversion,
    },
    day_totals_latest: {
      impressions: dayTotals.impressions,
      clicks: dayTotals.clicks,
      cost: dayTotals.cost,
      conversions: dayTotals.conversions,
    },
    series_days: series.length,
    limited_by_budget: limited,
    low_qs_keywords: lowQs,
    keyword_rows: keywords.length,
    keyword_cost_sum: Math.round(keywords.reduce((s, k) => s + (k.cost ?? 0), 0) * 100) / 100,
    search_term_total: terms.total,
    search_term_top: terms.rows.slice(0, 5).map((r) => ({
      q: r.query,
      cost: r.cost,
      clicks: r.clicks,
    })),
  };

  if (!REFERENCE) {
    console.log(JSON.stringify(node, null, 2));
    return;
  }

  const python = JSON.parse(readFileSync(REFERENCE, 'utf8'));
  const rows: Row[] = [];

  const push = (metric: string, p: unknown, n: unknown) =>
    rows.push({ metric, python: p, node: n, match: near(p, n) });

  push('window', python.window, node.window);
  for (const k of Object.keys(node.counts)) {
    push(`counts.${k}`, python.counts?.[k], (node.counts as Record<string, unknown>)[k]);
  }
  for (const k of Object.keys(node.window_totals)) {
    push(
      `30d.${k}`,
      python.window_totals?.[k],
      (node.window_totals as Record<string, unknown>)[k]
    );
  }
  for (const k of Object.keys(node.day_totals_latest)) {
    push(
      `latestDay.${k}`,
      python.day_totals_latest?.[k],
      (node.day_totals_latest as Record<string, unknown>)[k]
    );
  }
  push('series_days', python.series_days, node.series_days);
  push('limited_by_budget', python.limited_by_budget, node.limited_by_budget);
  push('low_qs_keywords', python.low_qs_keywords, node.low_qs_keywords);
  push('keyword_rows', python.keyword_rows, node.keyword_rows);
  push('keyword_cost_sum', python.keyword_cost_sum, node.keyword_cost_sum);
  push('search_term_total', python.search_term_total, node.search_term_total);
  for (let i = 0; i < 5; i++) {
    push(
      `topTerm[${i}].cost`,
      python.search_term_top?.[i]?.cost,
      node.search_term_top[i]?.cost
    );
  }

  const width = Math.max(...rows.map((r) => r.metric.length)) + 2;
  console.log(`\n${'metric'.padEnd(width)}${'python'.padEnd(22)}${'node'.padEnd(22)}match`);
  console.log('─'.repeat(width + 50));
  for (const r of rows) {
    console.log(
      `${r.metric.padEnd(width)}${String(JSON.stringify(r.python)).slice(0, 20).padEnd(22)}${String(
        JSON.stringify(r.node)
      )
        .slice(0, 20)
        .padEnd(22)}${r.match ? 'yes' : 'NO'}`
    );
  }

  const mismatches = rows.filter((r) => !r.match);
  console.log(`\n${rows.length - mismatches.length}/${rows.length} match\n`);
  if (mismatches.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$disconnect();
  });
