import { z } from 'zod';
import { ApiError, clientIp, handle, parseBody, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canSeeFinancials } from '@/lib/redact';
import {
  MAX_SEEDS,
  generateKeywordIdeas,
  takeSearchSlot,
  type KeywordIdea,
} from '@/lib/google-ads/keyword-ideas';

export const dynamic = 'force-dynamic';
// A seed list can take Google the better part of a minute to come back on.
export const maxDuration = 120;

/**
 * POST, not GET, because the seed list is user text of unbounded length and
 * a research query does not belong in a URL that lands in server logs.
 */
const schema = z
  .object({
    keywords: z.array(z.string().min(1).max(80)).max(MAX_SEEDS).optional(),
    pageUrl: z
      .string()
      .trim()
      .max(2048)
      // `.url()` alone is not enough: `javascript:alert(1)` is a perfectly
      // valid URL by the spec, and this value is echoed back into the page
      // and written to the audit log. Only the two schemes Google will
      // actually fetch are accepted.
      .refine(
        (v) => /^https?:\/\//i.test(v),
        'Give a full web address, starting with http:// or https://'
      )
      .optional()
      .or(z.literal('')),
    geoTargetIds: z.array(z.string().regex(/^\d{3,12}$/)).min(1).max(10),
    languageId: z.string().regex(/^\d{3,6}$/),
  })
  // Caught here rather than in the library so it comes back as a 400 the
  // form can show, not a 500 that reads as the server having fallen over.
  .refine((v) => (v.keywords?.length ?? 0) > 0 || Boolean(v.pageUrl), {
    message: 'Give at least one seed keyword, or a page to read them from.',
    path: ['keywords'],
  });

/** Bid estimates are money, and money is its own permission. */
function stripBids(idea: KeywordIdea): KeywordIdea {
  return { ...idea, lowTopOfPageBid: null, highTopOfPageBid: null };
}

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('KEYWORD_PLANNER', 'VIEW');
    const body = await parseBody(req, schema);

    const wait = takeSearchSlot(principal.userId);
    if (wait !== null) {
      throw new ApiError(
        429,
        `That is a lot of searches. The planner shares its daily quota with the nightly sync, ` +
          `so this one is held for ${Math.ceil(wait / 60)} more minute(s).`
      );
    }

    const { ideas, customerId } = await generateKeywordIdeas({
      keywords: body.keywords ?? [],
      pageUrl: body.pageUrl || null,
      geoTargetIds: body.geoTargetIds,
      languageId: body.languageId,
      scopeAccountIds: principal.allowedAccountIds,
    });

    const canSeeMoney = await canSeeFinancials(principal);

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'KEYWORDS_RESEARCHED',
      description: `Keyword research: ${
        body.keywords?.length ? body.keywords.slice(0, 5).join(', ') : body.pageUrl
      } — ${ideas.length} idea(s)`,
      targetType: 'keyword_planner',
      metadata: {
        seeds: body.keywords ?? [],
        pageUrl: body.pageUrl || null,
        geoTargetIds: body.geoTargetIds,
        languageId: body.languageId,
        results: ideas.length,
        // Which account's quota paid for it — the question asked when the
        // sync starts failing on RESOURCE_EXHAUSTED.
        customerId,
      },
      ipAddress: clientIp(req),
    });

    return {
      ideas: canSeeMoney ? ideas : ideas.map(stripBids),
      canSeeMoney,
      total: ideas.length,
    };
  });
}
