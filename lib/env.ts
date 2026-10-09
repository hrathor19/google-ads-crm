import 'server-only';

/**
 * Environment access and startup validation.
 *
 * Every secret in this app is server-side. Nothing here is ever imported from a
 * client component: `server-only` makes that a build error rather than a code
 * review question, which is what keeps the Google Ads, Gemini and GA4
 * credentials out of the browser bundle.
 */

type Requirement = {
  key: string;
  /** Why the app needs it — shown verbatim in the startup error. */
  purpose: string;
};

/** Without these the app cannot serve a single authenticated request. */
const REQUIRED: Requirement[] = [
  { key: 'DATABASE_URL', purpose: 'PostgreSQL connection for Prisma' },
  { key: 'NEXTAUTH_SECRET', purpose: 'signs the NextAuth session JWT' },
  { key: 'SEED_ADMIN_EMAIL', purpose: 'the Super Admin created by prisma/seed.ts' },
  { key: 'SEED_ADMIN_PASSWORD', purpose: 'initial Super Admin password (forced change on first login)' },
];

export class MissingEnvError extends Error {
  constructor(missing: Requirement[]) {
    super(
      [
        '',
        'Missing required environment variables:',
        ...missing.map((m) => `  • ${m.key} — ${m.purpose}`),
        '',
        'Copy .env.example to .env and fill these in, then restart.',
        '',
      ].join('\n')
    );
    this.name = 'MissingEnvError';
  }
}

/**
 * Throws with a readable list if anything required is absent. Called once from
 * the root layout, so a misconfigured deploy fails at the first page render
 * with an actionable message instead of a null-pointer three layers down.
 */
export function assertRequiredEnv(): void {
  const missing = REQUIRED.filter((r) => !(process.env[r.key] ?? '').trim());
  if (missing.length > 0) throw new MissingEnvError(missing);
}

function str(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).trim();
}

