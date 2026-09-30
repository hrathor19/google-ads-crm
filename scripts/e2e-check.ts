/**
 * End-to-end check of the workflow and RBAC, driven through the HTTP API the
 * way the browser drives it — so a guard that only exists in a component
 * cannot make this pass.
 *
 *   npm run e2e
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

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

  async login(email: string, password: string): Promise<boolean> {
    const csrfRes = await this.fetch('/api/auth/csrf');
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
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

/** Create (or reset) a test user on a given role, already past the password gate. */
async function ensureUser(email: string, name: string, roleSlug: string) {
  const role = await prisma.crmRole.findUniqueOrThrow({ where: { slug: roleSlug } });
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
        landingPageUrl: 'https://www.kollegeapply.com/',
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
  check('Operations submits it for approval', submitted.status === 200 && submitted.body.status === 'SUBMITTED');

  // Operations holds AD_REQUESTS:CREATE but not APPROVE.
  const selfApprove = await opsSession.json(`/api/ad-requests/${requestId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ target: 'APPROVED' }),
  });
  check('Operations cannot approve their own request', selfApprove.status === 403, `got ${selfApprove.status}`);

  console.log('\n── Workflow: Manager reviews ──');

  const mgrList = await managerSession.json<{ rows: Array<{ id: string }> }>(
    '/api/ad-requests?status=SUBMITTED'
  );
  check(
    'The request is in the manager’s approval queue',
    mgrList.status === 200 && mgrList.body.rows.some((r) => r.id === requestId)
  );

  const noReason = await managerSession.json<{ error: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'REJECTED' }) }
  );
  check('A rejection without a reason is refused', noReason.status === 400, noReason.body?.error);

  const changes = await managerSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    {
      method: 'POST',
      body: JSON.stringify({ target: 'CHANGES_REQUESTED', reason: 'Add the application deadline.' }),
    }
  );
  check('Manager can request changes', changes.status === 200 && changes.body.status === 'CHANGES_REQUESTED');

  const opsNotifs = await opsSession.json<{ unread: number }>('/api/notifications');
  check('Operations is notified of the change request', opsNotifs.body.unread > 0, `${opsNotifs.body.unread} unread`);

  const resubmit = await opsSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'SUBMITTED' }) }
  );
  check('Operations resubmits after the change', resubmit.status === 200 && resubmit.body.status === 'SUBMITTED');

  const approved = await managerSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'APPROVED' }) }
  );
  check('Manager approves', approved.status === 200 && approved.body.status === 'APPROVED');

  console.log('\n── Workflow: the Google Ads team works it ──');

  const queue = await adsSession.json<{ rows: Array<{ id: string }> }>(
    '/api/ad-requests?status=APPROVED,IN_PROGRESS,READY'
  );
  check(
    'The approved request reaches the Ads team queue',
    queue.status === 200 && queue.body.rows.some((r) => r.id === requestId)
  );

  const inProgress = await adsSession.json<{ status: string }>(
    `/api/ad-requests/${requestId}/transition`,
    { method: 'POST', body: JSON.stringify({ target: 'IN_PROGRESS' }) }
  );
  check('Ads team picks it up', inProgress.status === 200 && inProgress.body.status === 'IN_PROGRESS');

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

  const live = await adsSession.json<{ status: string }>(`/api/ad-requests/${requestId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ target: 'READY' }),
  });
  check('Ads team marks it ready', live.status === 200 && live.body.status === 'READY');

  const golive = await adsSession.json<{ status: string }>(`/api/ad-requests/${requestId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ target: 'LIVE', linkedCampaignId: '21345678901' }),
  });
  check('Ads team takes it live', golive.status === 200 && golive.body.status === 'LIVE');

  const detail = await adsSession.json<{
    request: { linkedCampaignId: string; events: unknown[]; adCopyVersions: unknown[]; landingScores: unknown[] };
  }>(`/api/ad-requests/${requestId}`);
  check(
    'The campaign ID is linked to the request',
    detail.body.request.linkedCampaignId === '21345678901'
  );
  check(
    'The timeline recorded every step',
    detail.body.request.events.length >= 8,
    `${detail.body.request.events.length} events`
  );
  check('The copy version is attached', detail.body.request.adCopyVersions.length === 1);
  check('The landing score is attached', detail.body.request.landingScores.length === 1);

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

    // Put the user back so the delete guard can be cleared.
    const opsRole = await prisma.crmRole.findUniqueOrThrow({ where: { slug: 'operations' } });
    await prisma.crmUser.update({ where: { id: ops.id }, data: { roleId: opsRole.id } });

    const deleted = await admin.json(`/api/admin/roles/${roleId}`, { method: 'DELETE' });
    check('An unassigned custom role can be deleted', deleted.status === 200);

    const systemRole = await prisma.crmRole.findUniqueOrThrow({ where: { slug: 'manager' } });
    const sysDelete = await admin.json<{ error: string }>(`/api/admin/roles/${systemRole.id}`, {
      method: 'DELETE',
    });
    check('A default role cannot be deleted', sysDelete.status === 409, sysDelete.body?.error);

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

  // Leave nothing behind but the users, which a re-run reuses.
  await prisma.crmAdRequest.deleteMany({ where: { id: requestId } });

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
