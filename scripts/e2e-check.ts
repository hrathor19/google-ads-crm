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
import { buildRequestBrief } from '@/lib/email/brief';

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
    'e2e.admin@kollegeapply.com',
    'e2e.accountmanager@example.com',
    'e2e.pending-password@example.com',
    'e2e.exporter-no-money@example.com',
    'e2e.planner-blocked@example.com',
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

/**
 * Point every mail this run triggers at a sink, and put the real settings
 * back when it is done.
 *
 * This suite drives the real workflow over HTTP, and every transition it
 * makes sends the real mail to the real recipients — the roles resolved
 * from the permission matrix, the global CC, and whatever each route adds.
 * So a test run mailed colleagues who had nothing to do with it, one copy
 * per transition, with a fixture college in the subject line.
 *
 * It cannot be fixed inside this process: the server does the sending, and
 * it reads these settings fresh on every mail. The settings row is the one
 * thing both sides share, so the switch goes there.
 *
 * `enabled` is deliberately left alone — the send path still resolves
 * recipients and renders the body, so a regression in either still fails
 * the run. Only the address at the end changes. `.invalid` can never
 * resolve (RFC 6761), so nothing is delivered and nothing bounces to a
 * person. The subdomain is not decoration: the settings validator wants a
 * dot in the domain, and a bare `@invalid` fails the save it is testing.
 */
const MAIL_SINK = process.env.E2E_MAIL_SINK ?? 'e2e-sink@e2e.invalid';

/** The real recipient, held while the suite runs. `undefined` = not muted. */
let realTestRecipient: string | null | undefined;

async function muteEmail(): Promise<void> {
  const before = await prisma.crmEmailSetting.findUnique({
    where: { id: 1 },
    select: { testModeRecipient: true },
  });
  // No settings row means nothing is configured and nothing can be sent.
  if (!before) return;
  realTestRecipient = before.testModeRecipient;
  await prisma.crmEmailSetting.update({
    where: { id: 1 },
    data: { testModeRecipient: MAIL_SINK },
  });
  console.log(`Mail muted — every mail this run sends goes to ${MAIL_SINK}`);
}

/**
 * Always called, however the run ends, or the next person to use the app
 * finds their mail silently diverted to a sink.
 */
async function restoreEmail(): Promise<void> {
  if (realTestRecipient === undefined) return;
  await prisma.crmEmailSetting.update({
    where: { id: 1 },
    data: { testModeRecipient: realTestRecipient },
  });
  realTestRecipient = undefined;
}

