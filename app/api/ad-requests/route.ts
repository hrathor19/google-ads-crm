import { z } from 'zod';
import { AdRequestStatus } from '@prisma/client';
import { clientIp, handle, parseBody, parseQuery, prisma, requirePermission } from '@/lib/api';
import { createRequest, visibilityWhere } from '@/lib/workflow/ad-requests';
import { createAdRequestSchema } from '@/lib/workflow/schemas';
import { canSeeFinancials } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const listSchema = z.object({
  status: z.string().optional(),
  accountId: z.coerce.number().int().positive().optional(),
  ownerId: z.string().optional(),
  assigneeId: z.string().optional(),
  search: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'VIEW');
    const q = parseQuery(req, listSchema.passthrough());

    const statuses = q.status
      ? (q.status.split(',').filter((s) => s in AdRequestStatus) as AdRequestStatus[])
      : undefined;

    const where = {
      AND: [
        await visibilityWhere(principal),
        statuses?.length ? { status: { in: statuses } } : {},
        q.accountId ? { accountId: q.accountId } : {},
        q.ownerId ? { createdById: q.ownerId } : {},
        q.assigneeId ? { assignedToId: q.assigneeId } : {},
        q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' as const } },
                { reference: { contains: q.search, mode: 'insensitive' as const } },
                { productService: { contains: q.search, mode: 'insensitive' as const } },
              ],
            }
          : {},
        q.from ? { createdAt: { gte: new Date(`${q.from}T00:00:00.000Z`) } } : {},
        q.to ? { createdAt: { lte: new Date(`${q.to}T23:59:59.999Z`) } } : {},
      ],
    };

    const [rows, total, counts] = await Promise.all([
      prisma.crmAdRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit ?? 50,
        skip: q.offset ?? 0,
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          objective: true,
          budget: true,
          startDate: true,
          endDate: true,
          landingPageUrl: true,
          createdAt: true,
          submittedAt: true,
          accountId: true,
          account: { select: { descriptive_name: true, customer_id: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
          _count: { select: { adCopyVersions: true, landingScores: true } },
        },
      }),
      prisma.crmAdRequest.count({ where }),
      prisma.crmAdRequest.groupBy({ by: ['status'], where, _count: true }),
    ]);

    const canSeeMoney = await canSeeFinancials(principal);

    return {
      total,
      canSeeMoney,
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      rows: rows.map((r) => ({
        ...r,
        budget: canSeeMoney ? Number(r.budget) : null,
        accountName: r.account?.descriptive_name ?? null,
        account: undefined,
      })),
    };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('AD_REQUESTS', 'CREATE');
    const body = await parseBody(req, createAdRequestSchema);

    return createRequest(
      principal,
      {
        title: body.title,
        accountId: body.accountId ?? null,
        objective: body.objective,
        productService: body.productService,
        targetAudience: body.targetAudience,
        location: body.location,
        budget: body.budget,
        startDate: new Date(`${body.startDate}T00:00:00.000Z`),
        endDate: body.endDate ? new Date(`${body.endDate}T00:00:00.000Z`) : null,
        landingPageUrl: body.landingPageUrl,
        usps: body.usps ?? null,
        keywords: body.keywords ?? null,
        notes: body.notes ?? null,
      },
      { submit: body.submit, ip: clientIp(req) }
    );
  });
}
