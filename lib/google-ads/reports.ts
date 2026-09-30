import 'server-only';
import { enums } from 'google-ads-api';
import { search } from './client';

/**
 * Per-entity report fetchers.
 *
 * Every GAQL string below is carried over verbatim from
 * `app/google_ads/reports/*.py`, including the `status != 'REMOVED'` filters
 * and the fields deliberately dropped for Google Ads API v24 compatibility.
 * Changing a query here changes what the numbers mean, so they are kept as
 * exact copies rather than rebuilt from a query builder.
 */

const MICROS = 1_000_000;

type EnumMap = Record<string | number, string | number>;

/**
 * The *name* of a proto enum value — `"ENABLED"`, not `2`.
 *
 * This is a parity requirement, not a cosmetic one. The Python SDK returns
 * proto-plus enums whose `.name` was written straight into the varchar status
 * columns, and every read path filters on those strings
 * (`status = 'ENABLED'`, `approval_status = 'DISAPPROVED'`). The Node SDK
 * returns the raw integer instead, so without this mapping a sync would fill
 * the same columns with `"2"` and silently break every one of those filters.
 *
 * A value that is already a name passes through, so a future SDK change that
 * starts returning names cannot break this.
 */
function enumName(value: unknown, table?: EnumMap): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value !== '' && !/^\d+$/.test(value)) return value;

  if (table) {
    const key = typeof value === 'number' ? value : Number(value);
    const name = Number.isFinite(key) ? table[key] : undefined;
    if (typeof name === 'string') return name;
  }

  const text = String(value);
  return text || null;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === 0 || v === '0') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse a Google Ads `YYYY-MM-DD` string; empty becomes null. */
export function parseAdsDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export type Metrics = {
  impressions: number;
  clicks: number;
  interactions: number;
  cost_micros: number;
  ctr: number | null;
  average_cpc_micros: number | null;
  average_cpm_micros: number | null;
  conversions: number;
  conversions_value: number;
  all_conversions: number;
  video_views: number;
};

/**
 * The standard metric block. Monetary metrics come back from the API in micros
 * and are stored as-is in the `*_micros` columns — no conversion happens on
 * the write path.
 */
function metricsOf(row: { metrics?: Record<string, unknown> }): Metrics {
  const m = row.metrics ?? {};
  return {
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    interactions: num(m.interactions),
    cost_micros: num(m.cost_micros),
    ctr: m.ctr === null || m.ctr === undefined ? null : Number(m.ctr),
    average_cpc_micros: intOrNull(m.average_cpc),
    average_cpm_micros: intOrNull(m.average_cpm),
    conversions: num(m.conversions),
    conversions_value: num(m.conversions_value),
    all_conversions: num(m.all_conversions),
    video_views: 0, // metrics.video_views was removed in Google Ads API v24
  };
}

function gaqlDateBetween(start: Date, end: Date): string {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return `segments.date BETWEEN '${iso(start)}' AND '${iso(end)}'`;
}

/** (start, end) covering the last `lookbackDays` complete days, ending yesterday. */
export function defaultDateRange(lookbackDays: number): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - Math.max(0, lookbackDays - 1));
  return { start, end };
}

// ─── Accounts ────────────────────────────────────────────────────────────────

// customer_client.level 0 = the manager itself, 1 = direct child accounts.
const GAQL_ACCOUNTS = `
SELECT
  customer_client.id,
  customer_client.descriptive_name,
  customer_client.currency_code,
  customer_client.time_zone,
  customer_client.manager,
  customer_client.test_account,
  customer_client.status,
  customer_client.level
FROM customer_client
WHERE customer_client.level <= 1
`.trim();

export type AccountRecord = {
  customer_id: string;
  descriptive_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  is_manager: boolean;
  test_account: boolean;
  status: string | null;
  manager_customer_id: string;
};

