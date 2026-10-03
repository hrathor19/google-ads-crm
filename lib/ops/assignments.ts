import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  campaignRollup,
  deriveAvgCpc,
  deriveConversionRate,
  deriveCostPerConversion,
  deriveCtr,
  round2,
  type CampaignRow,
  type Scope,
  type Totals,
} from './metrics';

/**
 * Performance for the campaigns an Ad Specialist has been handed.
 *
 * The approval flow ends with a person owning an account: the Manager assigns
 * the Ad Specialist at step 3 and hands over the full account at step 11. From
 * that point the interesting question is no longer "where is this request" but
 * "is the work delivering" — so this module joins the request back to the
 * synced Google Ads data and measures it against the two numbers the Manager
 * approved at step 10: the required CPL and the required leads.
 *
 * Three rules decide which campaigns belong to an assignment, in order:
 *
 *  1. **Explicitly linked campaigns win.** A client is rarely one campaign —
 *     the same brief routinely runs three or four — so the Manager picks them
 *     and the assignment means exactly that set.
 *  2. **Then the legacy single campaign id.** The column `linkedCampaignId`
 *     predates the relation and still carries rows that were never relinked.
 *  3. **Otherwise the account stands in.** Between the handover and the
 *     launch nothing is linked yet, but the specialist already owns the
 *     account — so every campaign in it is theirs. Reporting nothing during
 *     that stretch would hide precisely the period somebody is being judged
 *     on.
 *
 * A legacy id that matches nothing falls through to rule 3 rather than
 * reporting an empty assignment: it was typed by hand, and one transposed
 * digit should not blank an account. Rule 1 does not fall through — an
 * explicit, resolvable choice of campaigns is an answer, and quietly widening
 * it to the whole account would misreport whose numbers these are.
 *
 * Because two assignments can cover the same account, the same campaign can
 * belong to both. Per-assignment rows therefore overlap by design, and the
 * headline totals are computed over the *distinct* campaign set so nothing is
 * counted twice.
 */

/** How delivery compares to the CPL approved at step 10. */
export type Pacing = 'ON_TRACK' | 'OVER_CPL' | 'NO_LEADS' | 'NO_SPEND' | 'NO_TARGET';

export const PACING_VALUES: Pacing[] = [
  'ON_TRACK',
  'OVER_CPL',
  'NO_LEADS',
  'NO_SPEND',
  'NO_TARGET',
];

/**
 * Where delivery sits against the target.
 *
 * The order of the checks is the point. "No leads" and "no delivery" are
 * different problems — one is money going out with nothing coming back, the
 * other is a campaign that never started — and neither should be reported as
 * a CPL miss, because there is no CPL to miss. Only once leads exist does
 * comparing against the target mean anything.
 */
export function classifyPacing(a: {
  cost: number;
  conversions: number;
  requiredCpl: number | null;
}): Pacing {
  if (a.cost <= 0 && a.conversions <= 0) return 'NO_SPEND';
  if (a.conversions <= 0) return 'NO_LEADS';
  if (a.requiredCpl === null || a.requiredCpl <= 0) return 'NO_TARGET';
  return a.cost / a.conversions <= a.requiredCpl ? 'ON_TRACK' : 'OVER_CPL';
}

type Summable = Pick<Totals, 'impressions' | 'clicks' | 'cost' | 'conversions' | 'conversionsValue'>;

/**
 * Sum campaign rows the way the rest of the reporting does: add the raw
 * counts, then derive CTR, CPC and cost-per-conversion from the sums. Never
 * average the derived values — a campaign with 3 impressions would otherwise
 * weigh as much as one with 300,000.
 */
export function sumTotals(rows: Summable[]): Totals {
  let impressions = 0;
  let clicks = 0;
  let cost = 0;
  let conversions = 0;
  let conversionsValue = 0;
  for (const r of rows) {
    impressions += r.impressions;
    clicks += r.clicks;
    cost += r.cost ?? 0;
    conversions += r.conversions;
    conversionsValue += r.conversionsValue;
  }
  cost = round2(cost);
  // Conversions are fractional, so a plain sum accumulates float dust
  // (12.000000000000002) that then renders as a suspiciously precise figure.
  conversions = round2(conversions);
  conversionsValue = round2(conversionsValue);
  return {
    impressions,
    clicks,
    cost,
    conversions,
    conversionsValue,
    ctr: deriveCtr(clicks, impressions),
    avgCpc: deriveAvgCpc(cost, clicks),
    costPerConversion: deriveCostPerConversion(cost, conversions),
    conversionRate: deriveConversionRate(conversions, clicks),
  };
}

