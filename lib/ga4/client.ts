import 'server-only';
import { createSign } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Google Analytics 4 via the Analytics Data API.
 *
 * The source project has no GA4 reporting integration — GA4 appears there only
 * as *tag detection* inside the landing-page auditor — and its `.env` carries
 * no GA4 credentials. So there was nothing to port; this is written against
 * the documented `runReport` API and stays inert until a service account is
 * configured, rather than pretending the section does not exist.
 *
 * Auth is a hand-rolled JWT bearer grant rather than the `google-auth-library`
 * dependency: one signed assertion against the token endpoint is the whole
 * requirement, and it keeps a heavy transitive tree out of the bundle.
 */

export type Ga4Config = { propertyId: string; clientEmail: string; privateKey: string };

export class Ga4NotConfiguredError extends Error {
  name = 'Ga4NotConfiguredError';
}

export function ga4Config(): Ga4Config | null {
  const { propertyId, clientEmail, privateKey } = env.ga4();
  if (!propertyId || !clientEmail || !privateKey) return null;
  return { propertyId, clientEmail, privateKey };
}

export function ga4Configured(): boolean {
  return ga4Config() !== null;
}

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(cfg: Ga4Config): Promise<string> {
  // Reused until a minute before expiry; a token request per report would
  // double the latency of every page load for no benefit.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(cfg.privateKey));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`GA4 token request failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

export type Ga4Row = { dimensions: string[]; metrics: number[] };
export type Ga4Report = {
  dimensionHeaders: string[];
  metricHeaders: string[];
  rows: Ga4Row[];
  totals: number[];
  rowCount: number;
};

export async function runReport(params: {
  dimensions: string[];
  metrics: string[];
  startDate: string;
  endDate: string;
  limit?: number;
  orderByMetric?: string;
}): Promise<Ga4Report> {
  const cfg = ga4Config();
  if (!cfg) throw new Ga4NotConfiguredError('GA4 is not configured.');

  const token = await accessToken(cfg);
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
        dimensions: params.dimensions.map((name) => ({ name })),
        metrics: params.metrics.map((name) => ({ name })),
        limit: params.limit ?? 100,
        metricAggregations: ['TOTAL'],
        ...(params.orderByMetric && {
          orderBys: [{ desc: true, metric: { metricName: params.orderByMetric } }],
        }),
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`GA4 runReport failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as {
    dimensionHeaders?: Array<{ name: string }>;
    metricHeaders?: Array<{ name: string }>;
    rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>;
    totals?: Array<{ metricValues?: Array<{ value: string }> }>;
    rowCount?: number;
  };

  return {
    dimensionHeaders: (json.dimensionHeaders ?? []).map((h) => h.name),
    metricHeaders: (json.metricHeaders ?? []).map((h) => h.name),
    rows: (json.rows ?? []).map((r) => ({
      dimensions: (r.dimensionValues ?? []).map((v) => v.value),
      metrics: (r.metricValues ?? []).map((v) => Number(v.value) || 0),
    })),
    totals: (json.totals?.[0]?.metricValues ?? []).map((v) => Number(v.value) || 0),
    rowCount: json.rowCount ?? 0,
  };
}

export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  const cfg = ga4Config();
  if (!cfg) {
    return {
      ok: false,
      detail:
        'GA4_PROPERTY_ID, GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY are not set. The source project had no GA4 integration, so these are new.',
    };
  }
  try {
    const report = await runReport({
      dimensions: [],
      metrics: ['activeUsers'],
      startDate: '7daysAgo',
      endDate: 'yesterday',
      limit: 1,
    });
    return {
      ok: true,
      detail: `Property ${cfg.propertyId} responded (${report.totals[0] ?? 0} active users in the last 7 days).`,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
