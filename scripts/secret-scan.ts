/**
 * Fail the build if a secret from `.env` reaches the browser bundle.
 *
 * The brief requires that all Google Ads, GA4 and Gemini calls happen
 * server-side and that no secrets appear in the client bundle. In Next.js the
 * boundary is easy to cross by accident: referencing `process.env.X` from a
 * file that a Client Component imports inlines the value into the chunk, with
 * no error. This reads the real values and looks for them in what actually
 * shipped, which is the only check that cannot be fooled by intent.
 *
 * Run after `next build`, against `.next/static`.
 *
 * What this does and does not cover. `.next/static` is what the browser
 * downloads as JavaScript, so this catches a secret re-exposed under a
 * NEXT_PUBLIC_ name and one pasted into a client module as a literal. It does
 * not see a secret a Server Component passes to a Client Component as a prop:
 * that is serialised into the RSC payload of the rendered page at request
 * time, never into a build artifact. Guarding that is what `server-only` and
 * the Principal shape are for — `lib/redact.ts` strips money before
 * serialisation for the same reason.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Values that are configuration, not credentials, and may legitimately ship.
 *
 * Each needs a reason, because the cost of a wrong entry here is a leaked
 * secret that the check waves through.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  APP_ENV: 'the literal "development"/"production", which appears in any bundle',
  APP_DEBUG: 'a boolean',
  APP_LOG_JSON: 'a boolean',
  AUTH_ENABLED: 'a boolean',
  SCHEDULER_ENABLED: 'a boolean',
  DB_POOL_SIZE: 'a number',
  DB_MAX_OVERFLOW: 'a number',
  SMTP_PORT: 'a number',
  AD_COPY_LLM_PROVIDER: 'a provider name, not a credential',
  GEMINI_MODEL: 'a public model id',
  AUTH_ALLOWED_DOMAINS: 'the sign-in placeholder shows the domain',
  NEXTAUTH_URL: "the app's own origin, which the NextAuth client needs",
  PUBLIC_BASE_URL: 'public by name',
  EMAIL_FROM: 'a sender address shown to recipients',
  SMTP_FROM: 'a sender address shown to recipients',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: 'the MCC id, visible in the account picker',
  GA4_PROPERTY_ID: 'a property id, useless without the service-account key',
  SEED_ADMIN_EMAIL: 'an email address, not a credential',
};

/** Values shorter than this match too much to mean anything. */
const MIN_LENGTH = 8;

function parseEnv(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out.set(key, value);
  }
  return out;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function main() {
  const root = process.cwd();
  const envPath = resolve(root, '.env');
  const bundleDir = resolve(root, '.next/static');

  if (!existsSync(envPath)) {
    console.error('No .env to check against.');
    process.exit(1);
  }
  if (!existsSync(bundleDir)) {
    console.error('No .next/static — run `npm run build` first.');
    process.exit(1);
  }

  if (existsSync(join(bundleDir, 'development'))) {
    console.error('.next/static holds a dev build (a `development` directory is present).');
    console.error('Stop `next dev`, run `npm run build`, then re-run this check —');
    console.error('a dev bundle is not what ships, so scanning it proves nothing.');
    process.exit(1);
  }

  const env = parseEnv(envPath);
  const bundle = walk(bundleDir).map((f) => readFileSync(f, 'utf8'));

  const leaked: string[] = [];
  let checked = 0;
  let skipped = 0;

  for (const [key, value] of Array.from(env.entries())) {
    if (key.startsWith('NEXT_PUBLIC_') || key in PUBLIC_BY_DESIGN || value.length < MIN_LENGTH) {
      skipped += 1;
      continue;
    }
    checked += 1;
    // A secret is reported by name only. Printing the value would put it in
    // CI logs, which is the thing this script exists to prevent.
    if (bundle.some((text) => text.includes(value))) leaked.push(key);
  }

  console.log(`Scanned ${bundle.length} client file(s) for ${checked} secret value(s).`);
  console.log(`${skipped} skipped as public by design or too short to be meaningful.`);

  if (leaked.length) {
    console.error(`\n${leaked.length} secret(s) reached the client bundle:`);
    for (const key of leaked) console.error(`  - ${key}`);
    console.error('\nMove the read into a server-only module, or a Route Handler.');
    process.exit(1);
  }
  console.log('\nNo secret values found in the client bundle.');
}

main();
