import 'server-only';
import { complete, llmAvailable, LLMNotConfiguredError } from './gemini';
import { D_MAX, H_MAX, fit, validateAssets, type ValidationResult } from './rsa-validator';
import { analyzeLandingPage, type LandingPage } from './landing-page';

/**
 * AI ad copy generation.
 *
 * Follows the source's hybrid design (`app/services/ai/ad_copy_service.py`):
 * ground the model in facts pulled from the live landing page, ask it for
 * structured JSON, then validate everything against Google's hard limits and
 * drop whatever doesn't fit. If no key is configured, or the model fails, a
 * deterministic engine produces usable copy from the same facts — generating
 * ad copy is never allowed to hard-fail.
 *
 * The source is tuned to one advertiser's college/exam campaigns via a
 * hardcoded campus brief table. This version takes the brief from the Ad
 * Request the user filled in, which is the same information arriving through
 * the workflow instead of a config file.
 */

export const TONES = [
  'professional',
  'urgent',
  'friendly',
  'premium',
  'value',
  'direct',
] as const;
export type Tone = (typeof TONES)[number];

export const TONE_GUIDANCE: Record<Tone, string> = {
  professional: 'Measured and credible. Lead with outcomes and proof, no exclamation marks.',
  urgent: 'Deadline-driven. Lead with the closing date and what is lost by waiting.',
  friendly: 'Warm, second person, plain words. Reads like a helpful person, not a brochure.',
  premium: 'Selective and prestigious. Emphasise ranking, accreditation and exclusivity.',
  value: 'Cost-aware. Lead with fees, scholarships, financial aid and return on investment.',
  direct: 'Short imperative phrases. Verb first, no adjectives that earn nothing.',
};

export type Asset = { text: string; characters: number; reason?: string };

export type AdCopyBrief = {
  /** What is being advertised — the request's product/service. */
  product: string;
  /** The account or brand name that should appear in headlines. */
  brand?: string | null;
  objective: string;
  targetAudience: string;
  location: string;
  landingPageUrl: string;
  usps?: string | null;
  keywords?: string[];
  notes?: string | null;
  tone: Tone;
};

export type AdCopyResult = {
  headlines: Asset[];
  descriptions: Asset[];
  validation: ValidationResult;
  /** 'gemini' when the model produced the copy, 'deterministic' otherwise. */
  backend: 'gemini' | 'deterministic';
  /** Why the deterministic engine was used, when it was. */
  backendReason: string | null;
  landingFacts: LandingFacts | null;
};

/** The subset of the parsed page the generator is allowed to draw on. */
export type LandingFacts = {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  highlights: string[];
  courses: string[];
  fees: string[];
  placements: string[];
  accreditations: string[];
  rankings: string[];
  deadlines: string[];
  scholarships: string[];
  ctas: string[];
};

function toFacts(page: LandingPage): LandingFacts | null {
  if (!page.fetched) return null;
  return {
    title: page.title ?? null,
    metaDescription: page.meta_description ?? null,
    h1: page.h1 ?? [],
    highlights: page.highlights ?? [],
    courses: page.courses ?? [],
    fees: page.fees ?? [],
    placements: page.placements ?? [],
    accreditations: page.accreditations ?? [],
    rankings: page.rankings ?? [],
    deadlines: page.deadlines ?? [],
    scholarships: page.scholarships ?? [],
    ctas: page.cta_buttons ?? [],
  };
}

const SYSTEM_PROMPT = `You write Google Ads responsive search ad copy.

Hard rules, in priority order:
1. Every headline is at most ${H_MAX} characters, including spaces. Count them.
2. Every description is at most ${D_MAX} characters, including spaces. Count them.
3. Use ONLY facts present in the brief and the landing-page extract you are
   given. Never invent a ranking, a fee, a placement figure, an accreditation,
   a deadline or a statistic. If a fact is not supplied, write around it.
4. No ALL CAPS words (acronyms like MBA, NAAC, IIM are fine). No "!!". No
   double spaces. Do not repeat the same word three or more times in one
   headline.
5. Every headline must be distinct in wording, not just in punctuation.
6. Write in the requested tone.

Return ONLY JSON matching exactly this shape, with no surrounding prose:
{
  "headlines":    [{"text": "...", "reason": "..."}],
  "descriptions": [{"text": "...", "reason": "..."}]
}
Produce 15 headlines and 4 descriptions. "reason" is one short clause naming
the fact or angle the asset is built on.`;

