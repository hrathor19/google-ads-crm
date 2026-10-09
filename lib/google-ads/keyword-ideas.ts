import 'server-only';
import { prisma } from '@/lib/prisma';
import { customerFor, search } from './client';

/**
 * Keyword research, from Google's own planner.
 *
 * `KeywordPlanIdeaService` is what sits behind Keyword Planner in the Google
 * Ads UI, so the volumes here are the volumes a media planner would quote.
 * Three things about that data decide how the page presents it:
 *
 *  - **Volumes are banded, not counted.** Google rounds hard — 2,900 rather
 *    than 2,873, and anything small lands on 10. They are orders of
 *    magnitude, which is why nothing here computes a percentage off a single
 *    keyword's volume.
 *  - **The headline figure is a twelve-month average.** For admissions that
 *    hides the whole story, so the monthly series comes back too and the peak
 *    month sits beside the average.
 *  - **Every call spends one operation** from the same daily quota the
 *    nightly sync draws on, which is why this is rate limited per user and
 *    the geo list is cached rather than re-fetched per page load.
 */

/** Google rejects a longer seed list outright. */
export const MAX_SEEDS = 20;

export type Competition = 'UNSPECIFIED' | 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';

export type MonthPoint = { label: string; searches: number };

export type KeywordIdea = {
  keyword: string;
  avgMonthlySearches: number;
  competition: Competition;
  /** 0–100. Google's own index, finer grained than the three-way band. */
  competitionIndex: number | null;
  /** Rupees. Null where Google returns nothing, which happens on thin terms. */
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  /** Twelve months, oldest first. */
  monthly: MonthPoint[];
  /** Busiest month in the series — the one that decides when to fly. */
  peakMonth: string | null;
  peakSearches: number | null;
  /** Latest three months against the three before them, as a fraction. */
  trend: number | null;
  /**
   * Was below Google's reporting floor and no longer is. Shown instead of a
   * percentage, because a percentage off the floor is arithmetic on a band.
   */
  emerging: boolean;
  /** Already bid on in an account this user can see. */
  alreadyRunning: boolean;
};

const MICROS = 1_000_000;
const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
] as const;
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Three months at Google's smallest reported band.
 *
 * Nothing below 10 searches a month is reported as itself, so a quarter
 * totalling this or less is a measurement floor, not a figure to divide by.
 */
const FLOOR_QUARTER = 30;

/** Protobuf int64 arrives as a string; everything else arrives as it pleases. */
const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

const money = (micros: unknown): number | null => {
  const n = num(micros);
  // Zero means "Google has no bid estimate", not "this keyword is free".
  return n === 0 ? null : Math.round((n / MICROS) * 100) / 100;
};

export type RawVolume = { month?: string; year?: string | number; monthly_searches?: string | number };
export type RawIdea = {
  text?: string;
  keyword_idea_metrics?: {
    avg_monthly_searches?: string | number;
    competition?: string | number;
    competition_index?: string | number;
    low_top_of_page_bid_micros?: string | number;
    high_top_of_page_bid_micros?: string | number;
    monthly_search_volumes?: RawVolume[];
  } | null;
};

/**
 * The competition enum arrives as a name on some paths and an index on
 * others, depending on how the SDK decoded the response.
 */
export function competitionOf(value: unknown): Competition {
  const byIndex: Competition[] = ['UNSPECIFIED', 'UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'];
  if (typeof value === 'number') return byIndex[value] ?? 'UNSPECIFIED';
  const name = String(value ?? '').toUpperCase();
  return (byIndex as string[]).includes(name) ? (name as Competition) : 'UNSPECIFIED';
}

/**
 * Turn Google's twelve `{month, year, monthly_searches}` records into a
 * chartable series, plus the two derived figures worth a column.
 */
