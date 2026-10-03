import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { countryNameFromCriterion, isoNumericFromCriterion } from './country-codes';

/**
 * Aggregate queries over the synced Google Ads snapshots.
 *
 * A port of `app/repositories/ops.py` and `app/repositories/dashboard.py`.
 * Three rules from the source are what make the numbers match, and all three
 * are load-bearing:
 *
 *  1. **Money is stored in micros.** Every read divides by 1,000,000 and rounds
 *     to 2 dp — never the other way round, and never per-row before summing.
 *  2. **Derived metrics are computed after summing**, never averaged from
 *     per-row values: `ctr = SUM(clicks)/SUM(impressions)`, not `AVG(ctr)`.
 *  3. **CTR and CPC are null, not zero, when the denominator is zero** — a
 *     campaign with no impressions has no CTR, and rendering 0% would read as a
 *     measured failure rather than an absence.
 *
 * Everything is set-based and grouped; nothing issues a query per row.
 */

const MICROS = 1_000_000;
const ACTIVE = 'ENABLED';

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Postgres SUM() returns numeric/bigint; normalise whatever the driver gives us. */
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Prisma.Decimal) return v.toNumber();
  const n = Number(v as string);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return toNum(v);
}

export function microsToCurrency(micros: unknown): number {
  return round2(toNum(micros) / MICROS);
}

/** `ctr = clicks / impressions`, null when there were no impressions. */
export function deriveCtr(clicks: number, impressions: number): number | null {
  return impressions ? clicks / impressions : null;
}

/** `avg_cpc = cost / clicks`, null when there were no clicks. */
export function deriveAvgCpc(cost: number, clicks: number): number | null {
  return clicks ? cost / clicks : null;
}

/** `cost_per_conversion = cost / conversions`, null when there were none. */
export function deriveCostPerConversion(cost: number, conversions: number): number | null {
  return conversions ? cost / conversions : null;
}

export function deriveConversionRate(conversions: number, clicks: number): number | null {
  return clicks ? conversions / clicks : null;
}

/** An account-id filter fragment, or TRUE when the caller is unrestricted. */
function accountFilter(column: string, accountIds: number[] | null | undefined): Prisma.Sql {
  if (accountIds === null || accountIds === undefined) return Prisma.sql`TRUE`;
  if (accountIds.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(accountIds)})`;
}

/**
 * A campaign-pk filter fragment.
 *
 * An empty list means "no campaigns", not "all of them" — the same discipline
 * as `accountFilter`. A request whose links were all removed must report
 * nothing, not the whole account.
 */
function campaignFilter(column: string, pks: number[] | null | undefined): Prisma.Sql | null {
  if (pks === null || pks === undefined) return null;
  if (pks.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(pks)})`;
}

/**
 * A `DATE` bound parameter.
 *
 * `snapshot_date` is a bare Postgres DATE. Binding a JS `Date` sends a
 * timestamptz, which Postgres then converts through the session time zone —
 * in a non-UTC session that silently shifts the window by a day and drops a
 * boundary row. Sending `YYYY-MM-DD` with an explicit `::date` cast removes
 * the time zone from the comparison entirely.
 */
function day(d: Date): Prisma.Sql {
  return Prisma.sql`${d.toISOString().slice(0, 10)}::date`;
}

export type Scope = {
  /** `null` = every account the principal may see; otherwise this exact list. */
  accountIds: number[] | null;
};

export type Totals = {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
  conversionRate: number | null;
};

function buildTotals(row: {
  impressions: unknown;
  clicks: unknown;
  cost_micros: unknown;
  conversions: unknown;
  conversions_value?: unknown;
}): Totals {
  const impressions = toNum(row.impressions);
  const clicks = toNum(row.clicks);
  const cost = microsToCurrency(row.cost_micros);
  const conversions = toNum(row.conversions);
  return {
    impressions,
    clicks,
    cost,
    conversions,
    conversionsValue: toNum(row.conversions_value),
    ctr: deriveCtr(clicks, impressions),
    avgCpc: deriveAvgCpc(cost, clicks),
    costPerConversion: deriveCostPerConversion(cost, conversions),
    conversionRate: deriveConversionRate(conversions, clicks),
  };
}

// ─── Window totals ───────────────────────────────────────────────────────────

/**
 * Account totals over `[start, end]`.
 *
 * The source's `account_day_totals` covered a single day; the dashboard needs a
 * range, and summing a range of the same grouped rows is the same arithmetic —
 * passing `start === end` reproduces the original method exactly.
 */
export async function windowTotals(
  start: Date,
  end: Date,
  scope: Scope
): Promise<Totals> {
  const rows = await prisma.$queryRaw<
    Array<{
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      conversions_value: Prisma.Decimal;
    }>
  >`
    SELECT
      COALESCE(SUM(impressions), 0)       AS impressions,
      COALESCE(SUM(clicks), 0)            AS clicks,
      COALESCE(SUM(cost_micros), 0)       AS cost_micros,
      COALESCE(SUM(conversions), 0)       AS conversions,
      COALESCE(SUM(conversions_value), 0) AS conversions_value
    FROM campaign_snapshots
    WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      AND ${accountFilter('account_id', scope.accountIds)}
  `;
  // An empty window yields no row at all; zeros are the correct reading.
  return buildTotals(
    rows[0] ?? {
      impressions: 0,
      clicks: 0,
      cost_micros: 0,
      conversions: 0,
      conversions_value: 0,
    }
  );
}