function buildPrompt(brief: AdCopyBrief, facts: LandingFacts | null): string {
  const lines: string[] = [];
  lines.push('BRIEF');
  lines.push(`- Advertising: ${brief.product}`);
  if (brief.brand) lines.push(`- Brand / account: ${brief.brand}`);
  lines.push(`- Objective: ${brief.objective}`);
  lines.push(`- Target audience: ${brief.targetAudience}`);
  lines.push(`- Location: ${brief.location}`);
  lines.push(`- Landing page: ${brief.landingPageUrl}`);
  if (brief.usps) lines.push(`- USPs / offers: ${brief.usps}`);
  if (brief.keywords?.length) {
    lines.push(`- Target keywords: ${brief.keywords.slice(0, 40).join(', ')}`);
  }
  if (brief.notes) lines.push(`- Notes: ${brief.notes}`);
  lines.push(`- Tone: ${brief.tone} — ${TONE_GUIDANCE[brief.tone]}`);

  if (facts) {
    lines.push('');
    lines.push('LANDING PAGE EXTRACT (the only other facts you may use)');
    const push = (label: string, values: string[] | null | undefined) => {
      const v = (values ?? []).filter(Boolean).slice(0, 6);
      if (v.length) lines.push(`- ${label}: ${v.join(' | ')}`);
    };
    if (facts.title) lines.push(`- Page title: ${facts.title}`);
    if (facts.metaDescription) lines.push(`- Meta description: ${facts.metaDescription}`);
    push('Headings', facts.h1);
    push('Highlights', facts.highlights);
    push('Courses', facts.courses);
    push('Fees', facts.fees);
    push('Placements', facts.placements);
    push('Accreditations', facts.accreditations);
    push('Rankings', facts.rankings);
    push('Deadlines', facts.deadlines);
    push('Scholarships', facts.scholarships);
    push('Existing CTAs', facts.ctas);
  } else {
    lines.push('');
    lines.push(
      'LANDING PAGE EXTRACT: unavailable (the page could not be fetched). Use the brief only.'
    );
  }

  return lines.join('\n');
}

type RawAsset = { text?: unknown; reason?: unknown };

function parseModelJson(text: string): { headlines: RawAsset[]; descriptions: RawAsset[] } {
  // The model is asked for bare JSON, but a fenced block is a common slip and
  // is cheap to tolerate.
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as { headlines?: RawAsset[]; descriptions?: RawAsset[] };
  return {
    headlines: Array.isArray(parsed.headlines) ? parsed.headlines : [],
    descriptions: Array.isArray(parsed.descriptions) ? parsed.descriptions : [],
  };
}

/**
 * Keep only assets that fit the limit, de-duplicated case-insensitively.
 *
 * Over-length output is dropped rather than truncated: cutting a headline at
 * 30 characters reliably produces a fragment, and a short valid set beats a
 * long broken one.
 */
function collectAssets(raw: RawAsset[], limit: number, cap: number): Asset[] {
  const out: Asset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = fit(String(item?.text ?? ''), limit);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      text,
      characters: text.length,
      reason: item?.reason ? String(item.reason) : undefined,
    });
    if (out.length >= cap) break;
  }
  return out;
}

// ─── Deterministic engine ────────────────────────────────────────────────────