/** The campaigns that count as one assignment's — rules 1, 2, then 3. */
export function campaignsFor<T extends { id: number; campaignId: string; accountId: number }>(
  assignment: {
    /** `campaigns.id` values the Manager picked. */
    linkedCampaignPks?: number[] | null;
    linkedCampaignId: string | null;
    accountId: number | null;
  },
  campaigns: T[]
): T[] {
  // Rule 1 is final, including when the picked campaigns are outside the
  // caller's scope and so absent from `campaigns`: an explicit choice that
  // resolves to nothing visible must report nothing, not the whole account.
  if (assignment.linkedCampaignPks && assignment.linkedCampaignPks.length > 0) {
    const wanted = new Set(assignment.linkedCampaignPks);
    return campaigns.filter((c) => wanted.has(c.id));
  }
  if (assignment.linkedCampaignId) {
    const linked = campaigns.filter((c) => c.campaignId === assignment.linkedCampaignId);
    if (linked.length > 0) return linked;
  }
  if (assignment.accountId !== null) {
    return campaigns.filter((c) => c.accountId === assignment.accountId);
  }
  // Neither an account nor a resolvable campaign: nothing to report against.
  return [];
}

export type AssignmentRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  accountId: number | null;
  accountName: string | null;
  specialistId: string | null;
  specialistName: string | null;
  accountManagerName: string | null;
  linkedCampaignId: string | null;
  /** How many campaigns are explicitly linked; 0 means the account stands in. */
  linkedCampaignCount: number;
  /** Null until the Manager approves one at step 10. */
  requiredCpl: number | null;
  requiredLeads: number | null;
  budget: number | null;
  campaignCount: number;
  enabledCampaignCount: number;
  /** Daily budget across the campaigns in scope, as Google Ads holds it. */
  dailyBudget: number;
  pacing: Pacing;
  /** Leads in the window as a fraction of the requirement; null without one. */
  leadProgress: number | null;
  /** When the specialist was put on it, from the event feed. */
  assignedAt: string | null;
  /** Campaign-level attribution, so the campaign table can be built from this. */
  campaignIds: number[];
} & Totals;

export type AssignedCampaignRow = CampaignRow & {
  /** Every assignment this campaign is reported under. Usually exactly one. */
  assignmentIds: string[];
  references: string[];
  specialists: string[];
  /** The strictest CPL any of those assignments carries. */
  requiredCpl: number | null;
  pacing: Pacing;
};

export type AssignedPerformance = {
  assignments: AssignmentRow[];
  /** Every campaign the assignments could draw on, before pacing filtering. */
  catalogue: CampaignRow[];
};

export type AssignedSummary = {
  campaigns: AssignedCampaignRow[];
  totals: Totals & { assignments: number; campaigns: number; accounts: number };
};

