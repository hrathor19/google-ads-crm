/**
 * Responsive + accessibility smoke check.
 *
 *   npm run check:responsive
 *
 * Drives a real Chrome at the three widths the brief names and asserts the
 * things that actually break on a phone: horizontal overflow, a navigation
 * that cannot be opened, and touch targets too small to hit.
 */
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { ALL_FEATURES, SEED_ROLES } from '@/lib/rbac/features';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const WIDTHS = [
  { label: 'phone', width: 360, height: 780, mobile: true },
  { label: 'tablet', width: 768, height: 1024, mobile: true },
  { label: 'desktop', width: 1280, height: 900, mobile: false },
];

const PAGES = [
  '/dashboard',
  '/dashboard/accounts',
  '/dashboard/campaigns',
  '/dashboard/keywords',
  '/dashboard/search-terms',
  '/dashboard/segments',
  '/dashboard/priorities',
  '/dashboard/alerts',
  '/dashboard/budgets',
  '/dashboard/trends',
  '/dashboard/analytics',
  '/dashboard/ad-requests',
  '/dashboard/ad-requests/new',
  '/dashboard/assigned',
  '/dashboard/keyword-research',
  '/dashboard/ad-copy',
  '/dashboard/landing-score',
  '/dashboard/admin/users',
  '/dashboard/admin/roles',
  '/dashboard/admin/audit',
  '/dashboard/admin/email',
  '/dashboard/admin/integrations',
];

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const prisma = new PrismaClient();

/** A disposable Super Admin, so the sweep owns its own way in. */
const FIXTURE_EMAIL = 'responsive.check@kollegeapply.com';
const FIXTURE_PASSWORD = 'R3sponsiveCheck!';

/**
 * Create the account this sweep signs in with.
 *
 * It used to borrow SEED_ADMIN_EMAIL, which meant every page check failed
 * the moment somebody cleaned up users — 68 failures that said nothing about
 * layout. A fixture of its own cannot be taken away by using the product.
 */
async function ensureFixtureUser() {
  const def = SEED_ROLES.find((r) => r.slug === 'super-admin')!;
  const role = await prisma.crmRole.upsert({
    where: { slug: 'responsive-check' },
    create: {
      slug: 'responsive-check',
      name: 'Responsive Check',
      description: 'Disposable fixture for the responsive sweep.',
      isSystem: false,
      isSuperAdmin: true,
      allAccounts: true,
    },
    update: { isSuperAdmin: true },
  });
  const granted = new Set(def.features);
  await prisma.crmRolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.crmRolePermission.createMany({
    data: ALL_FEATURES.map((feature) => ({ roleId: role.id, feature, allowed: granted.has(feature) })),
  });

  const password = await bcrypt.hash(FIXTURE_PASSWORD, 10);
  await prisma.crmUser.upsert({
    where: { email: FIXTURE_EMAIL },
    create: {
      email: FIXTURE_EMAIL,
      name: 'Responsive Check',
      password,
      roleId: role.id,
      isActive: true,
      mustChangePassword: false,
      allAccounts: true,
    },
    update: { password, roleId: role.id, isActive: true, mustChangePassword: false },
  });
}

async function removeFixtureUser() {
  await prisma.crmUser.deleteMany({ where: { email: FIXTURE_EMAIL } });
  await prisma.crmRole.deleteMany({ where: { slug: 'responsive-check' } });
}

async function signIn(page: Page) {
  // A cold dev server compiles the route on first request, which can outrun a
  // single navigation timeout. Warm it, then drive the form.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForSelector('#email', { timeout: 60_000 });
  await page.type('#email', FIXTURE_EMAIL);
  await page.type('#password', FIXTURE_PASSWORD);
  await page.click('button[type="submit"]');

  // The credentials provider signs in over fetch and then routes client-side,
  // so there is no document navigation to await — poll the URL instead.
  for (let i = 0; i < 160; i++) {
    if (page.url().includes('/dashboard')) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500));
}