// ─── Entity counts ───────────────────────────────────────────────────────────

export type EntityCounts = {
  accounts: number;
  campaignsActive: number;
  adGroupsActive: number;
  keywordsActive: number;
};

/**
 * Counts for the overview tiles.
 *
 * `accounts` excludes managers — the MCC itself is not a client account and
 * counting it would inflate every "total accounts" figure by one.
 */
export async function entityCounts(scope: Scope): Promise<EntityCounts> {
  const [accounts, campaigns, adGroups, keywords] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM accounts
      WHERE is_manager = FALSE AND ${accountFilter('id', scope.accountIds)}
    `,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM campaigns
      WHERE status = ${ACTIVE} AND ${accountFilter('account_id', scope.accountIds)}
    `,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM ad_groups
      WHERE status = ${ACTIVE} AND ${accountFilter('account_id', scope.accountIds)}
    `,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM keywords
      WHERE status = ${ACTIVE} AND ${accountFilter('account_id', scope.accountIds)}
    `,
  ]);

  return {
    accounts: toNum(accounts[0]?.n),
    campaignsActive: toNum(campaigns[0]?.n),
    adGroupsActive: toNum(adGroups[0]?.n),
    keywordsActive: toNum(keywords[0]?.n),
  };
}

// ─── Overview signals ────────────────────────────────────────────────────────

export async function campaignsLimitedByBudgetCount(
  dayDate: Date,
  scope: Scope
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(id) AS n FROM campaign_snapshots
    WHERE snapshot_date = ${day(dayDate)}
      AND budget_micros IS NOT NULL
      AND budget_micros > 0
      AND cost_micros >= budget_micros
      AND ${accountFilter('account_id', scope.accountIds)}
  `;
  return toNum(rows[0]?.n);
}

export async function lowQualityKeywordCount(
  dayDate: Date,
  floor: number,
  scope: Scope
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT keyword_id) AS n FROM keyword_snapshots
    WHERE snapshot_date = ${day(dayDate)}
      AND quality_score IS NOT NULL
      AND quality_score < ${floor}
      AND ${accountFilter('account_id', scope.accountIds)}
  `;
  return toNum(rows[0]?.n);
}

export async function newSearchTermsCount(
  dayDate: Date, scope: Scope): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(id) AS n FROM search_terms
    WHERE created_at::date = ${day(dayDate)}
      AND ${accountFilter('account_id', scope.accountIds)}
  `;
  return toNum(rows[0]?.n);
}

/** Disapproved ad counts per campaign, from the current ad dimension state. */
export async function disapprovedAdsByCampaign(
  scope: Scope
): Promise<Map<number, number>> {
  const rows = await prisma.$queryRaw<Array<{ campaign_id: number; n: bigint }>>`
    SELECT ag.campaign_id AS campaign_id, COUNT(a.id) AS n
    FROM ads a
    JOIN ad_groups ag ON a.ad_group_id = ag.id
    WHERE a.approval_status = 'DISAPPROVED'
      AND a.status <> 'REMOVED'
      AND ${accountFilter('a.account_id', scope.accountIds)}
    GROUP BY ag.campaign_id
  `;
  return new Map(rows.map((r) => [Number(r.campaign_id), toNum(r.n)]));
}

export async function disapprovedAdsTotal(scope: Scope): Promise<number> {
  const byCampaign = await disapprovedAdsByCampaign(scope);
  let total = 0;
  byCampaign.forEach((n) => {
    total += n;
  });
  return total;
}

/** Active campaigns that recorded zero impressions on the reference day. */
export async function zeroImpressionCampaigns(
  dayDate: Date,
  scope: Scope,
  limit = 50
): Promise<Array<{ campaignPk: number; campaignId: string; name: string | null; accountId: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ id: number; campaign_id: bigint; name: string | null; account_id: number }>
  >`
    SELECT c.id, c.campaign_id, c.name, c.account_id
    FROM campaigns c
    JOIN campaign_snapshots s ON s.campaign_id = c.id AND s.snapshot_date = ${day(dayDate)}
    WHERE c.status = ${ACTIVE}
      AND ${accountFilter('c.account_id', scope.accountIds)}
    GROUP BY c.id, c.campaign_id, c.name, c.account_id
    HAVING COALESCE(SUM(s.impressions), 0) = 0
    ORDER BY c.name
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    campaignPk: r.id,
    campaignId: String(r.campaign_id),
    name: r.name,
    accountId: r.account_id,
  }));
}

// ─── Daily series ────────────────────────────────────────────────────────────

export type DailyPoint = {
  date: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
};

