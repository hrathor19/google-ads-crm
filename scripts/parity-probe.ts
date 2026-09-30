/**
 * Prints the same figures the Python app's OpsRepository exposes, so the two
 * can be diffed on identical data. Used by docs/PARITY.md and the parity test.
 */
import { resolveRefDates, utcDay, addDays, isoDay } from '../lib/ops/dates';
import {
  entityCounts,
  windowTotals,
  campaignsLimitedByBudgetCount,
  lowQualityKeywordCount,
  newSearchTermsCount,
  dailySeries,
} from '../lib/ops/metrics';

async function main() {
  const scope = { accountIds: null };
  const refs = await resolveRefDates();
  const monthStart = utcDay(
    `${refs.latest.getUTCFullYear()}-${String(refs.latest.getUTCMonth() + 1).padStart(2, '0')}-01`
  );

  const out = {
    latest: isoDay(refs.latest),
    prior: isoDay(refs.prior),
    counts: await entityCounts(scope),
    day_totals: await windowTotals(refs.latest, refs.latest, scope),
    limited_by_budget: await campaignsLimitedByBudgetCount(refs.latest, scope),
    low_qs: await lowQualityKeywordCount(refs.latest, 5, scope),
    new_terms: await newSearchTermsCount(refs.latest, scope),
    daily_series_len: (await dailySeries(monthStart, refs.latest, scope)).length,
  };
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('../lib/prisma');
    await prisma.$disconnect();
  });
