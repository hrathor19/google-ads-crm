import 'server-only';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import * as cheerio from 'cheerio';
import { env } from '@/lib/env';

/**
 * Landing-page intelligence: fetch the URL and extract structured facts from
 * the live page. A port of `app/services/ai/landing_page_service.py`.
 *
 * Only real, on-page content is returned — nothing is invented. If the page
 * can't be fetched, `fetched` is false and the caller degrades gracefully.
 *
 * Safety: only http(s) is followed, private/loopback/link-local hosts are
 * refused (SSRF guard), redirects are re-checked against the same guard, the
 * body is size-capped, and every failure degrades rather than throws.
 */

// Third-party hosts that legitimately appear on a landing page (analytics, tag
// managers, fonts, CDNs, social share/verify). These are NOT counted as
// "external links leaking the visitor away" — they're infrastructure, not exits.
const IGNORE_LINK_HOSTS = [
  'google.com', 'googletagmanager.com', 'google-analytics.com', 'googleadservices.com',
  'gstatic.com', 'googleapis.com', 'doubleclick.net', 'youtube.com', 'youtu.be',
  'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'whatsapp.com', 'wa.me', 'cloudflare.com', 'jsdelivr.net', 'unpkg.com',
  'fontawesome.com', 'w3.org', 'schema.org',
];

// Broken-link probe budget — bounded so an audit never hangs on a slow page.
const LINK_CHECK_CAP = 15;
const LINK_CHECK_TIMEOUT_MS = 4000;
// Only these statuses mean a link is genuinely dead. 401/403/405/429/503 are
// bots being blocked or rate-limited, NOT broken pages — flagging them wrongly
// marks a site's own privacy/terms/apply links as broken.
const BROKEN_STATUSES = new Set([404, 410]);

// Country-code second-level suffixes where the registrable domain is the last
// three labels (e.g. greatlakes.edu.in, foo.co.uk), so subdomains resolve to
// the organisation.
const MULTI_TLDS = new Set([
  'co.in', 'edu.in', 'ac.in', 'org.in', 'gov.in', 'net.in', 'res.in', 'gen.in',
  'firm.in', 'ind.in', 'nic.in', 'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'edu.au', 'gov.au', 'org.au', 'net.au', 'co.nz', 'com.sg', 'edu.sg',
  'com.my', 'edu.my',
]);

const USER_AGENT = 'Mozilla/5.0 (AdCopyBot; +internal-tool)';

/**
 * The org-owning domain (eTLD+1). `lp.example.com` and `apply.example.com`
 * both become `example.com`, so a page's links to its own sibling or parent
 * subdomains count as internal rather than as external leaks.
 */
export function registrableDomain(host: string | null | undefined): string {
  const h = (host ?? '').toLowerCase().trim().replace(/^\.+|\.+$/g, '');
  if (!h) return '';
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const last2 = labels.slice(-2).join('.');
  if (MULTI_TLDS.has(last2)) return labels.slice(-3).join('.');
  return last2;
}

// Keyword cues used to bucket on-page text into strategist-relevant facts.
const CUES: Record<string, RegExp[]> = {
  // Whole-word programme tokens only — avoids loose matches like "ba" in "Aruba".
  courses: [
    /\bmba\b/, /\bpgdm\b/, /\bpgpm\b/, /\bb\.?tech\b/, /\bbba\b/, /\bbca\b/,
    /\bmca\b/, /\bb\.?com\b/, /\bm\.?tech\b/, /\bph\.?d\b/, /\bdiploma\b/,
    /\bcourse\b/, /\bprogramme\b/, /\bspecial[ai]sation\b/,
  ],
  // Signals that a course has DETAIL under it (not just a name).
  course_detail: [
    /\bduration\b/, /\b\d+\s*(years?|yrs?|months?|semesters?)\b/, /\bsemesters?\b/,
    /\bcurriculum\b/, /\bsyllabus\b/, /\bcourse structure\b/, /\bsubjects?\b/,
    /\bmodules?\b/, /\belectives?\b/, /\bspecial[ai]s/, /\bstreams?\b/,
    /\bcredits?\b/, /\bcourse details?\b/, /\bknow more\b/, /\bview details\b/,
    /\bprogramme? details?\b/, /\bcourse overview\b/, /\bcareer (opportunit|option)/,
  ],
  fees: [/\bfees?\b/, /\btuition\b/, /₹/, /\blpa\b/, /\bper (year|annum|semester)\b/],
  eligibility: [/\beligibility\b/, /\beligible\b/, /\bcriteria\b/, /\bqualification\b/],
  scholarships: [/\bscholarship/, /\bfinancial aid\b/, /\bwaiver\b/],
  placements: [/\bplacement/, /\brecruiter/, /\bpackage\b/, /\blpa\b/, /highest salary/],
  rankings: [/\bnirf\b/, /\branked\b/, /top b-school/],
  accreditations: [/\bnaac\b/, /\baicte\b/, /\bugc\b/, /\baacsb\b/, /\bnba\b/, /accredit/],
  admission_dates: [/\badmission/, /\bintake\b/, /\bbatch 202[567]\b/, /\bsession 202/],
  deadlines: [/\blast date\b/, /\bdeadline\b/, /\bapply before\b/, /\bfinal date\b/],
};

