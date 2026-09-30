import { clientIp, handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { generateAdCopy } from '@/lib/ai/ad-copy';
import { generateCopySchema } from '@/lib/ai/schemas';
import { validateAssets } from '@/lib/ai/rsa-validator';
import { assertVisible } from '@/lib/workflow/ad-requests';
import { parseKeywordLines } from '@/lib/workflow/schemas';

export const dynamic = 'force-dynamic';
// Fetching the landing page then calling the model comfortably exceeds the
// default budget on a cold start.
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('AD_COPY', 'GENERATE_AI');
    const body = await parseBody(req, generateCopySchema);

    // A brief either comes from a request (the normal flow, where the Ads team
    // works inside the request screen) or straight from the standalone tool.
    let brief;
    let request: { id: string; reference: string } | null = null;

    if (body.requestId) {
      const row = await prisma.crmAdRequest.findUnique({
        where: { id: body.requestId },
        select: {
          id: true,
          reference: true,
          productService: true,
          objective: true,
          targetAudience: true,
          location: true,
          landingPageUrl: true,
          usps: true,
          keywords: true,
          notes: true,
          accountId: true,
          createdById: true,
          assignedToId: true,
          account: { select: { descriptive_name: true } },
        },
      });
      if (!row) throw notFound('Ad request not found.');
      await assertVisible(principal, row);
      request = { id: row.id, reference: row.reference };

      brief = {
        product: row.productService,
        brand: row.account?.descriptive_name ?? null,
        objective: row.objective,
        targetAudience: row.targetAudience,
        location: row.location,
        landingPageUrl: row.landingPageUrl,
        usps: row.usps,
        keywords: parseKeywordLines(row.keywords),
        notes: row.notes,
        tone: body.tone,
      };
    } else {
      if (!body.product || !body.landingPageUrl) {
        throw notFound('Provide a product and a landing page URL, or a request id.');
      }
      brief = {
        product: body.product,
        brand: body.brand ?? null,
        objective: body.objective ?? 'LEAD_GENERATION',
        targetAudience: body.targetAudience ?? 'General audience',
        location: body.location ?? 'India',
        landingPageUrl: body.landingPageUrl,
        usps: body.usps ?? null,
        keywords: body.keywords ?? [],
        notes: body.notes ?? null,
        tone: body.tone,
      };
    }

    const result = await generateAdCopy(brief);

    let savedVersion: { id: string; version: number } | null = null;
    if (body.save && request) {
      const last = await prisma.crmAdCopyVersion.findFirst({
        where: { requestId: request.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      savedVersion = await prisma.crmAdCopyVersion.create({
        data: {
          requestId: request.id,
          version: (last?.version ?? 0) + 1,
          tone: body.tone,
          headlines: result.headlines,
          descriptions: result.descriptions,
          validation: JSON.parse(JSON.stringify(result.validation)),
          backend: result.backend,
          createdById: principal.userId,
        },
        select: { id: true, version: true },
      });
      await prisma.crmAdRequestEvent.create({
        data: {
          requestId: request.id,
          type: 'AD_COPY_GENERATED',
          message: `${principal.email} generated ad copy v${savedVersion.version} (${result.backend}, ${body.tone}).`,
          actorId: principal.userId,
        },
      });
    }

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'AI_COPY_GENERATED',
      description: request
        ? `Generated ad copy for ${request.reference} (${result.backend})`
        : `Generated ad copy for "${brief.product}" (${result.backend})`,
      targetType: request ? 'CrmAdRequest' : undefined,
      targetId: request?.id,
      metadata: { tone: body.tone, backend: result.backend, saved: Boolean(savedVersion) },
      ipAddress: clientIp(req),
    });

    // Re-validated so a client that never sees the model output still gets the
    // canonical flags for exactly the assets it received.
    const validation = validateAssets({
      headlines: result.headlines.map((h) => h.text),
      descriptions: result.descriptions.map((d) => d.text),
      keywordThemes: brief.keywords,
    });

    return { ...result, validation, savedVersion };
  });
}
