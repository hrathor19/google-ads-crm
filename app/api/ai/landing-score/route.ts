import { badRequest, clientIp, handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { analyzeLandingPage } from '@/lib/ai/landing-page';
import { scoreLandingPage } from '@/lib/ai/landing-quality';
import { landingScoreSchema } from '@/lib/ai/schemas';
import { assertVisible } from '@/lib/workflow/ad-requests';

export const dynamic = 'force-dynamic';
// The scorer fetches the page and probes up to 15 links.
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('LANDING_SCORE', 'GENERATE_AI');
    const body = await parseBody(req, landingScoreSchema);

    if (body.requestId) {
      const row = await prisma.crmAdRequest.findUnique({
        where: { id: body.requestId },
        select: { accountId: true, createdById: true, assignedToId: true },
      });
      if (!row) throw notFound('Ad request not found.');
      await assertVisible(principal, row);
    }

    const page = await analyzeLandingPage(body.url);
    if (!page.fetched) {
      throw badRequest(page.notes ?? 'That page could not be fetched.');
    }

    const score = scoreLandingPage(page);
    if (!score.available) throw badRequest('That page could not be scored.');

    const saved = await prisma.crmLandingScore.create({
      data: {
        requestId: body.requestId ?? null,
        url: body.url,
        score: score.score,
        grade: score.grade,
        pageType: score.pageType,
        passed: score.passed,
        maxPoints: score.max,
        checks: score.checks,
        categories: JSON.parse(JSON.stringify(score.categories)),
        suggestions: score.suggestions,
        tracking: page.tracking ? JSON.parse(JSON.stringify(page.tracking)) : undefined,
        links: {
          external: score.externalLinks,
          externalCount: score.externalLinkCount,
          broken: score.brokenLinks,
          checked: score.linksChecked,
        },
        createdById: principal.userId,
      },
      select: { id: true, createdAt: true },
    });

    if (body.requestId) {
      await prisma.crmAdRequestEvent.create({
        data: {
          requestId: body.requestId,
          type: 'LANDING_SCORED',
          message: `${principal.email} scored the landing page: ${score.score}/100 (grade ${score.grade}).`,
          actorId: principal.userId,
        },
      });
    }

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'LANDING_PAGE_SCORED',
      description: `Scored ${body.url}: ${score.score}/100 (${score.grade})`,
      targetType: body.requestId ? 'CrmAdRequest' : undefined,
      targetId: body.requestId ?? undefined,
      ipAddress: clientIp(req),
    });

    return {
      id: saved.id,
      createdAt: saved.createdAt,
      url: body.url,
      ...score,
      tracking: page.tracking ?? null,
      technical: {
        loadMs: page.load_ms ?? null,
        hasViewport: page.has_viewport ?? false,
        hasForm: page.has_form ?? false,
        hasPrivacy: page.has_privacy ?? false,
        hasTerms: page.has_terms ?? false,
      },
    };
  });
}

/** Score history, most recent first. */
export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('LANDING_SCORE', 'VIEW');
    const url = new URL(req.url);
    const requestId = url.searchParams.get('requestId');

    const rows = await prisma.crmLandingScore.findMany({
      where: requestId ? { requestId } : { createdById: principal.userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        url: true,
        score: true,
        grade: true,
        pageType: true,
        passed: true,
        maxPoints: true,
        categories: true,
        suggestions: true,
        checks: true,
        tracking: true,
        links: true,
        createdAt: true,
        createdBy: { select: { name: true, email: true } },
      },
    });
    return { rows };
  });
}
