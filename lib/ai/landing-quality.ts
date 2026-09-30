/**
 * Landing-page quality score + specific, non-generic improvement suggestions.
 *
 * A port of `app/services/ai/landing_quality.py`. Scores the actual parsed page
 * against the elements that drive ad conversions (clear CTA, lead capture,
 * fees, deadlines, proof, message match). Every suggestion is CONDITIONAL on
 * what the page really has or lacks — if fees are already on the page it won't
 * tell you to add them; if there's no Apply button it will.
 */

import type { LandingPage } from './landing-page';

// ─── Page-type detection ─────────────────────────────────────────────────────
// An EXAM landing page (NMAT, CAT, CUET…) must be judged on exam signals
// (dates, eligibility, pattern, accepting colleges, mock tests) — NOT on
// college signals (placements, scholarships, fee structure, accreditation).

const EXAM_NAME_TOKENS = [
  'nmat', 'cat', 'xat', 'cmat', 'snap', 'mat', 'gmat', 'gre', 'cuet', 'jee',
  'neet', 'clat', 'gate', 'ipmat', 'npat', 'mhcet', 'mahcet', 'set', 'cet',
  'aptitude', 'iift', 'tissnet', 'micat', 'nid', 'nift', 'ailet', 'lsat',
];

const EXAM_WORDS = [
  'entrance exam', 'entrance test', 'exam date', 'exam pattern', 'admit card',
  'registration', 'eligibility criteria', 'syllabus', 'mock test', 'cut off',
  'cutoff', 'result', 'answer key', 'application form', 'exam city',
  'participating', 'accepting colleges', 'previous year', 'sample paper',
];

const COLLEGE_WORDS = [
  'placement', 'campus', 'fee structure', 'hostel', 'scholarship', 'university',
  'college', 'b.tech', 'btech', 'mba program', 'admission', 'recruiters',
  'accreditation', 'naac', 'ranking', 'faculty', 'alumni',
];

function textBlob(landing: LandingPage): string {
  const parts: string[] = [
    landing.url ?? '',
    landing.title ?? '',
    landing.meta_title ?? '',
    landing.meta_description ?? '',
  ];
  for (const k of ['h1', 'h2', 'h3', 'highlights', 'cta_buttons', 'courses', 'eligibility'] as const) {
    const v = landing[k];
    if (Array.isArray(v)) parts.push(...v.map(String));
  }
  return parts.join(' ').toLowerCase();
}

