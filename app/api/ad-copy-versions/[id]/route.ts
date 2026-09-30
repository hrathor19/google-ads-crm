import { z } from 'zod';
import { handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { H_MAX, D_MAX, validateAssets } from '@/lib/ai/rsa-validator';
import { assertVisible } from '@/lib/workflow/ad-requests';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  headlines: z.array(z.object({ text: z.string().trim().min(1).max(200) })).optional(),
  descriptions: z.array(z.object({ text: z.string().trim().min(1).max(400) })).optional(),
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
        request: { select: { accountId: true, createdById: true, assignedToId: true } },
      },
    });
    if (!version) throw notFound('That ad copy version does not exist.');
    await assertVisible(principal, version.request);

    const headlines = body.headlines ?? (version.headlines as Array<{ text: string }>);
    const descriptions = body.descriptions ?? (version.descriptions as Array<{ text: string }>);

    const validation = validateAssets({
      headlines: headlines.map((h) => h.text),
      descriptions: descriptions.map((d) => d.text),
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
      return tx.crmAdCopyVersion.update({
        where: { id: params.id },
        data: {
          headlines: headlines.map((h) => ({ text: h.text, characters: h.text.length })),
          descriptions: descriptions.map((d) => ({ text: d.text, characters: d.text.length })),
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
          message: `${principal.email} marked ad copy v${version.version} as final.`,
          actorId: principal.userId,
        },
      });
    }

    return { version: updated, validation, limits: { headline: H_MAX, description: D_MAX } };
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
