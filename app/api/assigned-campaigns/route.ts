import { z } from 'zod';
import { AdRequestStatus, type Prisma } from '@prisma/client';
import { forbidden, handle, parseQuery, requirePermission } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { hasPermission } from '@/lib/rbac/permissions';
import { visibilityWhere } from '@/lib/workflow/ad-requests';
import {
  assignedPerformance,
  summarise,
  PACING_VALUES,
  type Pacing,
} from '@/lib/ops/assignments';
import { canSeeFinancials, stripMoney } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * Performance for the campaigns handed to an Ad Specialist.
 *
 * Two scopes stack, and both are enforced here rather than by the page:
 *
 *  - **Account scope**, through `resolveFilters`, exactly as every other
 *    reporting endpoint.
 *  - **Whose assignments.** Holding `AD_REQUESTS:ASSIGN` is what makes
 *    somebody responsible for staffing the work, so that is what reveals
 *    everybody's. Without it a user sees the requests they are on: the ones
 *    they build, manage, own or raised.
 */
const schema = z.object({
  /** Comma-separated `AdRequestStatus` values. */
  status: z.string().optional(),
  /** Restrict to one Ad Specialist. */
  specialistId: z.string().trim().min(1).max(64).optional(),
  /** Comma-separated Google Ads campaign statuses, e.g. `ENABLED`. */
  campaignStatus: z.string().optional(),
  pacing: z.enum(PACING_VALUES as [Pacing, ...Pacing[]]).optional(),
  /** Only the requests the caller is personally on. */
  mine: z.enum(['true', 'false']).optional(),
});

/** Google Ads campaign states; anything else is a typo, not a filter. */
const CAMPAIGN_STATUSES = new Set(['ENABLED', 'PAUSED', 'REMOVED', 'UNKNOWN', 'UNSPECIFIED']);

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    // The page reports campaign performance, so it needs the permission that
    // governs campaign performance as well as the one that governs the flow.
    if (!(await hasPermission(principal, 'CAMPAIGNS:VIEW'))) {
      throw forbidden('Seeing assigned campaign performance needs the Campaigns permission.');
    }

    const { start, end, scope, accountId } = await resolveFilters(req, principal);
    const q = parseQuery(req, schema.passthrough());
    const canSeeMoney = await canSeeFinancials(principal);

    // Pacing is a statement about CPL. Offering it to a role that may not see
    // CPL would hand back the comparison we just withheld the figures for.
    if (q.pacing && !canSeeMoney) {
      throw forbidden('Filtering by CPL pacing needs the spend and financial data permission.');
    }

    const canSeeAll = principal.isSuperAdmin || (await hasPermission(principal, 'AD_REQUESTS:ASSIGN'));
    const onlyMine = q.mine === 'true' || !canSeeAll;

    const statuses = q.status
      ? (q.status.split(',').filter((s) => s in AdRequestStatus) as AdRequestStatus[])
      : undefined;
    const campaignStatuses = q.campaignStatus
      ? q.campaignStatus.split(',').filter((s) => CAMPAIGN_STATUSES.has(s))
      : undefined;

    // A user may only ever narrow to themselves; `specialistId` is not a way
    // around the ownership filter above, which stays in the AND either way.
    const mineWhere: Prisma.CrmAdRequestWhereInput = {
      OR: [
        { adSpecialistId: principal.userId },
        { accountManagerId: principal.userId },
        { assignedToId: principal.userId },
        { createdById: principal.userId },
      ],
    };

    const where: Prisma.CrmAdRequestWhereInput = {
      AND: [
        await visibilityWhere(principal),
        // The page is about work that has been handed to somebody. A request
        // still waiting for a specialist belongs on the Ad requests board.
        { adSpecialistId: { not: null } },
        onlyMine ? mineWhere : {},
        q.specialistId ? { adSpecialistId: q.specialistId } : {},
        statuses?.length ? { status: { in: statuses } } : {},
        accountId !== null ? { accountId } : {},
      ],
    };

    const { assignments, catalogue } = await assignedPerformance({
      start,
      end,
      scope,
      where,
      campaignStatuses,
    });

    // Pacing filters the assignments, and the campaign table and tiles are
    // then derived from the survivors — so every number on the page describes
    // the same set of rows.
    const kept = q.pacing ? assignments.filter((a) => a.pacing === q.pacing) : assignments;
    const { campaigns, totals } = summarise(kept, catalogue);

    // The picker is built from the assignments in view rather than the user
    // directory: it needs no USERS:VIEW, and it can only ever offer names the
    // caller is already allowed to see.
    const specialists = Array.from(
      new Map(
        assignments
          .filter((a) => a.specialistId)
          .map((a) => [a.specialistId!, { id: a.specialistId!, name: a.specialistName ?? '—' }])
      ).values()
    ).sort((a, b) => a.name.localeCompare(b.name));

    const statusCounts: Record<string, number> = {};
    for (const a of assignments) statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;

    return {
      canSeeMoney,
      canSeeAll,
      onlyMine,
      specialists,
      statusCounts,
      totals: canSeeMoney ? totals : stripMoney(totals),
      // Pacing is nulled rather than stripped alongside the figures: "over
      // CPL" is a statement about cost per lead, and handing back the verdict
      // after withholding the numbers would defeat the point of withholding
      // them. Lead delivery is not financial, so it survives.
      assignments: kept.map((a) =>
        canSeeMoney
          ? a
          : { ...stripMoney(a), requiredCpl: null, dailyBudget: null, pacing: null }
      ),
      campaigns: campaigns.map((c) =>
        canSeeMoney ? c : { ...stripMoney(c), requiredCpl: null, pacing: null }
      ),
    };
  });
}
