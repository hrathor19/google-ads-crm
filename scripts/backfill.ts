/**
 * Historical backfill, month by month.
 *
 *   npm run backfill -- --from=2025-11 --to=2026-09
 *   npm run backfill -- --from=2026-01 --to=2026-03 --entities=campaigns
 *
 * Why month-sized chunks rather than one wide range:
 *
 *  - Each Google Ads query stays bounded, so a wide account can't time out or
 *    blow the response budget.
 *  - `replaceWindow` clears and rewrites exactly the window it was given, so a
 *    month is the unit of idempotency: re-running repairs that month and
 *    touches nothing else.
 *  - An interrupted run leaves whole completed months behind, so resuming is
 *    just running it again — the finished months cost one no-op query each.
 *
 * Progress is printed per month so a long run is legible while it happens.
 */
import { runSync, SYNC_ENTITIES, type SyncEntity } from '@/lib/google-ads/sync';
import { monthRange, monthsBetween } from '@/lib/ops/month-chunks';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

const MONTH = /^\d{4}-\d{2}$/;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const hhmmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`;
};

async function main() {
  const from = arg('from');
  const to = arg('to');
  if (!from || !to || !MONTH.test(from) || !MONTH.test(to)) {
    console.error('Usage: npm run backfill -- --from=YYYY-MM --to=YYYY-MM [--entities=a,b]');
    process.exit(1);
  }
  if (from > to) {
    console.error('--from must not be after --to.');
    process.exit(1);
  }

  const entitiesArg = arg('entities');
  const entities = entitiesArg
    ? (entitiesArg.split(',').map((s) => s.trim()) as SyncEntity[])
    : SYNC_ENTITIES.filter((e) => e !== 'accounts');

  const unknown = entities.filter((e) => !SYNC_ENTITIES.includes(e));
  if (unknown.length) {
    console.error(`Unknown entities: ${unknown.join(', ')}`);
    process.exit(1);
  }

  const customersArg = arg('customers');
  const customerIds = customersArg ? customersArg.split(',').map((s) => s.trim()) : undefined;

  const months = monthsBetween(from, to);
  const t0 = Date.now();

  console.log(`\nBackfilling ${months.length} month(s): ${from} → ${to}`);
  console.log(`Entities: ${entities.join(', ')}\n`);

  let inserted = 0;
  let failed = 0;

  // Indexed loop rather than .entries(): the project's tsconfig targets a
  // level where iterating an iterator needs downlevelIteration.
  for (let i = 0; i < months.length; i++) {
    const month = months[i]!;
    const { start, end } = monthRange(month);
    const mt0 = Date.now();
    process.stdout.write(
      `[${String(i + 1).padStart(2)}/${months.length}] ${month} (${iso(start)}..${iso(end)}) … `
    );

    try {
      const res = await runSync({ entities, customerIds, start, end });
      const monthFailed = res.results.filter((r) => r.status === 'failed').length;
      inserted += res.totals.inserted;
      failed += monthFailed;
      console.log(
        `${String(res.totals.inserted).padStart(7)} rows, ${res.accountsProcessed} accounts, ` +
          `${monthFailed} failed  [${hhmmss(Date.now() - mt0)}]`
      );
    } catch (e) {
      // One bad month must not abandon the rest — the others are still worth having.
      failed += 1;
      console.log(`ERROR: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  console.log(
    `\nDone in ${hhmmss(Date.now() - t0)} — ${inserted.toLocaleString()} rows written, ` +
      `${failed} entity run(s) failed.`
  );
  if (failed > 0) {
    console.log('Re-run the same command to repair: each month is replaced, not appended.');
  }
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
