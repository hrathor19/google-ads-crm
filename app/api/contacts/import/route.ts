import { z } from 'zod';
import { badRequest, clientIp, handle, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { MAX_CONTACTS_PER_IMPORT, parseContactCsv } from '@/lib/contacts/csv';
import { validateRecipients } from '@/lib/workflow/recipients';

export const dynamic = 'force-dynamic';

/** 1 MB of CSV is roughly 20,000 rows — far past the cap, and still cheap. */
const schema = z.object({ csv: z.string().min(1).max(1_000_000) });

/**
 * Import a list of people from a spreadsheet.
 *
 * Nothing is overwritten. An address already in the directory is reported as
 * skipped rather than quietly updated, because an import is usually somebody
 * adding this term's contacts to last term's — and having that silently rename
 * forty people is the kind of thing nobody notices until the mail goes wrong.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('CONTACTS', 'CREATE');
    const body = await parseBody(req, schema);

    const parsed = parseContactCsv(body.csv);
    if (parsed.error) throw badRequest(parsed.error, { skipped: parsed.skipped });

    const skipped = [...parsed.skipped];
    const domains = env.auth().allowedDomains;

    // The same domain rule the directory and the mail trail both enforce.
    const allowed = parsed.rows.filter((row) => {
      const problem = validateRecipients([row], domains);
      if (problem) {
        skipped.push({ line: 0, value: row.email, reason: problem });
        return false;
      }
      return true;
    });

    const already = await prisma.crmMailContact.findMany({
      where: { email: { in: allowed.map((r) => r.email) } },
      select: { email: true, name: true },
    });
    const have = new Map(already.map((c) => [c.email, c.name]));

    const fresh = allowed.filter((r) => {
      const existingName = have.get(r.email);
      if (existingName !== undefined) {
        skipped.push({
          line: 0,
          value: r.email,
          reason: `Already in the list as "${existingName}".`,
        });
        return false;
      }
      return true;
    });

    if (fresh.length > 0) {
      await prisma.crmMailContact.createMany({
        data: fresh.map((r) => ({
          name: r.name,
          email: r.email,
          createdById: principal.userId,
          createdByEmail: principal.email,
        })),
        // Belt and braces against two people importing the same file at once;
        // the unique index on email is what actually guarantees it.
        skipDuplicates: true,
      });

      await logAudit({
        actorId: principal.userId,
        actorEmail: principal.email,
        action: 'CONTACTS_IMPORTED',
        description: `Imported ${fresh.length} mail contact(s), skipped ${skipped.length}`,
        targetType: 'CrmMailContact',
        metadata: { imported: fresh.map((r) => r.email), skipped: skipped.length },
        ipAddress: clientIp(req),
      });
    }

    return {
      imported: fresh.length,
      skipped,
      cap: MAX_CONTACTS_PER_IMPORT,
    };
  });
}
