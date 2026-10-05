/**
 * End-to-end check of the workflow and RBAC, driven through the HTTP API the
 * way the browser drives it — so a guard that only exists in a component
 * cannot make this pass.
 *
 *   npm run e2e
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ALL_FEATURES, SEED_ROLES } from '@/lib/rbac/features';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A cookie jar just rich enough for NextAuth's csrf + session pair. */
class Session {
  private cookies = new Map<string, string>();

  private header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private absorb(res: Response) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const idx = pair!.indexOf('=');
      if (idx > 0) this.cookies.set(pair!.slice(0, idx), pair!.slice(idx + 1));
    }
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const supplied = (init.headers ?? {}) as Record<string, string>;
    // Default a JSON content type, but never over a caller's own — the
    // NextAuth credentials callback is form-encoded and silently fails to
    // parse if this header is replaced.
    const headers: Record<string, string> = { ...supplied, Cookie: this.header() };
    if (init.body && !Object.keys(supplied).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual', headers });
    this.absorb(res);
    return res;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const res = await this.fetch(path, init);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body: body as T };
  }

  async csrf(): Promise<{ csrfToken: string }> {
    const res = await this.fetch('/api/auth/csrf');
    return (await res.json()) as { csrfToken: string };
  }

  /** What useSession().update() does on the wire: re-read the JWT from the DB. */
  async refreshSession(): Promise<number> {
    const { csrfToken } = await this.csrf();
    const res = await this.fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrfToken, data: {} }),
    });
    return res.status;
  }

  async login(email: string, password: string): Promise<boolean> {
    const { csrfToken } = await this.csrf();
    await this.fetch('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }).toString(),
    });
    const { body } = await this.json<{ user?: { email: string } }>('/api/auth/session');
    return body?.user?.email === email.toLowerCase();
  }
}

const TEST_PASSWORD = 'E2ePassw0rdCheck';

/**
 * A dedicated role per test persona, rebuilt from SEED_ROLES on every run.
 *
 * The first version of this assigned test users to the *live* seeded roles.
 * That made the suite depend on configuration a Super Admin is entitled to
 * change: the moment someone revoked DASHBOARD:VIEW from Operations through
 * the matrix — which is exactly what the matrix is for — the suite failed and
 * pointed at the wrong thing. A test must not break because the product was
 * used correctly.
 *
 * These roles are disposable fixtures. Resetting them every run also means an
 * interrupted run cannot leave a half-configured role behind.
 */
/**
 * Minimal RFC 4180 reader.
 *
 * Splitting a row on commas is wrong the moment a value contains one: a
 * campaign called "Maya Academy of Advanced Creativity, Bhopal" yields one
 * cell too many and shifts every column after it, which made an earlier
 * version of the export check report a leak that was not there.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function ensureRole(sourceSlug: string) {
  const def = SEED_ROLES.find((r) => r.slug === sourceSlug);
  if (!def) throw new Error(`no seeded role "${sourceSlug}" to model the fixture on`);

  const slug = `e2e-${sourceSlug}`;
  const role = await prisma.crmRole.upsert({
    where: { slug },
    create: {
      slug,
      name: `E2E ${def.name}`,
      description: 'Disposable fixture for the e2e suite.',
      isSystem: false,
      isSuperAdmin: def.isSuperAdmin ?? false,
      allAccounts: true,
    },
    update: {},
  });

  // Rewrite every toggle, so the fixture is exactly the seeded intent
  // regardless of what a previous run or a human left behind.
  const granted = new Set(def.features);
  await prisma.crmRolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.crmRolePermission.createMany({
    data: ALL_FEATURES.map((feature) => ({
      roleId: role.id,
      feature,
      allowed: granted.has(feature),
    })),
  });
  return role;
}

/** Create (or reset) a test user on its fixture role, past the password gate. */
async function ensureUser(email: string, name: string, roleSlug: string) {
  const role = await ensureRole(roleSlug);
  const password = await bcrypt.hash(TEST_PASSWORD, 10);
  return prisma.crmUser.upsert({
    where: { email },
    create: {
      email,
      name,
      password,
      roleId: role.id,
      isActive: true,
      mustChangePassword: false,
      allAccounts: true,
    },
    update: { password, roleId: role.id, isActive: true, mustChangePassword: false },
  });
}

/**
 * Delete everything this suite created.
 *
 * Order matters: the RESTRICT foreign keys on landing scores, copy versions
 * and reviews have to go before the users that own them.
 */
async function cleanUpFixtures(): Promise<void> {
  const emails = [
    'e2e.ops@kollegeapply.com',
    'e2e.manager@kollegeapply.com',
    'e2e.ads@kollegeapply.com',
    'e2e.accountmanager@example.com',
    'e2e.pending-password@example.com',
    'e2e.exporter-no-money@example.com',
  ];
  const users = await prisma.crmUser.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length) {
    const requests = await prisma.crmAdRequest.findMany({
      where: { createdById: { in: userIds } },
      select: { id: true },
    });
    const requestIds = requests.map((r) => r.id);
    await prisma.crmLandingScore.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.crmAdCopyVersion.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.crmAdRequestReview.deleteMany({ where: { reviewerId: { in: userIds } } });
    if (requestIds.length) {
      await prisma.crmAdRequest.deleteMany({ where: { id: { in: requestIds } } });
    }
    await prisma.crmUser.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.crmRole.deleteMany({ where: { slug: { startsWith: 'e2e-' } } });
}

