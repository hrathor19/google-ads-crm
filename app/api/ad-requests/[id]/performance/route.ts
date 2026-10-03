import { handle, notFound, prisma, requirePermission, forbidden } from '@/lib/api';
import { resolveFilters } from '@/lib/api-filters';
import { hasPermission } from '@/lib/rbac/permissions';
import { assertVisible } from '@/lib/workflow/ad-requests';
import { classifyPacing, resolveRequestCampaigns, sumTotals } from '@/lib/ops/assignments';
import {
  adGroupRollup,
  campaignRollup,
  dailySeries,
  keywordRollup,
  searchTermExplore,
} from '@/lib/ops/metrics';
import { canSeeFinancials, stripMoney } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/** Enough rows to find the problem, few enough to render. */
const DEEP_LIMIT = 50;

/**
 * Everything one request's campaigns did over the window.
 *
 * The Assigned campaigns page answers "which assignments are in trouble";
 * this answers "why", for one of them — the same campaign set, taken down
 * through ad groups, keywords and the search terms that actually triggered
 * the ads, so the Ad Specialist can act without re-deriving the filter on
 * four other screens.
 *
 * Every section is scoped to the resolved campaign set rather than to the
 * account, so a brief running 3 of an account's 40 campaigns reports on 3.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    if (!(await hasPermission(principal, 'CAMPAIGNS:VIEW'))) {
      throw forbidden('Seeing campaign performance needs the Campaigns permission.');
    }

    const request = await prisma.crmAdRequest.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        reference: true,
        accountId: true,
        linkedCampaignId: true,
        createdById: true,
        assignedToId: true,
        requiredCpl: true,
        requiredLeads: true,
        campaignLinks: { select: { campaignId: true } },
      },
    });
    if (!request) throw notFound('Ad request not found.');
    await assertVisible(principal, request);

    const { start, end, scope } = await resolveFilters(req, principal);
    const canSeeMoney = await canSeeFinancials(principal);
    const { pks, basis } = await resolveRequestCampaigns(request, scope);

    const requiredCpl = request.requiredCpl === null ? null : Number(request.requiredCpl);
    const empty = {
      basis,
      canSeeMoney,
      requiredCpl: canSeeMoney ? requiredCpl : null,
      requiredLeads: request.requiredLeads,
      campaignCount: 0,
      totals: sumTotals([]),
      pacing: null as string | null,
      leadProgress: null as number | null,
      series: [],
      campaigns: [],
      adGroups: [],
      keywords: [],
      searchTerms: [],
    };
    if (pks.length === 0) return empty;

    // One window, five groupings. Issued together because none depends on
    // another's result and the page shows them on one screen.
    const [campaigns, series, adGroups, keywords, terms] = await Promise.all([
      campaignRollup(start, end, scope, { campaignPks: pks }),
      dailySeries(start, end, scope, { campaignPks: pks }),
      adGroupRollup(start, end, scope, { campaignPks: pks }),
      keywordRollup(start, end, scope, { campaignPks: pks, limit: DEEP_LIMIT }),
      searchTermExplore({ start, end, scope, campaignPks: pks, limit: DEEP_LIMIT }),
    ]);

    const totals = sumTotals(campaigns);
    const body = {
      basis,
      canSeeMoney,
      requiredCpl,
      requiredLeads: request.requiredLeads,
      campaignCount: campaigns.length,
      totals,
      pacing: classifyPacing({ ...totals, requiredCpl }),
      leadProgress:
        request.requiredLeads && request.requiredLeads > 0
          ? totals.conversions / request.requiredLeads
          : null,
      series,
      campaigns,
      adGroups,
      // The two deep lists are ranked by what they cost, so the first screen
      // is the money. Without spend there is nothing to rank by, so they fall
      // back to clicks rather than returning an arbitrary order.
      keywords: [...keywords]
        .sort((a, b) => (canSeeMoney ? b.cost - a.cost : b.clicks - a.clicks))
        .slice(0, DEEP_LIMIT),
      searchTerms: terms.rows,
    };

    if (canSeeMoney) return body;
    return {
      ...body,
      requiredCpl: null,
      pacing: null,
      totals: stripMoney(totals),
      series: body.series.map((p) => ({ ...p, cost: null, avgCpc: null })),
      campaigns: body.campaigns.map(stripMoney),
      adGroups: body.adGroups.map(stripMoney),
      keywords: body.keywords.map(stripMoney),
      searchTerms: body.searchTerms.map(stripMoney),
    };
  });
}
