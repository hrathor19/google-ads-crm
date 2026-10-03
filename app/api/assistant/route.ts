import { z } from 'zod';
import { clientIp, handle, parseBody, requirePermission } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { askAssistant } from '@/lib/ai/assistant';
import { toolsFor } from '@/lib/ai/tools';
import { llmAvailable } from '@/lib/ai/gemini';

export const dynamic = 'force-dynamic';
// A few tool hops plus the model's own latency; the default budget is short.
export const maxDuration = 120;

/**
 * The reporting assistant.
 *
 * `ASSISTANT:VIEW` gates the door; each tool re-checks the module permission
 * it reads behind it. Both matter: the first decides who may ask, the second
 * decides what any given asker can be told — so granting a future role the
 * assistant does not quietly grant it spend.
 */
const schema = z.object({
  message: z.string().trim().min(1, 'Ask something.').max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        text: z.string().max(8000),
      })
    )
    .max(40)
    .optional(),
});

/** What the UI needs to render the empty state honestly. */
export async function GET() {
  return handle(async () => {
    const principal = await requirePermission('ASSISTANT', 'VIEW');
    const tools = await toolsFor(principal);
    return {
      available: llmAvailable(),
      tools: tools.map((t) => ({
        name: t.declaration.name,
        description: t.declaration.description ?? '',
      })),
    };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await requirePermission('ASSISTANT', 'VIEW');
    const body = await parseBody(req, schema);

    const started = Date.now();
    const answer = await askAssistant({
      principal,
      question: body.message,
      history: body.history,
    });

    // The question, not the answer: it records what someone went looking for
    // without copying client figures into a second table.
    await logAudit({
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'ASSISTANT_QUERIED',
      description: body.message.slice(0, 500),
      targetType: 'Assistant',
      metadata: {
        tools: answer.trace.map((t) => t.name),
        hops: answer.hops,
        durationMs: Date.now() - started,
      },
      ipAddress: clientIp(req),
    });

    return answer;
  });
}