export function seriesOf(volumes: RawVolume[] | undefined | null) {
  const rows = (volumes ?? [])
    .map((v) => {
      const mi = MONTHS.indexOf(String(v.month).toUpperCase() as (typeof MONTHS)[number]);
      const year = num(v.year);
      return {
        year,
        monthIndex: mi,
        label: mi >= 0 ? `${SHORT[mi]} ${String(year).slice(2)}` : String(v.month ?? ''),
        searches: num(v.monthly_searches),
      };
    })
    // Google returns these in order, but sorting makes the trend arithmetic
    // below independent of that promise.
    .sort((a, b) => a.year - b.year || a.monthIndex - b.monthIndex);

  const monthly: MonthPoint[] = rows.map((r) => ({ label: r.label, searches: r.searches }));

  let peakMonth: string | null = null;
  let peakSearches: number | null = null;
  for (const r of rows) {
    if (peakSearches === null || r.searches > peakSearches) {
      peakSearches = r.searches;
      peakMonth = r.label;
    }
  }

  // Two full quarters or nothing. A "trend" computed from one month against
  // five is a number people would read as seasonality and act on.
  //
  // The floor matters as much as the window. Google reports nothing smaller
  // than 10 searches a month, so a quarter totalling 30 means "under the
  // floor" rather than "thirty", and a percentage computed against it is
  // arithmetic on a band. Such a keyword is reported as emerging instead.
  //
  // A genuinely large rise is left alone: a term going from 110 a month to
  // 12,100 across a counselling cycle really is +1909%, and rounding that
  // away would hide the most actionable row on the page.
  let trend: number | null = null;
  let emerging = false;
  if (rows.length >= 6) {
    const recent = rows.slice(-3).reduce((s, r) => s + r.searches, 0);
    const prior = rows.slice(-6, -3).reduce((s, r) => s + r.searches, 0);
    if (prior > FLOOR_QUARTER) {
      trend = Math.round(((recent - prior) / prior) * 1000) / 1000;
    } else if (recent > FLOOR_QUARTER) {
      emerging = true;
    }
  }

  return { monthly, peakMonth, peakSearches, trend, emerging };
}

/**
 * Shape the API response into the rows the page renders.
 *
 * Separated from the call itself so the parsing — which is where the string
 * ints, the enum-or-index and the twelve-month series all have to be got
 * right — can be tested without a network.
 */
export function normaliseIdeas(raw: RawIdea[], running: Set<string>): KeywordIdea[] {
  const ideas = raw.map((r) => {
    const m = r.keyword_idea_metrics ?? {};
    const keyword = String(r.text ?? '');
    const { monthly, peakMonth, peakSearches, trend, emerging } = seriesOf(
      m.monthly_search_volumes
    );
    return {
      keyword,
      avgMonthlySearches: num(m.avg_monthly_searches),
      competition: competitionOf(m.competition),
      competitionIndex:
        m.competition_index === undefined || m.competition_index === null
          ? null
          : num(m.competition_index),
      lowTopOfPageBid: money(m.low_top_of_page_bid_micros),
      highTopOfPageBid: money(m.high_top_of_page_bid_micros),
      monthly,
      peakMonth,
      peakSearches,
      trend,
      emerging,
      alreadyRunning: running.has(keyword.toLowerCase()),
    };
  });

  ideas.sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches || a.keyword.localeCompare(b.keyword));
  return ideas;
}

// ─── The call ───────────────────────────────────────────────────────────────

export type IdeaRequest = {
  /** Seed phrases. At least one of these or `pageUrl` is required. */
  keywords?: string[];
  /** A landing page; Google reads the page and infers keywords from it. */
  pageUrl?: string | null;
  /** Geo target constant ids, bare — `2356` is India. */
  geoTargetIds: string[];
  /** Language constant id, bare — `1000` is English. */
  languageId: string;
  /**
   * Accounts whose live keywords count towards the "already running" flag.
   * Null means every synced account; a scoped role passes its own list so the
   * flag never reveals that another client is bidding on something.
   */
  scopeAccountIds?: number[] | null;
};

export type IdeaResult = {
  ideas: KeywordIdea[];
  /** The account the quota was spent against, for the audit entry. */
  customerId: string;
};

/**
 * Ask Google for ideas, then mark the ones already being bid on.
 *
 * That flag is the thing this page has that Google's own planner does not:
 * without it a list of 150 ideas gives no clue which are genuine gaps and
 * which the account has been buying for a year.
 */
export async function generateKeywordIdeas(req: IdeaRequest): Promise<IdeaResult> {
  const seeds = Array.from(
    new Set((req.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean))
  ).slice(0, MAX_SEEDS);
  const url = req.pageUrl?.trim() || null;
  if (seeds.length === 0 && !url) {
    throw new Error('Give at least one seed keyword, or a page to read them from.');
  }
  if (req.geoTargetIds.length === 0) {
    throw new Error('Pick at least one location — search volume is meaningless without one.');
  }

  // Any syncable account will do. This is a research call, not a read of that
  // account's data, and the service refuses a manager account — which is what
  // the login customer id is.
  const account = await prisma.accounts.findFirstOrThrow({
    where: { is_manager: false, is_syncable: true },
    select: { customer_id: true },
    orderBy: { customer_id: 'asc' },
  });

  const seed =
    seeds.length > 0 && url
      ? { keyword_and_url_seed: { url, keywords: seeds } }
      : url
        ? { url_seed: { url } }
        : { keyword_seed: { keywords: seeds } };

  const customer = customerFor(account.customer_id);
  const response = await customer.keywordPlanIdeas.generateKeywordIdeas({
    customer_id: account.customer_id,
    language: `languageConstants/${req.languageId}`,
    geo_target_constants: req.geoTargetIds.map((id) => `geoTargetConstants/${id}`),
    // GOOGLE_SEARCH, not GOOGLE_SEARCH_AND_PARTNERS: partner volume is not
    // what anyone means when they ask how often something is searched.
    keyword_plan_network: 2,
    include_adult_keywords: false,
    ...seed,
  } as never);

  const raw = (Array.isArray(response) ? response : []) as RawIdea[];

  // One query for the whole result set rather than a lookup per row.
  const texts = Array.from(
    new Set(raw.map((r) => String(r.text ?? '').toLowerCase()).filter(Boolean))
  );
  const running = new Set<string>();
  if (texts.length > 0) {
    const existing = await prisma.keywords.findMany({
      where: {
        text: { in: texts, mode: 'insensitive' },
        status: { not: 'REMOVED' },
        ...(req.scopeAccountIds ? { account_id: { in: req.scopeAccountIds } } : {}),
      },
      select: { text: true },
      distinct: ['text'],
    });
    for (const k of existing) if (k.text) running.add(k.text.toLowerCase());
  }

  return { ideas: normaliseIdeas(raw, running), customerId: account.customer_id };
}

