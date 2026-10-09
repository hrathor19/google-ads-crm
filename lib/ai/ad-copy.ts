import 'server-only';
import { complete, llmAvailable, LLMNotConfiguredError } from './gemini';
import {
  D_COUNT,
  D_MAX,
  H_COUNT,
  H_MAX,
  MIN_SUBJECT_HEADLINES,
  SITELINK_COUNT,
  SITELINK_DESC_MAX,
  SITELINK_TEXT_MAX,
  fit,
  significantTokens,
  validateAssets,
  type Sitelink,
  type ValidationResult,
} from './rsa-validator';
import { analyzeLandingPage, type LandingPage } from './landing-page';
import { excludedTermIn, filterClean, isClean } from './exclusions';

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

/**
 * The angles the fifteen headlines are spread across.
 *
 * This replaces the tone picker. A single tone applied to all fifteen
 * headlines is the opposite of what a responsive search ad wants: Google
 * rotates assets and rewards a set that covers different reasons to click,
 * so "all fifteen urgent" scores worse than a mixed set *and* loses whoever
 * was never going to respond to a deadline.
 *
 * Asking for the spread directly also removes a decision nobody was placed
 * to make — the Ads person picking "premium" over "value" was guessing at
 * an audience the data never described.
 */
/**
 * How many headlines must carry the college's own name, when one is given.
 *
 * Lower than the subject minimum on purpose: a long institution name eats a
 * 30-character headline, so demanding it in four of fifteen would crowd out
 * the keyword and offer angles that earn the clicks.
 */
export const MIN_INSTITUTION_HEADLINES = 2;

export const HEADLINE_ANGLES = [
  'the offer stated plainly',
  'the outcome or proof the page evidences',
  'cost, fees, scholarships or funding',
  'eligibility and who it is for',
  'timing — intake, deadline, how long it takes',
  'a direct instruction: apply, enquire, compare, download',
  'the highest-volume target keywords, worded naturally',
] as const;

export type Asset = { text: string; characters: number; reason?: string };

export type { Sitelink } from './rsa-validator';

export type AdCopyBrief = {
  /** The college, university or course being advertised. */
  product: string;
  /**
   * The client or campaign name from the request, when there is one.
   *
   * On an ad request the institution sits in `title` ("Campaign / client
   * name") while `productService` holds only the course — "MBA/PGDM" — so
   * without this the generator never learned which college the ad was for
   * and wrote fifteen headlines that could have belonged to anybody.
   */
  institution?: string | null;
  /**
   * Words that must not appear in any asset. Enforced after generation, not
   * merely asked for — see `./exclusions`.
   */
  excludedTerms?: string[];
  objective: string;
  /**
   * Nullable since the Ops requirement form stopped asking for it. The
   * prompt omits the line entirely rather than telling the model the
   * audience is "null", and the deterministic engine drops the phrase that
   * would have named it.
   */
  targetAudience: string | null;
  location: string;
  landingPageUrl: string;
  usps?: string | null;
  keywords?: string[];
  /**
   * The uploaded research, highest volume first. Separate from `keywords`
   * because the volume is what makes the list worth uploading: the model is
   * told which terms carry the demand, so the busiest ones reach a headline
   * instead of the first twenty alphabetically.
   */
  keywordVolumes?: Array<{ keyword: string; volume: number }>;
  notes?: string | null;
};

