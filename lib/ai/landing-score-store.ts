import 'server-only';
import { prisma } from '@/lib/prisma';
import { analyzeLandingPage } from './landing-page';
import { scoreLandingPage } from './landing-quality';

/** Trailing slashes and case differ between what was typed and what was scored. */
export function urlVariants(url: string): string[] {
  const trimmed = url.trim();
  const bare = trimmed.replace(/\/+$/, '');
  // No candidates at all for an empty or slash-only value. Building them
  // anyway yielded `['/']`, which is a real string that could match a
  // stored row and attach a stranger's score to this request.
  if (!bare) return [];
  return Array.from(new Set([trimmed, bare, `${bare}/`]));
}

/**
 * Fetch a page, score it, and keep the result.
 *
 * Shared by the scorer endpoint and the mail path so the two cannot drift:
 * a score taken automatically has to be the same score a person would get
 * by pressing the button.
 *
 * Scoring is deterministic — it fetches the page and runs heuristic checks,
 * with no model call — so it is cheap enough to run unattended. The only
 * cost is one HTTP request to the landing page, already bounded by
 * `LANDING_PAGE_TIMEOUT_SECONDS`.
 */
export async function scoreAndStore(params: {
  url: string;
  requestId: string | null;
  createdById: string;
}): Promise<{ id: string; createdAt: Date; score: number; grade: string } | null> {
  const page = await analyzeLandingPage(params.url);
  if (!page.fetched) return null;

  const score = scoreLandingPage(page);
  if (!score.available) return null;

  const saved = await prisma.crmLandingScore.create({
    data: {
      requestId: params.requestId,
      url: params.url,
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
      createdById: params.createdById,
    },
    select: { id: true, createdAt: true },
  });

  return { id: saved.id, createdAt: saved.createdAt, score: score.score, grade: score.grade };
}

/**
 * Score the page for a request, but only if nobody ever has.
 *
 * Called before a workflow mail goes out, so the brief carries a score
 * rather than an empty panel. Self-limiting: the first mail about a request
 * creates the score and every later one reuses it, so a request costs at
 * most one page fetch however many mails it generates.
 *
 * Never throws. A page that will not load must not stop a notification.
 */
export async function ensureLandingScore(requestId: string): Promise<void> {
  try {
    const request = await prisma.crmAdRequest.findUnique({
      where: { id: requestId },
      select: { landingPageUrl: true, createdById: true },
    });
    if (!request?.landingPageUrl?.trim()) return;

    const already = await prisma.crmLandingScore.findFirst({
      where: {
        OR: [{ requestId }, { url: request.landingPageUrl }],
      },
      select: { id: true },
    });
    if (already) return;

    await scoreAndStore({
      url: request.landingPageUrl,
      requestId,
      createdById: request.createdById,
    });
  } catch (err) {
    console.error('[landing-score] automatic scoring failed', err);
  }
}
