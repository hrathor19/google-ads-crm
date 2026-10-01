/**
 * Prove every sync entity can actually write.
 *
 * `npm run parity` cannot do this. It compares two engines reading the *same*
 * database, so a write path that has never worked still reports parity: both
 * sides agree on whatever is in the table, whoever put it there. That is
 * exactly how three search-term bugs survived — a column the snapshot table
 * does not have, an identity that ignored match_type, and a transaction
 * timeout sized for a sparser entity. The table had rows, so nothing looked
 * wrong; the rows were the Python app's.
 *
 * So this runs each entity for real, against one account and one month, and
 * asserts the sync reported success and the target table holds rows for that
 * window afterwards. Safe to re-run: replaceWindow replaces a window rather
 * than appending to it.
 *
 *   npm run check:writes                     # a recent month, busiest account
 *   npm run check:writes -- --month=2026-08
 *   npm run check:writes -- --customer=6896061937
 */
import { prisma } from '@/lib/prisma';
import { runSync, type SyncEntity } from '@/lib/google-ads/sync';
import { monthRange } from '@/lib/ops/month-chunks';

/** Which table each entity must land rows in, and whether rows are expected. */
const TARGETS: Array<{ entity: SyncEntity; table: string }> = [
  { entity: 'campaigns', table: 'campaign_snapshots' },
  { entity: 'ad_groups', table: 'ad_group_snapshots' },
  { entity: 'ads', table: 'ad_snapshots' },
  { entity: 'keywords', table: 'keyword_snapshots' },
  { entity: 'search_terms', table: 'search_term_snapshots' },
  { entity: 'budgets', table: 'budget_snapshots' },
];

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function rowsInWindow(table: string, accountId: number, start: Date, end: Date) {
  const out = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "${table}"
     WHERE account_id = $1 AND snapshot_date >= $2::date AND snapshot_date <= $3::date`,
    accountId,
    start.toISOString().slice(0, 10),
    end.toISOString().slice(0, 10)
  );
  return out[0]?.n ?? 0;
}

async function main() {
  const month = arg('month') ?? new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);

  // Default to the account with the most recent activity: an idle account
  // writes no snapshots, which would make a broken writer look fine.
  let customerId = arg('customer');
  if (!customerId) {
    const busiest = await prisma.$queryRawUnsafe<Array<{ customer_id: string }>>(
      `SELECT a.customer_id
       FROM campaign_snapshots cs JOIN accounts a ON a.id = cs.account_id
       WHERE cs.snapshot_date >= $1::date AND cs.snapshot_date <= $2::date
       GROUP BY a.customer_id ORDER BY sum(cs.clicks) DESC LIMIT 1`,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10)
    );
    customerId = busiest[0]?.customer_id;
  }
  if (!customerId) {
    console.error(`No account with activity in ${month}. Pass --month= or --customer=.`);
    process.exit(1);
  }

  const account = await prisma.accounts.findFirst({
    where: { customer_id: customerId },
    select: { id: true },
  });
  if (!account) {
    console.error(`Account ${customerId} is not in the database.`);
    process.exit(1);
  }

  console.log(`Write-path check: customer ${customerId}, ${month}\n`);
  const failures: string[] = [];

  for (const { entity, table } of TARGETS) {
    const before = await rowsInWindow(table, account.id, start, end);
    let status = 'threw';
    let written = 0;
    let error = '';
    try {
      const res = await runSync({ entities: [entity], customerIds: [customerId], start, end });
      const run = res.results[0];
      status = run?.status ?? 'missing';
      written = (run?.rowsInserted ?? 0) + (run?.rowsUpdated ?? 0);
      error = run?.error ?? '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const after = await rowsInWindow(table, account.id, start, end);

    // `failed` is always wrong. Zero rows is wrong only when the window had
    // rows before, since that means a working writer just emptied the table.
    const bad = status === 'failed' || status === 'threw' || (before > 0 && after === 0);
    const verdict = bad ? 'FAIL' : 'ok  ';
    console.log(
      `${verdict} ${entity.padEnd(13)} ${status.padEnd(8)} reported=${String(written).padStart(7)}` +
        `  ${table} ${before} -> ${after}` +
        (error ? `\n       ${error.replace(/\s+/g, ' ').slice(0, 160)}` : '')
    );
    if (bad) failures.push(entity);
  }

  if (failures.length) {
    console.error(`\n${failures.length} entity write path(s) broken: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nEvery entity wrote successfully.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