const TITLE_ACRONYMS = new Set([
  'mba', 'pgdm', 'pgpm', 'bba', 'bca', 'mca', 'mbbs', 'bds', 'llb', 'llm', 'phd',
  'bpt', 'bams', 'bhms', 'msc', 'bsc', 'mcom', 'bcom', 'ba', 'ma', 'cuet', 'cat',
  'nmat', 'micat', 'clat', 'gate', 'iit', 'nit', 'iim', 'ug', 'pg',
]);

/** Title-case that leaves programme acronyms upper-cased. Mirrors `_titlecase`. */
export function titlecase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const wl = w.toLowerCase().replace(/\.$/, '');
      if (TITLE_ACRONYMS.has(wl)) return wl.toUpperCase();
      if (wl === 'btech' || wl === 'b.tech') return 'B.Tech';
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Shorten to `limit` at a word boundary, without a trailing ellipsis.
 *
 * Google counts characters, so an over-length asset is rejected outright —
 * a clean shorter phrase beats a truncated one with a "…" burning a character.
 */
function clamp(text: string, limit: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : t.slice(0, limit)).trim();
}

/**
 * Template-driven copy built from the brief and the page facts.
 *
 * This is the floor, not the goal: it runs when no Gemini key is configured or
 * the model call fails, so the Ads team always leaves the screen with
 * something valid to edit rather than an error.
 *
 * Every candidate is built from already-shortened components and then filtered
 * through the real limit, and the pool is deliberately larger than the target
 * so that dropping the over-length ones still clears Google's minimum of three
 * headlines and two descriptions.
 */
