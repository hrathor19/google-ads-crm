/**
 * Words the copy must not contain.
 *
 * Some things are true about a course and still must not be advertised. Fees
 * are the standing example: the figure on the landing page is one intake's
 * tuition before scholarships, and an ad that quotes or even gestures at it
 * generates calls about a number that was never the price.
 *
 * So this is a hard filter rather than a line in the prompt. The model is
 * told, and then every asset it returns is checked anyway, because a
 * generator that obeys an instruction nine times out of ten is a generator
 * that ships the tenth.
 */

/** Applied unless the user changes it. */
export const DEFAULT_EXCLUDED_TERMS = ['fee'];

/** More than this and the filter is doing the writing. */
export const MAX_EXCLUDED_TERMS = 25;

/** Free text from the field into the terms it means. */
export function parseExcludedTerms(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 2)
    )
  ).slice(0, MAX_EXCLUDED_TERMS);
}

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A term matches as a whole word, plus its plural.
 *
 * "fee" has to catch "Fees" — nobody typing it means only the singular — and
 * must not catch "coffee" or "feedback", which is what a bare substring
 * search would do. A multi-word term matches as a phrase, with any run of
 * whitespace between the words.
 */
function patternFor(term: string): RegExp {
  const words = term.split(/\s+/).filter(Boolean);
  if (words.length === 0) return /(?!)/;
  const body = words.map(escape).join('\\s+');

  // Word boundaries only where the term's own edge is a word character. A
  // trailing \b after "50%" can never match, because the characters either
  // side of it are both non-word — so the term would silently never fire.
  const prefix = /^\w/.test(words[0]!) ? '\\b' : '';
  const endsInWord = /\w$/.test(words[words.length - 1]!);
  // The plural only makes sense on a term that ends in a letter.
  const suffix = endsInWord ? '(?:e?s)?\\b' : '';

  return new RegExp(`${prefix}${body}${suffix}`, 'i');
}

const cache = new Map<string, RegExp>();
function cached(term: string): RegExp {
  let re = cache.get(term);
  if (!re) {
    re = patternFor(term);
    cache.set(term, re);
  }
  return re;
}

/** The first excluded term present, or null. */
export function excludedTermIn(text: string, terms: string[]): string | null {
  if (!text || terms.length === 0) return null;
  for (const term of terms) {
    if (cached(term).test(text)) return term;
  }
  return null;
}

export function isClean(text: string, terms: string[]): boolean {
  return excludedTermIn(text, terms) === null;
}

/**
 * Drop the strings that carry an excluded term.
 *
 * Used on the landing-page facts before they reach the prompt as well as on
 * the assets afterwards: leaving "Fees: INR 12,00,000" in the brief and then
 * asking the model not to mention fees is an invitation it regularly
 * accepts.
 */
export function filterClean(values: string[] | null | undefined, terms: string[]): string[] {
  return (values ?? []).filter((v) => isClean(v, terms));
}
