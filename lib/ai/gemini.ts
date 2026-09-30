import 'server-only';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '@/lib/env';

/**
 * LLM client. A port of `app/ai_clients/llm_client.py`, narrowed to Gemini
 * because that is the provider the source project's `.env` actually configures
 * (`AD_COPY_LLM_PROVIDER=auto` with only `GEMINI_API_KEY` set resolves to
 * Gemini there too).
 *
 * The rest of the codebase depends only on `complete()`. When no key is
 * configured it reports unavailable and the caller falls back to the
 * deterministic engine — generating copy never hard-fails on a missing key.
 */

export class LLMNotConfiguredError extends Error {
  name = 'LLMNotConfiguredError';
}
export class LLMResponseError extends Error {
  name = 'LLMResponseError';
}
export class LLMTransientError extends Error {
  name = 'LLMTransientError';
}

export function llmAvailable(): boolean {
  return Boolean(env.gemini().apiKey);
}

const TRANSIENT_HINTS = [
  'resourceexhausted', 'serviceunavailable', 'deadline', 'toomany',
  'ratelimit', 'internal', 'unavailable', '429', '500', '503',
];

function classify(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const name = (err instanceof Error ? err.name : '').toLowerCase();
  const haystack = `${name} ${message}`.toLowerCase();
  if (TRANSIENT_HINTS.some((k) => haystack.includes(k))) return new LLMTransientError(message);
  return new LLMResponseError(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One completion, with exponential backoff on transient failures only.
 *
 * `responseMimeType: application/json` matches the source's Gemini call: the
 * generator asks for structured output and parses it, so a prose preamble
 * would break the parse.
 */
export async function complete(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
  json?: boolean;
}): Promise<string> {
  const { apiKey, model } = env.gemini();
  if (!apiKey) throw new LLMNotConfiguredError('GEMINI_API_KEY is not configured.');

  const client = new GoogleGenerativeAI(apiKey);
  const generativeModel = client.getGenerativeModel({
    model,
    systemInstruction: params.system,
  });

  const attempts = Math.max(1, env.sync().maxRetries);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
        generationConfig: {
          maxOutputTokens: params.maxTokens ?? 4096,
          ...(params.json === false ? {} : { responseMimeType: 'application/json' }),
        },
      });
      const text = (result.response.text() ?? '').trim();
      if (!text) throw new LLMResponseError('Empty response from Gemini.');
      return text;
    } catch (err) {
      const classified = classify(err);
      lastError = classified;
      if (!(classified instanceof LLMTransientError) || attempt === attempts - 1) {
        throw classified;
      }
      await sleep(Math.min(30_000, 2000 * 2 ** attempt));
    }
  }
  throw lastError ?? new LLMResponseError('Gemini call failed.');
}

/** Connection probe for the Integrations Health page. */
export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  if (!llmAvailable()) return { ok: false, detail: 'GEMINI_API_KEY is not set.' };
  try {
    const text = await complete({
      system: 'You reply with JSON only.',
      prompt: 'Reply with exactly {"ok":true}.',
      maxTokens: 32,
    });
    return { ok: true, detail: `Model ${env.gemini().model} responded (${text.length} chars).` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
