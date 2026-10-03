import 'server-only';
import { SchemaType, type FunctionDeclaration } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/lib/rbac/permissions';
import { hasPermission } from '@/lib/rbac/permissions';
import { canSeeFinancials, stripMoney } from '@/lib/redact';
import { resolveWindow } from '@/lib/ops/dates';
import {
  accountRollup,
  campaignRollup,
  dailySeries,
  deviceBreakdown,
  geoBreakdown,
  keywordRollup,
  searchTermExplore,
  syncHealth,
  windowTotals,
  type Scope,
} from '@/lib/ops/metrics';
import { buildPriorityQueue, evaluateAlerts } from '@/lib/ops/services';
import { assignedPerformance, summarise } from '@/lib/ops/assignments';
import { visibilityWhere } from '@/lib/workflow/ad-requests';
import { STATUS_LABELS } from '@/lib/workflow/state-machine';

/**
 * What the assistant is allowed to do.
 *
 * The model never writes SQL and never touches Prisma. It chooses a function
 * from this menu and supplies arguments; the server runs it under the asking
 * user's Principal. Three properties follow from that, and all three are the
 * reason it is built this way:
 *
 *  1. **It cannot exceed the asker.** Every tool resolves its scope from the
 *     Principal and strips money through `redact.ts`, exactly as the
 *     dashboards do. There is no path that reads an account the user cannot
 *     open, whatever the model is asked to do.
 *  2. **It cannot disagree with the screens.** The figures come from the same
 *     functions in `lib/ops/*` that render the pages, so "what did we spend"
 *     and the Overview tile are the same arithmetic, not two implementations
 *     that drift.
 *  3. **It cannot invent a query.** A question with no matching tool gets
 *     "I cannot answer that", which is worth far more than a confident
 *     number nobody can trace.
 *
 * Every tool is read-only. Nothing here pauses a campaign, moves a request,
 * or changes a budget.
 */

export type ToolContext = {
  principal: Principal;
  scope: Scope;
  canSeeMoney: boolean;
};

/** What a tool call produced, kept so the UI can show its working. */
export type ToolTrace = {
  name: string;
  args: Record<string, unknown>;
  /** A one-line description of what was actually read. */
  summary: string;
  ok: boolean;
};

const STR = SchemaType.STRING;
const NUM = SchemaType.NUMBER;

/** The window arguments every reporting tool accepts. */
const WINDOW_PROPS = {
  days: {
    type: NUM,
    description:
      'Rolling window ending at the most recent fully synced day. 30 if not given. Use 1 for today, 7 for a week, 90 for a quarter.',
  },
  start: { type: STR, description: 'Window start as YYYY-MM-DD. Use with end.' },
  end: { type: STR, description: 'Window end as YYYY-MM-DD. Use with start.' },
  account: {
    type: STR,
    description:
      'Restrict to one Google Ads account, by name or customer id. Omit for every account the user can see.',
  },
} as const;

type WindowArgs = { days?: number; start?: string; end?: string; account?: string };

/**
 * An account named in plain English.
 *
 * The model has no idea what `accounts.id` is, so it passes what the user
 * typed. An exact match wins; otherwise a single substring match is accepted
 * and anything ambiguous is refused with the candidates listed, because
 * silently picking one of four "KAPP Online" accounts would put the wrong
 * client's spend in front of somebody.
 */