/** `BigInt('abc')` throws; a campaign ID typed by hand is not guaranteed numeric. */
function asCampaignId(value: string | null): bigint | null {
  if (!value || !/^\d{1,19}$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function assignedPerformance(params: {
  start: Date;
  end: Date;
  scope: Scope;
  /** Already carries the principal's visibility and the caller's filters. */
  where: Prisma.CrmAdRequestWhereInput;
  campaignStatuses?: string[];
}): Promise<AssignedPerformance> {
  const { start, end, scope, where, campaignStatuses } = params;

  const requests = await prisma.crmAdRequest.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    select: {
      id: true,
      reference: true,
      title: true,
      status: true,
      accountId: true,
      linkedCampaignId: true,
      requiredCpl: true,
      requiredLeads: true,
      budget: true,
      adSpecialist: { select: { id: true, name: true } },
      accountManager: { select: { name: true } },
      account: { select: { descriptive_name: true } },
      campaignLinks: { select: { campaignId: true, campaign: { select: { account_id: true } } } },
    },
  });

  const empty: AssignedPerformance = { assignments: [], catalogue: [] };
  if (requests.length === 0) return empty;

  // ── Which accounts hold the campaigns we need ──────────────────────────────
  const accountIds = new Set<number>();
  for (const r of requests) {
    if (r.accountId !== null) accountIds.add(r.accountId);
    // A linked campaign can sit in an account the request itself is not tied
    // to — the brief was raised before accounts were picked, or the client
    // runs across two. The rollup is fetched per account, so each one has to
    // be in the list or its campaigns come back missing.
    for (const l of r.campaignLinks) accountIds.add(l.campaign.account_id);
  }

  // A request can carry a linked campaign without an account — the campaign ID
  // was typed in at launch and the brief was raised before accounts were
  // picked. Resolve those through the campaign itself, or they report zero.
  const orphanLinks = requests
    .filter((r) => r.accountId === null && r.linkedCampaignId)
    .map((r) => asCampaignId(r.linkedCampaignId))
    .filter((v): v is bigint => v !== null);
  if (orphanLinks.length > 0) {
    const found = await prisma.campaigns.findMany({
      where: { campaign_id: { in: orphanLinks } },
      select: { account_id: true },
    });
    for (const c of found) accountIds.add(c.account_id);
  }

  // The principal's account scope is applied here and not left to the rollup:
  // `visibilityWhere` lets someone see a request they raised even when it
  // points at an account outside their scope, and that must not become a way
  // to read that account's performance.
  const candidates = Array.from(accountIds);
  const allowed =
    scope.accountIds === null
      ? candidates
      : candidates.filter((id) => scope.accountIds!.includes(id));

  // No resolvable account is not the same as no assignment. A request that
  // has just been handed over has an owner, a CPL and a lead target but no
  // campaign yet — dropping it here would empty the page at exactly the
  // moment somebody opens it to check that the handover landed.
  const [campaigns, assignedEvents] = await Promise.all([
    allowed.length === 0
      ? Promise.resolve([] as CampaignRow[])
      : campaignRollup(start, end, { accountIds: allowed }, { statuses: campaignStatuses }),
    prisma.crmAdRequestEvent.groupBy({
      by: ['requestId'],
      where: {
        requestId: { in: requests.map((r) => r.id) },
        toStatus: { in: ['AM_ASSIGNED', 'ACCOUNT_ASSIGNED'] },
      },
      _max: { createdAt: true },
    }),
  ]);
  const assignedAt = new Map(assignedEvents.map((e) => [e.requestId, e._max.createdAt]));

  // ── One row per assignment ─────────────────────────────────────────────────
  const assignments: AssignmentRow[] = requests.map((r) => {
    const requiredCpl = r.requiredCpl === null ? null : Number(r.requiredCpl);
    const linkedCampaignPks = r.campaignLinks.map((l) => l.campaignId);
    const mine = campaignsFor(
      { linkedCampaignPks, linkedCampaignId: r.linkedCampaignId, accountId: r.accountId },
      campaigns
    );
    const totals = sumTotals(mine);
    const specialistName = r.adSpecialist?.name ?? null;

    const when = assignedAt.get(r.id) ?? null;
    return {
      id: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status,
      accountId: r.accountId,
      accountName: r.account?.descriptive_name ?? null,
      specialistId: r.adSpecialist?.id ?? null,
      specialistName,
      accountManagerName: r.accountManager?.name ?? null,
      linkedCampaignId: r.linkedCampaignId,
      linkedCampaignCount: linkedCampaignPks.length,
      requiredCpl,
      requiredLeads: r.requiredLeads,
      budget: r.budget === null ? null : Number(r.budget),
      campaignCount: mine.length,
      enabledCampaignCount: mine.filter((c) => c.status === 'ENABLED').length,
      dailyBudget: round2(mine.reduce((sum, c) => sum + c.budget, 0)),
      pacing: classifyPacing({ ...totals, requiredCpl }),
      leadProgress:
        r.requiredLeads && r.requiredLeads > 0 ? totals.conversions / r.requiredLeads : null,
      assignedAt: when ? when.toISOString() : null,
      campaignIds: mine.map((c) => c.id),
      ...totals,
    };
  });

  return { assignments, catalogue: campaigns };
}

/**
 * The campaign table and the headline totals, both derived from whichever
 * assignments survived filtering — so the tiles always describe the rows on
 * screen rather than a wider set the reader cannot see.
 *
 * Totals are over the distinct campaigns, not a sum of the assignment rows:
 * two assignments on one account would otherwise report that account's spend
 * twice.
 */
