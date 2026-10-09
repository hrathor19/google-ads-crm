import { clientIp, handle, notFound, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { generateAdCopy, subjectOf } from '@/lib/ai/ad-copy';
import { parseExcludedTerms } from '@/lib/ai/exclusions';
import { generateCopySchema } from '@/lib/ai/schemas';
import { validateAssets } from '@/lib/ai/rsa-validator';
import { assertVisible } from '@/lib/workflow/ad-requests';
import { parseKeywordLines } from '@/lib/workflow/schemas';
import { actorLabel } from '@/lib/rbac/permissions';

export const dynamic = 'force-dynamic';
// Fetching the landing page then calling the model comfortably exceeds the
// default budget on a cold start.
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('AD_COPY', 'GENERATE_AI');
    const body = await parseBody(req, generateCopySchema);

    // Normalised here rather than trusted as sent: the browser splits the
    // field, but the endpoint is reachable without it.
    const excludedTerms = parseExcludedTerms((body.excludedTerms ?? []).join('\n'));

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
          title: true,
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
        },
      });
      if (!row) throw notFound('Ad request not found.');
      await assertVisible(principal, row);
      request = { id: row.id, reference: row.reference };

      // Anything the Ads person edited on the copy screen wins; everything
      // they left alone falls back to what Ops filed. Nothing here writes
      // back to the request — the brief stays Ops' record of what was
      // asked for, and this is one generation's inputs.
      brief = {
        product: body.product?.trim() || row.productService,
        // "Campaign / client name" on the Ops form — the college or
        // university. The course alone ("MBA/PGDM") could belong to anyone.
        institution: body.institution !== undefined ? body.institution : row.title,
        excludedTerms,
        objective: row.objective,
        targetAudience: body.targetAudience?.trim() || row.targetAudience,
        location: body.location?.trim() || row.location,
        landingPageUrl: body.landingPageUrl?.trim() || row.landingPageUrl,
        usps: body.usps !== undefined ? body.usps : row.usps,
        // An uploaded export wins over the keywords typed into the brief:
        // the Ads person uploading research is deliberately replacing the
        // Ops guess with what Google says people actually search.
        keywords: body.keywordVolumes?.length
          ? body.keywordVolumes.map((k) => k.keyword)
          : parseKeywordLines(row.keywords),
        keywordVolumes: body.keywordVolumes ?? [],
        notes: row.notes,
      };
    } else {
      if (!body.product || !body.landingPageUrl) {
        throw notFound('Provide a product and a landing page URL, or a request id.');
      }
      brief = {
        product: body.product,
        // The standalone form has one field, "College / University /
        // Course", so the name is already in `product`.
        institution: null,
        excludedTerms,
        objective: body.objective ?? 'LEAD_GENERATION',
        targetAudience: body.targetAudience ?? 'General audience',
        location: body.location ?? 'India',
        landingPageUrl: body.landingPageUrl,
        usps: body.usps ?? null,
        keywords: body.keywordVolumes?.length
          ? body.keywordVolumes.map((k) => k.keyword)
          : (body.keywords ?? []),
        keywordVolumes: body.keywordVolumes ?? [],
        notes: body.notes ?? null,
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
          headlines: result.headlines,
          descriptions: result.descriptions,
          sitelinks: result.sitelinks,
          keywords: body.keywordVolumes ?? [],
          excludedTerms,
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
          message:
            `${actorLabel(principal)} generated ad copy v${savedVersion.version} ` +
            `(${result.backend}) — ${result.headlines.length} headlines, ` +
            `${result.descriptions.length} descriptions, ${result.sitelinks.length} sitelinks` +
            (body.keywordVolumes?.length
              ? ` from ${body.keywordVolumes.length} researched keyword(s).`
              : '.'),
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
      metadata: {
        backend: result.backend,
        saved: Boolean(savedVersion),
        keywordsUploaded: body.keywordVolumes?.length ?? 0,
        sitelinks: result.sitelinks.length,
        excludedTerms,
      },
      ipAddress: clientIp(req),
    });

    // Re-validated so a client that never sees the model output still gets the
    // canonical flags for exactly the assets it received.
    const validation = validateAssets({
      headlines: result.headlines.map((h) => h.text),
      descriptions: result.descriptions.map((d) => d.text),
      sitelinks: result.sitelinks,
      keywordThemes: brief.keywords,
      // Without this the client was told no headline named the college
      // while twelve of them did, because this re-validation builds its own
      // arguments and quietly omitted the one the library had passed.
      subject: subjectOf({ product: brief.product, institution: brief.institution }),
      excludedTerms,
    });

    return { ...result, validation, savedVersion };
  });
}