const CTA_WORDS = ['apply', 'enquire', 'register', 'download', 'book', 'get in touch'];

// Lines that are clearly form controls or junk, not real page content.
const JUNK_RE = /\(\s*\+?\d{1,4}\s*\)/; // phone country codes, e.g. "Aruba (+297)"

function isJunkLine(line: string): boolean {
  const low = line.trim().toLowerCase();
  if (JUNK_RE.test(line)) return true; // dropdown of dialling codes
  if (/^(select |choose |please select)/.test(low)) return true;
  if (/[*:]$/.test(low)) return true;
  return ['select program', 'select course', 'select state', 'select city', 'none'].includes(low);
}

export type Tracking = {
  gtm: boolean;
  gtm_id: string | null;
  google_ads_conversion: boolean;
  google_ads_id: string | null;
  ga4: boolean;
  ga4_id: string | null;
  meta_pixel: boolean;
  cookie_consent: boolean;
  remarketing: boolean;
};

/** Scan raw page HTML for the tracking tags an auditor cares about. */
export function detectTracking(html: string): Tracking {
  const h = html || '';
  const find = (pattern: RegExp): string | null => h.match(pattern)?.[0] ?? null;

  // IDs are upper-case tokens — matched case-sensitively so a CSS class like
  // "g-padding" cannot read as a GA4 "G-…" id.
  const gtmId = find(/\bGTM-[A-Z0-9]{5,}\b/);
  const ga4Id = find(/\bG-[A-Z0-9]{8,12}\b/);
  const awId = find(/\bAW-\d{8,}\b/);
  const hasGtag = Boolean(find(/gtag\(|googletagmanager\.com\/gtag\/js/i));
  const hasMetaPixel = Boolean(find(/fbq\(|connect\.facebook\.net\/[^"']*\/fbevents\.js/i));
  const hasConsent = Boolean(
    find(/cookieconsent|onetrust|cookiebot|cookieyes|\/consent|gtag\('consent'/i)
  );
  const hasRemarketing = Boolean(awId || find(/google_conversion|\/remarketing|_ga_/i));

  return {
    gtm: Boolean(gtmId),
    gtm_id: gtmId,
    google_ads_conversion: Boolean(awId) || Boolean(find(/google_conversion_id/i)),
    google_ads_id: awId,
    ga4: Boolean(ga4Id) || hasGtag,
    ga4_id: ga4Id,
    meta_pixel: hasMetaPixel,
    cookie_consent: hasConsent,
    remarketing: hasRemarketing,
  };
}

export type BrokenLink = { url: string; status: number | 'unreachable' };

export type LandingPage = {
  url: string;
  fetched: boolean;
  notes: string | null;
  title?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  h1?: string[];
  h2?: string[];
  h3?: string[];
  cta_buttons?: string[];
  courses?: string[];
  course_detail?: string[];
  fees?: string[];
  eligibility?: string[];
  scholarships?: string[];
  placements?: string[];
  rankings?: string[];
  accreditations?: string[];
  admission_dates?: string[];
  deadlines?: string[];
  highlights?: string[];
  usps?: string[];
  tracking?: Tracking;
  load_ms?: number | null;
  has_viewport?: boolean;
  has_form?: boolean;
  has_privacy?: boolean;
  has_terms?: boolean;
  external_links?: string[];
  external_link_count?: number;
  link_count?: number;
  broken_links?: BrokenLink[];
  links_checked?: number;
};

/**
 * SSRF guard: http(s) only, and every resolved address must be public.
 *
 * Checked per hop rather than once, because a public hostname can redirect to
 * a private one and a single up-front check would wave that through.
 */
async function isSafeUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!parsed.hostname) return false;

  // A literal IP needs no lookup — and must not be given one.
  const literal = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) return isPublicAddress(literal);

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    return false;
  }
  if (addresses.length === 0) return false;
  return addresses.every((a) => isPublicAddress(a.address));
}

function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number, number, number];
    if (a === 10) return false; // private
    if (a === 127) return false; // loopback
    if (a === 0) return false; // "this network"
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a >= 224) return false; // multicast / reserved
    return true;
  }
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return false; // loopback / unspecified
  if (low.startsWith('fe80')) return false; // link-local
  if (/^f[cd]/.test(low)) return false; // unique local
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) must be judged on the embedded address.
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]!);
  return true;
}

