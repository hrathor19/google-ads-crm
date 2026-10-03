import 'server-only';
import { GoogleGenerativeAI, type Content } from '@google/generative-ai';
import { env } from '@/lib/env';
import type { Principal } from '@/lib/rbac/permissions';
import { canSeeFinancials } from '@/lib/redact';
import { scopeAccountId } from '@/lib/api';
import { LLMNotConfiguredError } from './gemini';
import { findTool, toolsFor, type ToolContext, type ToolTrace } from './tools';

/**
 * The assistant loop.
 *
 * Gemini is given a menu of read-only functions and asked a question. It
 * picks one, we run it under the asking user's Principal, hand back the rows,
 * and let it pick again until it has enough to answer. The model composes
 * prose; it never produces a figure of its own.
 *
 * Three limits keep an agent loop from becoming an incident:
 *
 *  - **Hops are capped.** A model that cannot find the answer will otherwise
 *    call tools forever, and each hop is an API call and a database query.
 *  - **History is capped.** Long conversations are trimmed to the most recent
 *    turns, so the token bill and the latency stay flat rather than growing
 *    with the session.
 *  - **Tool output is capped.** A rollup of 1,087 campaigns serialised into
 *    the prompt would blow the context and cost a fortune to say "the top one
 *    is X", which is why every tool takes a limit.
 */

/** How many times the model may call tools before it has to answer. */
const MAX_HOPS = 5;
/** Turns of history kept. Each turn is a user message plus the reply. */
const MAX_HISTORY = 12;

export type ChatTurn = { role: 'user' | 'model'; text: string };

export type AssistantAnswer = {
  text: string;
  /** What was actually read, so the answer can be checked rather than trusted. */
  trace: ToolTrace[];
  hops: number;
};

function systemPrompt(params: {
  name: string;
  roleName: string;
  canSeeMoney: boolean;
  today: string;
  toolNames: string[];
}): string {
  return [
    'You are the reporting assistant inside KollegeApply Ads CRM, a Google Ads management tool.',
    `You are talking to ${params.name} (${params.roleName}). Today is ${params.today}.`,
    '',
    'HOW YOU WORK',
    '- You have no knowledge of this company\'s data. Every number you state must come from a tool call in this conversation.',
    '- Never estimate, extrapolate, or recall a figure from an earlier conversation. If you need a number, call a tool.',
    `- Available tools: ${params.toolNames.join(', ')}.`,
    '- If no tool can answer the question, say so plainly and name what you can answer instead. Do not improvise.',
    '- You may call several tools before answering, and the same tool twice with different windows to compare periods. Never call the same tool twice with identical arguments — you already have that answer.',
    '- Every reporting tool returns a "window" ({start, end}) and an "account". State the period from that field. Never state a date range you were not given; you do not know what today\'s data covers.',
    '- Questions outside this CRM — general knowledge, coding, anything not about these Google Ads accounts or the request workflow — get one short sentence declining, and a reminder of what you can help with. Do not answer them.',
    '',
    'HOW YOU ANSWER',
    '- Lead with the answer. One or two sentences, then detail only if it helps.',
    '- Use Indian number formatting for currency (₹1,22,79,481) and always name the period the figure covers.',
    '- Small tables are welcome for rankings. Use markdown.',
    '- Point out something worth noticing — a figure well off target, a collapse, an account dominating the spend — but do not recommend pausing or budget changes. You do not know what was agreed with the client.',
    '- If a tool returns nothing, say the period had no data rather than implying the performance was zero.',
    '- Never print an internal id. Use the account, campaign or request name the tool gave you.',
    params.canSeeMoney
      ? '- This user may see spend and cost figures.'
      : '- This user may NOT see spend, CPC, or cost-per-lead. Those come back as null. Never guess them, and say the figure is not available to them if asked.',
    '',
    'WHAT YOU NEVER DO',
    '- You cannot change anything. No pausing campaigns, editing budgets, approving requests, or assigning people. If asked, explain where in the app to do it.',
    '- Never claim a sync ran, an email was sent, or anything happened as a result of this conversation.',
  ].join('\n');
}

