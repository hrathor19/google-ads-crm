import { z } from 'zod';
import { handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import {
  D_MAX,
  H_MAX,
  SITELINK_DESC_MAX,
  SITELINK_TEXT_MAX,
  validateAssets,
  type Sitelink,
} from '@/lib/ai/rsa-validator';
import { keywordTextOf, type KeywordVolume } from '@/lib/ai/keyword-csv';
import { subjectOf } from '@/lib/ai/ad-copy';
import { assertVisible } from '@/lib/workflow/ad-requests';
import { actorLabel } from '@/lib/rbac/permissions';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  headlines: z.array(z.object({ text: z.string().trim().min(1).max(200) })).optional(),
  descriptions: z.array(z.object({ text: z.string().trim().min(1).max(400) })).optional(),
  sitelinks: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(200),
        description1: z.string().trim().max(200),
        description2: z.string().trim().max(200),
      })
    )
    .max(20)
    .optional(),
  isFinal: z.boolean().optional(),
});

/** Edit a saved version's copy, or mark it final. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_COPY', 'EDIT');
    const body = await parseBody(req, patchSchema);

    const version = await prisma.crmAdCopyVersion.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        version: true,
        requestId: true,
        headlines: true,
        descriptions: true,
        sitelinks: true,
        keywords: true,
        excludedTerms: true,
        request: {
          select: {
            accountId: true,
            createdById: true,
            assignedToId: true,
            title: true,
            productService: true,
          },
        },
      },
    });
    if (!version) throw notFound('That ad copy version does not exist.');
    await assertVisible(principal, version.request);

    const headlines = body.headlines ?? (version.headlines as Array<{ text: string }>);
    const descriptions = body.descriptions ?? (version.descriptions as Array<{ text: string }>);
    const sitelinks = body.sitelinks ?? ((version.sitelinks as Sitelink[] | null) ?? []);
    const researched = (version.keywords as KeywordVolume[] | null) ?? [];
    const excludedTerms = (version.excludedTerms as string[] | null) ?? [];

    const validation = validateAssets({
      headlines: headlines.map((h) => h.text),
      descriptions: descriptions.map((d) => d.text),
      sitelinks,
      keywordThemes: researched.map((k) => k.keyword),
      // Editing a headline can be what removes the college's name from the
      // last one carrying it, so the check has to run on the edit too.
      subject: subjectOf({
        product: version.request.productService,
        institution: version.request.title,
      }),
      // Re-checked on every edit, so typing "Low Fees" back into a headline
      // is refused rather than quietly accepted.
      excludedTerms,
    });

    const updated = await prisma.$transaction(async (tx) => {
      // At most one final version per request — a second "final" would leave
      // the Ads team with no answer to "which copy is live?".
      if (body.isFinal) {
        await tx.crmAdCopyVersion.updateMany({
          where: { requestId: version.requestId, NOT: { id: version.id } },
          data: { isFinal: false },
        });
      }
      // Marking a version final is the act of submitting the ad copy, and
      // the keywords it was written from are half of that submission. The
      // request's keyword field is what the review mail and the brief read,
      // so without this the reviewer approves copy whose keywords they never
      // saw — and the Ads person retypes a list they already uploaded.
      if (body.isFinal && researched.length > 0) {
        await tx.crmAdRequest.update({
          where: { id: version.requestId },
          data: { keywords: keywordTextOf(researched) },
        });
      }

      return tx.crmAdCopyVersion.update({
        where: { id: params.id },
        data: {
          headlines: headlines.map((h) => ({ text: h.text, characters: h.text.length })),
          descriptions: descriptions.map((d) => ({ text: d.text, characters: d.text.length })),
          sitelinks,
          validation: JSON.parse(JSON.stringify(validation)),
          ...(body.isFinal !== undefined && { isFinal: body.isFinal }),
        },
      });
    });

    if (body.isFinal) {
      await prisma.crmAdRequestEvent.create({
        data: {
          requestId: version.requestId,
          type: 'AD_COPY_GENERATED',
          message:
            `${actorLabel(principal)} marked ad copy v${version.version} as final` +
            (researched.length > 0
              ? ` and set the request's ${researched.length} researched keyword(s).`
              : '.'),
          actorId: principal.userId,
        },
      });
    }

    return {
      version: updated,
      validation,
      limits: {
        headline: H_MAX,
        description: D_MAX,
        sitelinkText: SITELINK_TEXT_MAX,
        sitelinkDescription: SITELINK_DESC_MAX,
      },
    };
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const principal = await requirePermission('AD_COPY', 'DELETE');
    const version = await prisma.crmAdCopyVersion.findUnique({
      where: { id: params.id },
      select: { request: { select: { accountId: true, createdById: true, assignedToId: true } } },
    });
    if (!version) throw notFound('That ad copy version does not exist.');
    await assertVisible(principal, version.request);

    await prisma.crmAdCopyVersion.delete({ where: { id: params.id } });
    return { ok: true };
  });
}
