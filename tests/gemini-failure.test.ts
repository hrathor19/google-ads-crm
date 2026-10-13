import { describe, expect, it } from 'vitest';
import { describeGeminiFailure } from '@/lib/ai/gemini';

/**
 * The strings here are the real ones Gemini returned on 13 Oct 2026, kept
 * verbatim. A paraphrase would pass while the parser quietly stopped matching
 * the thing it exists to match.
 */
const QUOTA_429 =
  '[GoogleGenerativeAI Error]: Error fetching from ' +
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent: ' +
  '[429 ] You exceeded your current quota, please check your plan and billing details. ' +
  '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
  'limit: 20, model: gemini-3.6-flash Please retry in 10h45m42.528000805s. ' +
  '[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":' +
  '"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},' +
  '{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"38742s"}]';

const OVERLOADED_503 =
  '[GoogleGenerativeAI Error]: Error fetching from ' +
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent: ' +
  '[503 ] This model is currently experiencing high demand. Spikes in demand are usually temporary.';

describe('describeGeminiFailure', () => {
  it('recognises the free tier daily cap and says when it resets', () => {
    const f = describeGeminiFailure(new Error(QUOTA_429));
    expect(f.kind).toBe('quota');
    expect(f.status).toBe(429);
    expect(f.retryAfterSeconds).toBe(38742);
    expect(f.message).toMatch(/10h 46m/);
    expect(f.message).toMatch(/billing/i);
  });

  it('recognises an overloaded model as their problem, not ours', () => {
    const f = describeGeminiFailure(new Error(OVERLOADED_503));
    expect(f.kind).toBe('overloaded');
    expect(f.status).toBe(503);
    expect(f.message).toMatch(/their side/i);
  });

  it('separates a per-minute rate limit from the daily cap', () => {
    const f = describeGeminiFailure(
      new Error('[429 ] Too many requests. quotaId: GenerateRequestsPerMinutePerProject')
    );
    expect(f.kind).toBe('rate-limit');
    expect(f.status).toBe(429);
  });

  it('falls back to something honest for an unrecognised failure', () => {
    const f = describeGeminiFailure(new Error('socket hang up'));
    expect(f.kind).toBe('other');
    expect(f.status).toBe(502);
  });

  it('never puts the endpoint, the key or Google internals in what a user sees', () => {
    for (const raw of [QUOTA_429, OVERLOADED_503, 'AIzaSyFAKEKEY leaked in an error']) {
      const { message } = describeGeminiFailure(new Error(raw));
      expect(message).not.toMatch(/generativelanguage|googleapis|AIza|quotaId|@type/);
    }
  });

  it('reads the delay from the machine-readable field, not the prose', () => {
    // Google prints both; the prose is rounded and formatted for humans, so
    // parsing it instead would drift.
    const f = describeGeminiFailure(
      new Error('[429 ] free_tier quota. Please retry in 1h2m3s. {"retryDelay":"90s"}')
    );
    expect(f.retryAfterSeconds).toBe(90);
    expect(f.message).toMatch(/2m/);
  });

  it('formats a short delay in seconds rather than rounding it to a minute', () => {
    const f = describeGeminiFailure(new Error('[429 ] free_tier cap {"retryDelay":"12s"}'));
    expect(f.message).toMatch(/12s/);
  });
});