/** Trim history so cost and latency do not grow with the conversation. */
function recent(history: ChatTurn[]): ChatTurn[] {
  return history.slice(-MAX_HISTORY);
}

export async function askAssistant(params: {
  principal: Principal;
  question: string;
  history?: ChatTurn[];
}): Promise<AssistantAnswer> {
  const { apiKey, model } = env.gemini();
  if (!apiKey) {
    throw new LLMNotConfiguredError(
      'The assistant needs GEMINI_API_KEY. Set it and restart, or ask an administrator.'
    );
  }

  const canSeeMoney = await canSeeFinancials(params.principal);
  const { accountIds } = scopeAccountId(params.principal, null);
  const ctx: ToolContext = {
    principal: params.principal,
    scope: { accountIds },
    canSeeMoney,
  };

  const tools = await toolsFor(params.principal);
  const client = new GoogleGenerativeAI(apiKey);
  const generativeModel = client.getGenerativeModel({
    model,
    systemInstruction: systemPrompt({
      name: params.principal.email,
      roleName: params.principal.roleName,
      canSeeMoney,
      today: new Date().toISOString().slice(0, 10),
      toolNames: tools.map((t) => t.declaration.name),
    }),
    tools: [{ functionDeclarations: tools.map((t) => t.declaration) }],
  });

  const contents: Content[] = [
    ...recent(params.history ?? []).map((t) => ({
      role: t.role,
      parts: [{ text: t.text }],
    })),
    { role: 'user', parts: [{ text: params.question }] },
  ];

  const trace: ToolTrace[] = [];

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const result = await generativeModel.generateContent({
      contents,
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
    });

    const calls = result.response.functionCalls() ?? [];
    if (calls.length === 0) {
      const text = (result.response.text() ?? '').trim();
      return {
        text: text || 'I could not put together an answer for that. Try rephrasing it.',
        trace,
        hops: hop,
      };
    }

    // Echo the model's own turn back byte for byte rather than rebuilding it
    // from `functionCalls()`. Newer Gemini models attach a `thoughtSignature`
    // to each functionCall part and reject the next request without it —
    // "Function call is missing a thought_signature in functionCall parts" —
    // and that field is not in this SDK's types, so any reconstruction drops
    // it. Replaying the candidate's content keeps whatever the API sent,
    // including fields this client does not know about.
    const modelTurn = result.response.candidates?.[0]?.content;
    contents.push(
      modelTurn ?? { role: 'model', parts: calls.map((c) => ({ functionCall: c })) }
    );

    const responses = [];
    for (const call of calls) {
      const tool = findTool(call.name);
      // A tool the user is not entitled to was filtered out of the menu, so
      // reaching one by name means the model invented it. Say so rather than
      // failing the turn — it recovers and picks a real one.
      const allowed = tools.some((t) => t.declaration.name === call.name);
      if (!tool || !allowed) {
        trace.push({ name: call.name, args: {}, summary: 'No such tool', ok: false });
        responses.push({
          functionResponse: {
            name: call.name,
            response: { error: `There is no tool called "${call.name}".` },
          },
        });
        continue;
      }

      const args = (call.args ?? {}) as Record<string, unknown>;
      try {
        const { data, summary } = await tool.run(args, ctx);
        trace.push({ name: call.name, args, summary, ok: true });
        responses.push({ functionResponse: { name: call.name, response: { data } } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        trace.push({ name: call.name, args, summary: message, ok: false });
        // Handed back as data, not thrown: a bad argument is something the
        // model can correct on the next hop, and a 500 would lose the whole
        // conversation over one mistyped date.
        responses.push({ functionResponse: { name: call.name, response: { error: message } } });
      }
    }

    // Role 'user', not 'function': this API rejects the latter outright —
    // "Role 'function' is not supported. Please use a valid role: … USER,
    // MODEL". Tool output is handed back as a user turn carrying
    // functionResponse parts.
    contents.push({ role: 'user', parts: responses });
  }

  return {
    text:
      'I kept looking things up without reaching an answer. Try narrowing the question — ' +
      'a single account, or a specific period.',
    trace,
    hops: MAX_HOPS,
  };
}