async function resolveAccount(
  name: string | undefined,
  scope: Scope
): Promise<{ id: number | null; label: string | null; error?: string }> {
  if (!name?.trim()) return { id: null, label: null };
  const needle = name.trim();
  const where = scope.accountIds === null ? {} : { id: { in: scope.accountIds } };

  const all = await prisma.accounts.findMany({
    where: { ...where, is_manager: false },
    select: { id: true, descriptive_name: true, customer_id: true },
  });

  const digits = needle.replace(/\D/g, '');
  const byId = digits.length >= 8 ? all.find((a) => a.customer_id === digits) : undefined;
  if (byId) return { id: byId.id, label: byId.descriptive_name ?? byId.customer_id };

  const lower = needle.toLowerCase();
  const exact = all.filter((a) => (a.descriptive_name ?? '').toLowerCase() === lower);
  const partial = exact.length
    ? exact
    : all.filter((a) => (a.descriptive_name ?? '').toLowerCase().includes(lower));

  if (partial.length === 1) {
    return { id: partial[0]!.id, label: partial[0]!.descriptive_name ?? partial[0]!.customer_id };
  }
  if (partial.length === 0) {
    return { id: null, label: null, error: `No account matches "${needle}".` };
  }
  return {
    id: null,
    label: null,
    error:
      `"${needle}" matches ${partial.length} accounts: ` +
      `${partial.slice(0, 8).map((a) => a.descriptive_name).join(', ')}. Ask the user which one.`,
  };
}

type ResolveFail = { error: string };
type ResolveOk = {
  start: Date;
  end: Date;
  scope: Scope;
  accountId: number | null;
  accountLabel: string | null;
};

/** Resolve the window and the account into something the helpers accept. */
async function resolveArgs(
  args: WindowArgs,
  ctx: ToolContext
): Promise<ResolveFail | ResolveOk> {
  const account = await resolveAccount(args.account, ctx.scope);
  if (account.error) return { error: account.error };

  const { start, end } = await resolveWindow({
    days: args.start && args.end ? undefined : (args.days ?? 30),
    start: args.start ?? null,
    end: args.end ?? null,
  });

  const scope: Scope =
    account.id !== null ? { accountIds: [account.id] } : { accountIds: ctx.scope.accountIds };

  return { start, end, scope, accountId: account.id, accountLabel: account.label };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtWindow = (start: Date, end: Date) => `${iso(start)} to ${iso(end)}`;

/**
 * Every reporting payload carries the period and the account it covers.
 *
 * Not cosmetic: without it the model states a window from its own sense of
 * the date, and it was confidently reporting a correct ₹9,37,235 over
 * "2025-09-03 to 2025-10-02" when the figures were from 2026. A right number
 * under the wrong period is a wrong answer, and a plausible one.
 */
function envelope(a: ResolveOk, payload: Record<string, unknown>) {
  return {
    window: { start: iso(a.start), end: iso(a.end) },
    account: a.accountLabel ?? 'all accounts this user can see',
    ...payload,
  };
}

/** `accounts.id` -> display name, for rows that carry only the id. */
async function accountNames(ids: number[]): Promise<Map<number, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const rows = await prisma.accounts.findMany({
    where: { id: { in: unique } },
    select: { id: true, descriptive_name: true, customer_id: true },
  });
  return new Map(rows.map((r) => [r.id, r.descriptive_name ?? r.customer_id]));
}

/** Trim a list so a wide table does not eat the model's context. */
function take<T>(rows: T[], limit: number | undefined, fallback = 10): T[] {
  return rows.slice(0, Math.max(1, Math.min(limit ?? fallback, 50)));
}

export type Tool = {
  declaration: FunctionDeclaration;
  /** Module:action the caller must hold on top of ASSISTANT:VIEW. */
  requires: string | null;
  /** True when the tool's output is meaningless without spend figures. */
  needsMoney?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<{ data: unknown; summary: string }>;
};

