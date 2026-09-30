import { z } from 'zod';
import { clientIp, handle, parseBody, prisma, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { testConnection as testGoogleAds } from '@/lib/google-ads/client';
import { testConnection as testGemini } from '@/lib/ai/gemini';
import { testConnection as testGa4 } from '@/lib/ga4/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  key: z.enum(['googleAds', 'gemini', 'ga4', 'database']),
});

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('INTEGRATIONS', 'MANAGE');
    const { key } = await parseBody(req, schema);

    let result: { ok: boolean; detail: string };
    switch (key) {
      case 'googleAds':
        result = await testGoogleAds();
        break;
      case 'gemini':
        result = await testGemini();
        break;
      case 'ga4':
        result = await testGa4();
        break;
      case 'database': {
        try {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT 1 AS n`;
          result = { ok: rows.length === 1, detail: 'Query round-trip succeeded.' };
        } catch (err) {
          result = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
        break;
      }
    }

    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'INTEGRATION_TESTED',
      description: `Tested ${key}: ${result.ok ? 'connected' : 'failed'}`,
      metadata: { key, ok: result.ok },
      ipAddress: clientIp(req),
    });

    return { key, ...result };
  });
}