export function detectPageType(landing: LandingPage): 'exam' | 'college' {
  const urlSlug = (landing.url ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  // A known exam token in the URL (e.g. .../NMAT2026) is a strong signal.
  if (EXAM_NAME_TOKENS.some((t) => new RegExp(`\\b${t}\\d*\\b`).test(urlSlug))) return 'exam';
  if (/\b(exam|entrance)\b/.test(urlSlug)) return 'exam';

  const blob = textBlob(landing);
  const examHits = EXAM_WORDS.filter((w) => blob.includes(w)).length;
  const collegeHits = COLLEGE_WORDS.filter((w) => blob.includes(w)).length;
  if (examHits >= 3 && examHits > collegeHits) return 'exam';
  return 'college';
}

// ─── Check definitions ───────────────────────────────────────────────────────
// [key, label, weight]. `ok` is computed from the parsed page.

type Check = [key: string, label: string, weight: number];

const CHECKS: Check[] = [
  ['cta', 'Clear Apply/Enquire CTA', 22],
  ['fees', 'Fees / fee structure shown', 14],
  ['deadline', 'Application deadline / urgency', 12],
  ['courses', 'Courses / programmes listed', 10],
  ['course_detail', 'Course details shown (duration/curriculum, not just names)', 8],
  ['placements', 'Placement proof (packages/recruiters)', 10],
  ['trust', 'Accreditation / ranking trust signals', 10],
  ['headline', 'Clear H1 headline', 8],
  ['meta', 'Meta title + description (ad relevance)', 8],
  ['scholarship', 'Scholarship / financial-aid mention', 6],
];

const has = (v: unknown): boolean => Array.isArray(v) ? v.length > 0 : Boolean(v);

function present(landing: LandingPage): Record<string, boolean> {
  return {
    cta: has(landing.cta_buttons),
    fees: has(landing.fees),
    deadline: has(landing.deadlines) || has(landing.admission_dates),
    courses: has(landing.courses),
    course_detail: has(landing.course_detail),
    placements: has(landing.placements),
    trust: has(landing.accreditations) || has(landing.rankings),
    headline: has(landing.h1),
    meta: Boolean(landing.meta_title && landing.meta_description),
    scholarship: has(landing.scholarships),
  };
}

// Specific fix text per missing element (references the real gap + the payoff).
const FIX: Record<string, string> = {
  cta:
    'No Apply/Enquire button was found — add a prominent "Apply Now" CTA above the fold and ' +
    'repeat it after each section. This is the single biggest lift to CVR.',
  fees:
    "Fees aren't visible on the page — add a clear fee-structure block. \"Fees\" is one of the " +
    'top admission search intents; hiding it loses ready-to-apply visitors.',
  deadline:
    'No application deadline / "last date to apply" shown — add a dated urgency line ' +
    '(e.g. "Applications close 31 July") to push fence-sitters to convert now.',
  courses:
    'No course/programme list detected — show the programmes with a one-line hook each so ' +
    'visitors self-qualify instead of bouncing.',
  course_detail:
    "Courses are named but there's no detail under them — add duration, eligibility, fees, " +
    'specialisations and curriculum (or a "course details" link) for each programme so ' +
    'applicants can judge fit before bouncing.',
  placements:
    'No placement proof found — add highest/average package and top recruiters. Proof of ' +
    'outcomes is a decisive trust lever for admissions.',
  trust:
    'No accreditation/ranking badges detected — surface NAAC/AICTE/UGC/NIRF signals near the ' +
    'CTA to reduce hesitation.',
  headline:
    'No clear H1 headline detected — add one that names the college + the action ' +
    '(e.g. "Admissions 2026 Open — Apply to <College>").',
  meta:
    'Meta title/description are incomplete — set both so the ad, the page, and the search ' +
    'snippet all match (higher Quality Score → lower CPC).',
  scholarship:
    'No scholarship/financial-aid mention — if offered, add it; cost is the top objection for ' +
    'many applicants.',
};

const MOBILE_NOTE =
  "You're ~88% mobile — verify the form is thumb-friendly, above the fold, and the page loads " +
  'in under 3s on 4G. Slow mobile pages silently kill the conversion rate.';

// Tracking/measurement is part of the score too — a page can't be "100%" if it
// can't even measure conversions. Applied on top of exam OR college checks.
const TRACKING_CHECKS: Check[] = [
  ['track_conv', 'Conversion tracking live (Google Ads / GA4)', 12],
  ['track_gtm', 'Tag Manager (GTM) installed', 5],
  ['track_retarget', 'Retargeting / audience pixel', 5],
];

function trackingPresent(landing: LandingPage): Record<string, boolean> {
  const tr = landing.tracking;
  return {
    track_conv: Boolean(tr?.google_ads_conversion || tr?.ga4),
    track_gtm: Boolean(tr?.gtm),
    track_retarget: Boolean(tr?.remarketing || tr?.meta_pixel),
  };
}

const TRACKING_FIX: Record<string, string> = {
  track_conv:
    "No conversion tracking found (Google Ads tag / GA4) — without it you can't measure leads " +
    'or let Google optimize bids. Add it before scaling spend.',
  track_gtm:
    'No Google Tag Manager detected — install GTM so tags & retargeting can be managed without ' +
    'touching code.',
  track_retarget:
    'No retargeting/audience pixel — add Google Ads remarketing or the Meta Pixel to re-engage ' +
    "visitors who didn't convert the first time.",
};

// Link hygiene is part of the score: broken links waste ad clicks, and external
// links leak the paid visitor off the page before they convert.
const LINK_CHECKS: Check[] = [
  ['no_broken', 'No broken links', 6],
  ['no_external', 'No external links leaking visitors away', 4],
];

function linksPresent(landing: LandingPage): Record<string, boolean> {
  return {
    no_broken: !(landing.broken_links?.length),
    no_external: !landing.external_link_count,
  };
}

function linksFix(landing: LandingPage): Record<string, string> {
  const broken = landing.broken_links ?? [];
  const ext = landing.external_link_count ?? 0;
  const brokenUrls = broken.slice(0, 3).map((b) => b.url).join(', ');
  return {
    no_broken:
      `${broken.length} broken link(s) found — every one wastes an ad click and hurts trust. ` +
      `Fix or remove: ${brokenUrls}${broken.length > 3 ? '…' : ''}`,
    no_external:
      `${ext} external link(s) point off this page — a paid landing page should keep the ` +
      'visitor here until they convert. Remove off-site links (or open the few essential ones, ' +
      'like the privacy policy, in a new tab).',
  };
}

// Each scored check maps to a category so the audit reads as a detailed
// measurement (Content / Tracking / Links), not one opaque number.
const CATEGORY_OF: Record<string, string> = {
  ...Object.fromEntries(TRACKING_CHECKS.map(([k]) => [k, 'Tracking'])),
  ...Object.fromEntries(LINK_CHECKS.map(([k]) => [k, 'Links'])),
};
const CATEGORY_ORDER = ['Content', 'Tracking', 'Links'];

const categoryOf = (key: string): string => CATEGORY_OF[key] ?? 'Content';

// ─── Exam landing-page checks ────────────────────────────────────────────────

const EXAM_CHECKS: Check[] = [
  ['cta', 'Clear Register / Apply CTA', 20],
  ['exam_date', 'Exam / registration dates shown', 16],
  ['eligibility', 'Eligibility criteria shown', 12],
  ['pattern', 'Exam pattern / syllabus', 12],
  ['accepting', 'Accepting colleges / participating institutes', 12],
  ['prep', 'Mock tests / preparation material', 10],
  ['headline', 'Clear H1 headline', 10],
  ['meta', 'Meta title + description (ad relevance)', 8],
];

function presentExam(landing: LandingPage): Record<string, boolean> {
  const blob = textBlob(landing);
  const hasAny = (...kw: string[]) => kw.some((k) => blob.includes(k));

  return {
    cta: has(landing.cta_buttons),
    exam_date:
      has(landing.admission_dates) ||
      has(landing.deadlines) ||
      hasAny('exam date', 'registration date', 'last date', 'exam on'),
    eligibility: has(landing.eligibility) || hasAny('eligibility'),
    pattern: hasAny(
      'exam pattern', 'syllabus', 'marking scheme', 'sections', 'question paper', 'duration'
    ),
    accepting: hasAny(
      'participating', 'accepting colleg', 'accepted by', 'colleges accept',
      'universities accept', 'institutes accept'
    ),
    prep: hasAny(
      'mock test', 'sample paper', 'practice test', 'preparation', 'previous year',
      'study material'
    ),
    headline: has(landing.h1),
    meta: Boolean(landing.meta_title && landing.meta_description),
  };
}

const EXAM_FIX: Record<string, string> = {
  cta:
    'No Register/Apply button found — add a prominent "Register Now" CTA above the fold (and ' +
    "after each section). It's the biggest lever on exam-registration CVR.",
  exam_date:
    'No exam / registration dates shown — add the registration deadline and exam date with ' +
    'urgency ("Registration closes 15 Oct") to drive sign-ups now.',
  eligibility:
    'No eligibility criteria shown — state who can apply (qualification, age, attempts) so ' +
    'visitors self-qualify instead of bouncing to check elsewhere.',
  pattern:
    'No exam pattern / syllabus detected — add sections, marks, duration and syllabus; ' +
    'candidates need this to trust the page and register.',
  accepting:
    'No accepting/participating colleges listed — show the institutes that accept this score; ' +
    "it's the #1 reason candidates take an exam.",
  prep:
    'No mock tests / prep material found — offer a free mock or sample paper to capture leads ' +
    'and pull candidates into the funnel.',
  headline:
    'No clear H1 detected — add one naming the exam + action ' +
    '(e.g. "NMAT 2026 Registration Open — Apply Now").',
  meta:
    'Meta title/description incomplete — set both so the ad, page and search snippet match ' +
    '(higher Quality Score → lower CPC).',
};

// ─── Scoring ─────────────────────────────────────────────────────────────────

export type ScoredCheck = { item: string; ok: boolean; weight: number; category: string };
export type ScoredCategory = {
  name: string;
  passed: number;
  max: number;
  score: number;
  items: Array<{ item: string; ok: boolean; weight: number }>;
};

export type LandingScore =
  | { available: false }
  | {
      available: true;
      pageType: 'exam' | 'college';
      score: number;
      grade: 'A' | 'B' | 'C' | 'D';
      checks: ScoredCheck[];
      categories: ScoredCategory[];
      suggestions: string[];
      passed: number;
      max: number;
      externalLinks: string[];
      externalLinkCount: number;
      brokenLinks: LandingPage['broken_links'];
      linksChecked: number;
    };

/** Return a 0-100 landing quality score, per-check breakdown, and fixes. */
export function scoreLandingPage(
  landing: LandingPage,
  opts: { mobileHeavy?: boolean } = {}
): LandingScore {
  const mobileHeavy = opts.mobileHeavy ?? true;
  if (!landing || !landing.fetched) return { available: false };

  // Judge an exam page on exam signals and a college page on college signals —
  // and ALWAYS include tracking/tags, so the score can't reach 100% without them.
  const pageType = detectPageType(landing);

  const checksDef: Check[] =
    pageType === 'exam'
      ? [...EXAM_CHECKS, ...TRACKING_CHECKS, ...LINK_CHECKS]
      : [...CHECKS, ...TRACKING_CHECKS, ...LINK_CHECKS];

  const flags: Record<string, boolean> =
    pageType === 'exam'
      ? { ...presentExam(landing), ...trackingPresent(landing), ...linksPresent(landing) }
      : { ...present(landing), ...trackingPresent(landing), ...linksPresent(landing) };

  const fixes: Record<string, string> =
    pageType === 'exam'
      ? { ...EXAM_FIX, ...TRACKING_FIX, ...linksFix(landing) }
      : { ...FIX, ...TRACKING_FIX, ...linksFix(landing) };

  const totalW = checksDef.reduce((s, [, , w]) => s + w, 0);
  const got = checksDef.reduce((s, [key, , w]) => s + (flags[key] ? w : 0), 0);
  const score = totalW ? Math.round((got / totalW) * 100) : 0;
  const grade: 'A' | 'B' | 'C' | 'D' =
    score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';

  const checks: ScoredCheck[] = checksDef.map(([key, label, w]) => ({
    item: label,
    ok: Boolean(flags[key]),
    weight: w,
    category: categoryOf(key),
  }));

  // Category breakdown — a per-dimension sub-score so the number is auditable.
  const cats = new Map<string, { got: number; max: number; items: ScoredCategory['items'] }>(
    CATEGORY_ORDER.map((c) => [c, { got: 0, max: 0, items: [] }])
  );
  for (const [key, label, w] of checksDef) {
    const c = cats.get(categoryOf(key))!;
    c.max += w;
    if (flags[key]) c.got += w;
    c.items.push({ item: label, ok: Boolean(flags[key]), weight: w });
  }
  const categories: ScoredCategory[] = CATEGORY_ORDER.filter((c) => cats.get(c)!.max > 0).map(
    (c) => {
      const v = cats.get(c)!;
      return {
        name: c,
        passed: v.got,
        max: v.max,
        score: v.max ? Math.round((v.got / v.max) * 100) : 0,
        items: v.items,
      };
    }
  );

  // Suggestions only for what's missing, heaviest lever first.
  const suggestions = checksDef
    .filter(([key]) => !flags[key])
    .sort((a, b) => b[2] - a[2])
    .map(([key]) => fixes[key]!)
    .filter(Boolean);
  if (mobileHeavy) suggestions.push(MOBILE_NOTE);

  return {
    available: true,
    pageType,
    score,
    grade,
    checks,
    categories,
    suggestions,
    passed: got,
    max: totalW,
    externalLinks: landing.external_links ?? [],
    externalLinkCount: landing.external_link_count ?? 0,
    brokenLinks: landing.broken_links ?? [],
    linksChecked: landing.links_checked ?? 0,
  };
}