function bool(key: string, fallback: boolean): boolean {
  const v = str(key).toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

function num(key: string, fallback: number): number {
  // An unset variable must fall back, not become 0 — `Number('')` is 0, which
  // would silently turn an absent timeout into "abort immediately".
  const raw = str(key);
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export const env = {
  databaseUrl: () => str('DATABASE_URL'),
  appEnv: () => str('APP_ENV', 'development'),

  seedAdminEmail: () => str('SEED_ADMIN_EMAIL'),
  seedAdminPassword: () => str('SEED_ADMIN_PASSWORD'),

  googleAds: () => ({
    developerToken: str('GOOGLE_ADS_DEVELOPER_TOKEN'),
    clientId: str('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: str('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken: str('GOOGLE_ADS_REFRESH_TOKEN'),
    loginCustomerId: str('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replace(/-/g, ''),
  }),

  gemini: () => ({
    apiKey: str('GEMINI_API_KEY'),
    // Matches the source project's default so generated copy comes from the
    // same model family it was tuned against.
    model: str('GEMINI_MODEL', 'gemini-flash-lite-latest'),
  }),

  ga4: () => ({
    propertyId: str('GA4_PROPERTY_ID'),
    clientEmail: str('GA4_CLIENT_EMAIL'),
    // Service-account keys are pasted with literal \n escapes in .env.
    privateKey: str('GA4_PRIVATE_KEY').replace(/\\n/g, '\n'),
  }),

  sync: () => ({
    maxRetries: num('SYNC_MAX_RETRIES', 3),
    retryBackoffSeconds: num('SYNC_RETRY_BACKOFF_SECONDS', 30),
    defaultLookbackDays: num('SYNC_DEFAULT_LOOKBACK_DAYS', 30),
    /**
     * Sync accounts the Google Ads account status marks SUSPENDED.
     *
     * The source project never does: it sets `is_syncable = status ==
     * "ENABLED"` and syncs only syncable, non-manager accounts. That hides
     * real money — 19 suspended accounts in this MCC hold 237,909 clicks and
     * about ₹39 lakh of spend, including the earliest activity anywhere
     * (2025-05-16), which is why the history looked like it began on the 23rd.
     *
     * A suspended account's past spend still happened, so it belongs in
     * historical reporting. Set this to false to go back to matching the
     * source app exactly.
     */
    includeSuspended: bool('SYNC_INCLUDE_SUSPENDED', true),
  }),

  /**
   * Sign-in configuration.
   *
   * `allowedDomains` is the server-side gate on Google sign-in. The consent
   * screen can also be set to Internal, but that is a toggle in a console
   * this app cannot see, so it is treated as defence in depth rather than
   * the control.
   */
  auth: () => ({
    googleClientId: str('GOOGLE_OAUTH_CLIENT_ID'),
    googleClientSecret: str('GOOGLE_OAUTH_CLIENT_SECRET'),
    allowedDomains: str('AUTH_ALLOWED_DOMAINS')
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
  }),

  /**
   * Transactional email.
   *
   * Infinito rather than Brevo: a Brevo key is restricted to an allowlist of
   * IP addresses, so every machine that ran this app — including a laptop on
   * a changing home connection — had to be registered before one mail would
   * leave it. Infinito authenticates on a client id and password and does
   * not care where the request came from.
   *
   * Only the credentials and the fallback sender live here. Everything about
   * how mail is addressed is in the database, so a Super Admin can change it
   * without a deploy.
   */
  email: () => ({
    infinitoClientId: str('INFINITO_CLIENT_ID'),
    infinitoClientPassword: str('INFINITO_CLIENT_PASSWORD'),
    /** Where Infinito posts delivery receipts. Optional; omitted when blank. */
    infinitoDlrUrl: str('INFINITO_DLR_URL'),
    /** Seeds the From address the first time the settings row is created. */
    defaultFrom: str('EMAIL_FROM'),
    /**
     * Where a mail's "Open the request" button points. A mail is read away
     * from the app, so a relative link is useless; without this the button
     * is left out rather than rendered broken.
     */
    publicBaseUrl: str('PUBLIC_BASE_URL') || str('NEXTAUTH_URL'),
  }),

  landingPage: () => ({
    timeoutMs: num('LANDING_PAGE_TIMEOUT_SECONDS', 15) * 1000,
    maxBytes: num('LANDING_PAGE_MAX_BYTES', 2_000_000),
  }),

  schedulerEnabled: () => bool('SCHEDULER_ENABLED', false),
} as const;

// ─── Integration readiness (for the Integrations Health page) ────────────────

export type IntegrationKey = 'googleAds' | 'gemini' | 'ga4' | 'database';

export type IntegrationStatus = {
  key: IntegrationKey;
  label: string;
  /** True when every credential the integration needs is present. */
  configured: boolean;
  /** Which env vars are missing — names only, never values. */
  missing: string[];
  /** A redacted hint so an admin can tell *which* account is wired up. */
  hint: string | null;
  description: string;
};

/** Last 4 characters only — enough to identify a credential, useless to steal. */
function tail(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
}

export function integrationStatuses(): IntegrationStatus[] {
  const ads = env.googleAds();
  const gem = env.gemini();
  const ga4 = env.ga4();

  const adsMissing = (
    [
      ['GOOGLE_ADS_DEVELOPER_TOKEN', ads.developerToken],
      ['GOOGLE_ADS_CLIENT_ID', ads.clientId],
      ['GOOGLE_ADS_CLIENT_SECRET', ads.clientSecret],
      ['GOOGLE_ADS_REFRESH_TOKEN', ads.refreshToken],
      ['GOOGLE_ADS_LOGIN_CUSTOMER_ID', ads.loginCustomerId],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const ga4Missing = (
    [
      ['GA4_PROPERTY_ID', ga4.propertyId],
      ['GA4_CLIENT_EMAIL', ga4.clientEmail],
      ['GA4_PRIVATE_KEY', ga4.privateKey],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return [
    {
      key: 'database',
      label: 'PostgreSQL',
      configured: Boolean(env.databaseUrl()),
      missing: env.databaseUrl() ? [] : ['DATABASE_URL'],
      hint: null,
      description: 'Stores the CRM tables and the synced Google Ads snapshots.',
    },
    {
      key: 'googleAds',
      label: 'Google Ads API',
      configured: adsMissing.length === 0,
      missing: adsMissing,
      hint: ads.loginCustomerId ? `MCC ${ads.loginCustomerId}` : null,
      description: 'Reads accounts, campaigns, keywords and search terms under the MCC.',
    },
    {
      key: 'gemini',
      label: 'Google Gemini',
      configured: Boolean(gem.apiKey),
      missing: gem.apiKey ? [] : ['GEMINI_API_KEY'],
      hint: gem.apiKey ? `${gem.model} · key ${tail(gem.apiKey)}` : null,
      description: 'Generates responsive search ad headlines and descriptions.',
    },
    {
      key: 'ga4',
      label: 'Google Analytics 4',
      configured: ga4Missing.length === 0,
      missing: ga4Missing,
      hint: ga4.propertyId ? `property ${ga4.propertyId}` : null,
      description:
        'Traffic, engagement, conversions and audience reports. Not configured in the source project — add a service account to enable.',
    },
  ];
}