/** Per-day account totals with derived CTR/CPC over a window. */
export async function dailySeries(
  start: Date,
  end: Date,
  scope: Scope,
  opts: { campaignPks?: number[] | null } = {}
): Promise<DailyPoint[]> {
  const campaigns = campaignFilter('campaign_id', opts.campaignPks);
  const campaignSql = campaigns ? Prisma.sql`AND ${campaigns}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<{
      d: Date;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
    }>
  >`
    SELECT
      snapshot_date                 AS d,
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(clicks), 0)      AS clicks,
      COALESCE(SUM(cost_micros), 0) AS cost_micros,
      COALESCE(SUM(conversions), 0) AS conversions
    FROM campaign_snapshots
    WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      AND ${accountFilter('account_id', scope.accountIds)}
      ${campaignSql}
    GROUP BY snapshot_date
    ORDER BY snapshot_date
  `;

  return rows.map((r) => {
    const impressions = toNum(r.impressions);
    const clicks = toNum(r.clicks);
    const cost = microsToCurrency(r.cost_micros);
    return {
      date: r.d.toISOString().slice(0, 10),
      impressions,
      clicks,
      cost,
      conversions: toNum(r.conversions),
      ctr: deriveCtr(clicks, impressions),
      avgCpc: deriveAvgCpc(cost, clicks),
    };
  });
}

// ─── Account rollup ──────────────────────────────────────────────────────────

export type AccountRow = {
  id: number;
  customerId: string;
  name: string | null;
  currency: string | null;
  timeZone: string | null;
  status: string | null;
  isManager: boolean;
  campaigns: number;
} & Totals;

/**
 * Per-account totals over a window — the Accounts table.
 *
 * LEFT JOIN so an account with no snapshots in the window still appears, at
 * zero, instead of vanishing: an account that stopped spending is exactly what
 * someone opening this page is looking for.
 */
export async function accountRollup(
  start: Date,
  end: Date,
  scope: Scope,
  opts: { includeManagers?: boolean } = {}
): Promise<AccountRow[]> {
  const managerFilter = opts.includeManagers
    ? Prisma.sql`TRUE`
    : Prisma.sql`a.is_manager = FALSE`;

  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      customer_id: string;
      descriptive_name: string | null;
      currency_code: string | null;
      time_zone: string | null;
      status: string | null;
      is_manager: boolean;
      campaigns: bigint;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      conversions_value: Prisma.Decimal;
    }>
  >`
    SELECT
      a.id,
      a.customer_id,
      a.descriptive_name,
      a.currency_code,
      a.time_zone,
      a.status,
      a.is_manager,
      COALESCE(c.campaigns, 0)          AS campaigns,
      COALESCE(s.impressions, 0)        AS impressions,
      COALESCE(s.clicks, 0)             AS clicks,
      COALESCE(s.cost_micros, 0)        AS cost_micros,
      COALESCE(s.conversions, 0)        AS conversions,
      COALESCE(s.conversions_value, 0)  AS conversions_value
    FROM accounts a
    LEFT JOIN (
      SELECT account_id,
             SUM(impressions)       AS impressions,
             SUM(clicks)            AS clicks,
             SUM(cost_micros)       AS cost_micros,
             SUM(conversions)       AS conversions,
             SUM(conversions_value) AS conversions_value
      FROM campaign_snapshots
      WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      GROUP BY account_id
    ) s ON s.account_id = a.id
    LEFT JOIN (
      SELECT account_id, COUNT(*) AS campaigns
      FROM campaigns
      WHERE status = ${ACTIVE}
      GROUP BY account_id
    ) c ON c.account_id = a.id
    WHERE ${managerFilter}
      AND ${accountFilter('a.id', scope.accountIds)}
    ORDER BY COALESCE(s.cost_micros, 0) DESC, a.descriptive_name
  `;

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    name: r.descriptive_name,
    currency: r.currency_code,
    timeZone: r.time_zone,
    status: r.status,
    isManager: r.is_manager,
    campaigns: toNum(r.campaigns),
    ...buildTotals(r),
  }));
}

// ─── Campaign rollup ─────────────────────────────────────────────────────────

export type CampaignRow = {
  id: number;
  campaignId: string;
  name: string | null;
  status: string | null;
  channelType: string | null;
  biddingStrategy: string | null;
  optimizationScore: number | null;
  accountId: number;
  accountName: string | null;
  budget: number;
} & Totals;

export async function campaignRollup(
  start: Date,
  end: Date,
  scope: Scope,
  opts: {
    accountId?: number | null;
    /** Restrict to these `campaigns.id` values; an empty list means none. */
    campaignPks?: number[] | null;
    statuses?: string[];
    search?: string | null;
  } = {}
): Promise<CampaignRow[]> {
  const extra: Prisma.Sql[] = [];
  if (opts.accountId != null) extra.push(Prisma.sql`c.account_id = ${opts.accountId}`);
  const many = campaignFilter('c.id', opts.campaignPks);
  if (many) extra.push(many);
  if (opts.statuses?.length) {
    extra.push(Prisma.sql`c.status IN (${Prisma.join(opts.statuses)})`);
  }
  if (opts.search) extra.push(Prisma.sql`c.name ILIKE ${`%${opts.search}%`}`);
  const extraSql = extra.length ? Prisma.sql`AND ${Prisma.join(extra, ' AND ')}` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      campaign_id: bigint;
      name: string | null;
      status: string | null;
      advertising_channel_type: string | null;
      bidding_strategy_type: string | null;
      optimization_score: number | null;
      account_id: number;
      account_name: string | null;
      budget_micros: bigint | null;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      conversions_value: Prisma.Decimal;
    }>
  >`
    SELECT
      c.id,
      c.campaign_id,
      c.name,
      c.status,
      c.advertising_channel_type,
      c.bidding_strategy_type,
      c.optimization_score,
      c.account_id,
      a.descriptive_name                AS account_name,
      s.budget_micros,
      COALESCE(s.impressions, 0)        AS impressions,
      COALESCE(s.clicks, 0)             AS clicks,
      COALESCE(s.cost_micros, 0)        AS cost_micros,
      COALESCE(s.conversions, 0)        AS conversions,
      COALESCE(s.conversions_value, 0)  AS conversions_value
    FROM campaigns c
    JOIN accounts a ON a.id = c.account_id
    LEFT JOIN (
      SELECT campaign_id,
             SUM(impressions)       AS impressions,
             SUM(clicks)            AS clicks,
             SUM(cost_micros)       AS cost_micros,
             SUM(conversions)       AS conversions,
             SUM(conversions_value) AS conversions_value,
             MAX(budget_micros)     AS budget_micros
      FROM campaign_snapshots
      WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      GROUP BY campaign_id
    ) s ON s.campaign_id = c.id
    WHERE ${accountFilter('c.account_id', scope.accountIds)}
      ${extraSql}
    ORDER BY COALESCE(s.cost_micros, 0) DESC, c.name
  `;

  return rows.map((r) => ({
    id: r.id,
    campaignId: String(r.campaign_id),
    name: r.name,
    status: r.status,
    channelType: r.advertising_channel_type,
    biddingStrategy: r.bidding_strategy_type,
    optimizationScore: toNullableNum(r.optimization_score),
    accountId: r.account_id,
    accountName: r.account_name,
    budget: microsToCurrency(r.budget_micros),
    ...buildTotals(r),
  }));
}

// ─── Ad group / ad / keyword / search term rollups ───────────────────────────

export type AdGroupRow = {
  id: number;
  adGroupId: string;
  name: string | null;
  status: string | null;
  type: string | null;
  campaignPk: number;
  campaignName: string | null;
  accountId: number;
} & Totals;

export async function adGroupRollup(
  start: Date,
  end: Date,
  scope: Scope,
  opts: { campaignPk?: number | null; campaignPks?: number[] | null; accountId?: number | null } = {}
): Promise<AdGroupRow[]> {
  const extra: Prisma.Sql[] = [];
  if (opts.campaignPk != null) extra.push(Prisma.sql`g.campaign_id = ${opts.campaignPk}`);
  const manyGroups = campaignFilter('g.campaign_id', opts.campaignPks);
  if (manyGroups) extra.push(manyGroups);
  if (opts.accountId != null) extra.push(Prisma.sql`g.account_id = ${opts.accountId}`);
  const extraSql = extra.length ? Prisma.sql`AND ${Prisma.join(extra, ' AND ')}` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      ad_group_id: bigint;
      name: string | null;
      status: string | null;
      type: string | null;
      campaign_pk: number;
      campaign_name: string | null;
      account_id: number;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      conversions_value: Prisma.Decimal;
    }>
  >`
    SELECT
      g.id, g.ad_group_id, g.name, g.status, g.type,
      g.campaign_id AS campaign_pk,
      c.name        AS campaign_name,
      g.account_id,
      COALESCE(s.impressions, 0)       AS impressions,
      COALESCE(s.clicks, 0)            AS clicks,
      COALESCE(s.cost_micros, 0)       AS cost_micros,
      COALESCE(s.conversions, 0)       AS conversions,
      COALESCE(s.conversions_value, 0) AS conversions_value
    FROM ad_groups g
    JOIN campaigns c ON c.id = g.campaign_id
    LEFT JOIN (
      SELECT ad_group_id,
             SUM(impressions) AS impressions, SUM(clicks) AS clicks,
             SUM(cost_micros) AS cost_micros, SUM(conversions) AS conversions,
             SUM(conversions_value) AS conversions_value
      FROM ad_group_snapshots
      WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      GROUP BY ad_group_id
    ) s ON s.ad_group_id = g.id
    WHERE ${accountFilter('g.account_id', scope.accountIds)}
      ${extraSql}
    ORDER BY COALESCE(s.cost_micros, 0) DESC, g.name
  `;

  return rows.map((r) => ({
    id: r.id,
    adGroupId: String(r.ad_group_id),
    name: r.name,
    status: r.status,
    type: r.type,
    campaignPk: r.campaign_pk,
    campaignName: r.campaign_name,
    accountId: r.account_id,
    ...buildTotals(r),
  }));
}

export type AdRow = {
  id: number;
  adId: string;
  type: string | null;
  status: string | null;
  approvalStatus: string | null;
  finalUrls: string | null;
  headlines: string[];
  descriptions: string[];
  adGroupPk: number;
  adGroupName: string | null;
  accountId: number;
} & Totals;

export async function adRollup(
  start: Date,
  end: Date,
  scope: Scope,
  opts: { adGroupPk?: number | null; campaignPk?: number | null; accountId?: number | null } = {}
): Promise<AdRow[]> {
  const extra: Prisma.Sql[] = [];
  if (opts.adGroupPk != null) extra.push(Prisma.sql`d.ad_group_id = ${opts.adGroupPk}`);
  if (opts.campaignPk != null) extra.push(Prisma.sql`g.campaign_id = ${opts.campaignPk}`);
  if (opts.accountId != null) extra.push(Prisma.sql`d.account_id = ${opts.accountId}`);
  const extraSql = extra.length ? Prisma.sql`AND ${Prisma.join(extra, ' AND ')}` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      ad_id: bigint;
      type: string | null;
      status: string | null;
      approval_status: string | null;
      final_urls: string | null;
      headlines: string | null;
      descriptions: string | null;
      ad_group_pk: number;
      ad_group_name: string | null;
      account_id: number;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      conversions_value: Prisma.Decimal;
    }>
  >`
    SELECT
      d.id, d.ad_id, d.type, d.status, d.approval_status, d.final_urls,
      d.headlines, d.descriptions,
      d.ad_group_id AS ad_group_pk,
      g.name        AS ad_group_name,
      d.account_id,
      COALESCE(s.impressions, 0)       AS impressions,
      COALESCE(s.clicks, 0)            AS clicks,
      COALESCE(s.cost_micros, 0)       AS cost_micros,
      COALESCE(s.conversions, 0)       AS conversions,
      COALESCE(s.conversions_value, 0) AS conversions_value
    FROM ads d
    JOIN ad_groups g ON g.id = d.ad_group_id
    LEFT JOIN (
      SELECT ad_id,
             SUM(impressions) AS impressions, SUM(clicks) AS clicks,
             SUM(cost_micros) AS cost_micros, SUM(conversions) AS conversions,
             SUM(conversions_value) AS conversions_value
      FROM ad_snapshots
      WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      GROUP BY ad_id
    ) s ON s.ad_id = d.id
    WHERE ${accountFilter('d.account_id', scope.accountIds)}
      ${extraSql}
    ORDER BY COALESCE(s.cost_micros, 0) DESC, d.id
  `;

  // Headlines and descriptions are stored newline-joined by the sync, matching
  // how the Python fetcher flattened the RSA asset lists.
  const split = (v: string | null): string[] =>
    (v ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

  return rows.map((r) => ({
    id: r.id,
    adId: String(r.ad_id),
    type: r.type,
    status: r.status,
    approvalStatus: r.approval_status,
    finalUrls: r.final_urls,
    headlines: split(r.headlines),
    descriptions: split(r.descriptions),
    adGroupPk: r.ad_group_pk,
    adGroupName: r.ad_group_name,
    accountId: r.account_id,
    ...buildTotals(r),
  }));
}

export type KeywordRow = {
  id: number;
  criterionId: string;
  text: string | null;
  matchType: string | null;
  status: string | null;
  qualityScore: number | null;
  expectedCtr: string | null;
  adRelevance: string | null;
  landingPageExperience: string | null;
  adGroupPk: number;
  adGroupName: string | null;
  campaignPk: number;
  campaignName: string | null;
  accountId: number;
} & Totals;

/**
 * Keyword performance over a window, with the averaged Quality Score.
 *
 * `ROUND(AVG(quality_score))` matches the source's `round(float(qs))`: Quality
 * Score is an integer 1-10 and a fractional average would be a false precision.
 */
export async function keywordRollup(
  start: Date,
  end: Date,
  scope: Scope,
  opts: {
    adGroupPk?: number | null;
    campaignPk?: number | null;
    campaignPks?: number[] | null;
    accountId?: number | null;
    search?: string | null;
    limit?: number;
  } = {}
): Promise<KeywordRow[]> {
  const extra: Prisma.Sql[] = [];
  if (opts.adGroupPk != null) extra.push(Prisma.sql`k.ad_group_id = ${opts.adGroupPk}`);
  // The keywords dimension carries no campaign_id — a keyword's campaign is
  // reached through its ad group, which is why the join below exists.
  if (opts.campaignPk != null) extra.push(Prisma.sql`g.campaign_id = ${opts.campaignPk}`);
  const manyKeywords = campaignFilter('g.campaign_id', opts.campaignPks);
  if (manyKeywords) extra.push(manyKeywords);
  if (opts.accountId != null) extra.push(Prisma.sql`k.account_id = ${opts.accountId}`);
  if (opts.search) extra.push(Prisma.sql`k.text ILIKE ${`%${opts.search}%`}`);
  const extraSql = extra.length ? Prisma.sql`AND ${Prisma.join(extra, ' AND ')}` : Prisma.empty;
  const limit = opts.limit ?? 5000;

  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      criterion_id: bigint;
      text: string | null;
      match_type: string | null;
      status: string | null;
      quality_score: Prisma.Decimal | null;
      expected_ctr: string | null;
      ad_relevance: string | null;
      landing_page_experience: string | null;
      ad_group_pk: number;
      ad_group_name: string | null;
      campaign_pk: number;
      campaign_name: string | null;
      account_id: number;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      conversions_value: Prisma.Decimal;
    }>
  >`
    SELECT
      k.id, k.criterion_id, k.text, k.match_type, k.status,
      k.ad_group_id AS ad_group_pk,
      g.name        AS ad_group_name,
      g.campaign_id AS campaign_pk,
      c.name        AS campaign_name,
      k.account_id,
      s.quality_score,
      s.expected_ctr,
      s.ad_relevance,
      s.landing_page_experience,
      COALESCE(s.impressions, 0)       AS impressions,
      COALESCE(s.clicks, 0)            AS clicks,
      COALESCE(s.cost_micros, 0)       AS cost_micros,
      COALESCE(s.conversions, 0)       AS conversions,
      COALESCE(s.conversions_value, 0) AS conversions_value
    FROM keywords k
    JOIN ad_groups g ON g.id = k.ad_group_id
    JOIN campaigns c ON c.id = g.campaign_id
    -- An inner join, matching the source's keyword_metrics: a keyword with no
    -- snapshot in the window has no data, which is not the same as zero. A
    -- LEFT JOIN here pads the list with thousands of never-served keywords and
    -- makes "keywords with data" read far higher than the source reports.
    JOIN (
      SELECT keyword_id,
             ROUND(AVG(quality_score))            AS quality_score,
             MAX(expected_ctr)                    AS expected_ctr,
             MAX(ad_relevance)                    AS ad_relevance,
             MAX(landing_page_experience)         AS landing_page_experience,
             SUM(impressions) AS impressions, SUM(clicks) AS clicks,
             SUM(cost_micros) AS cost_micros, SUM(conversions) AS conversions,
             SUM(conversions_value) AS conversions_value
      FROM keyword_snapshots
      WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      GROUP BY keyword_id
    ) s ON s.keyword_id = k.id
    WHERE ${accountFilter('k.account_id', scope.accountIds)}
      ${extraSql}
    ORDER BY COALESCE(s.cost_micros, 0) DESC, k.text
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    criterionId: String(r.criterion_id),
    text: r.text,
    matchType: r.match_type,
    status: r.status,
    qualityScore: toNullableNum(r.quality_score),
    expectedCtr: r.expected_ctr,
    adRelevance: r.ad_relevance,
    landingPageExperience: r.landing_page_experience,
    adGroupPk: r.ad_group_pk,
    adGroupName: r.ad_group_name,
    campaignPk: r.campaign_pk,
    campaignName: r.campaign_name,
    accountId: r.account_id,
    ...buildTotals(r),
  }));
}