export const TOOLS: Tool[] = [
  // ── Headline numbers ──────────────────────────────────────────────────────
  {
    declaration: {
      name: 'get_totals',
      description:
        'Headline performance over a window: impressions, clicks, CTR, spend, conversions (leads), cost per lead. Use for "what did we spend", "how many leads", or any single-number question.',
      parameters: { type: SchemaType.OBJECT, properties: { ...WINDOW_PROPS } },
    },
    requires: 'DASHBOARD:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const totals = await windowTotals(a.start, a.end, a.scope);
      return {
        data: envelope(a, { totals: ctx.canSeeMoney ? totals : stripMoney(totals) }),
        summary: `Totals for ${a.accountLabel ?? 'all accounts'}, ${fmtWindow(a.start, a.end)}`,
      };
    },
  },

  {
    declaration: {
      name: 'daily_trend',
      description:
        'Day-by-day clicks, spend and conversions over a window. Use for "trend", "is it going up", "which day was worst".',
      parameters: { type: SchemaType.OBJECT, properties: { ...WINDOW_PROPS } },
    },
    requires: 'DASHBOARD:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const series = await dailySeries(a.start, a.end, a.scope);
      return {
        data: envelope(a, {
          days: ctx.canSeeMoney ? series : series.map((p) => ({ ...p, cost: null, avgCpc: null })),
        }),
        summary: `${series.length} days for ${a.accountLabel ?? 'all accounts'}, ${fmtWindow(a.start, a.end)}`,
      };
    },
  },

  // ── Rankings ──────────────────────────────────────────────────────────────
  {
    declaration: {
      name: 'list_accounts',
      description:
        'Performance per Google Ads account, ranked by spend. Use for "which accounts", "top accounts", "how is each client doing".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ...WINDOW_PROPS,
          limit: { type: NUM, description: 'How many to return. Default 10, max 50.' },
        },
      },
    },
    requires: 'ACCOUNTS:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const rows = await accountRollup(a.start, a.end, a.scope);
      const out = take(rows, raw.limit as number | undefined);
      return {
        data: envelope(a, {
          returned: out.length,
          totalMatching: rows.length,
          accounts: ctx.canSeeMoney ? out : out.map(stripMoney),
        }),
        summary: `${out.length} of ${rows.length} accounts, ${fmtWindow(a.start, a.end)}`,
      };
    },
  },

  {
    declaration: {
      name: 'list_campaigns',
      description:
        'Performance per campaign, ranked by spend. Use for "which campaigns", "top campaigns", "campaigns with no conversions" (then filter the result yourself), or to look up one campaign by name.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ...WINDOW_PROPS,
          search: { type: STR, description: 'Only campaigns whose name contains this.' },
          status: {
            type: STR,
            description: 'Comma-separated Google Ads statuses, e.g. ENABLED or ENABLED,PAUSED.',
          },
          maxConversions: {
            type: NUM,
            description:
              'At most this many conversions. Pass 0 for "campaigns with no conversions" — do not filter the results yourself, the counts would be wrong.',
          },
          minCost: { type: NUM, description: 'Minimum spend, to ignore trivial campaigns.' },
          limit: { type: NUM, description: 'How many to return. Default 10, max 50.' },
        },
      },
    },
    requires: 'CAMPAIGNS:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const all = await campaignRollup(a.start, a.end, a.scope, {
        accountId: a.accountId,
        search: (raw.search as string) ?? null,
        statuses: raw.status ? String(raw.status).split(',') : undefined,
      });
      // Filtered here, not by the model: it only ever sees the top slice, so
      // counting matches itself would under-report every time.
      const maxConv = raw.maxConversions === undefined ? null : Number(raw.maxConversions);
      const minCost = raw.minCost === undefined ? null : Number(raw.minCost);
      const rows = all.filter(
        (c) =>
          (maxConv === null || c.conversions <= maxConv) &&
          (minCost === null || c.cost >= minCost)
      );
      const out = take(rows, raw.limit as number | undefined);
      return {
        data: envelope(a, {
          returned: out.length,
          totalMatching: rows.length,
          campaigns: ctx.canSeeMoney ? out : out.map(stripMoney),
        }),
        summary: `${out.length} of ${rows.length} campaigns, ${fmtWindow(a.start, a.end)}`,
      };
    },
  },

  {
    declaration: {
      name: 'list_keywords',
      description:
        'Keyword performance with Quality Score. Use for "worst keywords", "low quality score", "which keywords cost the most".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ...WINDOW_PROPS,
          search: { type: STR, description: 'Only keywords whose text contains this.' },
          limit: { type: NUM, description: 'How many to return. Default 15, max 50.' },
        },
      },
    },
    requires: 'KEYWORDS:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const rows = await keywordRollup(a.start, a.end, a.scope, {
        accountId: a.accountId,
        search: (raw.search as string) ?? null,
        limit: 500,
      });
      const sorted = [...rows].sort((x, y) =>
        ctx.canSeeMoney ? y.cost - x.cost : y.clicks - x.clicks
      );
      const out = take(sorted, raw.limit as number | undefined, 15);
      return {
        data: envelope(a, {
          returned: out.length,
          totalMatching: rows.length,
          keywords: ctx.canSeeMoney ? out : out.map(stripMoney),
        }),
        summary: `${out.length} of ${rows.length} keywords, ${fmtWindow(a.start, a.end)}`,
      };
    },
  },

  {
    declaration: {
      name: 'explore_search_terms',
      description:
        'The queries people actually typed. Use for "wasted spend", "search terms with no conversions", "what are we showing for". Set minClicks to find terms worth acting on.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ...WINDOW_PROPS,
          contains: { type: STR, description: 'Only terms containing this text.' },
          minClicks: { type: NUM, description: 'Minimum clicks. Use 10+ to find real waste.' },
          maxConversions: {
            type: NUM,
            description:
              'At most this many conversions. Pass 0 for "no conversions" or "wasted spend" — do not filter the results yourself, the counts would be wrong.',
          },
          limit: { type: NUM, description: 'How many to return. Default 15, max 50.' },
        },
      },
    },
    requires: 'KEYWORDS:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const { rows, total } = await searchTermExplore({
        start: a.start,
        end: a.end,
        scope: a.scope,
        accountId: a.accountId,
        contains: (raw.contains as string) ?? null,
        minClicks: (raw.minClicks as number) ?? 0,
        maxConversions:
          raw.maxConversions === undefined ? null : Number(raw.maxConversions),
        limit: Math.min((raw.limit as number) ?? 15, 50),
      });
      // Swap the internal account id for its name. The model will print
      // whatever it is given, and "Account ID 55" in an answer is both
      // meaningless to the reader and a detail of our schema.
      const names = await accountNames(rows.map((r) => r.accountId));
      const named = rows.map(({ accountId, ...rest }) => ({
        ...rest,
        account: names.get(accountId) ?? null,
      }));
      return {
        data: envelope(a, {
          returned: named.length,
          totalMatching: total,
          searchTerms: ctx.canSeeMoney ? named : named.map(stripMoney),
        }),
        summary: `${rows.length} of ${total} search terms, ${fmtWindow(a.start, a.end)}`,
      };
    },
  },

  {
    declaration: {
      name: 'segment_breakdown',
      description:
        'Performance split by device (mobile/desktop/tablet) or by location. Use for "mobile vs desktop", "which states convert".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ...WINDOW_PROPS,
          by: { type: STR, description: 'Either "device" or "geo".' },
        },
        required: ['by'],
      },
    },
    requires: 'CAMPAIGNS:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const by = String(raw.by ?? 'device').toLowerCase();
      const rows =
        by === 'geo'
          ? await geoBreakdown(a.start, a.end, a.scope, a.accountId)
          : await deviceBreakdown(a.start, a.end, a.scope, a.accountId);
      const out = take(rows, 20, 20);
      return {
        data: envelope(a, { by, segments: ctx.canSeeMoney ? out : out.map(stripMoney) }),
        summary: `${by} breakdown, ${fmtWindow(a.start, a.end)}`,
      };
    },
  },

  // ── What needs attention ──────────────────────────────────────────────────
  {
    declaration: {
      name: 'priority_queue',
      description:
        'Campaigns ranked by how badly they need attention, with the reason and estimated wasted spend. Use for "what should I look at", "what needs attention today".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          account: WINDOW_PROPS.account,
          limit: { type: NUM, description: 'How many to return. Default 10, max 50.' },
        },
      },
    },
    requires: 'CAMPAIGNS:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const queue = await buildPriorityQueue({ scope: a.scope, limit: 50 });
      const rows = take(queue.rows, raw.limit as number | undefined).map((r) => ({
        campaign: r.name,
        account: r.accountName,
        score: r.score,
        level: r.level,
        reason: r.primaryReason,
        estimatedWastedSpend: ctx.canSeeMoney ? r.priority.estimatedWastedSpend : null,
      }));
      return {
        data: {
          referenceDate: queue.referenceDate,
          account: a.accountLabel ?? 'all accounts this user can see',
          rows,
        },
        summary: `${rows.length} campaigns needing attention, as of ${queue.referenceDate}`,
      };
    },
  },

  {
    declaration: {
      name: 'list_alerts',
      description:
        'Day-over-day alerts: spend spikes, conversion collapses, budget exhaustion, disapproved ads. Use for "any problems", "what broke", "alerts".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: { account: WINDOW_PROPS.account },
      },
    },
    requires: 'DASHBOARD:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const { alerts, referenceDate } = await evaluateAlerts({ scope: a.scope });
      const rows = alerts.slice(0, 40).map((x) => ({
        severity: x.severity,
        entity: x.entityName,
        account: x.accountName,
        title: x.title,
        detail: x.detail,
      }));
      return {
        data: {
          referenceDate,
          account: a.accountLabel ?? 'all accounts this user can see',
          count: alerts.length,
          alerts: rows,
        },
        summary: `${alerts.length} alert(s) as of ${referenceDate}`,
      };
    },
  },

  // ── The CRM workflow ──────────────────────────────────────────────────────
  {
    declaration: {
      name: 'assigned_work',
      description:
        'Ad requests assigned to an Ad Specialist, with delivery against the approved CPL and lead targets. Use for "what is assigned to X", "who is behind", "which assignments are over CPL".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ...WINDOW_PROPS,
          specialist: { type: STR, description: "Filter to one Ad Specialist's name." },
        },
      },
    },
    requires: 'AD_REQUESTS:VIEW',
    run: async (raw, ctx) => {
      const a = await resolveArgs(raw as WindowArgs, ctx);
      if ('error' in a) return { data: { error: a.error }, summary: a.error };
      const { assignments, catalogue } = await assignedPerformance({
        start: a.start,
        end: a.end,
        scope: a.scope,
        where: {
          AND: [
            await visibilityWhere(ctx.principal),
            { adSpecialistId: { not: null } },
            a.accountId !== null ? { accountId: a.accountId } : {},
          ],
        },
      });
      const needle = (raw.specialist as string | undefined)?.trim().toLowerCase();
      const kept = needle
        ? assignments.filter((x) => (x.specialistName ?? '').toLowerCase().includes(needle))
        : assignments;
      const { totals } = summarise(kept, catalogue);
      const rows = kept.slice(0, 30).map((x) => ({
        reference: x.reference,
        title: x.title,
        status: STATUS_LABELS[x.status as keyof typeof STATUS_LABELS] ?? x.status,
        specialist: x.specialistName,
        account: x.accountName,
        campaigns: x.campaignCount,
        linkedCampaigns: x.linkedCampaignCount,
        leads: x.conversions,
        requiredLeads: x.requiredLeads,
        spend: ctx.canSeeMoney ? x.cost : null,
        costPerLead: ctx.canSeeMoney ? x.costPerConversion : null,
        requiredCpl: ctx.canSeeMoney ? x.requiredCpl : null,
        pacing: ctx.canSeeMoney ? x.pacing : null,
      }));
      return {
        data: envelope(a, {
          totals: ctx.canSeeMoney ? totals : stripMoney(totals),
          assignments: rows,
        }),
        summary: `${rows.length} assignment(s), ${fmtWindow(a.start, a.end)}`,
      };
    },
  },

  {
    declaration: {
      name: 'find_ad_request',
      description:
        'Look up ad requests by reference (AR-0001), title, or status. Use for "where is AR-0001", "what is waiting for approval", "show me rejected requests".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          search: { type: STR, description: 'Reference or words from the title.' },
          status: {
            type: STR,
            description:
              'Comma-separated statuses: DRAFT, SUBMITTED, AWAITING_AM_ASSIGNMENT, AWAITING_AD_SUBMISSION, UNDER_REVIEW, RECHECK_REQUESTED, REVIEW_APPROVED, BUDGET_APPROVED, ACCOUNT_ASSIGNED, LIVE, COMPLETED, REJECTED.',
          },
          limit: { type: NUM, description: 'How many to return. Default 10, max 50.' },
        },
      },
    },
    requires: 'AD_REQUESTS:VIEW',
    run: async (raw, ctx) => {
      const search = (raw.search as string | undefined)?.trim();
      const statuses = raw.status
        ? String(raw.status)
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v in STATUS_LABELS)
        : [];
      const rows = await prisma.crmAdRequest.findMany({
        where: {
          AND: [
            await visibilityWhere(ctx.principal),
            statuses.length ? { status: { in: statuses as never[] } } : {},
            search
              ? {
                  OR: [
                    { reference: { contains: search, mode: 'insensitive' } },
                    { title: { contains: search, mode: 'insensitive' } },
                    { productService: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {},
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.min((raw.limit as number) ?? 10, 50),
        select: {
          reference: true,
          title: true,
          status: true,
          updatedAt: true,
          requiredLeads: true,
          requiredCpl: true,
          decisionReason: true,
          account: { select: { descriptive_name: true } },
          createdBy: { select: { name: true } },
          adSpecialist: { select: { name: true } },
          accountManager: { select: { name: true } },
          _count: { select: { campaignLinks: true } },
        },
      });
      return {
        data: rows.map((r) => ({
          reference: r.reference,
          title: r.title,
          status: STATUS_LABELS[r.status] ?? r.status,
          account: r.account?.descriptive_name ?? null,
          raisedBy: r.createdBy.name,
          adSpecialist: r.adSpecialist?.name ?? null,
          manager: r.accountManager?.name ?? null,
          linkedCampaigns: r._count.campaignLinks,
          requiredLeads: r.requiredLeads,
          requiredCpl: ctx.canSeeMoney && r.requiredCpl ? Number(r.requiredCpl) : null,
          lastUpdated: r.updatedAt.toISOString().slice(0, 10),
          note: r.decisionReason,
        })),
        summary: `${rows.length} ad request(s)`,
      };
    },
  },

  // ── Is the data even current ──────────────────────────────────────────────
  {
    declaration: {
      name: 'data_freshness',
      description:
        'When the Google Ads data was last synced and how far back it goes. Use whenever the user doubts a number, or asks "is this up to date".',
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    requires: null,
    run: async () => {
      const health = await syncHealth();
      const span = await prisma.$queryRaw<Array<{ lo: Date | null; hi: Date | null }>>`
        SELECT MIN(snapshot_date) AS lo, MAX(snapshot_date) AS hi FROM campaign_snapshots
      `;
      const lo = span[0]?.lo?.toISOString().slice(0, 10) ?? null;
      const hi = span[0]?.hi?.toISOString().slice(0, 10) ?? null;
      return {
        data: { ...health, earliestData: lo, latestData: hi },
        summary: `Data spans ${lo} to ${hi}`,
      };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.declaration.name, t]));

/**
 * The tools this particular user may call.
 *
 * Filtered before the model ever sees them, so it cannot be talked into
 * calling something the asker is not entitled to: a tool that is absent
 * cannot be invoked by any prompt.
 */
export async function toolsFor(principal: Principal): Promise<Tool[]> {
  const allowed: Tool[] = [];
  const canSeeMoney = await canSeeFinancials(principal);
  for (const tool of TOOLS) {
    if (tool.needsMoney && !canSeeMoney) continue;
    if (tool.requires && !(await hasPermission(principal, tool.requires))) continue;
    allowed.push(tool);
  }
  return allowed;
}

export function findTool(name: string): Tool | undefined {
  return BY_NAME.get(name);
}