export type AdCopyResult = {
  headlines: Asset[];
  descriptions: Asset[];
  sitelinks: Sitelink[];
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

/** Every fact list, minus the entries carrying a banned term. */
function withoutExcluded(facts: LandingFacts, terms: string[]): LandingFacts {
  if (terms.length === 0) return facts;
  return {
    ...facts,
    title: facts.title && isClean(facts.title, terms) ? facts.title : null,
    metaDescription:
      facts.metaDescription && isClean(facts.metaDescription, terms)
        ? facts.metaDescription
        : null,
    h1: filterClean(facts.h1, terms),
    highlights: filterClean(facts.highlights, terms),
    courses: filterClean(facts.courses, terms),
    fees: filterClean(facts.fees, terms),
    placements: filterClean(facts.placements, terms),
    accreditations: filterClean(facts.accreditations, terms),
    rankings: filterClean(facts.rankings, terms),
    deadlines: filterClean(facts.deadlines, terms),
    scholarships: filterClean(facts.scholarships, terms),
    ctas: filterClean(facts.ctas, terms),
  };
}

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
5a. NAME WHAT IS BEING ADVERTISED. At least ${MIN_SUBJECT_HEADLINES} of the
   headlines and at least 2 of the descriptions must contain the college,
   university or course name from the brief. A searcher who typed that name
   expects to see it back, and Google scores an ad that carries it higher
   than one that does not.
   Where the brief names a college or university separately from the course,
   that institution is the name to use: put it in several headlines and at
   least one description, not the course alone.
   Use the full name wherever it fits the character limit. Where it does not,
   use the shortest form that is still a real name — its established acronym
   (IIM Bangalore, NMIMS, Christ University) or the institution without the
   programme words. Never cut a name mid-word and never invent an
   abbreviation nobody uses.
6. Spread the headlines across these angles, roughly two each, rather than
   writing fifteen versions of one idea:
${HEADLINE_ANGLES.map((a) => `     - ${a}`).join('\n')}
   Skip an angle the brief gives you nothing for rather than inventing
   something to fill it, and use the spare headlines on the angles it does.
   The four descriptions likewise cover different ground from each other.

7. Sitelinks are separate from headlines. Each one names a DIFFERENT place a
   visitor would want to go — fees, eligibility, placements, courses,
   scholarships, contact — never a restatement of the main offer. Link text
   is at most ${SITELINK_TEXT_MAX} characters, and each of its two
   description lines is at most ${SITELINK_DESC_MAX} characters. Write both
   description lines or neither; one alone is rejected by Google.

8. Some words are forbidden outright. The brief may list terms under
   "Never mention"; if it does, no headline, description or sitelink may
   contain them or any obvious variant. Write around the subject entirely —
   do not hint at it, and do not substitute a synonym for the same thing.

Return ONLY JSON matching exactly this shape, with no surrounding prose:
{
  "headlines":    [{"text": "...", "reason": "..."}],
  "descriptions": [{"text": "...", "reason": "..."}],
  "sitelinks":    [{"text": "...", "description1": "...", "description2": "..."}]
}
Produce exactly ${H_COUNT} headlines, ${D_COUNT} descriptions and
${SITELINK_COUNT} sitelinks — the full set every time, not a sample.
"reason" is one short clause naming the fact or angle the asset is built on.`;

function buildPrompt(brief: AdCopyBrief, facts: LandingFacts | null): string {
  // Strip the banned subject out of the evidence too. Leaving "Fees: INR
  // 12,00,000" in the extract and then asking the model not to mention fees
  // is an invitation it regularly accepts.
  facts = facts ? withoutExcluded(facts, brief.excludedTerms ?? []) : facts;
  const lines: string[] = [];
  lines.push('BRIEF');
  // When both are known they are stated separately, institution first. The
  // institution used to be a hedged "client / campaign name, use it if it
  // looks real" line below the course, and the model duly ignored it — an
  // override of "Narsee Monjee" produced fifteen headlines about Executive
  // PGDM and named no college. The field is visible and editable on both
  // screens now, so whatever is in it has been looked at by the person
  // generating the copy and is not a guess to be second-guessed.
  const institution = institutionName(brief.institution);
  if (institution) {
    lines.push(`- College / university: ${institution}`);
    lines.push(`- Course: ${brief.product}`);
  } else {
    lines.push(`- College / university / course: ${brief.product}`);
  }
  lines.push(`- Objective: ${brief.objective}`);
  if (brief.targetAudience) lines.push(`- Target audience: ${brief.targetAudience}`);
  lines.push(`- Location: ${brief.location}`);
  lines.push(`- Landing page: ${brief.landingPageUrl}`);
  if (brief.usps) lines.push(`- USPs / offers: ${brief.usps}`);
  // Ranked when the research was uploaded, a flat list otherwise. The
  // volumes are what tell the model which themes deserve a headline each.
  if (brief.keywordVolumes?.length) {
    const top = brief.keywordVolumes.slice(0, 40);
    lines.push('- Target keywords, busiest first (monthly searches in brackets):');
    for (const k of top) {
      lines.push(`    ${k.keyword}${k.volume > 0 ? ` (${k.volume.toLocaleString('en-IN')})` : ''}`);
    }
    lines.push(
      '  Cover the highest-volume themes first. The numbers are search volume, not ' +
        'facts about the advertiser — never put one in an asset.'
    );
  } else if (brief.keywords?.length) {
    lines.push(`- Target keywords: ${brief.keywords.slice(0, 40).join(', ')}`);
  }
  if (brief.notes) lines.push(`- Notes: ${brief.notes}`);
  if (brief.excludedTerms?.length) {
    lines.push(
      `- NEVER MENTION: ${brief.excludedTerms.join(', ')} — not these words, not variants of ` +
        'them, and not a synonym that means the same thing.'
    );
  }
  // No brand line. The advertiser's name belongs to the landing page, which
  // is supplied below — the Google Ads account name that used to fill this
  // slot is an internal label like "EDUGROWTH 2", and putting it in a
  // headline was worse than leaving the advertiser unnamed.

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
type RawSitelink = { text?: unknown; description1?: unknown; description2?: unknown };

function parseModelJson(text: string): {
  headlines: RawAsset[];
  descriptions: RawAsset[];
  sitelinks: RawSitelink[];
} {
  // The model is asked for bare JSON, but a fenced block is a common slip and
  // is cheap to tolerate.
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as {
    headlines?: RawAsset[];
    descriptions?: RawAsset[];
    sitelinks?: RawSitelink[];
  };
  return {
    headlines: Array.isArray(parsed.headlines) ? parsed.headlines : [],
    descriptions: Array.isArray(parsed.descriptions) ? parsed.descriptions : [],
    sitelinks: Array.isArray(parsed.sitelinks) ? parsed.sitelinks : [],
  };
}

/**
 * Keep the sitelinks that fit all three caps.
 *
 * A sitelink whose link text is over length is dropped outright, same as a
 * headline. Over-length *descriptions* are dropped to empty instead, leaving
 * a bare link — which Google accepts — rather than losing the destination
 * because one of its two subtitles ran four characters long.
 */
function collectSitelinks(raw: RawSitelink[], cap: number, excluded: string[] = []): Sitelink[] {
  const out: Sitelink[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = fit(String(item?.text ?? ''), SITELINK_TEXT_MAX);
    if (!text) continue;
    // A "Fees & Funding" sitelink beside headlines that may not say "fee"
    // would make the ban look like an oversight rather than a decision, so
    // the whole sitelink goes when its label carries a banned term.
    if (excludedTermIn(text, excluded)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let d1 = fit(String(item?.description1 ?? ''), SITELINK_DESC_MAX) ?? '';
    let d2 = fit(String(item?.description2 ?? ''), SITELINK_DESC_MAX) ?? '';
    // A banned description line drops the pair, not the destination: the
    // link itself is still somewhere a visitor wants to go.
    if (excludedTermIn(d1, excluded) || excludedTermIn(d2, excluded)) {
      d1 = '';
      d2 = '';
    }
    // Both lines or neither, which is Google's rule, not a preference.
    const both = d1 && d2 ? { description1: d1, description2: d2 } : { description1: '', description2: '' };

    out.push({ text, ...both });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Keep only assets that fit the limit, de-duplicated case-insensitively.
 *
 * Over-length output is dropped rather than truncated: cutting a headline at
 * 30 characters reliably produces a fragment, and a short valid set beats a
 * long broken one.
 */
function collectAssets(
  raw: RawAsset[],
  limit: number,
  cap: number,
  excluded: string[] = []
): Asset[] {
  const out: Asset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = fit(String(item?.text ?? ''), limit);
    if (!text) continue;
    // The hard half of the exclusion rule. The prompt asks; this refuses.
    if (excludedTermIn(text, excluded)) continue;
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

/**
 * Guarantee that enough headlines name the advertiser.
 *
 * The prompt demands it and the model usually complies — but "usually" is
 * the problem: one run in several came back naming only the course, and
 * that run is somebody's live ad. So the count is enforced here instead,
 * by swapping unnamed headlines at the end of the list for named ones from
 * the template pool. The model's own named headlines are never touched, and
 * nothing is added beyond the target count.
 */
function ensureNamed(
  headlines: Asset[],
  pool: Asset[],
  subject: string,
  target: number
): Asset[] {
  const tokens = significantTokens(subject);
  if (tokens.length === 0) return headlines;

  const names = (text: string) => {
    const t = text.toLowerCase();
    return tokens.some((tok) => t.includes(tok));
  };

  let shortfall = target - headlines.filter((h) => names(h.text)).length;
  if (shortfall <= 0) return headlines;

  const present = new Set(headlines.map((h) => h.text.toLowerCase()));
  const candidates = pool.filter((p) => names(p.text) && !present.has(p.text.toLowerCase()));
  if (candidates.length === 0) return headlines;

  const out = [...headlines];
  // From the end, because the model orders its best first and a swap should
  // cost the weakest headline rather than the strongest.
  for (let i = out.length - 1; i >= 0 && shortfall > 0 && candidates.length > 0; i--) {
    if (names(out[i]!.text)) continue;
    out[i] = candidates.shift()!;
    shortfall -= 1;
  }
  return out;
}

/**
 * Fill a short list from a fallback pool, keeping the originals first.
 *
 * De-duplicated case-insensitively against what is already there, so a
 * template that happens to match something the model wrote does not appear
 * twice.
 */
function mergeAssets(primary: Asset[], pool: Asset[], target: number): Asset[] {
  const out = [...primary];
  const seen = new Set(out.map((a) => a.text.toLowerCase()));
  for (const candidate of pool) {
    if (out.length >= target) break;
    const key = candidate.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function mergeSitelinks(primary: Sitelink[], pool: Sitelink[], target: number): Sitelink[] {
  const out = [...primary];
  const seen = new Set(out.map((s) => s.text.toLowerCase()));
  for (const candidate of pool) {
    if (out.length >= target) break;
    const key = candidate.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
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
  const word = (w: string): string => {
    if (!w) return w;
    // Already upper-cased by whoever typed it, so it is an acronym they
    // meant: VIT, NMIMS, SRM. The fixed list below cannot know every
    // institution in India, and lower-casing one invents a word — "Vit
    // Vellore" is not a place.
    if (w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
    const wl = w.toLowerCase().replace(/\.$/, '');
    if (TITLE_ACRONYMS.has(wl)) return wl.toUpperCase();
    if (wl === 'btech' || wl === 'b.tech') return 'B.Tech';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  };

  // "Indian Institute Of Management" is not how anyone writes that name.
  const MINOR = new Set(['of', 'the', 'and', 'in', 'for', 'at', 'to', 'a', 'an', 'on', 'by']);

  return (
    s
      .split(/\s+/)
      .filter(Boolean)
      // "MBA/PGDM" is two acronyms, not one word — splitting on the slash is
      // what stops it rendering as "Mba/pgdm".
      .map((token, i) => {
        const cased = token.split('/').map(word).join('/');
        // Minor words stay lower case unless they open the name.
        return i > 0 && MINOR.has(token.toLowerCase()) ? token.toLowerCase() : cased;
      })
      .join(' ')
  );
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
  // Never mid-word. The old rule fell back to a hard character slice when
  // the last space landed in the first half, which turned "Two-year
  // Full-time MBA" into "Two-year Full-ti" and shipped it inside a headline.
  // Returning the untrimmed string instead leaves it over the limit, and
  // `collectAssets` drops it — a missing candidate beats a broken one.
  if (lastSpace <= 0) return t;
  // A word-boundary cut can still land after a preposition — "Postgraduate
  // Diploma In" — which reads as a sentence someone forgot to finish.
  return dropDanglingWord(cut.slice(0, lastSpace).trim());
}

const DANGLING = new Set([
  'in', 'of', 'for', 'and', 'the', 'at', 'to', 'a', 'an', 'with', 'on', 'by', 'or', 'from',
]);

function dropDanglingWord(text: string): string {
  const words = text.split(' ');
  while (words.length > 1 && DANGLING.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }
  return words.join(' ');
}

/**
 * The short form of what is being advertised, for templates with no room.
 *
 * A whole-word prefix of "Two-year full-time MBA" is "Two-year", which says
 * nothing. The qualification is the part someone searches for and the part
 * worth the characters, so a known programme acronym in the name wins over
 * a prefix of it.
 */
function shortSubject(productFull: string, limit: number): string {
  if (productFull.length <= limit) return productFull;
  const acronym = productFull.split(/\s+/).filter(Boolean).find(isProgrammeToken);
  if (acronym && acronym.length <= limit) return titlecase(acronym);
  return clamp(productFull, limit);
}

/** A qualification rather than a describing word: MBA, PGDM, B.Tech. */
function isProgrammeToken(word: string): boolean {
  const w = word.toLowerCase().replace(/[.,]$/, '');
  // B.Tech is spelled two ways and is not in the acronym set, which exists
  // for capitalisation rather than for this.
  return TITLE_ACRONYMS.has(w) || w === 'btech' || w === 'b.tech';
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
): { headlines: Asset[]; descriptions: Asset[]; sitelinks: Sitelink[] } {
  const excluded = brief.excludedTerms ?? [];
  facts = facts ? withoutExcluded(facts, excluded) : facts;
  // Headlines are 30 characters, so the components have to be short before
  // they are combined — "MBA" not "Two-year full-time MBA programme".
  const productFull = titlecase(brief.product);
  const product = shortSubject(productFull, 26);
  const productShort = shortSubject(productFull, 16);
  const place = clamp(titlecase(brief.location.split(',')[0]!.trim()), 14);

  // The institution, when the request carried one separately from the
  // course. Dropped when it merely repeats the course, so a brief whose
  // client name is "MBA" does not produce "MBA MBA Admissions".
  const cleaned = institutionName(brief.institution);
  const institutionFull = cleaned ? titlecase(cleaned) : null;
  //
  // Never shortened. "Christ University" cut to "Christ" and "Indian
  // Institute of Management Bangalore" cut to "Indian" are not names, and a
  // headline reading "Apply to Indian" is worse than one that does not name
  // the institution at all. A name too long for a 30-character headline
  // simply loses those candidates to the length filter below; the model
  // path, which knows the real abbreviations, handles that case properly.
  const institution =
    institutionFull && !productFull.toLowerCase().includes(institutionFull.toLowerCase())
      ? institutionFull
      : null;

  // Product-based, deliberately. These feed templates that are clamped to
  // the headline limit, and an institution name put through that clamp is
  // how "Indian Institute of Management Bangalore: Apply Now" became
  // "Indian Institute Of Management". The institution gets its own
  // whole-or-nothing candidates below instead.
  const subject = product;
  const subjectShort = productShort;

  const kw = (brief.keywords ?? []).map((k) => titlecase(k)).filter((k) => k.length <= 28);

  const deadline = (facts?.deadlines ?? [])[0] ?? null;
  const hasFees = (facts?.fees ?? []).length > 0;
  const hasPlacements = (facts?.placements ?? []).length > 0;
  const hasAccred = (facts?.accreditations ?? []).length > 0;
  const hasScholarship = (facts?.scholarships ?? []).length > 0;
  const hasCourses = (facts?.courses ?? []).length > 0;

  // Each candidate is emitted only when the fact behind it exists, so the
  // fallback stays as grounded as the model path.
  // A candidate carrying the institution's name is used whole or not at
  // all. The length clamp below would otherwise shorten it to fit — which
  // produced "Indian Institute Of Management" and "Apply to Indian
  // Institute", both of which name an institution that does not exist.
  const whole = (text: string) => (text.length <= H_MAX ? text : null);

  const headlineCandidates: Array<string | null> = [
    // The name first. An admissions ad that never says whose it is competes
    // on generic terms against everyone else's generic terms.
    institution ? whole(`${institution} ${productShort}`) : null,
    institution ? whole(`${institution} Admissions`) : null,
    institution ? whole(`Apply to ${institution}`) : null,
    institution ? whole(`${institution}: Apply Now`) : null,
    product,
    `${productShort} in ${place}`,
    `${productShort} Admissions`,
    `Apply for ${productShort}`,
    `${subjectShort}: Apply Now`,
    `${productShort} — Enquire Now`,
    deadline ? 'Applications Close Soon' : null,
    hasFees ? 'See the Full Fee Details' : null,
    hasScholarship ? 'Scholarships Available' : null,
    hasPlacements ? 'Strong Placement Record' : null,
    hasAccred ? 'Accredited Programme' : null,
    hasCourses ? 'Compare All Programmes' : null,
    `${place} Admissions Open`,
    `Study ${productShort} in ${place}`,
    'Get the Course Details',
    'Book Free Counselling',
    'Download the Brochure',
    'Check Your Eligibility',
    'Talk to an Advisor Today',
    // The pool has to reach fifteen on its own now: it is both the fallback
    // when the model is unavailable and the top-up when the model returns
    // short, and with no landing page every fact-gated line above drops out.
    'Compare Your Options',
    'Start Your Application',
    'Request a Call Back',
    ...kw.slice(0, 4),
  ];

  // Descriptions get 90 characters — enough for two short sentences, not for
  // a subject repeated twice.
  const audience = (brief.targetAudience ?? '').trim().toLowerCase();
  const audienceShort = audience ? clamp(audience, 28) : '';
  const atInstitution = institution ? ` at ${institution}` : '';

  const descriptionCandidates: Array<string | null> = [
    audienceShort
      ? clamp(`${product}${atInstitution}. Built for ${audienceShort}. Apply online in minutes.`, D_MAX)
      : clamp(`${product}${atInstitution}. Apply online in minutes.`, D_MAX),
    hasFees
      ? clamp(`See fees, eligibility and course details for ${product}${atInstitution}. Enquire today.`, D_MAX)
      : clamp(`See eligibility and course details for ${product}${atInstitution}. Enquire today.`, D_MAX),
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
    H_COUNT,
    excluded
  );

  const descriptions = collectAssets(
    descriptionCandidates
      .filter((t): t is string => Boolean(t))
      .map((t) => ({ text: clamp(t, D_MAX), reason: 'Built from the brief and the landing page.' })),
    D_MAX,
    D_COUNT,
    excluded
  );

  // Sitelinks point somewhere else on the site, so the fact-gated ones come
  // first — there is no use offering "Fees & Funding" when the page never
  // mentioned a fee — and the generic enquiry links backfill to six.
  const sitelinkCandidates: Array<Sitelink | null> = [
    hasFees ? { text: 'Fees & Funding', description1: 'See the full fee structure', description2: 'Payment plans and deadlines' } : null,
    hasScholarship ? { text: 'Scholarships', description1: 'Check what you qualify for', description2: 'Awards and eligibility' } : null,
    // Unconditional: every programme has entry requirements, and "can I even
    // apply" is the first question a visitor has.
    { text: 'Eligibility', description1: 'Entry requirements in full', description2: 'Check before you apply' },
    hasCourses ? { text: 'All Programmes', description1: 'Compare every course offered', description2: 'Find the right fit for you' } : null,
    hasPlacements ? { text: 'Placements', description1: 'Recruiters and outcomes', description2: 'See the placement record' } : null,
    hasAccred ? { text: 'Accreditation', description1: 'Approvals and recognition', description2: 'Know what the degree carries' } : null,
    deadline ? { text: 'Application Dates', description1: 'Key dates for this intake', description2: 'Apply before it closes' } : null,
    // The generic backfill has to be deep enough to reach six on its own: a
    // page that could not be fetched drops every gated candidate above, and
    // a set of five is one short of what the Ads team hands over.
    { text: 'Course Details', description1: 'Everything about the programme', description2: 'Structure, intake and duration' },
    { text: 'Apply Online', description1: 'Start your application now', description2: 'Takes only a few minutes' },
    { text: 'Book Counselling', description1: 'Talk to an advisor free', description2: 'No obligation to apply' },
    { text: 'Download Brochure', description1: 'Full details in one PDF', description2: 'Course, fees and campus' },
    { text: 'Contact Admissions', description1: 'Questions about applying?', description2: 'Get a call back today' },
  ];

  const sitelinks = collectSitelinks(
    sitelinkCandidates.filter((s): s is Sitelink => Boolean(s)),
    SITELINK_COUNT,
    excluded
  );

  return { headlines, descriptions, sitelinks };
}

/**
 * Everything the copy could legitimately call the advertiser by.
 *
 * Both halves, because on a request they live in different fields: the
 * course in `product` and the institution in `institution`. Either one
 * appearing in a headline counts as the ad naming itself.
 */
/**
 * The college's name, out of the campaign name it is buried in.
 *
 * "Campaign / client name" on the requirement form routinely reads
 * "Christ University — MBA Admissions 2026": the institution, then the
 * course, then the intake. Passed whole it is 38 characters, which fits no
 * headline at all, and the model was being told the college was called
 * "Christ University — MBA Admissions 2026". Everything from the first
 * dash or pipe is campaign wording, not part of the name.
 */
export function institutionName(raw: string | null | undefined): string | null {
  const head = (raw ?? '').split(/\s[\u2014\u2013-]\s|\|/)[0]?.trim();
  return head ? head : null;
}

export function subjectOf(brief: Pick<AdCopyBrief, 'product' | 'institution'>): string {
  return [brief.product, brief.institution].filter((v) => v && v.trim()).join(' ');
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
  let sitelinks: Sitelink[] = [];
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
      const excluded = brief.excludedTerms ?? [];
      headlines = collectAssets(raw.headlines, H_MAX, H_COUNT, excluded);
      descriptions = collectAssets(raw.descriptions, D_MAX, D_COUNT, excluded);
      sitelinks = collectSitelinks(raw.sitelinks, SITELINK_COUNT, excluded);

      // Google needs 3 headlines and 2 descriptions for a valid RSA. Below
      // that the model's output is unusable on its own, so fall through.
      if (headlines.length >= 3 && descriptions.length >= 2) {
        backend = 'gemini';

        // Top up to the full set. The model is asked for 15/4/6 and usually
        // obliges, but a short answer used to be shipped as-is, and the Ads
        // person then pasted eleven headlines into Google and took the Ad
        // Strength hit. The templates are a weaker headline than the
        // model's; they are a much better one than a missing slot.
        const topUp = generateDeterministic(brief, facts);
        if (headlines.length < H_COUNT) {
          headlines = mergeAssets(headlines, topUp.headlines, H_COUNT);
        }
        if (descriptions.length < D_COUNT) {
          descriptions = mergeAssets(descriptions, topUp.descriptions, D_COUNT);
        }
        if (sitelinks.length < SITELINK_COUNT) {
          sitelinks = mergeSitelinks(sitelinks, topUp.sitelinks, SITELINK_COUNT);
        }
        headlines = ensureNamed(
          headlines,
          topUp.headlines,
          subjectOf(brief),
          MIN_SUBJECT_HEADLINES
        );
        // A second pass for the institution specifically. The first counts
        // any subject token, so four headlines saying "MBA" satisfy it
        // while naming no college at all — which is exactly what one run in
        // several produced.
        const college = institutionName(brief.institution);
        if (college) {
          headlines = ensureNamed(headlines, topUp.headlines, college, MIN_INSTITUTION_HEADLINES);
        }
      } else {
        backendReason = `The model returned ${headlines.length} usable headline(s) and ${descriptions.length} description(s) — below Google's minimum.`;
        headlines = [];
        descriptions = [];
        sitelinks = [];
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
    sitelinks = fallback.sitelinks;
  }

  const validation = validateAssets({
    headlines: headlines.map((h) => h.text),
    descriptions: descriptions.map((d) => d.text),
    sitelinks,
    keywordThemes: brief.keywordVolumes?.map((k) => k.keyword) ?? brief.keywords ?? [],
    subject: subjectOf(brief),
    excludedTerms: brief.excludedTerms ?? [],
  });

  return {
    headlines,
    descriptions,
    sitelinks,
    validation,
    backend,
    backendReason,
    landingFacts: facts,
  };
}
