import 'server-only';
import { GoogleAdsApi, type Customer } from 'google-ads-api';
import { env } from '@/lib/env';

/**
 * Google Ads API client factory, query execution, retry and quota handling.
 *
 * A port of `app/google_ads/client.py`. The client is cached per process and
 * reused across customer ids — the login (manager) customer id is fixed and the
 * per-request customer id is passed to each search call.
 */

export class GoogleAdsAuthError extends Error {
  name = 'GoogleAdsAuthError';
}
export class QuotaExceededError extends Error {
  name = 'QuotaExceededError';
}
export class TransientGoogleAdsError extends Error {
  name = 'TransientGoogleAdsError';
}

let cachedApi: GoogleAdsApi | null = null;

function getApi(): GoogleAdsApi {
  if (cachedApi) return cachedApi;
  const cfg = env.googleAds();
  if (!cfg.developerToken || !cfg.refreshToken) {
    throw new GoogleAdsAuthError(
      'Google Ads credentials are not configured. Set the GOOGLE_ADS_* environment variables.'
    );
  }
  cachedApi = new GoogleAdsApi({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    developer_token: cfg.developerToken,
  });
  return cachedApi;
}

export function customerFor(customerId: string): Customer {
  const cfg = env.googleAds();
  return getApi().Customer({
    customer_id: customerId.replace(/-/g, '').trim(),
    login_customer_id: cfg.loginCustomerId || undefined,
    refresh_token: cfg.refreshToken,
  });
}

/**
 * Map an SDK/transport failure onto the retryable/fatal taxonomy the sync
 * engine reacts to. Auth and quota problems are never worth retrying blindly;
 * everything transport-shaped is.
 */
function translateError(err: unknown, customerId: string): never {
  const e = err as { errors?: Array<{ error_code?: Record<string, unknown>; message?: string }>; message?: string; code?: number };
  const message = e?.message ?? String(err);

  if (Array.isArray(e?.errors)) {
    for (const item of e.errors) {
      const code = item.error_code ?? {};
      if (code.authentication_error !== undefined || code.authorization_error !== undefined) {
        throw new GoogleAdsAuthError(`Auth error for customer ${customerId}: ${item.message}`);
      }
      if (code.quota_error !== undefined) {
        throw new QuotaExceededError(`Quota error for customer ${customerId}: ${item.message}`);
      }
    }
    throw new TransientGoogleAdsError(`Google Ads request failed for ${customerId}: ${message}`);
  }

  // gRPC status codes: 8 RESOURCE_EXHAUSTED, 4 DEADLINE_EXCEEDED,
  // 13 INTERNAL, 14 UNAVAILABLE.
  if (e?.code === 8) throw new QuotaExceededError(`Rate limited for ${customerId}: ${message}`);
  if (e?.code === 4 || e?.code === 13 || e?.code === 14) {
    throw new TransientGoogleAdsError(message);
  }
  if (/UNAVAILABLE|DEADLINE|INTERNAL|RESOURCE_EXHAUSTED/i.test(message)) {
    throw new TransientGoogleAdsError(message);
  }
  throw err instanceof Error ? err : new Error(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a GAQL query, materialising the whole result set inside the retry
 * boundary so a transient mid-stream failure re-runs the query cleanly rather
 * than leaving a half-read page.
 */
export async function search<T = Record<string, unknown>>(
  customerId: string,
  query: string
): Promise<T[]> {
  const { maxRetries, retryBackoffSeconds } = env.sync();
  const attempts = Math.max(1, maxRetries);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const customer = customerFor(customerId);
      return (await customer.query(query)) as T[];
    } catch (err) {
      try {
        translateError(err, customerId);
      } catch (translated) {
        lastError = translated;
        // Only transient failures are worth another attempt; auth and quota
        // errors will fail identically however many times we ask.
        if (!(translated instanceof TransientGoogleAdsError)) throw translated;
        if (attempt === attempts - 1) throw translated;
        // Exponential backoff, capped at 300s as in the source.
        const waitMs = Math.min(300_000, retryBackoffSeconds * 1000 * 2 ** attempt);
        await sleep(waitMs);
      }
    }
  }
  throw lastError ?? new Error('Google Ads search failed.');
}

/** Whether the credentials can reach the API at all — used by Integrations Health. */
export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  const cfg = env.googleAds();
  if (!cfg.developerToken || !cfg.refreshToken || !cfg.loginCustomerId) {
    return { ok: false, detail: 'Credentials are incomplete.' };
  }
  try {
    const rows = await search<{ customer_client: { id: string } }>(
      cfg.loginCustomerId,
      'SELECT customer_client.id FROM customer_client WHERE customer_client.level <= 1 LIMIT 5'
    );
    return { ok: true, detail: `Reached the MCC; ${rows.length} account(s) visible in the probe.` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
