import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import * as reports from './reports';
import { uniformColumns } from './row-shape';
import { defaultDateRange } from './reports';

/**
 * The sync engine. A port of `app/services/sync_service.py`.
 *
 * Two contracts from the source are reproduced exactly, because the read side
 * depends on both:
 *
 *  1. **One `sync_logs` row per (entity, account, run)**, moving
 *     `running -> success | partial | failed`. A failure in one entity does not
 *     roll back the others, so a single inaccessible account cannot lose a
 *     whole night's sync.
 *  2. **`replaceWindow`**: delete the account's rows in `[start, end]` for the
 *     table, then insert the freshly fetched ones. Snapshots are append-only,
 *     but a re-run over an overlapping range would otherwise stack duplicate
 *     (entity, day) rows and inflate every summed metric. Clearing first makes
 *     each sync deterministic — exactly one row per (entity, day).
 */

export type SyncRunType = 'manual' | 'daily' | 'hourly' | 'backfill';

export type SyncEntity =
  | 'accounts'
  | 'campaigns'
  | 'ad_groups'
  | 'ads'
  | 'keywords'
  | 'search_terms'
  | 'budgets';

export const SYNC_ENTITIES: SyncEntity[] = [
  'accounts',
  'campaigns',
  'ad_groups',
  'ads',
  'keywords',
  'search_terms',
  'budgets',
];

export type EntityResult = {
  entity: SyncEntity;
  customerId: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  rowsInserted: number;
  rowsUpdated: number;
  rowsFailed: number;
  error: string | null;
  durationMs: number;
};