export function summarise(
  assignments: AssignmentRow[],
  catalogue: CampaignRow[]
): AssignedSummary {
  // Built from the assignments passed in, never from the wider set, so a
  // campaign never carries a reference to an assignment the filter removed.
  const attribution = new Map<
    number,
    { assignmentIds: string[]; references: string[]; specialists: string[]; cpls: number[] }
  >();
  for (const a of assignments) {
    for (const id of a.campaignIds) {
      const entry =
        attribution.get(id) ?? { assignmentIds: [], references: [], specialists: [], cpls: [] };
      entry.assignmentIds.push(a.id);
      entry.references.push(a.reference);
      if (a.specialistName && !entry.specialists.includes(a.specialistName)) {
        entry.specialists.push(a.specialistName);
      }
      if (a.requiredCpl !== null && a.requiredCpl > 0) entry.cpls.push(a.requiredCpl);
      attribution.set(id, entry);
    }
  }

  const rows: AssignedCampaignRow[] = catalogue
    .filter((c) => attribution.has(c.id))
    .map((c) => {
      const meta = attribution.get(c.id)!;
      // The strictest target the campaign is held to: if two assignments
      // cover it, meeting the looser one is not meeting both.
      const requiredCpl = meta.cpls.length ? Math.min(...meta.cpls) : null;
      return {
        ...c,
        assignmentIds: meta.assignmentIds,
        references: meta.references,
        specialists: meta.specialists,
        requiredCpl,
        pacing: classifyPacing({ cost: c.cost, conversions: c.conversions, requiredCpl }),
      };
    });

  const accounts = new Set(rows.map((c) => c.accountId));
  return {
    campaigns: rows,
    totals: {
      ...sumTotals(rows),
      assignments: assignments.length,
      campaigns: rows.length,
      accounts: accounts.size,
    },
  };
}

// ─── One request, in depth ───────────────────────────────────────────────────

/** How a request's campaign set was arrived at — shown so the page can say. */
export type CampaignBasis = 'LINKED' | 'LEGACY' | 'ACCOUNT' | 'NONE';

export type ResolvedCampaigns = {
  /** `campaigns.id` values, already filtered to the caller's scope. */
  pks: number[];
  basis: CampaignBasis;
};

/**
 * The campaign set behind one request, resolved against the database.
 *
 * Same precedence as `campaignsFor`, but it reads the ids straight from
 * Postgres rather than filtering a pre-fetched catalogue — the per-request
 * page wants only this request's campaigns, and fetching every campaign in
 * the account to throw most of them away would be absurd at 1,100 campaigns.
 *
 * Scope is applied to every branch. A link the caller may not see is dropped
 * rather than refused: a Manager scoped to two accounts should still get a
 * usable page for a request that also touches a third, with the part they may
 * see and nothing more.
 */
export async function resolveRequestCampaigns(
  request: {
    accountId: number | null;
    linkedCampaignId: string | null;
    campaignLinks: Array<{ campaignId: number }>;
  },
  scope: Scope
): Promise<ResolvedCampaigns> {
  const inScope = (ids: number[]) =>
    ids.length === 0
      ? Promise.resolve([] as Array<{ id: number }>)
      : prisma.campaigns.findMany({
          where: {
            id: { in: ids },
            ...(scope.accountIds === null ? {} : { account_id: { in: scope.accountIds } }),
          },
          select: { id: true },
        });

  if (request.campaignLinks.length > 0) {
    const rows = await inScope(request.campaignLinks.map((l) => l.campaignId));
    // LINKED even when scope empties it: the choice was made, and falling
    // through to the account would report campaigns nobody put on this brief.
    return { pks: rows.map((r) => r.id), basis: 'LINKED' };
  }

  const legacy = asCampaignId(request.linkedCampaignId);
  if (legacy !== null) {
    const rows = await prisma.campaigns.findMany({
      where: {
        campaign_id: legacy,
        ...(scope.accountIds === null ? {} : { account_id: { in: scope.accountIds } }),
      },
      select: { id: true },
    });
    if (rows.length > 0) return { pks: rows.map((r) => r.id), basis: 'LEGACY' };
  }

  if (request.accountId !== null) {
    if (scope.accountIds !== null && !scope.accountIds.includes(request.accountId)) {
      return { pks: [], basis: 'NONE' };
    }
    const rows = await prisma.campaigns.findMany({
      where: { account_id: request.accountId },
      select: { id: true },
    });
    return { pks: rows.map((r) => r.id), basis: 'ACCOUNT' };
  }

  return { pks: [], basis: 'NONE' };
}
