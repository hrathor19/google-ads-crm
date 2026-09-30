/**
 * Manual sync runner.
 *
 *   npm run sync -- --entities=campaigns,keywords --customers=8104811686 --days=7
 *
 * Same code path the "Refresh" button in the UI calls, so a scheduled cron and
 * an operator at a terminal produce identical rows.
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