async function main() {
  console.log(`\nRunning against ${BASE}\n`);

  await muteEmail();

  console.log('Setting up test users…');
  const ops = await ensureUser('e2e.ops@kollegeapply.com', 'E2E Operations', 'operations');
  const manager = await ensureUser('e2e.manager@kollegeapply.com', 'E2E Manager', 'manager');
  const adsTeam = await ensureUser('e2e.ads@kollegeapply.com', 'E2E Ads Team', 'google-ads-team');
  const superAdmin = await ensureUser(
    'e2e.admin@kollegeapply.com',
    'E2E Super Admin',
    'super-admin'
  );

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
    body: JSON.stringify({ product: 'x', landingPageUrl: 'https://example.com' }),
  });
  check('Operations cannot generate AI copy', opsCopy.status === 403, `got ${opsCopy.status}`);

  console.log('\n── Workflow: Operations raises a request ──');

  const created = await opsSession.json<{ id: string; reference: string; status: string }>(
    '/api/ad-requests',
    {
      method: 'POST',
      body: JSON.stringify({
        // A realistic client name, because the generator now reads this as
        // the college and has to put it in the headlines.
        title: 'Christ University — MBA Admissions 2026',
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

  // ── The month-by-month lead plan survives an edit ──
  // It is a relation, so it was not in the PATCH handler's scalar loop and
  // nothing else wrote it: every edit silently discarded the plan Ops had
  // typed, and it was then missing from the brief mail with no error
  // anywhere to say why.
  const withPlan = await opsSession.json(`/api/ad-requests/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      leadTargets: [
        { month: '2026-11', leads: 80 },
        { month: '2026-12', leads: 120 },
        { month: '2027-01', leads: 160 },
      ],
    }),
  });
  check('Operations adds a month-by-month lead plan', withPlan.status === 200, `got ${withPlan.status}`);

  const storedPlan = await prisma.crmAdRequestLeadTarget.findMany({
    where: { requestId },
    orderBy: { month: 'asc' },
    select: { month: true, leads: true },
  });
  check(
    'And editing the request keeps it',
    storedPlan.length === 3 && storedPlan.map((t) => t.leads).join(',') === '80,120,160',
    storedPlan.map((t) => `${t.month.toISOString().slice(0, 7)}:${t.leads}`).join(' ') || 'nothing stored'
  );

  // A second edit that names the months again has to replace, not append —
  // a month the user deleted must disappear.
  await opsSession.json(`/api/ad-requests/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ leadTargets: [{ month: '2026-11', leads: 90 }] }),
  });
  const replaced = await prisma.crmAdRequestLeadTarget.findMany({ where: { requestId } });
  check(
    'A later edit replaces the plan rather than appending to it',
    replaced.length === 1 && replaced[0]!.leads === 90,
    `${replaced.length} row(s)`
  );

  // Put the full plan back so the brief mail below has something to show.
  await opsSession.json(`/api/ad-requests/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      leadTargets: [
        { month: '2026-11', leads: 80 },
        { month: '2026-12', leads: 120 },
        { month: '2027-01', leads: 160 },
      ],
    }),
  });

  // And it reaches the mail that announces what Ops asked for, which is the
  // one it used to be filtered out of as a "not an Ops field".
  const opsBrief = await buildRequestBrief(requestId, { onlyOpsFields: true });
  const planTable = opsBrief?.tables.find((t) => /month/i.test(t.heading));
  check(
    'The plan reaches the first brief mail, as a table with a total',
    Boolean(planTable) && planTable!.body.length === 3 && planTable!.foot?.[1] === '360',
    planTable ? `${planTable.body.length} rows, total ${planTable.foot?.[1]}` : 'no table in the brief'
  );

  const submitted = await opsSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'SUBMITTED' }) }
  );
  check(
    'Operations submits, and the system advances to awaiting an Account Manager',
    submitted.status === 200 && submitted.body.status === 'AWAITING_AM_ASSIGNMENT',
    `got ${submitted.body?.status}`
  );

  // The brief closes to edits once it has been submitted, which is also why
  // the edit page refuses to render a form for it: somebody filled in a
  // month-by-month lead plan on a submitted request, saved, and the save
  // came back 409 while the form sat there still showing their numbers.
  const lateEdit = await opsSession.json<{ error: string }>(`/api/ad-requests/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ leadTargets: [{ month: '2027-06', leads: 999 }] }),
  });
  check(
    'A submitted request refuses an edit to its lead plan',
    lateEdit.status === 409,
    lateEdit.body?.error ?? `got ${lateEdit.status}`
  );
  const untouched = await prisma.crmAdRequestLeadTarget.findMany({ where: { requestId } });
  check(
    'And the refusal leaves the stored plan exactly as it was',
    untouched.length === 3 && !untouched.some((t) => t.leads === 999),
    `${untouched.length} row(s)`
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

  // ── The reviewer prunes the keyword list ──
  // Striking one keyword is the whole point of the review; before this the
  // only way to object to one was to reject the lot and describe it in prose.
  {
    await prisma.crmAdRequest.update({
      where: { id: requestId },
      data: { keywords: 'mba admission\nbest mba college\nfree mba\nmba jobs' },
    });

    const pruned = await opsSession.json<{ keywords: string[]; removed: number }>(
      `/api/ad-requests/${requestId}/keywords`,
      { method: 'PUT', body: JSON.stringify({ keywords: ['mba admission', 'best mba college'] }) }
    );
    check(
      'The reviewer can remove keywords while the request is under review',
      pruned.status === 200 && pruned.body.keywords.length === 2 && pruned.body.removed === 2,
      `${pruned.body?.keywords?.length} left, ${pruned.body?.removed} removed`
    );
    const stored = await prisma.crmAdRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { keywords: true },
    });
    check(
      'And the pruned list is what the request now carries',
      (stored.keywords ?? '').split('\n').filter(Boolean).join(',') ===
        'mba admission,best mba college',
      JSON.stringify(stored.keywords)
    );

    const dupes = await opsSession.json<{ keywords: string[] }>(
      `/api/ad-requests/${requestId}/keywords`,
      {
        method: 'PUT',
        body: JSON.stringify({ keywords: ['MBA Admission', 'mba admission', 'bba pune'] }),
      }
    );
    check(
      'The same keyword twice is merged, not stored twice',
      dupes.body.keywords?.length === 2,
      JSON.stringify(dupes.body?.keywords)
    );

    const byAds = await adsSession.json<{ error: string }>(
      `/api/ad-requests/${requestId}/keywords`,
      { method: 'PUT', body: JSON.stringify({ keywords: ['anything'] }) }
    );
    check(
      'The Ad Specialist cannot edit the list once it is under review',
      byAds.status === 409,
      byAds.body?.error ?? `got ${byAds.status}`
    );

    // Restore a realistic list for the mails that follow.
    await opsSession.json(`/api/ad-requests/${requestId}/keywords`, {
      method: 'PUT',
      body: JSON.stringify({ keywords: ['mba admission', 'best mba college'] }),
    });
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

  // The Keyword Research export, as the browser parses it before upload.
  // One generation call covers the whole pipeline: the research reaches the
  // prompt, the copy and sitelinks come back, and the version carries both.
  const RESEARCHED = [
    { keyword: 'mba admission', volume: 2900 },
    { keyword: 'mba eligibility', volume: 2400 },
    { keyword: 'mba entrance', volume: 720 },
    { keyword: 'online mba admission', volume: 590 },
  ];

  const copy = await adsSession.json<{
    headlines: Array<{ text: string; characters: number }>;
    descriptions: Array<{ text: string; characters: number }>;
    sitelinks: Array<{ text: string; description1: string; description2: string }>;
    backend: string;
    validation: {
      flags: Array<{ level: string }>;
      sitelinkCount: number;
      subjectInHeadlines: number;
      subjectInDescriptions: number;
      excludedTermHits: number;
    };
    savedVersion: { id: string; version: number } | null;
  }>('/api/ai/ad-copy', {
    method: 'POST',
    body: JSON.stringify({
      requestId,
      save: true,
      keywordVolumes: RESEARCHED,
      // The default ban. The landing page used here talks about fees
      // throughout, so this is a real test of the filter rather than a
      // rule that never has to fire.
      excludedTerms: ['fee'],
    }),
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

  check(
    'Exactly 15 headlines and 4 descriptions come back, topped up if the model ran short',
    (copy.body.headlines ?? []).length === 15 && (copy.body.descriptions ?? []).length === 4,
    `${copy.body?.headlines?.length} / ${copy.body?.descriptions?.length}`
  );
  check(
    'No two headlines are the same after the top-up',
    new Set((copy.body.headlines ?? []).map((h) => h.text.toLowerCase())).size ===
      (copy.body.headlines ?? []).length
  );
  check(
    'No headline is a mid-word fragment of the product name',
    (copy.body.headlines ?? []).every((h) => !/\bFull-ti\b|\bAdmissio\b/.test(h.text)),
    (copy.body.headlines ?? []).map((h) => h.text).join(' | ').slice(0, 120)
  );

  // ── The ad has to say which college it is for ──
  const namesCollege = (text: string) => /christ|university|mba|pgdm/i.test(text);
  const headlinesNaming = (copy.body.headlines ?? []).filter((h) => namesCollege(h.text)).length;
  const descriptionsNaming = (copy.body.descriptions ?? []).filter((d) =>
    namesCollege(d.text)
  ).length;
  check(
    'At least four headlines name the college, university or course',
    headlinesNaming >= 4,
    `${headlinesNaming} of ${copy.body?.headlines?.length}`
  );
  check(
    'At least one description names it too',
    descriptionsNaming >= 1,
    `${descriptionsNaming} of ${copy.body?.descriptions?.length}`
  );
  check(
    'The validator does not overstate how many headlines carry the name',
    // `namesCollege` here is deliberately narrower than the validator, which
    // also counts tokens from the campaign title such as the intake year.
    // So the validator may legitimately count more — it must never count
    // fewer than the ones we can see with the naked eye.
    (copy.body.validation?.subjectInHeadlines ?? 0) >= headlinesNaming,
    `validator ${copy.body.validation?.subjectInHeadlines}, visibly naming ${headlinesNaming}`
  );
  check(
    'The client name reaches the copy, not just the course',
    (copy.body.headlines ?? []).some((h) => /christ/i.test(h.text)),
    (copy.body.headlines ?? [])
      .filter((h) => /christ/i.test(h.text))
      .map((h) => h.text)
      .join(' | ') || 'no headline named the college'
  );
  check(
    'And no headline carries the internal campaign wording from the title',
    // Only the internal part. The intake year in "Christ University MBA
    // 2026" comes from the brief and belongs in an admissions headline.
    (copy.body.headlines ?? []).every((h) => !/e2e/i.test(h.text)),
    (copy.body.headlines ?? []).map((h) => h.text).join(' | ').slice(0, 100)
  );

  // ── Sitelinks ──
  const sitelinks = copy.body.sitelinks ?? [];
  check(
    'Six sitelinks come back with the copy',
    sitelinks.length === 6,
    `${sitelinks.length} sitelink(s)`
  );
  check(
    'Every sitelink link text is within 25 characters',
    sitelinks.every((sl) => sl.text.trim().length > 0 && sl.text.length <= 25),
    sitelinks.map((sl) => `${sl.text}=${sl.text.length}`).join(', ')
  );
  check(
    'Both sitelink description lines are within 35 characters',
    sitelinks.every((sl) => sl.description1.length <= 35 && sl.description2.length <= 35),
    `longest: ${Math.max(0, ...sitelinks.flatMap((sl) => [sl.description1.length, sl.description2.length]))}`
  );
  check(
    'No sitelink carries one description line without the other',
    sitelinks.every(
      (sl) => Boolean(sl.description1.trim()) === Boolean(sl.description2.trim())
    )
  );
  check(
    'No two sitelinks share the same link text',
    new Set(sitelinks.map((sl) => sl.text.toLowerCase())).size === sitelinks.length
  );

  // ── Nothing fee-related survives, anywhere ──
  const FEE = /\bfees?\b/i;
  const everyAsset = [
    ...(copy.body.headlines ?? []).map((h) => h.text),
    ...(copy.body.descriptions ?? []).map((d) => d.text),
    ...sitelinks.flatMap((sl) => [sl.text, sl.description1, sl.description2]),
  ].filter(Boolean);
  const feeLeaks = everyAsset.filter((t) => FEE.test(t));
  check(
    'No headline, description or sitelink mentions a fee',
    feeLeaks.length === 0,
    feeLeaks.join(' | ') || `${everyAsset.length} asset(s) checked, all clean`
  );
  check(
    'The validator agrees nothing slipped through',
    copy.body.validation?.excludedTermHits === 0,
    `${copy.body.validation?.excludedTermHits} hit(s)`
  );

  // ── The saved version keeps the research it was written from ──
  const versionId = copy.body.savedVersion?.id ?? '';
  const savedRow = versionId
    ? await prisma.crmAdCopyVersion.findUnique({
        where: { id: versionId },
        select: { sitelinks: true, keywords: true },
      })
    : null;
  check(
    'The saved version stores its sitelinks',
    Array.isArray(savedRow?.sitelinks) && (savedRow!.sitelinks as unknown[]).length === 6,
    `${(savedRow?.sitelinks as unknown[] | null)?.length ?? 0} stored`
  );
  check(
    'And the uploaded keywords, so the copy can be explained later',
    Array.isArray(savedRow?.keywords) && (savedRow!.keywords as unknown[]).length === RESEARCHED.length,
    `${(savedRow?.keywords as unknown[] | null)?.length ?? 0} stored`
  );

  const savedTerms = versionId
    ? (
        await prisma.crmAdCopyVersion.findUnique({
          where: { id: versionId },
          select: { excludedTerms: true },
        })
      )?.excludedTerms
    : null;
  check(
    'The version records what it was forbidden to say',
    Array.isArray(savedTerms) && (savedTerms as string[]).includes('fee'),
    JSON.stringify(savedTerms)
  );

  // Editing a banned word back in has to be refused, or the ban only holds
  // until the first correction.
  const reintroduced = await adsSession.json<{
    validation: { excludedTermHits: number; flags: Array<{ level: string; message: string }> };
  }>(`/api/ad-copy-versions/${versionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      headlines: [{ text: 'Low Fees This Year' }, { text: 'Apply Online' }, { text: 'Enquire Now' }],
    }),
  });
  check(
    'Typing a banned word back into a headline is flagged as an error',
    reintroduced.body.validation?.excludedTermHits === 1 &&
      reintroduced.body.validation.flags.some(
        (f) => f.level === 'error' && /excludes/.test(f.message)
      ),
    reintroduced.body.validation?.flags
      ?.filter((f) => /excludes/.test(f.message))
      .map((f) => f.message)
      .join(' | ') || 'not flagged'
  );

  // Put the real copy back before the rest of the run reads it.
  await adsSession.json(`/api/ad-copy-versions/${versionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ headlines: (copy.body.headlines ?? []).map((h) => ({ text: h.text })) }),
  });

  // ── Marking final submits the copy AND the keywords ──
  const beforeFinal = await prisma.crmAdRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { keywords: true },
  });
  const markedFinal = await adsSession.json<{ validation: { sitelinkCount: number } }>(
    `/api/ad-copy-versions/${versionId}`,
    { method: 'PATCH', body: JSON.stringify({ isFinal: true }) }
  );
  check('The Ads team marks the version final', markedFinal.status === 200, `got ${markedFinal.status}`);

  const afterFinal = await prisma.crmAdRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { keywords: true },
  });
  const landed = (afterFinal.keywords ?? '').split('\n').filter(Boolean);
  check(
    "Marking it final writes the researched keywords onto the request",
    RESEARCHED.every((k) => landed.includes(k.keyword)),
    `was ${JSON.stringify(beforeFinal.keywords)}, now ${landed.length} keyword(s)`
  );
  check(
    'And the volumes are left out of the text the brief mail renders',
    !(afterFinal.keywords ?? '').includes('2900'),
    afterFinal.keywords?.slice(0, 60) ?? ''
  );

  // ── An over-length sitelink is caught on edit, not at upload to Google ──
  const badSitelink = await adsSession.json<{
    validation: { flags: Array<{ level: string; field: string; message: string }> };
  }>(`/api/ad-copy-versions/${versionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sitelinks: [
        {
          text: 'A sitelink label far past twenty five characters',
          description1: 'Short enough',
          description2: '',
        },
      ],
    }),
  });
  const sitelinkErrors = (badSitelink.body.validation?.flags ?? []).filter(
    (f) => f.field === 'sitelink' && f.level === 'error'
  );
  check(
    'An edited sitelink over 25 characters is flagged as an error',
    sitelinkErrors.some((f) => /exceeds 25/.test(f.message)),
    sitelinkErrors.map((f) => f.message).join(' | ') || 'no sitelink errors'
  );
  check(
    'A sitelink with one description line is flagged too',
    sitelinkErrors.some((f) => /both description lines/.test(f.message))
  );

  // Put the real sitelinks back so the rest of the run sees a sane version.
  await adsSession.json(`/api/ad-copy-versions/${versionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ sitelinks }),
  });

  // ── The copy screen's brief fields override what Ops filed ──
  // The Ads person can see that the course was typed one way and the
  // landing page says another; before this they had to edit somebody
  // else's requirement form to fix a headline.
  const overridden = await adsSession.json<{
    headlines: Array<{ text: string }>;
    descriptions: Array<{ text: string }>;
  }>('/api/ai/ad-copy', {
    method: 'POST',
    body: JSON.stringify({
      requestId,
      institution: 'Narsee Monjee',
      product: 'Executive PGDM',
      location: 'Mumbai',
      excludedTerms: ['fee'],
    }),
  });
  const overriddenText = [
    ...(overridden.body.headlines ?? []).map((h) => h.text),
    ...(overridden.body.descriptions ?? []).map((d) => d.text),
  ].join(' | ');
  check(
    'An overridden institution reaches the copy',
    overridden.status === 200 && /narsee|monjee/i.test(overriddenText),
    overriddenText.slice(0, 110)
  );
  check(
    'And the request it overrode is not named instead',
    !/christ/i.test(overriddenText),
    overriddenText.slice(0, 110)
  );

  const stored = await prisma.crmAdRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { title: true, productService: true, location: true },
  });
  check(
    'Overriding changes the generation, never the request',
    stored.title.includes('Christ University') &&
      stored.productService === 'Two-year full-time MBA' &&
      !stored.location.includes('Mumbai'),
    `${stored.title} / ${stored.productService} / ${stored.location}`
  );

  const score = await adsSession.json<{ score: number; grade: string; suggestions: string[] }>(
    '/api/ai/landing-score',
    { method: 'POST', body: JSON.stringify({ url: 'https://www.kollegeapply.com/', requestId }) }
  );
  check(
    'Ads team scores the landing page',
    score.status === 200 && typeof score.body.score === 'number',
    `${score.body?.score}/100 grade ${score.body?.grade}, ${score.body?.suggestions?.length} suggestion(s)`
  );

  // ── The score is taken automatically, before anyone asks ──
  // Scoring is deterministic and costs one page fetch, so the mail carries
  // a number rather than an empty panel. The guard is what keeps it to one
  // fetch per request however many mails that request sends.
  {
    const { ensureLandingScore } = await import('@/lib/ai/landing-score-store');
    const probe = await prisma.crmAdRequest.create({
      data: {
        reference: `AR-AUTOSCORE-${Date.now() % 100000}`,
        title: 'Auto score probe', objective: 'LEAD_GENERATION', productService: 'MBA',
        targetAudience: '', location: 'Delhi', startDate: new Date('2026-10-01'),
        // A URL nothing has scored yet, so the guard below is testing the
        // "already scored" case rather than tripping over an earlier run.
        landingPageUrl: `https://www.kollegeapply.com/?e2e=${Date.now()}`,
        adUrlClientlpDesktop: 'https://www.kollegeapply.com/',
        status: 'DRAFT', createdById: ops.id,
      },
      select: { id: true },
    });
    await ensureLandingScore(probe.id);
    const first = await prisma.crmLandingScore.count({ where: { requestId: probe.id } });
    check('A mail scores the landing page when nobody has', first === 1, `${first} score(s)`);

    // Called again — as the next four mails about this request would.
    await ensureLandingScore(probe.id);
    const second = await prisma.crmLandingScore.count({ where: { requestId: probe.id } });
    check(
      'And never scores the same request twice',
      second === 1,
      `${second} score(s) after a second mail`
    );
    await prisma.crmAdRequest.delete({ where: { id: probe.id } });
  }

  // ── And the score reaches the mail ──
  const scoredBrief = await buildRequestBrief(requestId, { onlyOpsFields: true });
  check(
    'The landing page score reaches the brief mail',
    scoredBrief?.landingScore?.score === score.body.score &&
      scoredBrief?.landingScore?.grade === score.body.grade,
    scoredBrief?.landingScore
      ? `${scoredBrief.landingScore.score}/100 (${scoredBrief.landingScore.passed} of ${scoredBrief.landingScore.maxPoints} weighted), grade ${scoredBrief.landingScore.grade}`
      : 'no score on the brief'
  );
  check(
    'It is attached to the request, not matched loosely by URL',
    scoredBrief?.landingScore?.matchedByUrl === false,
    `matchedByUrl=${scoredBrief?.landingScore?.matchedByUrl}`
  );
  check(
    'The score is reported out of 100, not against the raw weight total',
    // `score` is already a percentage. Pairing it with maxPoints read as a
    // score that had lost 43 points it never had.
    scoredBrief?.landingScore?.score === score.body.score &&
      (scoredBrief?.landingScore?.passed ?? 0) <= (scoredBrief?.landingScore?.maxPoints ?? 0),
    `${scoredBrief?.landingScore?.score}/100 from ${scoredBrief?.landingScore?.passed}/${scoredBrief?.landingScore?.maxPoints}`
  );

  const scoreSection = scoredBrief?.sections.find((s) => /landing page score/i.test(s.heading));
  check(
    'And it renders as its own section with the score and the grade',
    Boolean(scoreSection) &&
      scoreSection!.rows.some((r) => r.label === 'Score' && r.value.endsWith('/ 100')) &&
      scoreSection!.rows.some((r) => r.label === 'Grade' && r.value === score.body.grade),
    scoreSection ? scoreSection.rows.map((r) => `${r.label}=${r.value}`).join(' | ').slice(0, 120) : 'no section'
  );

  // A run started from the Landing Page Scorer menu saves with no request
  // id, so the brief has to find it by URL or the score somebody just took
  // would be missing from the very next mail.
  const standalone = await adsSession.json<{ score: number; grade: string }>(
    '/api/ai/landing-score',
    { method: 'POST', body: JSON.stringify({ url: 'https://www.kollegeapply.com/' }) }
  );
  const orphan = await prisma.crmLandingScore.findFirst({
    where: { requestId: null, url: 'https://www.kollegeapply.com/' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  check(
    'A score taken from the menu is saved without a request',
    standalone.status === 200 && Boolean(orphan),
    orphan ? 'stored unattached' : 'not stored'
  );

  // The request screen has to find it too. It used to look only at scores
  // attached to the request, so a page scored from the menu showed "No
  // score yet" on the request while the brief mail displayed it fine.
  {
    const bare = await prisma.crmAdRequest.create({
      data: {
        reference: `AR-LPMATCH-${Date.now() % 100000}`,
        title: 'URL match probe', objective: 'LEAD_GENERATION', productService: 'MBA',
        targetAudience: '', location: 'Delhi', startDate: new Date('2026-10-01'),
        landingPageUrl: 'https://www.kollegeapply.com/',
        adUrlClientlpDesktop: 'https://www.kollegeapply.com/',
        status: 'DRAFT', createdById: ops.id,
      },
      select: { id: true },
    });
    const own = await prisma.crmLandingScore.count({ where: { requestId: bare.id } });
    const seen = await adsSession.json<{
      request: { landingScores: Array<{ score: number; matchedByUrl?: boolean }> };
    }>(`/api/ad-requests/${bare.id}`);
    check(
      'A request with no score of its own still shows the one taken for its URL',
      own === 0 && (seen.body.request?.landingScores?.length ?? 0) > 0,
      `${own} own, ${seen.body.request?.landingScores?.length ?? 0} shown`
    );
    check(
      'And it is flagged as matched by URL, not passed off as its own',
      seen.body.request?.landingScores?.[0]?.matchedByUrl === true,
      `matchedByUrl=${seen.body.request?.landingScores?.[0]?.matchedByUrl}`
    );
    await prisma.crmAdRequest.delete({ where: { id: bare.id } });
  }

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
  check(
    'The landing score is attached',
    // At least one, not exactly one: the first workflow mail scores the
    // page automatically and the Ads team can score it again afterwards.
    // History is the point — it shows whether a fix moved the number.
    detail.body.request.landingScores.length >= 1,
    `${detail.body.request.landingScores.length} score(s) on the request`
  );

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

  // A fixture Super Admin, like the three personas above, rather than the
  // live seeded account. Borrowing that one meant the suite broke the moment
  // somebody cleaned up users — which is a thing a Super Admin is entitled
  // to do, and exactly the dependency the note above these helpers warns
  // against.
  const admin = new Session();
  const adminOk = await admin.login(superAdmin.email, TEST_PASSWORD);
  check('Super Admin can sign in', adminOk, superAdmin.email);

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
  await adminMail.login(superAdmin.email, TEST_PASSWORD);

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
    routes: Array<{ event: string; toRoles: string[]; ccRoles: string[]; enabled: boolean }>;
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
          ? { ...r, enabled: true, toRoles: [], toEmails: '' }
          : r
      ),
    }),
  });
  check(
    'A rule with no possible recipient is refused on save',
    unsendable.status === 400 && /nobody in To/i.test(unsendable.body?.error ?? ''),
    unsendable.body?.error ?? `got ${unsendable.status}`
  );

  // The agreed routing, resolved against a real request rather than read
  // off the defaults: this is what would actually be addressed.
  const suppressedHits: string[] = [];
  const emptyTo: string[] = [];
  for (const event of FLOW_EVENTS) {
    const p = await adminMail.json<{
      to: Array<{ email: string }>;
      cc: Array<{ email: string }>;
      bcc: Array<{ email: string }>;
    }>(`/api/admin/email/preview?event=${event}`);
    const everyone = [...(p.body.to ?? []), ...(p.body.cc ?? []), ...(p.body.bcc ?? [])];
    if (everyone.some((a) => a.email === 'admin@kollegeapply.com')) suppressedHits.push(event);
    if ((p.body.to ?? []).length === 0) emptyTo.push(event);
    // Nobody should be told twice; some clients render the address in both.
    const inTo = new Set((p.body.to ?? []).map((a) => a.email));
    check(
      `${event} does not CC somebody already in To`,
      !(p.body.cc ?? []).some((a) => inTo.has(a.email)),
      (p.body.cc ?? []).map((a) => a.email).join(', ')
    );
  }
  check(
    'No rule resolves to an empty To',
    emptyTo.length === 0,
    emptyTo.join(', ') || 'all addressed'
  );
  check(
    'The suppressed address is dropped from every rule',
    suppressedHits.length === 0,
    suppressedHits.join(', ') || 'admin@kollegeapply.com not addressed anywhere'
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

  console.log('\n── Keyword research ──');

  {
    const seedBody = (over: Record<string, unknown> = {}) =>
      JSON.stringify({
        keywords: ['mba admission'],
        geoTargetIds: ['2356'],
        languageId: '1000',
        ...over,
      });

    const anonIdeas = await new Session().json('/api/keyword-ideas', {
      method: 'POST',
      body: seedBody(),
    });
    check('An unauthenticated search is 401', anonIdeas.status === 401, `got ${anonIdeas.status}`);

    // A role holding everything *except* the planner. Proves the module's own
    // toggle is what opens the endpoint, not merely being signed in with the
    // neighbouring keyword permissions.
    const blockedRole = await prisma.crmRole.upsert({
      where: { slug: 'e2e-planner-blocked' },
      create: {
        slug: 'e2e-planner-blocked',
        name: 'E2E Planner Blocked',
        description: 'Disposable fixture for the e2e suite.',
        isSystem: false,
        isSuperAdmin: false,
        allAccounts: true,
      },
      update: {},
    });
    await prisma.crmRolePermission.deleteMany({ where: { roleId: blockedRole.id } });
    await prisma.crmRolePermission.createMany({
      data: ALL_FEATURES.map((feature) => ({
        roleId: blockedRole.id,
        feature: feature,
        allowed: !feature.startsWith('KEYWORD_PLANNER:'),
      })),
    });
    await prisma.crmUser.upsert({
      where: { email: 'e2e.planner-blocked@example.com' },
      create: {
        email: 'e2e.planner-blocked@example.com',
        name: 'E2E Planner Blocked',
        password: await bcrypt.hash(TEST_PASSWORD, 10),
        roleId: blockedRole.id,
        isActive: true,
        mustChangePassword: false,
        allAccounts: true,
      },
      update: { roleId: blockedRole.id, isActive: true, mustChangePassword: false },
    });

    const blocked = new Session();
    await blocked.login('e2e.planner-blocked@example.com', TEST_PASSWORD);
    const blockedSearch = await blocked.json('/api/keyword-ideas', {
      method: 'POST',
      body: seedBody(),
    });
    check(
      'KEYWORDS:VIEW alone does not open the planner',
      blockedSearch.status === 403,
      `got ${blockedSearch.status}`
    );
    const blockedOptions = await blocked.json('/api/keyword-ideas/locations');
    check(
      'Nor the location list',
      blockedOptions.status === 403,
      `got ${blockedOptions.status}`
    );

    // ── Input validation ──
    const noSeeds = await opsSession.json('/api/keyword-ideas', {
      method: 'POST',
      body: JSON.stringify({ geoTargetIds: ['2356'], languageId: '1000' }),
    });
    check('A search with no seed and no URL is refused', noSeeds.status === 400, `got ${noSeeds.status}`);

    const noGeo = await opsSession.json('/api/keyword-ideas', {
      method: 'POST',
      body: seedBody({ geoTargetIds: [] }),
    });
    check('A search with no location is refused', noGeo.status === 400, `got ${noGeo.status}`);

    const junkGeo = await opsSession.json('/api/keyword-ideas', {
      method: 'POST',
      body: seedBody({ geoTargetIds: ['geoTargetConstants/2356'] }),
    });
    check(
      'A geo target that is not a bare id is refused',
      junkGeo.status === 400,
      `got ${junkGeo.status}`
    );

    const junkUrl = await opsSession.json('/api/keyword-ideas', {
      method: 'POST',
      body: JSON.stringify({
        pageUrl: 'javascript:alert(1)',
        geoTargetIds: ['2356'],
        languageId: '1000',
      }),
    });
    check('A non-http page URL is refused', junkUrl.status === 400, `got ${junkUrl.status}`);

    const tooMany = await opsSession.json('/api/keyword-ideas', {
      method: 'POST',
      body: seedBody({ keywords: Array.from({ length: 21 }, (_, i) => `seed ${i}`) }),
    });
    check(
      'More than twenty seeds is refused rather than silently truncated at the API',
      tooMany.status === 400,
      `got ${tooMany.status}`
    );

    if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      console.log('  SKIP  Google Ads is not configured; the live planner call was not exercised.');
    } else {
      const locations = await opsSession.json<{
        locations: Array<{ id: string; name: string; type: string }>;
        languages: Array<{ id: string; name: string }>;
        degraded: boolean;
      }>('/api/keyword-ideas/locations');
      check(
        'The location list loads',
        locations.status === 200 && (locations.body.locations ?? []).length > 0,
        `${locations.body?.locations?.length ?? 0} location(s), degraded=${locations.body?.degraded}`
      );
      check(
        'India is in it, and it is first',
        locations.body?.locations?.[0]?.id === '2356',
        locations.body?.locations?.[0]?.name
      );

      const before = await prisma.crmAuditLog.count({ where: { action: 'KEYWORDS_RESEARCHED' } });

      // Operations holds the planner but not FINANCIALS:VIEW, so this is both
      // the happy path and the redaction case in one call.
      const opsIdeas = await opsSession.json<{
        ideas: Array<{
          keyword: string;
          avgMonthlySearches: number;
          lowTopOfPageBid: number | null;
          highTopOfPageBid: number | null;
          monthly: Array<{ label: string; searches: number }>;
          competition: string;
        }>;
        canSeeMoney: boolean;
        total: number;
      }>('/api/keyword-ideas', { method: 'POST', body: seedBody() });

      check(
        'A real search returns ideas',
        opsIdeas.status === 200 && (opsIdeas.body.ideas ?? []).length > 0,
        `${opsIdeas.body?.ideas?.length ?? 0} idea(s)`
      );

      const rows = opsIdeas.body?.ideas ?? [];
      if (rows.length > 0) {
        check(
          'Every volume is a real number, not a string or a NaN',
          rows.every((r) => typeof r.avgMonthlySearches === 'number' && !Number.isNaN(r.avgMonthlySearches)),
          `top: ${rows[0]!.keyword} = ${rows[0]!.avgMonthlySearches}`
        );
        check(
          'They arrive sorted by volume',
          rows.every((r, i) => i === 0 || rows[i - 1]!.avgMonthlySearches >= r.avgMonthlySearches),
          `${rows[0]!.avgMonthlySearches} … ${rows[rows.length - 1]!.avgMonthlySearches}`
        );
        check(
          'The twelve-month series comes back',
          rows.some((r) => (r.monthly ?? []).length >= 12),
          `longest series: ${Math.max(...rows.map((r) => (r.monthly ?? []).length))}`
        );
        check(
          'Operations is told it cannot see money',
          opsIdeas.body.canSeeMoney === false,
          `canSeeMoney=${opsIdeas.body.canSeeMoney}`
        );
        check(
          'And no bid estimate reaches the wire',
          rows.every((r) => r.lowTopOfPageBid === null && r.highTopOfPageBid === null),
          `${rows.filter((r) => r.highTopOfPageBid !== null).length} row(s) leaked a bid`
        );
      }

      const managerIdeas = await managerSession.json<{
        ideas: Array<{ lowTopOfPageBid: number | null; highTopOfPageBid: number | null }>;
        canSeeMoney: boolean;
      }>('/api/keyword-ideas', { method: 'POST', body: seedBody() });
      check(
        'A Manager, who holds FINANCIALS:VIEW, does get the bids',
        managerIdeas.status === 200 &&
          managerIdeas.body.canSeeMoney === true &&
          (managerIdeas.body.ideas ?? []).some((r) => r.highTopOfPageBid !== null),
        `canSeeMoney=${managerIdeas.body?.canSeeMoney}`
      );

      const after = await prisma.crmAuditLog.count({ where: { action: 'KEYWORDS_RESEARCHED' } });
      check('Every search is audited', after > before, `${after - before} new row(s)`);
    }
  }

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

// Ctrl-C in the middle of a run would otherwise leave the sink in place,
// which silently stops the real mail going out — a worse fault than the one
// muting fixes, and an invisible one.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void restoreEmail()
      .catch(() => {
        console.error(`\nCould not restore the mail recipient. Clear "Test mode recipient" on the Email settings page — it is set to ${MAIL_SINK}.`);
      })
      .finally(async () => {
        await prisma.$disconnect();
        process.exit(130);
      });
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await restoreEmail();
    await prisma.$disconnect();
  });