// ─── Locations and languages ────────────────────────────────────────────────

export type GeoTarget = { id: string; name: string; type: string };

/**
 * Cached for twelve hours.
 *
 * The list is Google's, it changes about never, and fetching it is an API
 * operation against the same daily quota as the sync — paying that on every
 * page load to receive the same few hundred rows would be careless.
 */
let geoCache: { at: number; rows: GeoTarget[] } | null = null;
const GEO_TTL_MS = 12 * 60 * 60 * 1000;

export async function listGeoTargets(): Promise<GeoTarget[]> {
  if (geoCache && Date.now() - geoCache.at < GEO_TTL_MS) return geoCache.rows;

  const account = await prisma.accounts.findFirstOrThrow({
    where: { is_manager: false, is_syncable: true },
    select: { customer_id: true },
    orderBy: { customer_id: 'asc' },
  });

  const rows = await search<{
    geo_target_constant: { id: string; canonical_name: string; target_type: string };
  }>(
    account.customer_id,
    `SELECT geo_target_constant.id, geo_target_constant.canonical_name,
            geo_target_constant.target_type
     FROM geo_target_constant
     WHERE geo_target_constant.country_code = 'IN'
       AND geo_target_constant.status = 'ENABLED'
       AND geo_target_constant.target_type IN ('Country','State','City')`
  );

  geoCache = { at: Date.now(), rows: sortGeoTargets(rows.map((r) => ({
    id: String(r.geo_target_constant.id),
    // "Karnataka,India" reads badly in a dropdown.
    name: String(r.geo_target_constant.canonical_name).replace(/,\s*India$/, ''),
    type: String(r.geo_target_constant.target_type),
  }))) };
  return geoCache.rows;
}

/** Country first, then states, then cities, each alphabetical. */
export function sortGeoTargets(rows: GeoTarget[]): GeoTarget[] {
  const rank = (t: string) => (t === 'Country' ? 0 : t === 'State' ? 1 : 2);
  return [...rows].sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name));
}

/** India. The default, and the fallback if the geo lookup is unavailable. */
export const DEFAULT_GEO_TARGET = '2356';
export const DEFAULT_LANGUAGE = '1000';

/** The languages worth offering, as Google's language constant ids. */
export const LANGUAGES: Array<{ id: string; name: string }> = [
  { id: '1000', name: 'English' },
  { id: '1023', name: 'Hindi' },
  { id: '1098', name: 'Bengali' },
  { id: '1130', name: 'Tamil' },
  { id: '1131', name: 'Telugu' },
  { id: '1102', name: 'Marathi' },
  { id: '1097', name: 'Gujarati' },
  { id: '1086', name: 'Kannada' },
  { id: '1101', name: 'Malayalam' },
  { id: '1110', name: 'Punjabi' },
];

// ─── Quota guard ────────────────────────────────────────────────────────────

/**
 * A per-user ceiling on searches.
 *
 * The planner draws on the same daily operation budget as the nightly sync,
 * and nothing about the UI stops somebody holding down Enter. In-memory and
 * per-process, like the login limiter: enough to stop a runaway, not a
 * security control.
 */
const SEARCH_LIMIT = 60;
const SEARCH_WINDOW_MS = 60 * 60 * 1000;
const searches = new Map<string, number[]>();

/** Records the attempt. Returns null when allowed, or seconds to wait. */
export function takeSearchSlot(userId: string, now = Date.now()): number | null {
  const recent = (searches.get(userId) ?? []).filter((t) => now - t < SEARCH_WINDOW_MS);
  if (recent.length >= SEARCH_LIMIT) {
    searches.set(userId, recent);
    return Math.ceil((SEARCH_WINDOW_MS - (now - recent[0])) / 1000);
  }
  recent.push(now);
  searches.set(userId, recent);
  return null;
}
