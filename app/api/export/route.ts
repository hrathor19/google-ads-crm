import { z } from 'zod';
import * as XLSX from 'xlsx';
import { ApiError, badRequest, clientIp, forbidden, parseQuery, requireUser } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { resolveFilters } from '@/lib/api-filters';
import { hasPermission } from '@/lib/rbac/permissions';
import { canSeeFinancials, stripMoney } from '@/lib/redact';
import {
  accountRollup,
  adGroupRollup,
  campaignRollup,
  keywordRollup,
  searchTermExplore,
} from '@/lib/ops/metrics';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  dataset: z.enum(['accounts', 'campaigns', 'adGroups', 'keywords', 'searchTerms']),
  format: z.enum(['csv', 'xlsx']).optional(),
  campaignPk: z.coerce.number().int().positive().optional(),
});

/** Each dataset names the permission that must be held to export it. */
const EXPORT_PERMISSION: Record<string, string> = {
  accounts: 'ACCOUNTS:EXPORT',
  campaigns: 'CAMPAIGNS:EXPORT',
  adGroups: 'CAMPAIGNS:EXPORT',
  keywords: 'KEYWORDS:EXPORT',
  searchTerms: 'KEYWORDS:EXPORT',
};

/**
 * A file download, so this handler does not use `handle()`: that helper wraps
 * whatever it returns in `NextResponse.json`, which would serialise the
 * Response object instead of sending the file. Errors are mapped here to the
 * same JSON shape every other endpoint returns.
 */
export async function GET(req: Request) {
  try {
    const principal = await requireUser();
    const q = parseQuery(req, schema.passthrough());

    const permission = EXPORT_PERMISSION[q.dataset];
    if (!permission || !(await hasPermission(principal, permission))) {
      throw forbidden(`Requires the "${permission}" permission.`);
    }

    const { start, end, scope, accountId } = await resolveFilters(req, principal);
    const canSeeMoney = await canSeeFinancials(principal);

    let rows: Array<Record<string, unknown>>;
    switch (q.dataset) {
      case 'accounts':
        rows = await accountRollup(start, end, scope);
        break;
      case 'campaigns':
        rows = await campaignRollup(start, end, scope, { accountId });
        break;
      case 'adGroups':
        rows = await adGroupRollup(start, end, scope, {
          accountId,
          campaignPk: q.campaignPk ?? null,
        });
        break;
      case 'keywords':
        rows = await keywordRollup(start, end, scope, {
          accountId,
          campaignPk: q.campaignPk ?? null,
          limit: 50_000,
        });
        break;
      case 'searchTerms': {
        const result = await searchTermExplore({
          start,
          end,
          scope,
          accountId,
          campaignPk: q.campaignPk ?? null,
          limit: 500,
        });
        rows = result.rows;
        break;
      }
      default:
        throw badRequest('Unknown dataset.');
    }

    // The export goes through exactly the same redaction as the screen — a
    // role that cannot see spend must not be able to download it either.
    const clean = (canSeeMoney ? rows : rows.map(stripMoney)).map((r) => {
      const { today, prior, issues, priority, health, ...rest } = r as Record<string, unknown>;
      return rest;
    });

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'DATA_EXPORTED',
      description: `Exported ${clean.length} ${q.dataset} row(s) as ${q.format ?? 'csv'}`,
      metadata: { dataset: q.dataset, rows: clean.length, withFinancials: canSeeMoney },
      ipAddress: clientIp(req),
    });

    const stamp = `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`;
    const filename = `${q.dataset}_${stamp}`;
    const sheet = XLSX.utils.json_to_sheet(clean);

    if (q.format === 'xlsx') {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, q.dataset.slice(0, 31));
      const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
        },
      });
    }

    const csv = XLSX.utils.sheet_to_csv(sheet);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error('[export] unhandled error', err);
    return Response.json({ error: 'The export could not be produced.' }, { status: 500 });
  }
}