async function main() {
  let browser: Browser | undefined;
  await ensureFixtureUser();
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120_000);
    await page.setViewport({ width: 1280, height: 900 });
    await signIn(page);

    const url = page.url();
    check('signed in and landed on the dashboard', url.includes('/dashboard'), url);

    for (const vp of WIDTHS) {
      console.log(`\n── ${vp.label} (${vp.width}px) ──`);
      await page.setViewport({
        width: vp.width,
        height: vp.height,
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      });

      for (const path of PAGES) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' });
        // Let the client-side queries settle so tables are really rendered.
        await new Promise((r) => setTimeout(r, 900));

        const result = await page.evaluate(() => {
          const doc = document.documentElement;

          // What "horizontal overflow" means to a user is that the *page*
          // slides sideways. Measuring documentElement.scrollWidth does not
          // test that: Chrome inflates it for `position: sticky` cells inside
          // a horizontally-scrollable region, so a correctly scrolling table
          // reports hundreds of pixels of phantom overflow. Try to scroll the
          // page instead, and cross-check against body.scrollWidth.
          const beforeX = window.scrollX;
          window.scrollTo(9999, window.scrollY);
          const scrolledX = window.scrollX;
          window.scrollTo(beforeX, window.scrollY);

          const bodyOverflow = document.body.scrollWidth - doc.clientWidth;
          const overflowBy = Math.max(scrolledX, bodyOverflow);

          // Which elements stick out past the viewport, if any — ignoring
          // those inside a deliberate scroll container, which are clipped and
          // scroll on their own.
          const offenders: string[] = [];
          if (overflowBy > 1) {
            const clipped = (el: HTMLElement) => {
              let p = el.parentElement;
              while (p && p !== document.body) {
                const ox = getComputedStyle(p).overflowX;
                if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
                p = p.parentElement;
              }
              return false;
            };
            for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > doc.clientWidth + 1 && !clipped(el)) {
                const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
                offenders.push(`${el.tagName.toLowerCase()}.${cls}`);
                if (offenders.length >= 3) break;
              }
            }
          }

          // Anything hidden from the accessibility tree is not a control a
          // person can reach — Radix Select keeps a visually hidden native
          // <select> for form compatibility and marks it aria-hidden.
          const reachable = (el: HTMLElement) => {
            if (el.closest('[aria-hidden="true"]')) return false;
            if (el.hasAttribute('hidden') || el.getAttribute('type') === 'hidden') return false;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return true;
          };

          // Inputs without an accessible name.
          const unlabelled = Array.from(
            document.querySelectorAll<HTMLElement>('input, select, textarea')
          )
            .filter(reachable)
            .filter((el) => {
              const id = el.getAttribute('id');
              const labelled =
                (id && document.querySelector(`label[for="${id}"]`)) ||
                el.getAttribute('aria-label') ||
                el.getAttribute('aria-labelledby') ||
                el.closest('label');
              return !labelled;
            }).length;

          // Icon-only buttons with no accessible name at all. A `<label for>`
          // pointing at the control counts: that is how a Switch with a
          // visible caption gets its name, and flagging it sent us looking
          // for a bug in a component that was already labelled.
          const namelessButtons = Array.from(
            document.querySelectorAll<HTMLElement>('button')
          ).filter(
            (b) =>
              !b.textContent?.trim() &&
              !b.getAttribute('aria-label') &&
              !b.getAttribute('aria-labelledby') &&
              !b.querySelector('.sr-only') &&
              !(b.id && document.querySelector(`label[for="${CSS.escape(b.id)}"]`))
          ).length;

          const hasH1 = Boolean(document.querySelector('h1'));
          const errored = document.body.innerText.includes('Application error');

          return { overflowBy, offenders, unlabelled, namelessButtons, hasH1, errored };
        });

        check(`${vp.label} ${path} renders`, !result.errored);
        check(
          `${vp.label} ${path} does not scroll horizontally`,
          result.overflowBy <= 1,
          result.overflowBy > 1
            ? `${result.overflowBy}px of page scroll: ${result.offenders.join(', ') || '(no unclipped offender found)'}`
            : ''
        );
        check(`${vp.label} ${path} has a heading`, result.hasH1);
        check(
          `${vp.label} ${path} labels every input`,
          result.unlabelled === 0,
          result.unlabelled ? `${result.unlabelled} unlabelled` : ''
        );
        check(
          `${vp.label} ${path} names every icon button`,
          result.namelessButtons === 0,
          result.namelessButtons ? `${result.namelessButtons} unnamed` : ''
        );
      }

      if (vp.width < 1024) {
        // The sidebar collapses below lg; the drawer has to open.
        await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 600));
        const opened = await page.evaluate(async () => {
          const trigger = Array.from(document.querySelectorAll('button')).find(
            (b) => b.getAttribute('aria-label') === 'Open navigation'
          );
          if (!trigger) return 'no trigger';
          trigger.click();
          await new Promise((r) => setTimeout(r, 400));
          const links = document.querySelectorAll('nav[aria-label="Main"] a');
          return links.length > 0 ? 'ok' : 'drawer empty';
        });
        check(`${vp.label} navigation drawer opens`, opened === 'ok', String(opened));
      } else {
        const railVisible = await page.evaluate(() => {
          const aside = document.querySelector('aside');
          return Boolean(aside && aside.getBoundingClientRect().width > 100);
        });
        check('desktop sidebar rail is visible', railVisible);
      }
    }

    // Touch-target sizing on the smallest screen.
    await page.setViewport({ width: 360, height: 780, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/dashboard/ad-requests/new`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 900));
    const tooSmall = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('input, button, select'))
        .filter((el) => !el.closest('[aria-hidden="true"]'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < 32;
        })
        .map((el) => `${el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().height)}px`)
        .slice(0, 5);
    });
    check(
      'phone form controls are at least 32px tall',
      tooSmall.length === 0,
      tooSmall.join(', ')
    );

    // Dark mode has to actually repaint the page, not just flip a class.
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    const dark = await page.evaluate(async () => {
      const before = getComputedStyle(document.body).backgroundColor;
      const toggle = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.getAttribute('aria-label') ?? '').includes('dark mode')
      );
      if (!toggle) return { ok: false, reason: 'no toggle' };
      toggle.click();
      await new Promise((r) => setTimeout(r, 500));
      const after = getComputedStyle(document.body).backgroundColor;
      return {
        ok: before !== after && document.documentElement.classList.contains('dark'),
        reason: `${before} → ${after}`,
      };
    });
    check('dark mode repaints the page', dark.ok, dark.reason);
  } finally {
    await browser?.close();
    await removeFixtureUser();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