export type SyncResult = {
  startedAt: string;
  finishedAt: string;
  syncType: SyncRunType;
  window: { start: string; end: string };
  accountsProcessed: number;
  results: EntityResult[];
  totals: { inserted: number; updated: number; failed: number };
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Open a `sync_logs` row in the `running` state and return its id.
 *
 * The table keys runs by the Google `customer_id` string, not by the internal
 * account pk, and carries the date window in the free-form `details` column —
 * matching what the Python engine writes, so both produce rows the same
 * dashboards can read.
 */
async function openSyncLog(
  syncType: SyncRunType,
  entity: string,
  customerId: string | null,
  start: Date,
  end: Date
): Promise<number> {
  const row = await prisma.sync_logs.create({
    data: {
      sync_type: syncType,
      entity,
      customer_id: customerId,
      status: 'running',
      started_at: new Date(),
      rows_inserted: 0,
      rows_updated: 0,
      rows_failed: 0,
      attempt: 1,
      details: { date_range_start: isoDay(start), date_range_end: isoDay(end), source: 'google-ads-crm' },
    },
    select: { id: true },
  });
  return row.id;
}

async function closeSyncLog(
  id: number,
  status: EntityResult['status'],
  counts: { inserted: number; updated: number; failed: number },
  error: string | null,
  startedMs: number
): Promise<void> {
  await prisma.sync_logs.update({
    where: { id },
    data: {
      status,
      finished_at: new Date(),
      duration_ms: Date.now() - startedMs,
      rows_inserted: counts.inserted,
      rows_updated: counts.updated,
      rows_failed: counts.failed,
      // Truncated rather than allowed to fail the close: losing the record of
      // a run is worse than losing the tail of a stack trace.
      error_message: error ? error.slice(0, 2000) : null,
    },
  });
}

/**
 * Delete this account's snapshot rows in `[start, end]` then insert the new
 * ones, inside one transaction so a failed insert rolls back the delete and
 * the old rows survive.
 */
/**
 * How long one window replacement may take. Generous on purpose: exceeding it
 * loses the whole account-month, and the work is a bulk insert that is either
 * fast or blocked on something worth waiting for.
 */
const REPLACE_WINDOW_TIMEOUT_MS = 180_000;

async function replaceWindow(
  table: string,
  accountId: number,
  start: Date,
  end: Date,
  rows: Array<Record<string, unknown>>
): Promise<number> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM ${Prisma.raw(`"${table}"`)}
      WHERE account_id = ${accountId}
        AND snapshot_date >= ${isoDay(start)}::date
        AND snapshot_date <= ${isoDay(end)}::date
    `;
    if (rows.length === 0) return;

    // Chunked so a wide account's 30-day keyword window doesn't build a single
    // multi-megabyte statement.
    const CHUNK = 1000;
    const columns = uniformColumns(rows, table);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values = slice.map(
        (r) => Prisma.sql`(${Prisma.join(columns.map((c) => r[c] as never))})`
      );
      await tx.$executeRaw`
        INSERT INTO ${Prisma.raw(`"${table}"`)}
          (${Prisma.raw(columns.map((c) => `"${c}"`).join(', '))})
        VALUES ${Prisma.join(values)}
      `;
    }
  },
  {
    // Prisma's default interactive-transaction timeout is 5s, which is fine
    // for a campaign window and nowhere near enough for a dense one: a single
    // account-month of search terms is ~14,000 rows and blew the limit at
    // 5,160ms. The whole window has to land in one transaction — the DELETE
    // and the INSERTs are the two halves of one replace — so the timeout has
    // to accommodate the widest account rather than the typical one.
    timeout: REPLACE_WINDOW_TIMEOUT_MS,
    maxWait: 15_000,
  });
  return rows.length;
}

/**
 * Which accounts a sync covers.
 *
 * `is_syncable` is maintained by the source project as `status == "ENABLED"`,
 * and it writes to this same database, so the column cannot be repurposed —
 * it would be overwritten on that app's next account sync, and changing it
 * would alter that app's behaviour. The decision is made here instead, and
 * the column is left alone.
 *
 * Manager accounts are always excluded: the Google Ads API refuses metrics on
 * an MCC outright ("Metrics cannot be requested for a manager account").
 */
function accountScopeFilter() {
  if (!env.sync().includeSuspended) return { is_manager: false, is_syncable: true };

  // Widening to every non-manager account sweeps in ones the API refuses
  // outright — "The customer account can't be accessed", for accounts closed
  // or unlinked from the MCC. In this MCC that is 29 of the 48, and each one
  // is a failed sync_log per entity per run: ~174 failures a day once the
  // cron is installed, which would bury any real problem on the Integrations
  // Health page.
  //
  // Account status does not predict it — 6 CANCELED accounts are reachable
  // and 1 SUSPENDED is not — so the test is whether the account has ever
  // yielded a snapshot. That needs no extra table to track, and it
  // self-corrects: an account whose access is restored starts producing rows
  // again the first time it is synced explicitly with --customers.
  return {
    is_manager: false,
    OR: [{ is_syncable: true }, { campaign_snapshots: { some: {} } }],
  };
}

/**
 * Map a fetched dict onto the shared snapshot columns.
 *
 * The return type is inferred rather than widened to
 * `Record<string, unknown>`, and the date arrives already narrowed to `Date`.
 * Both matter: a precise type here is what lets each caller's snapshot literal
 * end in `satisfies Prisma.<table>UncheckedCreateInput`, which is the only
 * thing standing between a mistyped column and a raw INSERT that fails at
 * runtime against every account. `search_term_snapshots` was being handed a
 * `match_type` it has no column for, and nothing caught it until the query ran.
 */
function snapshotBase(accountId: number, syncLogId: number, snapshotDate: Date) {
  return {
    snapshot_date: snapshotDate,
    sync_time: new Date(),
    account_id: accountId,
    sync_log_id: syncLogId,
  };
}

function metricColumns(m: reports.Metrics) {
  return {
    impressions: m.impressions,
    clicks: m.clicks,
    interactions: m.interactions,
    cost_micros: m.cost_micros,
    ctr: m.ctr,
    average_cpc_micros: m.average_cpc_micros,
    average_cpm_micros: m.average_cpm_micros,
    conversions: m.conversions,
    conversions_value: m.conversions_value,
    all_conversions: m.all_conversions,
    video_views: m.video_views,
  };
}

// ─── Account discovery ───────────────────────────────────────────────────────

/** Upsert the MCC and its children, and return the syncable client accounts. */
export async function syncAccounts(syncType: SyncRunType = 'manual'): Promise<{
  result: EntityResult;
  accounts: Array<{ id: number; customerId: string; name: string | null }>;
}> {
  const t0 = Date.now();
  const cfg = env.googleAds();
  const { start, end } = defaultDateRange(1);
  const logId = await openSyncLog(syncType, 'accounts', cfg.loginCustomerId, start, end);

  try {
    const fetched = await reports.fetchAccounts(cfg.loginCustomerId);
    let inserted = 0;
    let updated = 0;

    for (const a of fetched) {
      const existing = await prisma.accounts.findUnique({
        where: { customer_id: a.customer_id },
        select: { id: true },
      });
      const data = {
        descriptive_name: a.descriptive_name,
        currency_code: a.currency_code,
        time_zone: a.time_zone,
        status: a.status,
        is_manager: a.is_manager,
        manager_customer_id: a.manager_customer_id,
        test_account: a.test_account,
      } satisfies Prisma.accountsUncheckedUpdateInput;
      if (existing) {
        await prisma.accounts.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.accounts.create({
          data: { customer_id: a.customer_id, is_syncable: true, ...data },
        });
        inserted += 1;
      }
    }

    await closeSyncLog(logId, 'success', { inserted, updated, failed: 0 }, null, t0);

    const accounts = await prisma.accounts.findMany({
      where: accountScopeFilter(),
      select: { id: true, customer_id: true, descriptive_name: true },
      orderBy: { customer_id: 'asc' },
    });

    return {
      result: {
        entity: 'accounts',
        customerId: cfg.loginCustomerId,
        status: 'success',
        rowsInserted: inserted,
        rowsUpdated: updated,
        rowsFailed: 0,
        error: null,
        durationMs: Date.now() - t0,
      },
      accounts: accounts.map((a) => ({
        id: a.id,
        customerId: a.customer_id,
        name: a.descriptive_name,
      })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await closeSyncLog(logId, 'failed', { inserted: 0, updated: 0, failed: 0 }, message, t0);
    return {
      result: {
        entity: 'accounts',
        customerId: cfg.loginCustomerId,
        status: 'failed',
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsFailed: 0,
        error: message,
        durationMs: Date.now() - t0,
      },
      accounts: [],
    };
  }
}

// ─── Dimension upserts ───────────────────────────────────────────────────────

/** `{googleId -> pk}` for an account's campaigns, ad groups or keywords. */
async function idMap(
  model: 'campaigns' | 'ad_groups' | 'keywords' | 'budgets' | 'ads',
  accountId: number,
  naturalKey: string
): Promise<Map<number, number>> {
  const rows = await prisma.$queryRaw<Array<{ id: number; key: bigint }>>`
    SELECT id, ${Prisma.raw(`"${naturalKey}"`)} AS key
    FROM ${Prisma.raw(`"${model}"`)}
    WHERE account_id = ${accountId}
  `;
  return new Map(rows.map((r) => [Number(r.key), r.id]));
}

type EntitySyncContext = {
  accountId: number;
  customerId: string;
  start: Date;
  end: Date;
  syncType: SyncRunType;
};

async function runEntity(
  entity: SyncEntity,
  ctx: EntitySyncContext,
  fn: (logId: number) => Promise<{ inserted: number; updated: number; failed: number }>
): Promise<EntityResult> {
  const t0 = Date.now();
  const logId = await openSyncLog(ctx.syncType, entity, ctx.customerId, ctx.start, ctx.end);
  try {
    const counts = await fn(logId);
    const status = counts.failed > 0 ? 'partial' : 'success';
    await closeSyncLog(logId, status, counts, null, t0);
    return {
      entity,
      customerId: ctx.customerId,
      status,
      rowsInserted: counts.inserted,
      rowsUpdated: counts.updated,
      rowsFailed: counts.failed,
      error: null,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await closeSyncLog(logId, 'failed', { inserted: 0, updated: 0, failed: 0 }, message, t0);
    return {
      entity,
      customerId: ctx.customerId,
      status: 'failed',
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsFailed: 0,
      error: message,
      durationMs: Date.now() - t0,
    };
  }
}

async function syncCampaignsFor(ctx: EntitySyncContext): Promise<EntityResult> {
  return runEntity('campaigns', ctx, async (logId) => {
    const configs = await reports.fetchCampaigns(ctx.customerId);
    let inserted = 0;
    let updated = 0;

    for (const c of configs) {
      const res = await prisma.campaigns.upsert({
        where: {
          account_id_campaign_id: {
            account_id: ctx.accountId,
            campaign_id: c.campaign_id,
          },
        },
        create: {
          account_id: ctx.accountId,
          campaign_id: c.campaign_id,
          name: c.name,
          status: c.status,
          serving_status: c.serving_status,
          advertising_channel_type: c.advertising_channel_type,
          advertising_channel_sub_type: c.advertising_channel_sub_type,
          bidding_strategy_type: c.bidding_strategy_type,
          networks: c.networks,
          optimization_score: c.optimization_score,
          budget_id: c.budget_id,
        },
        update: {
          name: c.name,
          status: c.status,
          serving_status: c.serving_status,
          advertising_channel_type: c.advertising_channel_type,
          advertising_channel_sub_type: c.advertising_channel_sub_type,
          bidding_strategy_type: c.bidding_strategy_type,
          networks: c.networks,
          optimization_score: c.optimization_score,
          budget_id: c.budget_id,
        },
        select: { id: true, created_at: true, updated_at: true },
      });
      if (res.created_at.getTime() === res.updated_at.getTime()) inserted += 1;
      else updated += 1;
    }

    const pkByGoogleId = await idMap('campaigns', ctx.accountId, 'campaign_id');

    const [metrics, deviceMetrics, geoMetrics] = await Promise.all([
      reports.fetchCampaignMetrics(ctx.customerId, ctx.start, ctx.end),
      reports.fetchCampaignDeviceMetrics(ctx.customerId, ctx.start, ctx.end),
      reports.fetchCampaignGeoMetrics(ctx.customerId, ctx.start, ctx.end),
    ]);

    let failed = 0;
    const resolve = (googleId: number): number | null => {
      const pk = pkByGoogleId.get(googleId);
      if (pk === undefined) failed += 1;
      return pk ?? null;
    };

    const snapRows = metrics
      .map((m) => {
        const pk = resolve(m.campaign_id);
        if (pk === null || !m.snapshot_date) return null;
        return {
          campaign_id: pk,
          ...snapshotBase(ctx.accountId, logId, m.snapshot_date),
          status: m.status,
          budget_micros: m.budget_micros,
          bidding_strategy_type: m.bidding_strategy_type,
          optimization_score: m.optimization_score,
          ...metricColumns(m),
        } satisfies Prisma.campaign_snapshotsUncheckedCreateInput;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const deviceRows = deviceMetrics
      .map((m) => {
        const pk = pkByGoogleId.get(m.campaign_id);
        if (pk === undefined || !m.snapshot_date) return null;
        return {
          campaign_id: pk,
          ...snapshotBase(ctx.accountId, logId, m.snapshot_date),
          device: m.device,
          ...metricColumns(m),
        } satisfies Prisma.campaign_device_snapshotsUncheckedCreateInput;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const geoRows = geoMetrics
      .map((m) => {
        const pk = pkByGoogleId.get(m.campaign_id);
        if (pk === undefined || !m.snapshot_date) return null;
        return {
          campaign_id: pk,
          ...snapshotBase(ctx.accountId, logId, m.snapshot_date),
          country_criterion_id: m.country_criterion_id,
          location_name: m.location_name,
          ...metricColumns(m),
        } satisfies Prisma.campaign_geo_snapshotsUncheckedCreateInput;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const n =
      (await replaceWindow('campaign_snapshots', ctx.accountId, ctx.start, ctx.end, snapRows)) +
      (await replaceWindow('campaign_device_snapshots', ctx.accountId, ctx.start, ctx.end, deviceRows)) +
      (await replaceWindow('campaign_geo_snapshots', ctx.accountId, ctx.start, ctx.end, geoRows));

    return { inserted: inserted + n, updated, failed };
  });
}

async function syncAdGroupsFor(ctx: EntitySyncContext): Promise<EntityResult> {
  return runEntity('ad_groups', ctx, async (logId) => {
    const campaignPk = await idMap('campaigns', ctx.accountId, 'campaign_id');
    const configs = await reports.fetchAdGroups(ctx.customerId);
    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const g of configs) {
      const cpk = campaignPk.get(g.campaign_id);
      if (cpk === undefined) {
        failed += 1;
        continue;
      }
      const existing = await prisma.ad_groups.findFirst({
        where: { account_id: ctx.accountId, ad_group_id: g.ad_group_id },
        select: { id: true },
      });
      const data = {
        campaign_id: cpk,
        name: g.name,
        status: g.status,
        type: g.type,
        cpc_bid_micros: g.cpc_bid_micros,
      } satisfies Prisma.ad_groupsUncheckedUpdateInput;
      if (existing) {
        await prisma.ad_groups.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.ad_groups.create({
          data: { account_id: ctx.accountId, ad_group_id: g.ad_group_id, ...data },
        });
        inserted += 1;
      }
    }

    const adGroupPk = await idMap('ad_groups', ctx.accountId, 'ad_group_id');
    const metrics = await reports.fetchAdGroupMetrics(ctx.customerId, ctx.start, ctx.end);

    const rows = metrics
      .map((m) => {
        const gpk = adGroupPk.get(m.ad_group_id);
        const cpk = campaignPk.get(m.campaign_id);
        if (gpk === undefined || cpk === undefined || !m.snapshot_date) return null;
        return {
          ad_group_id: gpk,
          campaign_id: cpk,
          ...snapshotBase(ctx.accountId, logId, m.snapshot_date),
          status: m.status,
          cpc_bid_micros: m.cpc_bid_micros,
          ...metricColumns(m),
        } satisfies Prisma.ad_group_snapshotsUncheckedCreateInput;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const n = await replaceWindow('ad_group_snapshots', ctx.accountId, ctx.start, ctx.end, rows);
    return { inserted: inserted + n, updated, failed };
  });
}

async function syncAdsFor(ctx: EntitySyncContext): Promise<EntityResult> {
  return runEntity('ads', ctx, async (logId) => {
    const campaignPk = await idMap('campaigns', ctx.accountId, 'campaign_id');
    const adGroupPk = await idMap('ad_groups', ctx.accountId, 'ad_group_id');
    const configs = await reports.fetchAds(ctx.customerId);
    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const a of configs) {
      const gpk = adGroupPk.get(a.ad_group_id);
      if (gpk === undefined) {
        failed += 1;
        continue;
      }
      const existing = await prisma.ads.findFirst({
        where: { account_id: ctx.accountId, ad_id: a.ad_id },
        select: { id: true },
      });
      const data = {
        ad_group_id: gpk,
        type: a.type,
        status: a.status,
        approval_status: a.approval_status,
        final_urls: a.final_urls,
        headlines: a.headlines,
        descriptions: a.descriptions,
      } satisfies Prisma.adsUncheckedUpdateInput;
      if (existing) {
        await prisma.ads.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.ads.create({
          data: { account_id: ctx.accountId, ad_id: a.ad_id, ...data },
        });
        inserted += 1;
      }
    }

    const adPk = await idMap('ads', ctx.accountId, 'ad_id');
    const metrics = await reports.fetchAdMetrics(ctx.customerId, ctx.start, ctx.end);

    const rows = metrics
      .map((m) => {
        const apk = adPk.get(m.ad_id);
        const gpk = adGroupPk.get(m.ad_group_id);
        const cpk = campaignPk.get(m.campaign_id);
        if (apk === undefined || gpk === undefined || cpk === undefined || !m.snapshot_date) {
          return null;
        }
        return {
          ad_id: apk,
          ad_group_id: gpk,
          campaign_id: cpk,
          ...snapshotBase(ctx.accountId, logId, m.snapshot_date),
          status: m.status,
          approval_status: m.approval_status,
          ...metricColumns(m),
        } satisfies Prisma.ad_snapshotsUncheckedCreateInput;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const n = await replaceWindow('ad_snapshots', ctx.accountId, ctx.start, ctx.end, rows);
    return { inserted: inserted + n, updated, failed };
  });
}

async function syncKeywordsFor(ctx: EntitySyncContext): Promise<EntityResult> {
  return runEntity('keywords', ctx, async (logId) => {
    const campaignPk = await idMap('campaigns', ctx.accountId, 'campaign_id');
    const adGroupPk = await idMap('ad_groups', ctx.accountId, 'ad_group_id');
    const configs = await reports.fetchKeywords(ctx.customerId);
    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const k of configs) {
      // Only the ad group has to resolve here. The source app's
      // _step_keywords_dim checks ad_group_pk alone, and `keywords` stores no
      // campaign_id — also requiring the campaign dropped every keyword under
      // a REMOVED campaign, which the ad-group query returns but the campaign
      // query filters out. That silently lost 877 keywords on one account.
      const gpk = adGroupPk.get(k.ad_group_id);
      if (gpk === undefined) {
        failed += 1;
        continue;
      }
      const existing = await prisma.keywords.findFirst({
        where: { account_id: ctx.accountId, criterion_id: k.criterion_id, ad_group_id: gpk },
        select: { id: true },
      });
      // `keywords` has no campaign_id column: a keyword reaches its campaign
      // through ad_groups. Only keyword_snapshots stores campaign_id directly,
      // which is why `cpk` is still resolved above — the snapshot rows need it.
      // `satisfies` is load-bearing: TypeScript only excess-property-checks an
      // object literal passed inline. Assign it to a variable first and an
      // invented column slips through to the database driver — which is how a
      // `campaign_id` that this table does not have reached Prisma and broke
      // every keywords update.
      const config = {
        text: k.text,
        match_type: k.match_type,
        status: k.status,
        cpc_bid_micros: k.cpc_bid_micros,
      } satisfies Prisma.keywordsUncheckedUpdateInput;
      if (existing) {
        // ad_group_id is part of the lookup above, so it cannot have changed;
        // leaving it out keeps `data` to plain scalars.
        await prisma.keywords.update({ where: { id: existing.id }, data: config });
        updated += 1;
      } else {
        await prisma.keywords.create({
          data: {
            account_id: ctx.accountId,
            ad_group_id: gpk,
            criterion_id: k.criterion_id,
            ...config,
          },
        });
        inserted += 1;
      }
    }

    const keywordRows = await prisma.keywords.findMany({
      where: { account_id: ctx.accountId },
      select: { id: true, criterion_id: true, ad_group_id: true },
    });
    const keywordPk = new Map(
      keywordRows.map((k) => [`${k.criterion_id}:${k.ad_group_id}`, k.id])
    );

    const metrics = await reports.fetchKeywordMetrics(ctx.customerId, ctx.start, ctx.end);
    const rows = metrics
      .map((m) => {
        const gpk = adGroupPk.get(m.ad_group_id);
        const cpk = campaignPk.get(m.campaign_id);
        if (gpk === undefined || cpk === undefined || !m.snapshot_date) return null;
        const kpk = keywordPk.get(`${m.criterion_id}:${gpk}`);
        if (kpk === undefined) return null;
        return {
          keyword_id: kpk,
          ad_group_id: gpk,
          campaign_id: cpk,
          ...snapshotBase(ctx.accountId, logId, m.snapshot_date),
          match_type: m.match_type,
          status: m.status,
          quality_score: m.quality_score,
          expected_ctr: m.expected_ctr,
          ad_relevance: m.ad_relevance,
          landing_page_experience: m.landing_page_experience,
          ...metricColumns(m),
        } satisfies Prisma.keyword_snapshotsUncheckedCreateInput;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const n = await replaceWindow('keyword_snapshots', ctx.accountId, ctx.start, ctx.end, rows);
    return { inserted: inserted + n, updated, failed };
  });
}

async function syncSearchTermsFor(ctx: EntitySyncContext): Promise<EntityResult> {
  return runEntity('search_terms', ctx, async (logId) => {
    const campaignPk = await idMap('campaigns', ctx.accountId, 'campaign_id');
    const adGroupPk = await idMap('ad_groups', ctx.accountId, 'ad_group_id');
    const fetched = await reports.fetchSearchTerms(ctx.customerId, ctx.start, ctx.end);

    let inserted = 0;
    let failed = 0;

    // A search term is identified by (ad_group_id, query, match_type) — the
    // table's unique constraint, and the source app's `unique_by`. The same
    // query really can arrive under two match types in one ad group, and they
    // are different rows. Keying on (query, ad group) alone collapsed them,
    // then tried to *update* match_type into whichever arrived first, which
    // collided with the row that already held it:
    //   Unique constraint failed on (`ad_group_id`,`query`,`match_type`)
    const termKey = (adGroupId: number, query: string, matchType: string | null) =>
      `${adGroupId}\u0000${query}\u0000${matchType ?? ''}`;

    const seen = new Map<
      string,
      { query: string; adGroupId: number; campaignId: number; status: string | null; matchType: string | null }
    >();
    for (const t of fetched) {
      const gpk = adGroupPk.get(t.ad_group_id);
      const cpk = campaignPk.get(t.campaign_id);
      if (gpk === undefined || cpk === undefined) {
        failed += 1;
        continue;
      }
      const key = termKey(gpk, t.query, t.match_type);
      if (!seen.has(key)) {
        seen.set(key, {
          query: t.query,
          adGroupId: gpk,
          campaignId: cpk,
          status: t.search_term_targeting_status,
          matchType: t.match_type,
        });
      }
    }

    for (const t of Array.from(seen.values())) {
      const existing = await prisma.search_terms.findFirst({
        where: { ad_group_id: t.adGroupId, query: t.query, match_type: t.matchType },
        select: { id: true },
      });
      // match_type is part of the identity, so it is never updated — only the
      // values the source app carries in `values`.
      const data = {
        account_id: ctx.accountId,
        campaign_id: t.campaignId,
        search_term_targeting_status: t.status,
      } satisfies Prisma.search_termsUncheckedUpdateInput;
      if (existing) {
        await prisma.search_terms.update({ where: { id: existing.id }, data });
      } else {
        await prisma.search_terms.create({
          data: {
            query: t.query,
            ad_group_id: t.adGroupId,
            match_type: t.matchType,
            ...data,
          },
        });
        inserted += 1;
      }
    }

    const termRows = await prisma.search_terms.findMany({
      where: { account_id: ctx.accountId },
      select: { id: true, query: true, ad_group_id: true, match_type: true },
    });
    const termPk = new Map(
      termRows.map((t) => [termKey(t.ad_group_id, t.query, t.match_type), t.id])
    );

    const rows = fetched
      .map((m) => {
        const gpk = adGroupPk.get(m.ad_group_id);
        const cpk = campaignPk.get(m.campaign_id);
        if (gpk === undefined || cpk === undefined || !m.snapshot_date) return null;
        const tpk = termPk.get(termKey(gpk, m.query, m.match_type));
        if (tpk === undefined) return null;
        return {
          search_term_id: tpk,
          ad_group_id: gpk,
          campaign_id: cpk,
          ...snapshotBase(ctx.accountId, logId, m.snapshot_date),
          // No match_type here: search_term_snapshots has no such column. The
          // match type is a property of the term itself and is written on the
          // search_terms dimension row above, which is where the source app
          // puts it too.
          ...metricColumns(m),
        } satisfies Prisma.search_term_snapshotsUncheckedCreateInput;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const n = await replaceWindow('search_term_snapshots', ctx.accountId, ctx.start, ctx.end, rows);
    return { inserted: inserted + n, updated: 0, failed };
  });
}

async function syncBudgetsFor(ctx: EntitySyncContext): Promise<EntityResult> {
  return runEntity('budgets', ctx, async (logId) => {
    const configs = await reports.fetchBudgets(ctx.customerId);
    let inserted = 0;
    let updated = 0;

    for (const b of configs) {
      const existing = await prisma.budgets.findFirst({
        where: { account_id: ctx.accountId, budget_id: b.budget_id },
        select: { id: true },
      });
      const data = {
        name: b.name,
        amount_micros: b.amount_micros,
        delivery_method: b.delivery_method,
        period: b.period,
        explicitly_shared: b.explicitly_shared,
      } satisfies Prisma.budgetsUncheckedUpdateInput;
      if (existing) {
        await prisma.budgets.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.budgets.create({
          data: { account_id: ctx.accountId, budget_id: b.budget_id, ...data },
        });
        inserted += 1;
      }
    }

    const budgetPk = await idMap('budgets', ctx.accountId, 'budget_id');
    const metrics = await reports.fetchBudgetMetrics(ctx.customerId, ctx.start, ctx.end);

    const rows = metrics
      .map((m) => {
        const bpk = budgetPk.get(m.budget_id);
        if (bpk === undefined || !m.snapshot_date) return null;
        return {
          budget_id: bpk,
          ...snapshotBase(ctx.accountId, logId, m.snapshot_date),
          amount_micros: m.amount_micros,
          spend_micros: m.spend_micros,
          utilization: m.utilization,
          delivery_method: m.delivery_method,
        } satisfies Prisma.budget_snapshotsUncheckedCreateInput;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const n = await replaceWindow('budget_snapshots', ctx.accountId, ctx.start, ctx.end, rows);
    return { inserted: inserted + n, updated, failed: 0 };
  });
}

const ENTITY_RUNNERS: Record<
  Exclude<SyncEntity, 'accounts'>,
  (ctx: EntitySyncContext) => Promise<EntityResult>
> = {
  campaigns: syncCampaignsFor,
  ad_groups: syncAdGroupsFor,
  ads: syncAdsFor,
  keywords: syncKeywordsFor,
  search_terms: syncSearchTermsFor,
  budgets: syncBudgetsFor,
};

/**
 * Run a sync.
 *
 * Entities run in dependency order per account (campaigns before ad groups
 * before ads/keywords/search terms) because each level resolves the previous
 * level's primary keys. Accounts are processed sequentially rather than in
 * parallel: the Google Ads API quota is per developer token, and a fan-out
 * across 121 accounts is the fastest way to exhaust it.
 */
export async function runSync(
  options: {
    entities?: SyncEntity[];
    customerIds?: string[];
    lookbackDays?: number;
    /** An explicit window. Supplying both marks the run as a backfill. */
    start?: Date;
    end?: Date;
  } = {}
): Promise<SyncResult> {
  const startedAt = new Date();
  const lookback = options.lookbackDays ?? env.sync().defaultLookbackDays;
  const isBackfill = Boolean(options.start && options.end);
  const range =
    options.start && options.end
      ? { start: options.start, end: options.end }
      : defaultDateRange(lookback);
  // The rolling refresh and a historical backfill are different operations to
  // whoever reads sync_logs later; the source project distinguished them and
  // so does this.
  const syncType: SyncRunType = isBackfill ? 'backfill' : 'manual';

  const entities = options.entities?.length ? options.entities : SYNC_ENTITIES;
  const results: EntityResult[] = [];

  let accounts: Array<{ id: number; customerId: string; name: string | null }> = [];

  if (entities.includes('accounts')) {
    const { result, accounts: discovered } = await syncAccounts(syncType);
    results.push(result);
    accounts = discovered;
  } else {
    const rows = await prisma.accounts.findMany({
      where: accountScopeFilter(),
      select: { id: true, customer_id: true, descriptive_name: true },
    });
    accounts = rows.map((a) => ({
      id: a.id,
      customerId: a.customer_id,
      name: a.descriptive_name,
    }));
  }

  if (options.customerIds?.length) {
    const wanted = new Set(options.customerIds.map((c) => c.replace(/-/g, '').trim()));
    accounts = accounts.filter((a) => wanted.has(a.customerId));
  }

  const perAccountEntities = entities.filter(
    (e): e is Exclude<SyncEntity, 'accounts'> => e !== 'accounts'
  );

  for (const account of accounts) {
    const ctx: EntitySyncContext = {
      accountId: account.id,
      customerId: account.customerId,
      start: range.start,
      end: range.end,
      syncType,
    };
    for (const entity of perAccountEntities) {
      results.push(await ENTITY_RUNNERS[entity](ctx));
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    syncType,
    window: { start: isoDay(range.start), end: isoDay(range.end) },
    accountsProcessed: accounts.length,
    results,
    totals: {
      inserted: results.reduce((s, r) => s + r.rowsInserted, 0),
      updated: results.reduce((s, r) => s + r.rowsUpdated, 0),
      failed: results.reduce((s, r) => s + r.rowsFailed, 0),
    },
  };
}
