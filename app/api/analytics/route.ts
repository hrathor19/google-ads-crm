import { z } from 'zod';
import { handle, parseQuery, requirePermission } from '@/lib/api';
import { buildGa4Overview } from '@/lib/ga4/reports';
import { resolveWindow } from '@/lib/ops/dates';
import { isoDay } from '@/lib/ops/dates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  days: z.coerce.number().int().min(1).max(3650).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(req: Request) {
  return handle(async () => {
    await requirePermission('ANALYTICS', 'VIEW');
    const q = parseQuery(req, schema.passthrough());

    // GA4 has its own property-level date handling, but the window comes from
    // the same global picker so the two sections of the app stay comparable.
    const { start, end } = await resolveWindow({
      days: q.days,
      start: q.start ?? null,
      end: q.end ?? null,
    });

    return buildGa4Overview({ startDate: isoDay(start), endDate: isoDay(end) });
  });
}