async function fetchWithGuard(
  url: string,
  init: RequestInit & { timeoutMs: number }
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    // Redirects are followed manually so each hop passes the SSRF guard.
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      if (!(await isSafeUrl(current))) return null;
      const res = await fetch(current, {
        ...init,
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return res;
        current = new URL(location, current).toString();
        continue;
      }
      return res;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe up to `LINK_CHECK_CAP` links. Bounded and best-effort: a link counts as
 * broken only on 404/410/5xx or a connection failure. Timeouts are treated as
 * inconclusive, so a slow-but-live page isn't unfairly penalised.
 */
async function checkBrokenLinks(links: string[]): Promise<{ broken: BrokenLink[]; checked: number }> {
  if (links.length === 0) return { broken: [], checked: 0 };
  const targets = links.slice(0, LINK_CHECK_CAP);

  const probe = async (u: string): Promise<BrokenLink | null> => {
    try {
      let res = await fetchWithGuard(u, { method: 'HEAD', timeoutMs: LINK_CHECK_TIMEOUT_MS });
      // Many servers reject or limit HEAD from bots — confirm with GET before
      // ever calling a link broken.
      if (!res || [401, 403, 405, 429, 501].includes(res.status) || res.status >= 500) {
        res = await fetchWithGuard(u, { method: 'GET', timeoutMs: LINK_CHECK_TIMEOUT_MS });
      }
      if (!res) return null; // timed out or refused by the guard — inconclusive
      if (BROKEN_STATUSES.has(res.status) || res.status >= 500) {
        return { url: u, status: res.status };
      }
      return null;
    } catch {
      return { url: u, status: 'unreachable' };
    }
  };

  const results = await Promise.all(targets.map(probe));
  return { broken: results.filter((r): r is BrokenLink => r !== null), checked: targets.length };
}

export async function analyzeLandingPage(url: string | null): Promise<LandingPage> {
  if (!url) {
    return { url: '', fetched: false, notes: 'No landing page URL provided.' };
  }
  if (!(await isSafeUrl(url))) {
    return {
      url,
      fetched: false,
      notes: 'URL refused (not http(s), or it points to a private host).',
    };
  }

  const { timeoutMs, maxBytes } = env.landingPage();
  const t0 = Date.now();
  const res = await fetchWithGuard(url, { method: 'GET', timeoutMs });
  if (!res || !res.ok) {
    return {
      url,
      fetched: false,
      notes: res
        ? `Page returned HTTP ${res.status}.`
        : 'Page could not be fetched (timeout, DNS failure, or a refused host).',
    };
  }
  const loadMs = Date.now() - t0;
  const body = (await res.text()).slice(0, maxBytes);

  const parsed = parseLandingPage(url, body, loadMs);
  const { broken, checked } = await checkBrokenLinks(parsed._allLinks);
  const { _allLinks, ...rest } = parsed;
  return { ...rest, broken_links: broken, links_checked: checked };
}

export function parseLandingPage(
  url: string,
  html: string,
  loadMs: number | null
): LandingPage & { _allLinks: string[] } {
  // Tracking is detected on the RAW html, before scripts are stripped.
  const tracking = detectTracking(html);

  const $ = cheerio.load(html);

  const viewportEl = $('meta[name]').filter(
    (_, el) => ($(el).attr('name') ?? '').toLowerCase() === 'viewport'
  );
  const hasViewport = viewportEl.length > 0 && Boolean(viewportEl.first().attr('content'));
  const hasForm = $('form').length > 0;

  const pageDom = registrableDomain(safeHostname(url));
  const allLinks: string[] = [];
  const external: string[] = [];
  let hasPrivacy = false;
  let hasTerms = false;

  $('a').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    const blob = `${$(el).text().replace(/\s+/g, ' ').trim()} ${href}`.toLowerCase();
    if (blob.includes('privacy')) hasPrivacy = true;
    if (blob.includes('terms') || blob.includes('t&c') || blob.includes('conditions')) {
      hasTerms = true;
    }
    if (!href || /^(#|mailto:|tel:|sms:|javascript:)/i.test(href)) return;

    let abs: URL;
    try {
      abs = new URL(href, url);
    } catch {
      return;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return;
    const absStr = abs.toString();
    if (!allLinks.includes(absStr)) allLinks.push(absStr);

    const linkDom = registrableDomain(abs.hostname);
    // External = a DIFFERENT organisation's domain. The same registrable domain
    // (own subdomains or parent — privacy/terms/apply pages) is internal, and
    // analytics/social infrastructure is ignored, so neither counts as a leak.
    const isOwn = !linkDom || linkDom === pageDom;
    const isInfra = IGNORE_LINK_HOSTS.some((d) => linkDom === d || linkDom.endsWith(`.${d}`));
    if (!isOwn && !isInfra && !external.includes(absStr)) external.push(absStr);
  });

  $('script, style, noscript').remove();

  const texts = (selector: string, limit: number): string[] => {
    const seen: string[] = [];
    $(selector).each((_, el) => {
      if (seen.length >= limit) return false;
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && !seen.includes(t) && t.length >= 2 && t.length <= 160) seen.push(t);
      return undefined;
    });
    return seen;
  };

  const meta = (name: string): string | null => {
    const el = $(`meta[name="${name}"]`).first().length
      ? $(`meta[name="${name}"]`).first()
      : $(`meta[property="${name}"]`).first();
    const content = el.attr('content');
    return content ? content.replace(/\s+/g, ' ').trim() || null : null;
  };

  const title = $('title').first().text().trim() || null;
  const metaTitle = meta('og:title');
  const metaDesc = meta('description') ?? meta('og:description');
  const h1 = texts('h1', 6);
  const h2 = texts('h2', 12);
  const h3 = texts('h3', 15);

  // CTA buttons / links.
  const ctas: string[] = [];
  $('a, button').each((_, el) => {
    if (ctas.length >= 12) return false;
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    const isCta =
      t && t.length >= 2 && t.length <= 40 && CTA_WORDS.some((w) => t.toLowerCase().includes(w));
    if (isCta && !ctas.includes(t)) ctas.push(t);
    return undefined;
  });

  // Bucket page text by cue keywords (facts only).
  const pageLines = $.root()
    .text()
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3 && l.length <= 160 && !isJunkLine(l));

  const buckets: Record<string, string[]> = Object.fromEntries(
    Object.keys(CUES).map((k) => [k, [] as string[]])
  );
  for (const line of pageLines) {
    const low = line.toLowerCase();
    for (const [bucket, cues] of Object.entries(CUES)) {
      const list = buckets[bucket]!;
      if (list.length >= 8 || list.includes(line)) continue;
      if (cues.some((c) => c.test(low))) list.push(line);
    }
  }

  // USPs / highlights: short punchy H2/H3 lines.
  const highlights = [...h2, ...h3].filter((t) => t.length <= 70).slice(0, 8);

  return {
    url,
    fetched: true,
    notes: null,
    title,
    meta_title: metaTitle,
    meta_description: metaDesc,
    h1,
    h2,
    h3,
    cta_buttons: ctas,
    courses: buckets.courses,
    course_detail: buckets.course_detail,
    fees: buckets.fees,
    eligibility: buckets.eligibility,
    scholarships: buckets.scholarships,
    placements: buckets.placements,
    rankings: buckets.rankings,
    accreditations: buckets.accreditations,
    admission_dates: buckets.admission_dates,
    deadlines: buckets.deadlines,
    highlights,
    usps: highlights,
    tracking,
    load_ms: loadMs,
    has_viewport: hasViewport,
    has_form: hasForm,
    has_privacy: hasPrivacy,
    has_terms: hasTerms,
    external_links: external.slice(0, 25),
    external_link_count: external.length,
    link_count: allLinks.length,
    _allLinks: allLinks,
  };
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
