/**
 * Side-by-side parity check against the Python app.
 *
 *   npm run parity
 *
 * Runs the same figures through this app's aggregation layer and prints them
 * next to the source project's, computed from the identical rows in the
 * identical database. Anything that differs is a real divergence, not noise.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** Where the Python project lives; override with --source=/path/to/it. */
const SOURCE_DIR =
  process.argv.find((a) => a.startsWith('--source='))?.split('=')[1] ??
  process.env.ADS_INTELLIGENCE_DIR ??
  resolve(process.cwd(), '..', '..', 'google-ads-intelligence-main');

/**
 * Run the source project's reporting code and return its figures.
 *
 * Captured now, not read from a file written earlier: both engines read the
 * same live database, so a sync between the two measurements would show up as
 * a divergence that does not exist. (It already did once — a Refresh moved
 * active campaigns 168 -> 171 between a saved snapshot and a comparison run.)
 */
function capturePythonReference(): Record<string, unknown> | null {
  const venv = resolve(SOURCE_DIR, '.venv/bin/python');
  const script = resolve(process.cwd(), 'scripts/python-reference.py');
  if (!existsSync(venv)) {
    console.error(`No Python venv at ${venv}.`);
    console.error('Pass --source=/path/to/google-ads-intelligence-main, or');
    console.error('--reference=<file.json> to diff against a saved capture.');
    return null;
  }
  const out = execFileSync(venv, [script], {
    cwd: SOURCE_DIR,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out) as Record<string, unknown>;
}

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

  // A saved file is still accepted, but the default is a live capture.
  const python = REFERENCE
    ? (JSON.parse(readFileSync(REFERENCE, 'utf8')) as Record<string, unknown>)
    : capturePythonReference();

  if (!python) {
    console.log('\nThis app only:\n');
    console.log(JSON.stringify(node, null, 2));
    process.exitCode = 1;
    return;
  }
  const py = python as Record<string, any>;
  const rows: Row[] = [];

  const push = (metric: string, p: unknown, n: unknown) =>
    rows.push({ metric, python: p, node: n, match: near(p, n) });

  push('window', py.window, node.window);
  for (const k of Object.keys(node.counts)) {
    push(`counts.${k}`, py.counts?.[k], (node.counts as Record<string, unknown>)[k]);
  }
  for (const k of Object.keys(node.window_totals)) {
    push(
      `30d.${k}`,
      py.window_totals?.[k],
      (node.window_totals as Record<string, unknown>)[k]
    );
  }
  for (const k of Object.keys(node.day_totals_latest)) {
    push(
      `latestDay.${k}`,
      py.day_totals_latest?.[k],
      (node.day_totals_latest as Record<string, unknown>)[k]
    );
  }
  push('series_days', py.series_days, node.series_days);
  push('limited_by_budget', py.limited_by_budget, node.limited_by_budget);
  push('low_qs_keywords', py.low_qs_keywords, node.low_qs_keywords);
  push('keyword_rows', py.keyword_rows, node.keyword_rows);
  push('keyword_cost_sum', py.keyword_cost_sum, node.keyword_cost_sum);
  push('search_term_total', py.search_term_total, node.search_term_total);
  for (let i = 0; i < 5; i++) {
    push(
      `topTerm[${i}].cost`,
      py.search_term_top?.[i]?.cost,
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