/** All accounts: the MCC plus its direct children. */
export async function fetchAccounts(managerCustomerId: string): Promise<AccountRecord[]> {
  const rows = await search<{ customer_client: Record<string, unknown> }>(
    managerCustomerId,
    GAQL_ACCOUNTS
  );
  return rows.map((r) => {
    const cc = r.customer_client;
    return {
      customer_id: String(cc.id),
      descriptive_name: (cc.descriptive_name as string) || null,
      currency_code: (cc.currency_code as string) || null,
      time_zone: (cc.time_zone as string) || null,
      is_manager: Boolean(cc.manager),
      test_account: Boolean(cc.test_account),
      status: enumName(cc.status, enums.CustomerStatus),
      manager_customer_id: managerCustomerId,
    };
  });
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

const GAQL_CAMPAIGN_CONFIG = `
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.serving_status,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  campaign.bidding_strategy_type,
  campaign.network_settings.target_google_search,
  campaign.network_settings.target_search_network,
  campaign.network_settings.target_content_network,
  campaign.network_settings.target_partner_search_network,
  campaign.optimization_score,
  campaign_budget.id
FROM campaign
WHERE campaign.status != 'REMOVED'
`.trim();

function networksOf(campaign: Record<string, unknown>): string | null {
  const ns = (campaign.network_settings ?? {}) as Record<string, unknown>;
  const flags: Array<[string, unknown]> = [
    ['GOOGLE_SEARCH', ns.target_google_search],
    ['SEARCH_PARTNERS', ns.target_search_network],
    ['CONTENT', ns.target_content_network],
    ['PARTNER_SEARCH', ns.target_partner_search_network],
  ];
  const enabled = flags.filter(([, on]) => on).map(([name]) => name);
  return enabled.length ? enabled.join(',') : null;
}

export async function fetchCampaigns(customerId: string) {
  const rows = await search<{
    campaign: Record<string, unknown>;
    campaign_budget: Record<string, unknown>;
  }>(customerId, GAQL_CAMPAIGN_CONFIG);

  return rows.map((r) => {
    const c = r.campaign;
    return {
      campaign_id: Number(c.id),
      name: (c.name as string) || null,
      status: enumName(c.status, enums.CampaignStatus),
      serving_status: enumName(c.serving_status, enums.CampaignServingStatus),
      advertising_channel_type: enumName(c.advertising_channel_type, enums.AdvertisingChannelType),
      advertising_channel_sub_type: enumName(c.advertising_channel_sub_type, enums.AdvertisingChannelSubType),
      bidding_strategy_type: enumName(c.bidding_strategy_type, enums.BiddingStrategyType),
      networks: networksOf(c),
      // start_date/end_date are not queried, for Google Ads API v24
      // compatibility (the fields are not recognised there).
      start_date: null as Date | null,
      end_date: null as Date | null,
      optimization_score: c.optimization_score ? Number(c.optimization_score) : null,
      budget_id: r.campaign_budget?.id ? Number(r.campaign_budget.id) : null,
    };
  });
}

export async function fetchCampaignMetrics(customerId: string, start: Date, end: Date) {
  const query = `
    SELECT
      campaign.id,
      campaign.status,
      campaign.bidding_strategy_type,
      campaign.optimization_score,
      campaign_budget.amount_micros,
      segments.date,
      metrics.impressions, metrics.clicks, metrics.interactions, metrics.cost_micros,
      metrics.ctr, metrics.average_cpc, metrics.average_cpm,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions
    FROM campaign
    WHERE ${gaqlDateBetween(start, end)} AND campaign.status != 'REMOVED'
  `.trim();

  const rows = await search<{
    campaign: Record<string, unknown>;
    campaign_budget: Record<string, unknown>;
    segments: { date: string };
    metrics: Record<string, unknown>;
  }>(customerId, query);

  return rows.map((r) => ({
    campaign_id: Number(r.campaign.id),
    snapshot_date: parseAdsDate(r.segments?.date),
    status: enumName(r.campaign.status, enums.CampaignStatus),
    bidding_strategy_type: enumName(r.campaign.bidding_strategy_type, enums.BiddingStrategyType),
    optimization_score: r.campaign.optimization_score
      ? Number(r.campaign.optimization_score)
      : null,
    budget_micros: intOrNull(r.campaign_budget?.amount_micros),
    ...metricsOf(r),
  }));
}

export async function fetchCampaignDeviceMetrics(customerId: string, start: Date, end: Date) {
  const query = `
    SELECT
      campaign.id, segments.date, segments.device,
      metrics.impressions, metrics.clicks, metrics.interactions, metrics.cost_micros,
      metrics.ctr, metrics.average_cpc, metrics.average_cpm,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions
    FROM campaign
    WHERE ${gaqlDateBetween(start, end)} AND campaign.status != 'REMOVED'
  `.trim();

  const rows = await search<{
    campaign: Record<string, unknown>;
    segments: { date: string; device: unknown };
    metrics: Record<string, unknown>;
  }>(customerId, query);

  return rows.map((r) => ({
    campaign_id: Number(r.campaign.id),
    snapshot_date: parseAdsDate(r.segments?.date),
    device: enumName(r.segments?.device, enums.Device) ?? 'UNKNOWN',
    ...metricsOf(r),
  }));
}

/**
 * Resolve Google Ads geo criterion ids to their canonical names.
 *
 * The source project left `location_name` null on every geo row, so its own
 * reports could only show the raw id. One extra query per sync fills it in.
 * Cached per process: the geo target constants are a fixed reference table.
 */
const geoNameCache = new Map<number, string>();

export async function fetchGeoTargetNames(
  customerId: string,
  criterionIds: number[]
): Promise<Map<number, string>> {
  const unknown = Array.from(new Set(criterionIds)).filter(
    (id) => Number.isFinite(id) && !geoNameCache.has(id)
  );

  if (unknown.length > 0) {
    try {
      const rows = await search<{ geo_target_constant: Record<string, unknown> }>(
        customerId,
        `SELECT geo_target_constant.id, geo_target_constant.name
         FROM geo_target_constant
         WHERE geo_target_constant.id IN (${unknown.join(',')})`
      );
      for (const r of rows) {
        const id = Number(r.geo_target_constant.id);
        const name = r.geo_target_constant.name as string | undefined;
        if (Number.isFinite(id) && name) geoNameCache.set(id, name);
      }
    } catch {
      // A naming lookup must never fail a sync — the metrics are the point,
      // and the read side falls back to the ISO table.
    }
  }

  return new Map(
    criterionIds
      .filter((id) => geoNameCache.has(id))
      .map((id) => [id, geoNameCache.get(id)!])
  );
}

export async function fetchCampaignGeoMetrics(customerId: string, start: Date, end: Date) {
  const query = `
    SELECT
      campaign.id, segments.date,
      geographic_view.country_criterion_id,
      metrics.impressions, metrics.clicks, metrics.interactions, metrics.cost_micros,
      metrics.ctr, metrics.average_cpc, metrics.average_cpm,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions
    FROM geographic_view
    WHERE ${gaqlDateBetween(start, end)}
  `.trim();

  const rows = await search<{
    campaign: Record<string, unknown>;
    segments: { date: string };
    geographic_view: Record<string, unknown>;
    metrics: Record<string, unknown>;
  }>(customerId, query);

  const mapped = rows.map((r) => ({
    campaign_id: Number(r.campaign.id),
    snapshot_date: parseAdsDate(r.segments?.date),
    country_criterion_id: intOrNull(r.geographic_view?.country_criterion_id),
    location_name: null as string | null,
    ...metricsOf(r),
  }));

  // Name the locations, so the stored rows are readable without a lookup.
  const names = await fetchGeoTargetNames(
    customerId,
    mapped.map((m) => m.country_criterion_id).filter((id): id is number => id !== null)
  );
  for (const row of mapped) {
    if (row.country_criterion_id !== null) {
      row.location_name = names.get(row.country_criterion_id) ?? null;
    }
  }
  return mapped;
}

// ─── Ad groups ───────────────────────────────────────────────────────────────

const GAQL_AD_GROUP_CONFIG = `
SELECT
  ad_group.id,
  ad_group.name,
  ad_group.status,
  ad_group.type,
  ad_group.cpc_bid_micros,
  campaign.id
FROM ad_group
WHERE ad_group.status != 'REMOVED'
`.trim();

export async function fetchAdGroups(customerId: string) {
  const rows = await search<{
    ad_group: Record<string, unknown>;
    campaign: Record<string, unknown>;
  }>(customerId, GAQL_AD_GROUP_CONFIG);

  return rows.map((r) => ({
    ad_group_id: Number(r.ad_group.id),
    campaign_id: Number(r.campaign.id),
    name: (r.ad_group.name as string) || null,
    status: enumName(r.ad_group.status, enums.AdGroupStatus),
    type: enumName(r.ad_group.type, enums.AdGroupType),
    cpc_bid_micros: intOrNull(r.ad_group.cpc_bid_micros),
  }));
}

export async function fetchAdGroupMetrics(customerId: string, start: Date, end: Date) {
  const query = `
    SELECT
      ad_group.id, campaign.id, ad_group.status, ad_group.cpc_bid_micros,
      segments.date,
      metrics.impressions, metrics.clicks, metrics.interactions, metrics.cost_micros,
      metrics.ctr, metrics.average_cpc, metrics.average_cpm,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions
    FROM ad_group
    WHERE ${gaqlDateBetween(start, end)} AND ad_group.status != 'REMOVED'
  `.trim();

  const rows = await search<{
    ad_group: Record<string, unknown>;
    campaign: Record<string, unknown>;
    segments: { date: string };
    metrics: Record<string, unknown>;
  }>(customerId, query);

  return rows.map((r) => ({
    ad_group_id: Number(r.ad_group.id),
    campaign_id: Number(r.campaign.id),
    snapshot_date: parseAdsDate(r.segments?.date),
    status: enumName(r.ad_group.status, enums.AdGroupStatus),
    cpc_bid_micros: intOrNull(r.ad_group.cpc_bid_micros),
    ...metricsOf(r),
  }));
}

// ─── Ads ─────────────────────────────────────────────────────────────────────

const GAQL_AD_CONFIG = `
SELECT
  ad_group_ad.ad.id,
  ad_group_ad.ad.type,
  ad_group_ad.status,
  ad_group_ad.policy_summary.approval_status,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad.responsive_search_ad.headlines,
  ad_group_ad.ad.responsive_search_ad.descriptions,
  ad_group.id,
  campaign.id
FROM ad_group_ad
WHERE ad_group_ad.status != 'REMOVED'
`.trim();

/** Join responsive-ad asset `.text` values with newlines, as the source did. */
function assetTexts(assets: unknown): string | null {
  if (!Array.isArray(assets)) return null;
  const texts = assets
    .map((a) => (a as { text?: string })?.text)
    .filter((t): t is string => Boolean(t));
  return texts.length ? texts.join('\n') : null;
}

export async function fetchAds(customerId: string) {
  const rows = await search<{
    ad_group_ad: Record<string, any>;
    ad_group: Record<string, unknown>;
    campaign: Record<string, unknown>;
  }>(customerId, GAQL_AD_CONFIG);

  return rows.map((r) => {
    const ad = r.ad_group_ad.ad ?? {};
    const rsa = ad.responsive_search_ad ?? {};
    return {
      ad_id: Number(ad.id),
      ad_group_id: Number(r.ad_group.id),
      campaign_id: Number(r.campaign.id),
      type: enumName(ad.type, enums.AdType),
      status: enumName(r.ad_group_ad.status, enums.AdGroupAdStatus),
      approval_status: enumName(r.ad_group_ad.policy_summary?.approval_status, enums.PolicyApprovalStatus),
      final_urls: Array.isArray(ad.final_urls) && ad.final_urls.length
        ? ad.final_urls.join('\n')
        : null,
      headlines: assetTexts(rsa.headlines),
      descriptions: assetTexts(rsa.descriptions),
    };
  });
}

export async function fetchAdMetrics(customerId: string, start: Date, end: Date) {
  const query = `
    SELECT
      ad_group_ad.ad.id, ad_group.id, campaign.id,
      ad_group_ad.status, ad_group_ad.policy_summary.approval_status,
      segments.date,
      metrics.impressions, metrics.clicks, metrics.interactions, metrics.cost_micros,
      metrics.ctr, metrics.average_cpc, metrics.average_cpm,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions
    FROM ad_group_ad
    WHERE ${gaqlDateBetween(start, end)} AND ad_group_ad.status != 'REMOVED'
  `.trim();

  const rows = await search<{
    ad_group_ad: Record<string, any>;
    ad_group: Record<string, unknown>;
    campaign: Record<string, unknown>;
    segments: { date: string };
    metrics: Record<string, unknown>;
  }>(customerId, query);

  return rows.map((r) => ({
    ad_id: Number(r.ad_group_ad.ad?.id),
    ad_group_id: Number(r.ad_group.id),
    campaign_id: Number(r.campaign.id),
    snapshot_date: parseAdsDate(r.segments?.date),
    status: enumName(r.ad_group_ad.status, enums.AdGroupAdStatus),
    approval_status: enumName(r.ad_group_ad.policy_summary?.approval_status, enums.PolicyApprovalStatus),
    ...metricsOf(r),
  }));
}

// ─── Keywords ────────────────────────────────────────────────────────────────

const GAQL_KEYWORD_CONFIG = `
SELECT
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  ad_group_criterion.status,
  ad_group_criterion.cpc_bid_micros,
  ad_group.id,
  campaign.id
FROM keyword_view
WHERE ad_group_criterion.status != 'REMOVED'
`.trim();

export async function fetchKeywords(customerId: string) {
  const rows = await search<{
    ad_group_criterion: Record<string, any>;
    ad_group: Record<string, unknown>;
    campaign: Record<string, unknown>;
  }>(customerId, GAQL_KEYWORD_CONFIG);

  return rows.map((r) => {
    const crit = r.ad_group_criterion;
    return {
      criterion_id: Number(crit.criterion_id),
      ad_group_id: Number(r.ad_group.id),
      campaign_id: Number(r.campaign.id),
      text: (crit.keyword?.text as string) || null,
      match_type: enumName(crit.keyword?.match_type, enums.KeywordMatchType),
      status: enumName(crit.status, enums.AdGroupCriterionStatus),
      cpc_bid_micros: intOrNull(crit.cpc_bid_micros),
    };
  });
}

export async function fetchKeywordMetrics(customerId: string, start: Date, end: Date) {
  const query = `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group.id, campaign.id,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      ad_group_criterion.quality_info.quality_score,
      ad_group_criterion.quality_info.creative_quality_score,
      ad_group_criterion.quality_info.post_click_quality_score,
      ad_group_criterion.quality_info.search_predicted_ctr,
      segments.date,
      metrics.impressions, metrics.clicks, metrics.interactions, metrics.cost_micros,
      metrics.ctr, metrics.average_cpc, metrics.average_cpm,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions
    FROM keyword_view
    WHERE ${gaqlDateBetween(start, end)} AND ad_group_criterion.status != 'REMOVED'
  `.trim();

  const rows = await search<{
    ad_group_criterion: Record<string, any>;
    ad_group: Record<string, unknown>;
    campaign: Record<string, unknown>;
    segments: { date: string };
    metrics: Record<string, unknown>;
  }>(customerId, query);

  return rows.map((r) => {
    const crit = r.ad_group_criterion;
    const qi = crit.quality_info ?? {};
    return {
      criterion_id: Number(crit.criterion_id),
      ad_group_id: Number(r.ad_group.id),
      campaign_id: Number(r.campaign.id),
      snapshot_date: parseAdsDate(r.segments?.date),
      match_type: enumName(crit.keyword?.match_type, enums.KeywordMatchType),
      status: enumName(crit.status, enums.AdGroupCriterionStatus),
      quality_score: qi.quality_score ? Number(qi.quality_score) : null,
      // Quality Score sub-components, stored as their enum name strings.
      ad_relevance: enumName(qi.creative_quality_score, enums.QualityScoreBucket),
      landing_page_experience: enumName(qi.post_click_quality_score, enums.QualityScoreBucket),
      expected_ctr: enumName(qi.search_predicted_ctr, enums.QualityScoreBucket),
      ...metricsOf(r),
    };
  });
}

// ─── Search terms ────────────────────────────────────────────────────────────

/**
 * Search terms are inherently date-segmented report rows; one query returns
 * both the dimension identity (query + ad group) and the daily metrics.
 */
export async function fetchSearchTerms(customerId: string, start: Date, end: Date) {
  const query = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      segments.search_term_match_type,
      segments.date,
      ad_group.id, campaign.id,
      metrics.impressions, metrics.clicks, metrics.interactions, metrics.cost_micros,
      metrics.ctr, metrics.average_cpc, metrics.average_cpm,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions
    FROM search_term_view
    WHERE ${gaqlDateBetween(start, end)}
  `.trim();

  const rows = await search<{
    search_term_view: Record<string, unknown>;
    segments: { date: string; search_term_match_type: unknown };
    ad_group: Record<string, unknown>;
    campaign: Record<string, unknown>;
    metrics: Record<string, unknown>;
  }>(customerId, query);

  return rows.map((r) => ({
    query: (r.search_term_view.search_term as string) || '',
    search_term_targeting_status: enumName(r.search_term_view.status, enums.SearchTermTargetingStatus),
    match_type: enumName(r.segments?.search_term_match_type, enums.SearchTermMatchType),
    ad_group_id: Number(r.ad_group.id),
    campaign_id: Number(r.campaign.id),
    snapshot_date: parseAdsDate(r.segments?.date),
    ...metricsOf(r),
  }));
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

const GAQL_BUDGET_CONFIG = `
SELECT
  campaign_budget.id,
  campaign_budget.name,
  campaign_budget.amount_micros,
  campaign_budget.delivery_method,
  campaign_budget.period,
  campaign_budget.explicitly_shared
FROM campaign_budget
`.trim();

export async function fetchBudgets(customerId: string) {
  const rows = await search<{ campaign_budget: Record<string, unknown> }>(
    customerId,
    GAQL_BUDGET_CONFIG
  );
  return rows.map((r) => {
    const b = r.campaign_budget;
    return {
      budget_id: Number(b.id),
      name: (b.name as string) || null,
      amount_micros: intOrNull(b.amount_micros),
      delivery_method: enumName(b.delivery_method, enums.BudgetDeliveryMethod),
      period: enumName(b.period, enums.BudgetPeriod),
      explicitly_shared: Boolean(b.explicitly_shared),
    };
  });
}

export async function fetchBudgetMetrics(customerId: string, start: Date, end: Date) {
  const query = `
    SELECT
      campaign_budget.id,
      campaign_budget.amount_micros,
      campaign_budget.delivery_method,
      segments.date,
      metrics.cost_micros
    FROM campaign_budget
    WHERE ${gaqlDateBetween(start, end)}
  `.trim();

  const rows = await search<{
    campaign_budget: Record<string, unknown>;
    segments: { date: string };
    metrics: Record<string, unknown>;
  }>(customerId, query);

  return rows.map((r) => {
    const amount = intOrNull(r.campaign_budget.amount_micros);
    const spend = num(r.metrics?.cost_micros);
    const utilization = amount ? spend / amount : null;
    return {
      budget_id: Number(r.campaign_budget.id),
      snapshot_date: parseAdsDate(r.segments?.date),
      amount_micros: amount,
      spend_micros: spend,
      utilization: utilization === null ? null : Math.round(utilization * 10_000) / 10_000,
      delivery_method: enumName(r.campaign_budget.delivery_method, enums.BudgetDeliveryMethod),
    };
  });
}

export { MICROS };