async function main() {
  console.log(`\nRunning against ${BASE}\n`);

  console.log('Setting up test users…');
  const ops = await ensureUser('e2e.ops@kollegeapply.com', 'E2E Operations', 'operations');
  const manager = await ensureUser('e2e.manager@kollegeapply.com', 'E2E Manager', 'manager');
  const adsTeam = await ensureUser('e2e.ads@kollegeapply.com', 'E2E Ads Team', 'google-ads-team');

  const opsSession = new Session();
  const managerSession = new Session();
  const adsSession = new Session();

  console.log('\n── Authentication ──');
  check('Operations can sign in', await opsSession.login(ops.email, TEST_PASSWORD));
  check('Manager can sign in', await managerSession.login(manager.email, TEST_PASSWORD));
  check('Ads team can sign in', await adsSession.login(adsTeam.email, TEST_PASSWORD));

  const bad = new Session();
  check('A wrong password is refused', !(await bad.login(ops.email, 'not-the-password')));

  const anon = new Session();
  const anonRes = await anon.json('/api/dashboard/overview?days=7');
  check('An unauthenticated API call is 401', anonRes.status === 401, `got ${anonRes.status}`);

  console.log('\n── RBAC enforcement (server side) ──');

  // Operations has no FINANCIALS:VIEW, so spend must not reach them at all.
  const opsOverview = await opsSession.json<{ totals: { cost: number | null }; canSeeMoney: boolean }>(
    '/api/dashboard/overview?days=30'
  );
  check(
    'Operations is refused financial data',
    opsOverview.status === 200 && opsOverview.body.canSeeMoney === false && opsOverview.body.totals.cost === null,
    `canSeeMoney=${opsOverview.body?.canSeeMoney}, cost=${opsOverview.body?.totals?.cost}`
  );

  const mgrOverview = await managerSession.json<{ totals: { cost: number | null }; canSeeMoney: boolean }>(
    '/api/dashboard/overview?days=30'
  );
  check(
    'Manager receives financial data',
    mgrOverview.status === 200 && mgrOverview.body.canSeeMoney === true && typeof mgrOverview.body.totals.cost === 'number',
    `cost=${mgrOverview.body?.totals?.cost}`
  );

  const opsUsers = await opsSession.json('/api/admin/users');
  check('Operations cannot list users', opsUsers.status === 403, `got ${opsUsers.status}`);

  const opsRoles = await opsSession.json('/api/admin/roles');
  check('Operations cannot read the role matrix', opsRoles.status === 403, `got ${opsRoles.status}`);

  const opsExport = await opsSession.json('/api/export?dataset=accounts&days=7');
  check('Operations cannot export accounts', opsExport.status === 403, `got ${opsExport.status}`);

  // A rolling refresh and a historical backfill have very different costs; the
  // Ads team holds SYNC:CREATE for the first but must not be able to launch
  // the second, which is hours of calls against a shared daily quota.
  const adsRefresh = await adsSession.json('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ entities: ['campaigns'], lookbackDays: 1, customerIds: ['0000000000'] }),
  });
  check(
    'Ads team may trigger a rolling refresh',
    adsRefresh.status !== 403,
    `got ${adsRefresh.status}`
  );

  const adsBackfill = await adsSession.json<{ error: string }>('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ entities: ['campaigns'], start: '2025-01-01', end: '2025-01-31' }),
  });
  check(
    'Ads team cannot launch a historical backfill',
    adsBackfill.status === 403,
    `got ${adsBackfill.status}`
  );

  const opsBackfill = await opsSession.json('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ entities: ['campaigns'], start: '2025-01-01', end: '2025-01-31' }),
  });
  check('Operations cannot backfill either', opsBackfill.status === 403, `got ${opsBackfill.status}`);

  const badRange = await adsSession.json('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ entities: ['campaigns'], start: '2025-03-01', end: '2025-01-01' }),
  });
  check('An inverted backfill range is refused', badRange.status === 400, `got ${badRange.status}`);

  const opsCopy = await opsSession.json('/api/ai/ad-copy', {
    method: 'POST',
    body: JSON.stringify({ tone: 'professional', product: 'x', landingPageUrl: 'https://example.com' }),
  });
  check('Operations cannot generate AI copy', opsCopy.status === 403, `got ${opsCopy.status}`);

  console.log('\n── Workflow: Operations raises a request ──');

  const created = await opsSession.json<{ id: string; reference: string; status: string }>(
    '/api/ad-requests',
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'E2E check — MBA Admissions 2026',
        objective: 'LEAD_GENERATION',
        productService: 'Two-year full-time MBA',
        targetAudience: 'Graduates aged 21-26 in India',
        location: 'Bangalore',
        budget: 250000,
        startDate: new Date().toISOString().slice(0, 10),
        adUrlClientlpDesktop: 'https://www.kollegeapply.com/',
        usps: 'NAAC A++, scholarships, placement support',
        keywords: 'mba admission\nbest mba college',
      }),
    }
  );
  check('Operations creates a draft', created.status === 200 && created.body.status === 'DRAFT', created.body?.reference);
  const requestId = created.body.id;

  const submitted = await opsSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'SUBMITTED' }) }
  );
  check(
    'Operations submits, and the system advances to awaiting an Account Manager',
    submitted.status === 200 && submitted.body.status === 'AWAITING_AM_ASSIGNMENT',
    `got ${submitted.body?.status}`
  );

  // Ops now holds APPROVE: on the 13-step flow Ops reviews the ads and
  // applies the budget. What it still cannot do is skip a step.
  const skipAhead = await opsSession.json(`/api/ad-requests/${requestId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ target: 'LIVE' }),
  });
  check('A request cannot skip to Live from the start', skipAhead.status === 409, `got ${skipAhead.status}`);

  console.log('\n── Workflow: steps 3-4, the Account Manager ──');

  // Step 3 hands the account to whoever will build it.
  const amUser = adsTeam;

  const noAm = await managerSession.json<{ error: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'AM_ASSIGNED' }) }
  );
  check('Assigning with nobody named is refused', noAm.status === 400, noAm.body?.error);

  const opsCannotAssign = await opsSession.json<{ error: string }>(
    `/api/ad-requests/${requestId}/transition`,
    {
      method: 'POST',
      body: JSON.stringify({ target: 'AM_ASSIGNED', adSpecialistId: amUser.id, budget: 250000, requiredCpl: 2500 }),
    }
  );
  check(
    'Operations cannot assign anyone',
    opsCannotAssign.status === 403,
    `got ${opsCannotAssign.status}`
  );

  // The money is settled here, with the person. Assigning somebody and
  // leaving them to build with no budget was the complaint that moved it.
  const noBudget = await managerSession.json<{ error: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'AM_ASSIGNED', adSpecialistId: amUser.id }) }
  );
  check('Assigning without a budget and CPL is refused', noBudget.status === 400, noBudget.body?.error);

  const amAssigned = await managerSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    {
      method: 'POST',
      body: JSON.stringify({ target: 'AM_ASSIGNED', adSpecialistId: amUser.id, budget: 250000, requiredCpl: 2500 }),
    }
  );
  check(
    'The Manager assigns the Ad Specialist with the budget, and the system advances to awaiting ads',
    amAssigned.status === 200 && amAssigned.body.status === 'AWAITING_AD_SUBMISSION',
    `got ${amAssigned.body?.status}`
  );

  const funded = await prisma.crmAdRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { budget: true, requiredCpl: true },
  });
  check(
    'The budget and CPL are on the request from the assignment onwards',
    Number(funded.budget) === 250000 && Number(funded.requiredCpl) === 2500,
    `budget=${funded.budget}, cpl=${funded.requiredCpl}`
  );

  console.log('\n── Workflow: steps 5-8, submission and the recheck loop ──');

  const adsSubmitted = await adsSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'ADS_SUBMITTED' }) }
  );
  check(
    'The Ad Specialist submits, and the system opens the review',
    adsSubmitted.status === 200 && adsSubmitted.body.status === 'UNDER_REVIEW',
    `got ${adsSubmitted.body?.status}`
  );

  const noRemark = await opsSession.json<{ error: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'RECHECK_REQUESTED' }) }
  );
  check('A recheck with no remarks is refused', noRemark.status === 400, noRemark.body?.error);

  // Three rounds, as the brief asks for.
  for (const round of [1, 2, 3]) {
    const recheck = await opsSession.json<{ status: string }>(
      `/api/ad-requests/${requestId}/transition`,
      { method: 'POST', body: JSON.stringify({ target: 'RECHECK_REQUESTED', reason: `Round ${round}: tighten the copy.` }) }
    );
    check(`Recheck round ${round} is requested`, recheck.status === 200 && recheck.body.status === 'RECHECK_REQUESTED');

    const again = await adsSession.json<{ status: string }>(
      `/api/ad-requests/${requestId}/transition`,
      { method: 'POST', body: JSON.stringify({ target: 'ADS_SUBMITTED' }) }
    );
    check(`Round ${round} is resubmitted and back under review`, again.status === 200 && again.body.status === 'UNDER_REVIEW');
  }

  console.log('\n── Workflow: review to live ──');

  const reviewApproved = await opsSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'REVIEW_APPROVED' }) }
  );
  check('Ops approves the review', reviewApproved.status === 200 && reviewApproved.body.status === 'REVIEW_APPROVED');

  // The funding step and the second handover are gone: the budget was
  // settled at assignment and the Specialist was named there, so asking a
  // Manager to pick the same person again read as if it had not taken.
  for (const retired of ['BUDGET_APPROVED', 'ACCOUNT_ASSIGNED'] as const) {
    const gone = await managerSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/transition`,
      {
        method: 'POST',
        body: JSON.stringify({ target: retired, adSpecialistId: adsTeam.id, budget: 250000, requiredCpl: 2500 }),
      }
    );
    check(`${retired} is no longer a step anything moves to`, gone.status === 409, `got ${gone.status}`);
  }

  const liveAccount = await prisma.campaigns.groupBy({
    by: ['account_id'],
    _count: { _all: true },
    orderBy: { _count: { account_id: 'desc' } },
    take: 1,
  });
  const accountId = liveAccount[0]?.account_id ?? null;
  if (accountId !== null) {
    const linkAccount = await managerSession.json<{ accountId: number | null }>(
      `/api/ad-requests/${requestId}/account`,
      { method: 'PUT', body: JSON.stringify({ accountId }) }
    );
    check(
      'The Google Ads account is set on the request',
      linkAccount.status === 200 && linkAccount.body.accountId === accountId,
      `got ${linkAccount.body?.accountId}`
    );
  }

  const specialistQueue = await adsSession.json<{ rows: Array<{ id: string }> }>(
    '/api/ad-requests?status=AWAITING_AD_SUBMISSION,RECHECK_REQUESTED,REVIEW_APPROVED,LIVE'
  );
  check(
    'It reaches the Ad Specialist queue',
    specialistQueue.status === 200 && specialistQueue.body.rows.some((r) => r.id === requestId)
  );

  const copy = await adsSession.json<{
    headlines: Array<{ text: string; characters: number }>;
    descriptions: Array<{ text: string; characters: number }>;
    backend: string;
    validation: { flags: Array<{ level: string }> };
    savedVersion: { version: number } | null;
  }>('/api/ai/ad-copy', {
    method: 'POST',
    body: JSON.stringify({ requestId, tone: 'professional', save: true }),
  });
  check(
    'Ads team generates ad copy',
    copy.status === 200 && copy.body.headlines.length >= 3 && copy.body.descriptions.length >= 2,
    `${copy.body?.headlines?.length} headlines, ${copy.body?.descriptions?.length} descriptions via ${copy.body?.backend}`
  );
  check(
    'Every headline is within 30 characters',
    (copy.body.headlines ?? []).every((h) => h.text.length <= 30)
  );
  check(
    'Every description is within 90 characters',
    (copy.body.descriptions ?? []).every((d) => d.text.length <= 90)
  );
  check(
    'The generated copy has no validation errors',
    (copy.body.validation?.flags ?? []).filter((f) => f.level === 'error').length === 0
  );
  check('The version was saved to the request', copy.body.savedVersion?.version === 1);

  const score = await adsSession.json<{ score: number; grade: string; suggestions: string[] }>(
    '/api/ai/landing-score',
    { method: 'POST', body: JSON.stringify({ url: 'https://www.kollegeapply.com/', requestId }) }
  );
  check(
    'Ads team scores the landing page',
    score.status === 200 && typeof score.body.score === 'number',
    `${score.body?.score}/100 grade ${score.body?.grade}, ${score.body?.suggestions?.length} suggestion(s)`
  );

  const noCampaign = await adsSession.json<{ error: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'LIVE' }) }
  );
  check('Going live without a campaign ID is refused', noCampaign.status === 400, noCampaign.body?.error);

  const golive = await adsSession.json<{ status: string }>(`/api/ad-requests/${requestId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ target: 'LIVE', linkedCampaignId: '21345678901' }),
  });
  check(
    'The Ad Specialist takes it live',
    golive.status === 200 && golive.body.status === 'LIVE',
    `got ${golive.status} ${golive.body?.status ?? JSON.stringify(golive.body).slice(0, 90)}`
  );

  const completed = await adsSession.json<{ status: string }>(`/api/ad-requests/${requestId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ target: 'COMPLETED' }),
  });
  check(
    'The setup is completed',
    completed.status === 200 && completed.body.status === 'COMPLETED',
    `got ${completed.status} ${completed.body?.status ?? ''}`
  );

  const detail = await adsSession.json<{
    request: { linkedCampaignId: string; events: unknown[]; adCopyVersions: unknown[]; landingScores: unknown[] };
  }>(`/api/ad-requests/${requestId}`);
  check(
    'The campaign ID is linked to the request',
    detail.body.request.linkedCampaignId === '21345678901'
  );
  check(
    'The timeline recorded every step',
    detail.body.request.events.length >= 18,
    `${detail.body.request.events.length} events`
  );
  check('The copy version is attached', detail.body.request.adCopyVersions.length === 1);
  check('The landing score is attached', detail.body.request.landingScores.length === 1);

  console.log('\n── Changing the Google Ads account out of band ──');

  if (accountId !== null) {
    const opsRelink = await opsSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/account`,
      { method: 'PUT', body: JSON.stringify({ accountId }) }
    );
    check(
      'Operations cannot change the account, though it raised the request',
      opsRelink.status === 403,
      `got ${opsRelink.status}`
    );

    const adsRelink = await adsSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/account`,
      { method: 'PUT', body: JSON.stringify({ accountId }) }
    );
    check(
      'The Ad Specialist cannot either — it is a Manager decision',
      adsRelink.status === 403,
      `got ${adsRelink.status}`
    );

    const noop = await managerSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/account`,
      { method: 'PUT', body: JSON.stringify({ accountId }) }
    );
    check('Re-picking the same account is refused', noop.status === 400, noop.body?.error);

    const ghost = await managerSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/account`,
      { method: 'PUT', body: JSON.stringify({ accountId: 2_000_000_000 }) }
    );
    check('An account that does not exist is refused', ghost.status === 400, ghost.body?.error);

    // The optimistic lock holds here too: this changes which numbers the
    // request is judged by, so a stale page must not win.
    const stale = await managerSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/account`,
      { method: 'PUT', body: JSON.stringify({ accountId: null, expectedVersion: 0 }) }
    );
    check('A stale version is refused', stale.status === 409, `got ${stale.status}`);

    const unlink = await managerSession.json<{ accountId: number | null; version: number }>(
      `/api/ad-requests/${requestId}/account`,
      { method: 'PUT', body: JSON.stringify({ accountId: null }) }
    );
    check(
      'The Manager can unlink it',
      unlink.status === 200 && unlink.body.accountId === null,
      `got ${unlink.status}`
    );

    const unlinked = await managerSession.json<{
      assignments: Array<{ id: string; campaignCount: number }>;
    }>('/api/assigned-campaigns?days=90');
    check(
      'With no account the assignment stays listed, reporting nothing',
      (unlinked.body.assignments ?? []).find((a) => a.id === requestId)?.campaignCount === 0,
      `${unlinked.body.assignments?.find((a) => a.id === requestId)?.campaignCount} campaign(s)`
    );

    const relink = await managerSession.json<{ accountId: number | null }>(
      `/api/ad-requests/${requestId}/account`,
      { method: 'PUT', body: JSON.stringify({ accountId }) }
    );
    check('And link it back', relink.status === 200 && relink.body.accountId === accountId);

    const trail = await prisma.crmAuditLog.count({
      where: { action: 'REQUEST_ACCOUNT_CHANGED', targetId: requestId },
    });
    check('Every account change is audited', trail >= 2, `${trail} row(s)`);
  }

  console.log('\n── Linking many campaigns to one request ──');

  if (accountId !== null) {
    const pool = await prisma.campaigns.findMany({
      where: { account_id: accountId },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 4,
    });
    const picks = pool.map((c) => c.id);

    const opsLink = await opsSession.json(`/api/ad-requests/${requestId}/campaigns`, {
      method: 'PUT',
      body: JSON.stringify({ campaignIds: picks }),
    });
    check('Operations cannot link campaigns', opsLink.status === 403, `got ${opsLink.status}`);

    const ghostLink = await managerSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/campaigns`,
      { method: 'PUT', body: JSON.stringify({ campaignIds: [2_000_000_000] }) }
    );
    check('A campaign that does not exist is refused', ghostLink.status === 400, ghostLink.body?.error);

    const tooMany = await managerSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/campaigns`,
      {
        method: 'PUT',
        body: JSON.stringify({ campaignIds: Array.from({ length: 60 }, (_, i) => i + 1) }),
      }
    );
    check('More than the cap is refused', tooMany.status === 400, `got ${tooMany.status}`);

    const linked = await managerSession.json<{ campaigns: Array<{ id: number }> }>(
      `/api/ad-requests/${requestId}/campaigns`,
      { method: 'PUT', body: JSON.stringify({ campaignIds: picks }) }
    );
    check(
      'The Manager links several campaigns at once',
      linked.status === 200 && linked.body.campaigns.length === picks.length,
      `${linked.body.campaigns?.length ?? 0} of ${picks.length}`
    );

    const repeat = await managerSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/campaigns`,
      { method: 'PUT', body: JSON.stringify({ campaignIds: picks }) }
    );
    check('Re-saving the same set is refused', repeat.status === 400, repeat.body?.error);

    // The whole point: reporting narrows from the account to the picked set.
    const narrowed = await managerSession.json<{
      assignments: Array<{ id: string; campaignCount: number; linkedCampaignCount: number }>;
    }>(`/api/assigned-campaigns?days=90&specialistId=${adsTeam.id}`);
    const narrowRow = narrowed.body.assignments?.find((a) => a.id === requestId);
    check(
      'Reporting narrows from the whole account to the linked campaigns',
      narrowRow?.campaignCount === picks.length && narrowRow?.linkedCampaignCount === picks.length,
      `${narrowRow?.campaignCount} campaign(s), ${narrowRow?.linkedCampaignCount} linked`
    );

    const deep = await managerSession.json<{
      basis: string;
      campaignCount: number;
      campaigns: unknown[];
      adGroups: unknown[];
      keywords: unknown[];
      searchTerms: unknown[];
      totals: { cost: number | null };
    }>(`/api/ad-requests/${requestId}/performance?days=90`);
    check(
      'The deep view reports on exactly the linked campaigns',
      deep.status === 200 && deep.body.basis === 'LINKED' && deep.body.campaignCount === picks.length,
      `basis=${deep.body?.basis}, ${deep.body?.campaignCount} campaign(s)`
    );
    check(
      'It drills through ad groups, keywords and search terms',
      Array.isArray(deep.body.adGroups) &&
        Array.isArray(deep.body.keywords) &&
        Array.isArray(deep.body.searchTerms),
      `${deep.body.adGroups?.length} ad groups, ${deep.body.keywords?.length} keywords, ${deep.body.searchTerms?.length} terms`
    );

    const opsDeep = await opsSession.json<{ totals: { cost: number | null }; requiredCpl: number | null }>(
      `/api/ad-requests/${requestId}/performance?days=90`
    );
    check(
      'The deep view withholds money from a role without it',
      opsDeep.status === 200 &&
        opsDeep.body.totals.cost === null &&
        opsDeep.body.requiredCpl === null,
      `cost=${opsDeep.body?.totals?.cost}`
    );

    // Unlinking everything must report nothing, not silently widen back to
    // the account — that would credit a request with campaigns nobody put
    // on it.
    const cleared = await managerSession.json<{ campaigns: unknown[] }>(
      `/api/ad-requests/${requestId}/campaigns`,
      { method: 'PUT', body: JSON.stringify({ campaignIds: [] }) }
    );
    check('All campaigns can be unlinked', cleared.status === 200 && cleared.body.campaigns.length === 0);

    const afterClear = await managerSession.json<{
      assignments: Array<{ id: string; campaignCount: number; linkedCampaignCount: number }>;
    }>(`/api/assigned-campaigns?days=90&specialistId=${adsTeam.id}`);
    const clearedRow = afterClear.body.assignments?.find((a) => a.id === requestId);
    check(
      'With nothing linked the account stands in again',
      (clearedRow?.campaignCount ?? 0) > picks.length && clearedRow?.linkedCampaignCount === 0,
      `${clearedRow?.campaignCount} campaign(s)`
    );

    // Put the links back so the sections after this see the narrow set.
    await managerSession.json(`/api/ad-requests/${requestId}/campaigns`, {
      method: 'PUT',
      body: JSON.stringify({ campaignIds: picks }),
    });

    const detail = await managerSession.json<{
      request: { linkedCampaigns: Array<{ id: number; name: string | null }> };
    }>(`/api/ad-requests/${requestId}`);
    check(
      'The request detail carries the linked campaigns',
      detail.body.request.linkedCampaigns?.length === picks.length,
      `${detail.body.request.linkedCampaigns?.length} campaign(s)`
    );

    const allOptions = await managerSession.json<{ campaigns: unknown[]; total: number }>(
      '/api/campaigns/options'
    );
    const options = await managerSession.json<{
      campaigns: Array<{ accountId: number }>;
      total: number;
    }>(`/api/campaigns/options?accountId=${accountId}`);
    check(
      'The picker lists campaigns',
      options.status === 200 && options.body.campaigns.length > 0,
      `${options.body.campaigns?.length} of ${options.body.total}`
    );
    check(
      'And narrowing by account actually narrows it',
      options.body.total < allOptions.body.total &&
        options.body.campaigns.every((c) => c.accountId === accountId),
      `${options.body.total} vs ${allOptions.body.total} unfiltered`
    );
  }

  console.log('\n── Assigned campaign performance ──');

  const mgrAssigned = await managerSession.json<{
    canSeeAll: boolean;
    canSeeMoney: boolean;
    onlyMine: boolean;
    assignments: Array<{
      id: string;
      specialistName: string | null;
      requiredCpl: number | null;
      pacing: string | null;
    }>;
    specialists: Array<{ id: string; name: string }>;
  }>('/api/assigned-campaigns?days=30');
  check(
    'The Manager sees everybody\'s assignments',
    mgrAssigned.status === 200 && mgrAssigned.body.canSeeAll === true,
    `got ${mgrAssigned.status}`
  );
  const mgrRow = mgrAssigned.body.assignments?.find((a) => a.id === requestId);
  check(
    'The assigned request appears on the performance page',
    Boolean(mgrRow),
    `${mgrAssigned.body.assignments?.length ?? 0} row(s)`
  );
  check(
    'It carries the CPL the Manager approved at step 10',
    mgrRow?.requiredCpl === 2500,
    `got ${mgrRow?.requiredCpl}`
  );
  check(
    'Every row has an Ad Specialist on it',
    (mgrAssigned.body.assignments ?? []).every((a) => a.specialistName !== null)
  );
  check(
    'The specialist picker is built from the rows in view',
    (mgrAssigned.body.specialists ?? []).some((s) => s.id === adsTeam.id)
  );

  // The request went live against a made-up campaign ID, so the linked-campaign
  // rule finds nothing and the account rule is what has to carry it.
  const mgrCampaigns = await managerSession.json<{
    assignments: Array<{ id: string; campaignCount: number; cost: number | null }>;
    campaigns: Array<{ id: number }>;
    totals: { campaigns: number };
  }>(`/api/assigned-campaigns?days=90&specialistId=${adsTeam.id}`);
  const specialistRow = mgrCampaigns.body.assignments?.find((a) => a.id === requestId);
  check(
    'Filtering by Ad Specialist narrows to their rows',
    mgrCampaigns.status === 200 && Boolean(specialistRow),
    `${mgrCampaigns.body.assignments?.length ?? 0} row(s)`
  );
  check(
    'The campaign view is built from the same assignments as the tiles',
    mgrCampaigns.body.campaigns.length === mgrCampaigns.body.totals.campaigns,
    `${mgrCampaigns.body.campaigns.length} vs ${mgrCampaigns.body.totals.campaigns}`
  );
  if (accountId !== null) {
    check(
      'The assignment reports against its campaigns',
      (specialistRow?.campaignCount ?? 0) > 0,
      `${specialistRow?.campaignCount ?? 0} campaign(s)`
    );
  }

  const adsAssigned = await adsSession.json<{
    canSeeAll: boolean;
    onlyMine: boolean;
    assignments: Array<{ id: string }>;
  }>('/api/assigned-campaigns?days=30');
  check(
    'The Ad Specialist sees their own assignment, scoped to themselves',
    adsAssigned.status === 200 &&
      adsAssigned.body.canSeeAll === false &&
      adsAssigned.body.onlyMine === true &&
      adsAssigned.body.assignments.some((a) => a.id === requestId),
    `got ${adsAssigned.status}, ${adsAssigned.body?.assignments?.length ?? 0} row(s)`
  );

  const opsAssigned = await opsSession.json<{
    canSeeMoney: boolean;
    assignments: Array<{ id: string; cost: number | null; requiredCpl: number | null; pacing: string | null }>;
    totals: { cost: number | null };
  }>('/api/assigned-campaigns?days=30');
  const opsRow = opsAssigned.body.assignments?.find((a) => a.id === requestId);
  check(
    'Operations sees the request it raised',
    Boolean(opsRow),
    `${opsAssigned.body.assignments?.length ?? 0} row(s)`
  );
  check(
    '…but with no spend, no CPL target and no pacing verdict',
    opsAssigned.body.canSeeMoney === false &&
      opsAssigned.body.totals.cost === null &&
      Boolean(opsRow) &&
      opsRow!.cost === null &&
      opsRow!.requiredCpl === null &&
      opsRow!.pacing === null,
    `cost=${opsRow?.cost}, cpl=${opsRow?.requiredCpl}, pacing=${opsRow?.pacing}`
  );

  // The verdict is as financial as the figures behind it: "over CPL" would
  // hand back exactly what the redaction above withheld.
  const opsPacing = await opsSession.json('/api/assigned-campaigns?days=30&pacing=OVER_CPL');
  check(
    'Operations cannot filter by CPL pacing either',
    opsPacing.status === 403,
    `got ${opsPacing.status}`
  );

  console.log('\n── Custom role: create, toggle, assign, verify ──');

  const admin = new Session();
  const adminOk = await admin.login(
    process.env.SEED_ADMIN_EMAIL ?? '',
    process.env.SEED_ADMIN_PASSWORD ?? ''
  );
  check('Super Admin can sign in', adminOk);

  if (adminOk) {
    // Start clean so a re-run does not trip the duplicate-name guard.
    await prisma.crmRole.deleteMany({ where: { slug: 'e2e-read-only' } });

    const role = await admin.json<{ id: string; name: string }>('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({ name: 'E2E Read Only', description: 'Created by the e2e check.' }),
    });
    check('Super Admin creates a custom role', role.status === 200, role.body?.name);

    const roleId = role.body.id;
    const grant = await admin.json(`/api/admin/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ feature: 'DASHBOARD:VIEW', allowed: true }),
    });
    check('A permission toggle saves', grant.status === 200);

    // Move the Operations test user onto the new role and confirm the change
    // bites without a sign-out: the JWT revalidates against the DB.
    await prisma.crmUser.update({ where: { id: ops.id }, data: { roleId } });

    const scoped = new Session();
    await scoped.login(ops.email, TEST_PASSWORD);

    const allowed = await scoped.json('/api/dashboard/overview?days=7');
    check('The custom role can reach what it was granted', allowed.status === 200, `got ${allowed.status}`);

    const denied = await scoped.json('/api/keywords?days=7');
    check('The custom role is refused what it was not granted', denied.status === 403, `got ${denied.status}`);

    // Assigned campaign performance joins two modules, and the endpoint
    // demands both. Granting only the workflow half must not open the
    // campaign half.
    await admin.json(`/api/admin/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ feature: 'AD_REQUESTS:VIEW', allowed: true }),
    });
    const flowOnly = await scoped.json('/api/ad-requests?limit=1');
    check('AD_REQUESTS:VIEW alone opens the request list', flowOnly.status === 200, `got ${flowOnly.status}`);
    const halfGranted = await scoped.json('/api/assigned-campaigns?days=7');
    check(
      'AD_REQUESTS:VIEW alone does not open campaign performance',
      halfGranted.status === 403,
      `got ${halfGranted.status}`
    );

    const revoke = await admin.json(`/api/admin/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ feature: 'DASHBOARD:VIEW', allowed: false }),
    });
    check('A permission can be revoked', revoke.status === 200);

    const afterRevoke = await scoped.json('/api/dashboard/overview?days=7');
    check(
      'Revoking takes effect on a live session',
      afterRevoke.status === 403,
      `got ${afterRevoke.status}`
    );

    const inUse = await admin.json<{ error: string }>(`/api/admin/roles/${roleId}`, {
      method: 'DELETE',
    });
    check('A role with users assigned cannot be deleted', inUse.status === 409, inUse.body?.error);

    // Put the user back on its fixture role so the delete guard clears.
    const opsFixture = await prisma.crmRole.findUniqueOrThrow({ where: { slug: 'e2e-operations' } });
    await prisma.crmUser.update({ where: { id: ops.id }, data: { roleId: opsFixture.id } });

    const deleted = await admin.json(`/api/admin/roles/${roleId}`, { method: 'DELETE' });
    check('An unassigned custom role can be deleted', deleted.status === 200);

    const systemRole = await prisma.crmRole.findUniqueOrThrow({ where: { slug: 'manager' } });
    const sysDelete = await admin.json<{ error: string }>(`/api/admin/roles/${systemRole.id}`, {
      method: 'DELETE',
    });
    check('A default role cannot be deleted', sysDelete.status === 409, sysDelete.body?.error);

    console.log('\n── Workflow email ──');

  const opsPreview = await opsSession.json('/api/admin/email/preview?event=REQUEST_SUBMITTED');
  check('Operations cannot preview the mail routing', opsPreview.status === 403, `got ${opsPreview.status}`);

  const adminMail = new Session();
  await adminMail.login(process.env.SEED_ADMIN_EMAIL ?? '', process.env.SEED_ADMIN_PASSWORD ?? '');

  // Only the events, not who they go to. Which audience each route uses is
  // configuration a Super Admin is entitled to change on the Email page, and
  // asserting the seeded default here would fail the suite the first time
  // somebody used the product correctly — the same trap the fixture roles
  // above exist to avoid. The defaults are pinned in the unit tests, where
  // they are a code constant rather than a live row.
  const FLOW_EVENTS = [
    'REQUEST_SUBMITTED',
    'REQUEST_SPECIALIST_ASSIGNED',
    'REQUEST_BUDGET_APPROVED',
    'REQUEST_ADS_SUBMITTED',
    'REQUEST_APPROVED',
    'REQUEST_LIVE',
    'REQUEST_CHANGES_REQUESTED',
    'REQUEST_REJECTED',
  ] as const;

  const config = await adminMail.json<{
    settings: { threadPerRequest: boolean };
    routes: Array<{ event: string; audience: string; enabled: boolean }>;
    events: Array<{ event: string }>;
  }>('/api/admin/email');
  check('The Email page lists a route for every flow step', config.status === 200 &&
    FLOW_EVENTS.every((e) => config.body.routes.some((r) => r.event === e)),
    `${config.body.routes?.length ?? 0} route(s)`);

  // One trail per request is the product behaviour, so it is worth asserting:
  // every mail about one request has to reach the client as the same subject,
  // give or take the Re: that clients strip before grouping.
  const subjects: string[] = [];
  const labels = new Set<string>();
  for (const event of FLOW_EVENTS) {
    const p = await adminMail.json<{ subject: string; stepLine: string | null }>(
      `/api/admin/email/preview?event=${event}`
    );
    subjects.push((p.body.subject ?? '').replace(/^Re:\s*/i, ''));
    if (p.body.stepLine) labels.add(p.body.stepLine);
  }
  if (config.body.settings?.threadPerRequest) {
    check(
      'Every mail about one request carries the same subject',
      new Set(subjects).size === 1,
      Array.from(new Set(subjects)).join(' | ')
    );
    check(
      'And each one still says which step it is, in the body',
      labels.size === FLOW_EVENTS.length,
      `${labels.size} distinct label(s) for ${FLOW_EVENTS.length} events`
    );
  } else {
    console.log('  SKIP  One trail per request is switched off; threading not exercised.');
  }

  // A rule that can never send must not be saveable: this is how the
  // "requirement raised" mail went quiet without anyone noticing.
  const unsendable = await adminMail.json<{ error: string }>('/api/admin/email', {
    method: 'PUT',
    body: JSON.stringify({
      ...config.body.settings,
      routes: (config.body.routes ?? []).map((r) =>
        r.event === 'REQUEST_SUBMITTED'
          ? { ...r, enabled: true, audience: 'FIXED', toEmails: '' }
          : r
      ),
    }),
  });
  check(
    'A rule with no possible recipient is refused on save',
    unsendable.status === 400 && /addresses below/i.test(unsendable.body?.error ?? ''),
    unsendable.body?.error ?? `got ${unsendable.status}`
  );

  const preview = await adminMail.json<{
    subject: string; html: string; text: string; skipped: string | null; step: string;
  }>('/api/admin/email/preview?event=REQUEST_BUDGET_APPROVED');
  check(
    'The budget mail previews with the full brief',
    preview.status === 200 &&
      preview.body.html.includes('Assigned budget') &&
      preview.body.html.includes('Required CPL'),
    preview.body?.subject
  );
  check(
    'A preview reports why it would not send, rather than pretending',
    typeof preview.body.skipped === 'string' || preview.body.skipped === null,
    preview.body?.skipped ?? 'would send'
  );

  const bogus = await adminMail.json<{ error: string }>('/api/admin/email/preview?event=NOT_A_THING');
  check('An unknown event is rejected', Boolean(bogus.body?.error), bogus.body?.error);

  console.log('\n── The assistant ──');

  const opsAsk = await opsSession.json('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'What did we spend last month?' }),
  });
  check('Operations cannot use the assistant', opsAsk.status === 403, `got ${opsAsk.status}`);

  const adsAsk = await adsSession.json('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'What did we spend last month?' }),
  });
  check('The Ads team cannot either', adsAsk.status === 403, `got ${adsAsk.status}`);

  const anonAsk = await new Session().json('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'hello' }),
  });
  check('An unauthenticated question is 401', anonAsk.status === 401, `got ${anonAsk.status}`);

  const menu = await managerSession.json<{ available: boolean; tools: Array<{ name: string }> }>(
    '/api/assistant'
  );
  check(
    'The Manager gets a tool menu',
    menu.status === 200 && menu.body.tools.some((t) => t.name === 'get_totals'),
    `${menu.body.tools?.length ?? 0} tool(s), gemini available=${menu.body.available}`
  );

  const blank = await managerSession.json('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: '   ' }),
  });
  check('An empty question is refused', blank.status === 400, `got ${blank.status}`);

  if (menu.body?.available) {
    // A real round trip. The question is deliberately one only a tool can
    // answer, so a model that invented a number would be visible.
    const asked = await managerSession.json<{
      text: string;
      trace: Array<{ name: string; ok: boolean; summary: string }>;
      hops: number;
    }>('/api/assistant', {
      method: 'POST',
      body: JSON.stringify({ message: 'How far back does our Google Ads data go, and when did we last sync?' }),
    });
    check(
      'The Manager gets an answer',
      asked.status === 200 && (asked.body.text ?? '').length > 20,
      `${(asked.body?.text ?? '').slice(0, 90)}…`
    );
    check(
      'And it was produced by a real tool call, not invented',
      (asked.body.trace ?? []).some((t) => t.ok),
      (asked.body.trace ?? []).map((t) => `${t.name}:${t.ok}`).join(', ') || 'no tool calls'
    );

    const audited = await prisma.crmAuditLog.count({ where: { action: 'ASSISTANT_QUERIED' } });
    check('Every question is audited', audited > 0, `${audited} row(s)`);
  } else {
    console.log('  SKIP  Gemini is not configured; the live round trip was not exercised.');
  }

  console.log('\n── Audit trail ──');
    const audit = await admin.json<{ rows: Array<{ action: string }> }>(
      '/api/admin/audit?limit=100'
    );
    const actions = new Set((audit.body.rows ?? []).map((r) => r.action));
    for (const expected of [
      'REQUEST_CREATED',
      'REQUEST_SUBMITTED',
      'REQUEST_APPROVED',
      'REQUEST_CHANGES_REQUESTED',
      'AI_COPY_GENERATED',
      'LANDING_PAGE_SCORED',
      'ROLE_CREATED',
      'PERMISSION_CHANGED',
      'ROLE_DELETED',
    ]) {
      check(`Audit recorded ${expected}`, actions.has(expected));
    }
  }

  // ── Export must redact money for a role that may export but not see it ───
  //
  // The 403 case above only proves a role without EXPORT is refused. It never
  // exercises stripMoney, which is the path that matters for a role that is
  // *meant* to export: the file must not carry spend the screen withholds.
  {
    const slug = 'e2e-exporter-no-money';
    const role = await prisma.crmRole.upsert({
      where: { slug },
      create: {
        slug,
        name: 'E2E Exporter Without Financials',
        description: 'Disposable fixture for the e2e suite.',
        isSystem: false,
        isSuperAdmin: false,
        allAccounts: true,
      },
      update: {},
    });
    await prisma.crmRolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.crmRolePermission.createMany({
      data: ALL_FEATURES.map((feature) => ({
        roleId: role.id,
        feature,
        // Everything needed to reach the export, and nothing that reveals money.
        allowed: feature !== 'FINANCIALS:VIEW',
      })),
    });

    const email = 'e2e.exporter-no-money@example.com';
    const password = await bcrypt.hash(TEST_PASSWORD, 10);
    await prisma.crmUser.upsert({
      where: { email },
      create: {
        email,
        name: 'E2E Exporter Without Financials',
        password,
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
        allAccounts: true,
      },
      update: { password, roleId: role.id, isActive: true, mustChangePassword: false },
    });

    const exporter = new Session();
    check('Exporter-without-financials can sign in', await exporter.login(email, TEST_PASSWORD));

    const res = await exporter.fetch('/api/export?dataset=campaigns&days=30');
    check('A role with EXPORT but not FINANCIALS gets its file', res.status === 200, `got ${res.status}`);

    const csv = res.status === 200 ? await res.text() : '';
    const table = parseCsv(csv);
    const header = table[0] ?? [];
    // Every money key stripMoney nulls, not just the three on the screen.
    const moneyColumns = ['cost', 'avgCpc', 'costPerConversion', 'budget', 'amount', 'spend']
      .map((c) => [c, header.indexOf(c)] as const)
      .filter(([, i]) => i >= 0);
    const rows = table.slice(1);
    const leaked = rows.filter((cells) =>
      moneyColumns.some(([, i]) => (cells[i] ?? '').trim() !== '')
    );
    check(
      'The exported file carries no spend figures',
      rows.length > 0 && moneyColumns.length > 0 && leaked.length === 0,
      `${rows.length} row(s), ${leaked.length} with money, checked: ${moneyColumns.map(([c]) => c).join(', ') || 'no money columns found'}`
    );

    await prisma.crmUser.deleteMany({ where: { email } });
    await prisma.crmRolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.crmRole.deleteMany({ where: { slug } });
  }

  // ── A pending password change must gate the API, not just the pages ──────
  //
  // The middleware matcher covers /dashboard/:path* and never sees /api/*, so
  // this was once bypassable: the browser bounced to /change-password while
  // the API happily returned every campaign and keyword. The password on such
  // an account is known to somebody else, which is the whole point of the gate.
  {
    const pendingEmail = 'e2e.pending-password@example.com';
    const role = await ensureRole('super-admin');
    const pendingPassword = 'E2ePendingPass1';
    await prisma.crmUser.upsert({
      where: { email: pendingEmail },
      create: {
        email: pendingEmail,
        name: 'E2E Pending Password',
        password: await bcrypt.hash(pendingPassword, 10),
        roleId: role.id,
        isActive: true,
        mustChangePassword: true,
        allAccounts: true,
      },
      update: {
        password: await bcrypt.hash(pendingPassword, 10),
        roleId: role.id,
        isActive: true,
        mustChangePassword: true,
      },
    });

    const pending = new Session();
    check('A user owing a password change can sign in', await pending.login(pendingEmail, pendingPassword));

    const blocked = await pending.fetch('/api/campaigns');
    check(
      'A user owing a password change is refused data from the API',
      blocked.status === 403,
      `got ${blocked.status}`
    );

    const wrongCurrent = await pending.fetch('/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'not-it', newPassword: 'E2eChangedPass1' }),
    });
    check(
      'The change-password endpoint still rejects a wrong current password',
      wrongCurrent.status === 400,
      `got ${wrongCurrent.status}`
    );

    const changed = await pending.fetch('/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: pendingPassword, newPassword: 'E2eChangedPass1' }),
    });
    check(
      'The change-password endpoint stays reachable while the gate is up',
      changed.status === 200,
      `got ${changed.status}`
    );

    await pending.refreshSession();
    const allowed = await pending.fetch('/api/campaigns');
    check(
      'The API opens once the password has been changed',
      allowed.status === 200,
      `got ${allowed.status}`
    );

    await prisma.crmUser.deleteMany({ where: { email: pendingEmail } });
  }

  // Leave nothing behind at all.
  //
  // This used to keep its users and roles "because a re-run reuses them",
  // which meant every test run repopulated the real Users and Roles screens
  // with e2e.* accounts. A suite that dirties the list it is testing is not
  // worth the few seconds it saves; the fixtures are rebuilt from SEED_ROLES
  // at the start of each run anyway.
  await prisma.crmAdRequest.deleteMany({ where: { id: requestId } });
  await cleanUpFixtures();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
