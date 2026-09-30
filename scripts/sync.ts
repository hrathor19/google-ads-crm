/**
 * Manual sync runner.
 *
 *   npm run sync -- --entities=campaigns,keywords --customers=8104811686 --days=7
 *
 * Backfill a historical window instead of the rolling one:
 *
 *   npm run sync -- --start=2026-04-01 --end=2026-04-30
 *
 * Same code path the "Refresh" button in the UI calls, so a scheduled cron and
 * an operator at a terminal produce identical rows. A run with an explicit
 * range is recorded as a backfill rather than a manual refresh.
 */
import { runSync, SYNC_ENTITIES, type SyncEntity } from '@/lib/google-ads/sync';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

async function main() {
  const entitiesArg = arg('entities');
  const customersArg = arg('customers');
  const daysArg = arg('days');
  const startArg = arg('start');
  const endArg = arg('end');

  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if ((startArg && !endArg) || (endArg && !startArg)) {
    console.error('Backfill needs both --start and --end (YYYY-MM-DD).');
    process.exit(1);
  }
  if (startArg && endArg) {
    if (!DAY.test(startArg) || !DAY.test(endArg)) {
      console.error('--start and --end must be YYYY-MM-DD.');
      process.exit(1);
    }
    if (startArg > endArg) {
      console.error('--start must not be after --end.');
      process.exit(1);
    }
  }

  const entities = entitiesArg
    ? (entitiesArg.split(',').map((s) => s.trim()) as SyncEntity[])
    : SYNC_ENTITIES;

  const unknown = entities.filter((e) => !SYNC_ENTITIES.includes(e));
  if (unknown.length) {
    console.error(`Unknown entities: ${unknown.join(', ')}`);
    console.error(`Valid: ${SYNC_ENTITIES.join(', ')}`);
    process.exit(1);
  }

  const result = await runSync({
    entities,
    customerIds: customersArg ? customersArg.split(',').map((s) => s.trim()) : undefined,
    lookbackDays: daysArg ? Number(daysArg) : undefined,
    start: startArg ? new Date(`${startArg}T00:00:00.000Z`) : undefined,
    end: endArg ? new Date(`${endArg}T00:00:00.000Z`) : undefined,
  });

  console.log(JSON.stringify(result, null, 2));
  const failures = result.results.filter((r) => r.status === 'failed');
  if (failures.length) {
    console.error(`\n${failures.length} entity run(s) failed.`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$disconnect();
  });