export type SearchTermRow = {
  id: number;
  query: string;
  status: string | null;
  matchType: string | null;
  campaignName: string | null;
  adGroupName: string | null;
  accountId: number;
} & Totals;

/**
 * The Search Term Explorer. A port of `search_terms_explore`, including its
 * HAVING-based filters and the total count taken over the grouped subquery so
 * pagination reports the number of distinct terms, not of snapshot rows.
 */
export async function searchTermExplore(params: {
  start: Date;
  end: Date;
  scope: Scope;
  accountId?: number | null;
  campaignPk?: number | null;
  campaignPks?: number[] | null;
  adGroupPk?: number | null;
  minClicks?: number;
  minCost?: number;
  minCtr?: number | null;
  contains?: string | null;
  sort?: 'cost' | 'clicks' | 'impressions' | 'conversions';
  limit?: number;
  offset?: number;
}): Promise<{ rows: SearchTermRow[]; total: number }> {
  const {
    start,
    end,
    scope,
    accountId,
    campaignPk,
    campaignPks,
    adGroupPk,
    minClicks = 0,
    minCost = 0,
    minCtr = null,
    contains = null,
    sort = 'cost',
    limit = 50,
    offset = 0,
  } = params;

  const where: Prisma.Sql[] = [
    Prisma.sql`ss.snapshot_date BETWEEN ${day(start)} AND ${day(end)}`,
    accountFilter('st.account_id', scope.accountIds),
  ];
  if (accountId != null) where.push(Prisma.sql`st.account_id = ${accountId}`);
  if (campaignPk != null) where.push(Prisma.sql`st.campaign_id = ${campaignPk}`);
  const manyTerms = campaignFilter('st.campaign_id', campaignPks);
  if (manyTerms) where.push(manyTerms);
  if (adGroupPk != null) where.push(Prisma.sql`st.ad_group_id = ${adGroupPk}`);
  if (contains) where.push(Prisma.sql`st.query ILIKE ${`%${contains}%`}`);
  const whereSql = Prisma.join(where, ' AND ');

  const havings: Prisma.Sql[] = [];
  if (minClicks) havings.push(Prisma.sql`COALESCE(SUM(ss.clicks), 0) >= ${minClicks}`);
  if (minCost) {
    havings.push(
      Prisma.sql`COALESCE(SUM(ss.cost_micros), 0) >= ${Math.round(minCost * MICROS)}`
    );
  }
  if (minCtr != null) {
    // clicks / impressions >= minCtr, expressed multiplicatively so a zero
    // impression count can't divide by zero.
    havings.push(
      Prisma.sql`COALESCE(SUM(ss.clicks), 0) >= ${minCtr} * COALESCE(SUM(ss.impressions), 0)`
    );
  }
  const havingSql = havings.length
    ? Prisma.sql`HAVING ${Prisma.join(havings, ' AND ')}`
    : Prisma.empty;

  const orderCol = {
    cost: Prisma.sql`cost_micros`,
    clicks: Prisma.sql`clicks`,
    impressions: Prisma.sql`impressions`,
    conversions: Prisma.sql`conversions`,
  }[sort];

  const base = Prisma.sql`
    SELECT
      st.id                                AS id,
      st.query                             AS query,
      st.search_term_targeting_status      AS status,
      st.match_type                        AS match_type,
      st.account_id                        AS account_id,
      c.name                               AS campaign_name,
      g.name                               AS ad_group_name,
      COALESCE(SUM(ss.impressions), 0)       AS impressions,
      COALESCE(SUM(ss.clicks), 0)            AS clicks,
      COALESCE(SUM(ss.cost_micros), 0)       AS cost_micros,
      COALESCE(SUM(ss.conversions), 0)       AS conversions,
      COALESCE(SUM(ss.conversions_value), 0) AS conversions_value
    FROM search_terms st
    JOIN search_term_snapshots ss ON ss.search_term_id = st.id
    JOIN campaigns c ON c.id = st.campaign_id
    JOIN ad_groups g ON g.id = st.ad_group_id
    WHERE ${whereSql}
    GROUP BY st.id, st.query, st.search_term_targeting_status, st.match_type,
             st.account_id, c.name, g.name
    ${havingSql}
  `;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM (${base}) q`,
    prisma.$queryRaw<
      Array<{
        id: number;
        query: string;
        status: string | null;
        match_type: string | null;
        account_id: number;
        campaign_name: string | null;
        ad_group_name: string | null;
        impressions: bigint;
        clicks: bigint;
        cost_micros: bigint;
        conversions: Prisma.Decimal;
        conversions_value: Prisma.Decimal;
      }>
    >`SELECT * FROM (${base}) q ORDER BY ${orderCol} DESC OFFSET ${offset} LIMIT ${limit}`,
  ]);

  return {
    total: toNum(countRows[0]?.n),
    rows: rows.map((r) => ({
      id: r.id,
      query: r.query,
      status: r.status,
      matchType: r.match_type,
      campaignName: r.campaign_name,
      adGroupName: r.ad_group_name,
      accountId: r.account_id,
      ...buildTotals(r),
    })),
  };
}

// ─── Device & geo ────────────────────────────────────────────────────────────

export type SegmentRow = { segment: string } & Totals;

export async function deviceBreakdown(
  start: Date,
  end: Date,
  scope: Scope,
  accountId?: number | null
): Promise<SegmentRow[]> {
  const extra =
    accountId != null ? Prisma.sql`AND account_id = ${accountId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<{
      device: string;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      conversions_value: Prisma.Decimal;
    }>
  >`
    SELECT device,
      COALESCE(SUM(impressions), 0)       AS impressions,
      COALESCE(SUM(clicks), 0)            AS clicks,
      COALESCE(SUM(cost_micros), 0)       AS cost_micros,
      COALESCE(SUM(conversions), 0)       AS conversions,
      COALESCE(SUM(conversions_value), 0) AS conversions_value
    FROM campaign_device_snapshots
    WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      AND ${accountFilter('account_id', scope.accountIds)}
      ${extra}
    GROUP BY device
    ORDER BY COALESCE(SUM(cost_micros), 0) DESC
  `;
  return rows.map((r) => ({ segment: r.device, ...buildTotals(r) }));
}

export type GeoRow = SegmentRow & {
  /** Google Ads country criterion id, e.g. 2356. */
  criterionId: number | null;
  /** ISO 3166-1 numeric — the id the world topojson keys its features on. */
  isoNumeric: number | null;
};

export async function geoBreakdown(
  start: Date,
  end: Date,
  scope: Scope,
  accountId?: number | null
): Promise<GeoRow[]> {
  const extra =
    accountId != null ? Prisma.sql`AND account_id = ${accountId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<{
      country_criterion_id: bigint | null;
      location_name: string | null;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      conversions_value: Prisma.Decimal;
    }>
  >`
    SELECT country_criterion_id, MAX(location_name) AS location_name,
      COALESCE(SUM(impressions), 0)       AS impressions,
      COALESCE(SUM(clicks), 0)            AS clicks,
      COALESCE(SUM(cost_micros), 0)       AS cost_micros,
      COALESCE(SUM(conversions), 0)       AS conversions,
      COALESCE(SUM(conversions_value), 0) AS conversions_value
    FROM campaign_geo_snapshots
    WHERE snapshot_date BETWEEN ${day(start)} AND ${day(end)}
      AND ${accountFilter('account_id', scope.accountIds)}
      ${extra}
    GROUP BY country_criterion_id
    ORDER BY COALESCE(SUM(cost_micros), 0) DESC
  `;
  return rows.map((r) => {
    const criterionId = r.country_criterion_id === null ? null : Number(r.country_criterion_id);
    // Prefer the name the sync cached from Google's geo_target_constant; fall
    // back to the ISO table for rows synced before that existed. Only show a
    // bare id if a country is in neither, which should not happen.
    const name =
      r.location_name ??
      countryNameFromCriterion(criterionId) ??
      (criterionId !== null ? `Country ${criterionId}` : 'Unknown');
    return {
      segment: name,
      criterionId,
      isoNumeric: criterionId === null ? null : isoNumericFromCriterion(criterionId),
      ...buildTotals(r),
    };
  });
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export type BudgetRow = {
  id: number;
  name: string | null;
  accountId: number;
  accountName: string | null;
  snapshotDate: string | null;
  amount: number;
  spend: number;
  utilization: number | null;
};

/** The latest budget snapshot per budget — the source's `latest_budget_snapshots`. */
export async function latestBudgetSnapshots(scope: Scope): Promise<BudgetRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      name: string | null;
      account_id: number;
      account_name: string | null;
      snapshot_date: Date | null;
      amount_micros: bigint | null;
      spend_micros: bigint | null;
    }>
  >`
    SELECT DISTINCT ON (b.id)
      b.id, b.name, b.account_id,
      a.descriptive_name AS account_name,
      s.snapshot_date, s.amount_micros, s.spend_micros
    FROM budgets b
    JOIN accounts a ON a.id = b.account_id
    JOIN budget_snapshots s ON s.budget_id = b.id
    WHERE ${accountFilter('b.account_id', scope.accountIds)}
    ORDER BY b.id, s.snapshot_date DESC
  `;

  return rows
    .map((r) => {
      const amount = microsToCurrency(r.amount_micros);
      const spend = microsToCurrency(r.spend_micros);
      return {
        id: r.id,
        name: r.name,
        accountId: r.account_id,
        accountName: r.account_name,
        snapshotDate: r.snapshot_date ? r.snapshot_date.toISOString().slice(0, 10) : null,
        amount,
        spend,
        utilization: amount ? spend / amount : null,
      };
    })
    .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0));
}

// ─── Health inputs ───────────────────────────────────────────────────────────

/** `{campaignPk -> {day -> metrics}}` for the requested days. */
export async function campaignMetricsByDay(
  days: Date[],
  scope: Scope
): Promise<Map<number, Map<string, { impressions: number; clicks: number; cost: number; conversions: number; budget: number }>>> {
  if (days.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    Array<{
      campaign_id: number;
      snapshot_date: Date;
      impressions: bigint;
      clicks: bigint;
      cost_micros: bigint;
      conversions: Prisma.Decimal;
      budget_micros: bigint | null;
    }>
  >`
    SELECT campaign_id, snapshot_date,
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(clicks), 0)      AS clicks,
      COALESCE(SUM(cost_micros), 0) AS cost_micros,
      COALESCE(SUM(conversions), 0) AS conversions,
      MAX(budget_micros)            AS budget_micros
    FROM campaign_snapshots
    WHERE snapshot_date IN (${Prisma.join(days.map(day))})
      AND ${accountFilter('account_id', scope.accountIds)}
    GROUP BY campaign_id, snapshot_date
  `;

  const out = new Map<
    number,
    Map<string, { impressions: number; clicks: number; cost: number; conversions: number; budget: number }>
  >();
  for (const r of rows) {
    const key = r.snapshot_date.toISOString().slice(0, 10);
    if (!out.has(r.campaign_id)) out.set(r.campaign_id, new Map());
    out.get(r.campaign_id)!.set(key, {
      impressions: toNum(r.impressions),
      clicks: toNum(r.clicks),
      // Not rounded here: this feeds the health score's CPC comparison, and
      // rounding each day before dividing would move the ratio.
      cost: toNum(r.cost_micros) / MICROS,
      conversions: toNum(r.conversions),
      budget: r.budget_micros ? toNum(r.budget_micros) / MICROS : 0,
    });
  }
  return out;
}

/** Average Quality Score per campaign on one day. */
export async function avgQualityScoreByCampaign(
  dayDate: Date,
  scope: Scope
): Promise<Map<number, number>> {
  const rows = await prisma.$queryRaw<Array<{ campaign_id: number; avg: Prisma.Decimal }>>`
    SELECT campaign_id, AVG(quality_score) AS avg
    FROM keyword_snapshots
    WHERE snapshot_date = ${day(dayDate)}
      AND quality_score IS NOT NULL
      AND ${accountFilter('account_id', scope.accountIds)}
    GROUP BY campaign_id
  `;
  return new Map(rows.map((r) => [Number(r.campaign_id), toNum(r.avg)]));
}

export type CampaignMeta = {
  campaignPk: number;
  campaignId: string;
  name: string | null;
  accountId: number;
  accountName: string | null;
  status: string | null;
  optimizationScore: number | null;
};

export async function campaignMeta(scope: Scope): Promise<CampaignMeta[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      campaign_id: bigint;
      name: string | null;
      account_id: number;
      account_name: string | null;
      status: string | null;
      optimization_score: number | null;
    }>
  >`
    SELECT c.id, c.campaign_id, c.name, c.account_id,
           a.descriptive_name AS account_name,
           c.status, c.optimization_score
    FROM campaigns c
    JOIN accounts a ON a.id = c.account_id
    WHERE ${accountFilter('c.account_id', scope.accountIds)}
  `;
  return rows.map((r) => ({
    campaignPk: r.id,
    campaignId: String(r.campaign_id),
    name: r.name,
    accountId: r.account_id,
    accountName: r.account_name,
    status: r.status,
    optimizationScore: toNullableNum(r.optimization_score),
  }));
}

// ─── Sync freshness ──────────────────────────────────────────────────────────

export type SyncHealth = {
  lastSuccessfulAt: string | null;
  latestStatus: string | null;
  latestAt: string | null;
  runningCount: number;
  failedLast24h: number;
};

export async function syncHealth(): Promise<SyncHealth> {
  const [lastOk, latest, counts] = await Promise.all([
    prisma.sync_logs.findFirst({
      where: { status: 'success' },
      orderBy: { finished_at: 'desc' },
      select: { finished_at: true },
    }),
    prisma.sync_logs.findFirst({
      orderBy: { started_at: 'desc' },
      select: { status: true, started_at: true },
    }),
    prisma.$queryRaw<Array<{ running: bigint; failed: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'failed' AND started_at > NOW() - INTERVAL '24 hours') AS failed
      FROM sync_logs
    `,
  ]);

  return {
    lastSuccessfulAt: lastOk?.finished_at?.toISOString() ?? null,
    latestStatus: latest?.status ?? null,
    latestAt: latest?.started_at?.toISOString() ?? null,
    runningCount: toNum(counts[0]?.running),
    failedLast24h: toNum(counts[0]?.failed),
  };
}