export function generateDeterministic(
  brief: AdCopyBrief,
  facts: LandingFacts | null
): { headlines: Asset[]; descriptions: Asset[] } {
  // Headlines are 30 characters, so the components have to be short before
  // they are combined — "MBA" not "Two-year full-time MBA programme".
  const productFull = titlecase(brief.product);
  const product = clamp(productFull, 26);
  const productShort = clamp(productFull, 16);
  const brandRaw = brief.brand ? titlecase(brief.brand) : null;
  // With no account attached the brand would fall back to the product, which
  // reads as "MBA at MBA"; better to drop the clause entirely.
  const brand = brandRaw && brandRaw.toLowerCase() !== productFull.toLowerCase() ? clamp(brandRaw, 20) : null;
  const brandShort = brand ? clamp(brand, 14) : null;
  const place = clamp(titlecase(brief.location.split(',')[0]!.trim()), 14);
  const subject = brand ?? product;
  const subjectShort = brandShort ?? productShort;

  const kw = (brief.keywords ?? []).map((k) => titlecase(k)).filter((k) => k.length <= 28);

  const deadline = (facts?.deadlines ?? [])[0] ?? null;
  const hasFees = (facts?.fees ?? []).length > 0;
  const hasPlacements = (facts?.placements ?? []).length > 0;
  const hasAccred = (facts?.accreditations ?? []).length > 0;
  const hasScholarship = (facts?.scholarships ?? []).length > 0;
  const hasCourses = (facts?.courses ?? []).length > 0;

  // Each candidate is emitted only when the fact behind it exists, so the
  // fallback stays as grounded as the model path.
  const headlineCandidates: Array<string | null> = [
    product,
    `${productShort} in ${place}`,
    brand ? `${brand} Admissions` : null,
    `Apply for ${productShort}`,
    `${subjectShort}: Apply Now`,
    brand ? `${brandShort} — Enquire Now` : null,
    deadline ? 'Applications Close Soon' : null,
    hasFees ? 'See the Full Fee Details' : null,
    hasScholarship ? 'Scholarships Available' : null,
    hasPlacements ? 'Strong Placement Record' : null,
    hasAccred ? 'Accredited Programme' : null,
    hasCourses ? 'Compare All Programmes' : null,
    `${place} Admissions Open`,
    'Get the Course Details',
    'Book Free Counselling',
    'Download the Brochure',
    'Check Your Eligibility',
    'Talk to an Advisor Today',
    ...kw.slice(0, 4),
  ];

  // Descriptions get 90 characters — enough for two short sentences, not for
  // a subject repeated twice.
  const audience = brief.targetAudience.trim().toLowerCase();
  const audienceShort = clamp(audience, 28);
  const atBrand = brand ? ` at ${brand}` : '';

  const descriptionCandidates: Array<string | null> = [
    clamp(`${product}${atBrand}. Built for ${audienceShort}. Apply online in minutes.`, D_MAX),
    hasFees
      ? clamp(`See fees, eligibility and course details for ${product}. Enquire today.`, D_MAX)
      : clamp(`See eligibility and course details for ${product}. Enquire today.`, D_MAX),
    hasPlacements
      ? clamp(`${subject} in ${place}. Review the placement record, then apply online.`, D_MAX)
      : clamp(`${subject} in ${place}. Review the programme details and apply online.`, D_MAX),
    deadline
      ? clamp(`Applications close soon. Secure your place on ${product} now.`, D_MAX)
      : clamp(`Speak to an advisor about ${product}. Free counselling, no obligation.`, D_MAX),
    hasScholarship
      ? clamp(`Scholarships available on ${product}. Check what you qualify for today.`, D_MAX)
      : null,
    clamp(`Applying for ${product}? Get the details and start your application today.`, D_MAX),
    clamp(`${product} in ${place}. Enquire now and get a call back from an advisor.`, D_MAX),
  ];

  const headlines = collectAssets(
    headlineCandidates
      .filter((t): t is string => Boolean(t))
      // A component-level clamp can still overshoot once combined, so every
      // candidate is clamped again at the real limit before it is considered.
      .map((t) => ({ text: clamp(t, H_MAX), reason: 'Built from the brief and the landing page.' })),
    H_MAX,
    15
  );

  const descriptions = collectAssets(
    descriptionCandidates
      .filter((t): t is string => Boolean(t))
      .map((t) => ({ text: clamp(t, D_MAX), reason: 'Built from the brief and the landing page.' })),
    D_MAX,
    4
  );

  return { headlines, descriptions };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export async function generateAdCopy(
  brief: AdCopyBrief,
  opts: { landingPage?: LandingPage | null } = {}
): Promise<AdCopyResult> {
  // Reuse a page the caller already fetched (the request screen scores and
  // generates in one flow) rather than hitting the site twice.
  const page = opts.landingPage ?? (await analyzeLandingPage(brief.landingPageUrl));
  const facts = toFacts(page);

  let headlines: Asset[] = [];
  let descriptions: Asset[] = [];
  let backend: 'gemini' | 'deterministic' = 'deterministic';
  let backendReason: string | null = null;

  if (llmAvailable()) {
    try {
      const text = await complete({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(brief, facts),
        maxTokens: 4096,
      });
      const raw = parseModelJson(text);
      headlines = collectAssets(raw.headlines, H_MAX, 15);
      descriptions = collectAssets(raw.descriptions, D_MAX, 4);

      // Google needs 3 headlines and 2 descriptions for a valid RSA. Below
      // that the model's output is unusable on its own, so fall through.
      if (headlines.length >= 3 && descriptions.length >= 2) {
        backend = 'gemini';
      } else {
        backendReason = `The model returned ${headlines.length} usable headline(s) and ${descriptions.length} description(s) — below Google's minimum.`;
        headlines = [];
        descriptions = [];
      }
    } catch (err) {
      backendReason =
        err instanceof LLMNotConfiguredError
          ? 'No Gemini API key is configured.'
          : `Gemini call failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    backendReason = 'No Gemini API key is configured.';
  }

  if (backend === 'deterministic') {
    const fallback = generateDeterministic(brief, facts);
    headlines = fallback.headlines;
    descriptions = fallback.descriptions;
  }

  const validation = validateAssets({
    headlines: headlines.map((h) => h.text),
    descriptions: descriptions.map((d) => d.text),
    keywordThemes: brief.keywords ?? [],
  });

  return { headlines, descriptions, validation, backend, backendReason, landingFacts: facts };
}
