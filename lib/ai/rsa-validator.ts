import { excludedTermIn } from './exclusions';

/**
 * RSA validation + Ad Strength prediction.
 *
 * A direct port of `app/services/ai/rsa_validator.py`. Pure functions over the
 * asset lists — no external calls — so generated copy can be checked instantly
 * as the user edits it, client-side or server-side.
 */

export const H_MAX = 30;
export const D_MAX = 90;
export const PATH_MAX = 15;
export const CALLOUT_MAX = 25;

/** Sitelink limits, which differ from the RSA ones and from each other. */
export const SITELINK_TEXT_MAX = 25;
export const SITELINK_DESC_MAX = 35;

/** How many of each a complete, maximum-strength ad carries. */
export const H_COUNT = 15;
export const D_COUNT = 4;
export const SITELINK_COUNT = 6;

export type Sitelink = {
  /** The blue link text. */
  text: string;
  description1: string;
  description2: string;
};

export type FlagLevel = 'error' | 'warning' | 'info';
export type Flag = { level: FlagLevel; field: string; message: string };

export type AdStrength = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR';

export type ValidationResult = {
  expectedAdStrength: AdStrength;
  /** Assets carrying a term the brief forbids. Zero unless someone edits one back in. */
  excludedTermHits: number;
  headlineCount: number;
  descriptionCount: number;
  sitelinkCount: number;
  /** Headlines naming the college, university or course. */
  subjectInHeadlines: number;
  /** Descriptions naming it. */
  subjectInDescriptions: number;
  uniqueHeadlineRatio: number;
  keywordCoverage: number;
  predictedCtrBand: string;
  qualityScoreContribution: string;
  flags: Flag[];
};

/** How many headlines should carry the name before it stops being a note. */
export const MIN_SUBJECT_HEADLINES = 4;

/**
 * The words of a name worth matching on.
 *
 * Course words are kept — "MBA" in "Christ University MBA" is one of the
 * names the searcher typed — but the filler around them is not, or a
 * headline containing "the" would count as naming the college.
 */
const NAME_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'our', 'your', 'all', 'new',
  'course', 'courses', 'programme', 'program', 'programmes', 'programs',
  'admission', 'admissions', 'degree', 'study', 'studies', 'full', 'time',
  'part', 'year', 'years', 'online', 'distance', 'generic', 'campaign',
]);

export function significantTokens(name: string): string[] {
  return Array.from(
    new Set(
      (name.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !NAME_STOPWORDS.has(w))
    )
  );
}

const flag = (level: FlagLevel, field: string, message: string): Flag => ({
  level,
  field,
  message,
});

export function validateAssets(params: {
  headlines: string[];
  descriptions: string[];
  displayPaths?: string[];
  callouts?: string[];
  sitelinks?: Sitelink[];
  keywordThemes?: string[];
  /** The college, university or course being advertised. */
  subject?: string | null;
  /** Words the copy must not contain. */
  excludedTerms?: string[];
}): ValidationResult {
  const { headlines, descriptions } = params;
  const displayPaths = params.displayPaths ?? [];
  const callouts = params.callouts ?? [];
  const sitelinks = params.sitelinks ?? [];
  const keywordThemes = params.keywordThemes ?? [];
  const flags: Flag[] = [];

  // --- hard character limits ---
  for (const h of headlines) {
    if (h.length > H_MAX) {
      flags.push(flag('error', 'headline', `'${h}' exceeds ${H_MAX} chars (${h.length}).`));
    }
  }
  for (const d of descriptions) {
    if (d.length > D_MAX) {
      flags.push(flag('error', 'description', `'${d}' exceeds ${D_MAX} chars (${d.length}).`));
    }
  }
  for (const p of displayPaths) {
    if (p.length > PATH_MAX) {
      flags.push(flag('error', 'path', `Path '${p}' exceeds ${PATH_MAX} chars.`));
    }
  }
  for (const c of callouts) {
    if (c.length > CALLOUT_MAX) {
      flags.push(flag('warning', 'callout', `Callout '${c}' exceeds ${CALLOUT_MAX} chars.`));
    }
  }

  // --- sitelinks ---
  // Three separate caps, and the two descriptions are all-or-nothing: Google
  // rejects a sitelink carrying only the first line, so a half-filled one is
  // an error rather than a cosmetic gap.
  sitelinks.forEach((sl, i) => {
    const n = i + 1;
    if (sl.text.length > SITELINK_TEXT_MAX) {
      flags.push(
        flag(
          'error',
          'sitelink',
          `Sitelink ${n} text '${sl.text}' exceeds ${SITELINK_TEXT_MAX} chars (${sl.text.length}).`
        )
      );
    }
    if (!sl.text.trim()) {
      flags.push(flag('error', 'sitelink', `Sitelink ${n} has no link text.`));
    }
    for (const [label, value] of [
      ['Description 1', sl.description1],
      ['Description 2', sl.description2],
    ] as const) {
      if (value.length > SITELINK_DESC_MAX) {
        flags.push(
          flag(
            'error',
            'sitelink',
            `Sitelink ${n} ${label.toLowerCase()} exceeds ${SITELINK_DESC_MAX} chars (${value.length}).`
          )
        );
      }
    }
    const filled = [sl.description1, sl.description2].filter((d) => d.trim()).length;
    if (filled === 1) {
      flags.push(
        flag('error', 'sitelink', `Sitelink ${n} needs both description lines, or neither.`)
      );
    }
  });

  const sitelinkTexts = sitelinks.map((s) => s.text.trim().toLowerCase()).filter(Boolean);
  if (new Set(sitelinkTexts).size !== sitelinkTexts.length) {
    flags.push(flag('warning', 'sitelink', 'Two sitelinks share the same link text.'));
  }
  if (sitelinks.length > 0 && sitelinks.length < 4) {
    // Google serves sitelinks in pairs and will not show them at all below
    // four, so a set of two is work that never reaches an impression.
    flags.push(
      flag('warning', 'sitelink', `Only ${sitelinks.length} sitelink(s); Google needs at least 4 to show any.`)
    );
  }

  // --- minimum counts (Google requires 3 headlines + 2 descriptions) ---
  if (headlines.length < 3) flags.push(flag('error', 'headline', 'Fewer than 3 headlines.'));
  if (descriptions.length < 2) {
    flags.push(flag('error', 'description', 'Fewer than 2 descriptions.'));
  }
  if (headlines.length < 11) {
    flags.push(
      flag('info', 'headline', 'Add more headlines (15 recommended for best Ad Strength).')
    );
  }
  if (descriptions.length < 4) {
    flags.push(flag('info', 'description', 'Add up to 4 descriptions for best Ad Strength.'));
  }

  // --- duplicates / diversity ---
  const lowerH = headlines.map((h) => h.toLowerCase());
  const counts = new Map<string, number>();
  for (const h of lowerH) counts.set(h, (counts.get(h) ?? 0) + 1);
  for (const [h, n] of Array.from(counts.entries())) {
    if (n > 1) flags.push(flag('warning', 'headline', `Duplicate headline: '${h}'.`));
  }
  const uniqueRatio = lowerH.length ? new Set(lowerH).size / lowerH.length : 0;

  // --- ALL CAPS / punctuation / stuffing ---
  for (const h of headlines) {
    const letters = h.replace(/[^a-zA-Z]/g, '');
    if (letters && letters === letters.toUpperCase() && letters.length > 3) {
      flags.push(flag('warning', 'headline', `Excessive capitalisation: '${h}'.`));
    }
    if (h.includes('!!') || h.includes('  ')) {
      flags.push(flag('warning', 'headline', `Punctuation/spacing issue: '${h}'.`));
    }
    const words = (h.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2);
    if (words.length) {
      const wordCounts = new Map<string, number>();
      for (const w of words) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
      if (Math.max(...Array.from(wordCounts.values())) >= 3) {
        flags.push(flag('warning', 'headline', `Possible keyword stuffing: '${h}'.`));
      }
    }
  }

  // --- forbidden words ---
  // The generator already drops these, so a hit here means someone typed one
  // back in while editing. An error rather than a warning: the whole point
  // of the field is that these words never reach a live ad.
  const excludedTerms = params.excludedTerms ?? [];
  let excludedTermHits = 0;
  const banCheck = (field: string, values: string[]) => {
    for (const value of values) {
      const hit = excludedTermIn(value, excludedTerms);
      if (!hit) continue;
      excludedTermHits += 1;
      flags.push(
        flag('error', field, `'${value}' mentions "${hit}", which this brief excludes.`)
      );
    }
  };
  banCheck('headline', headlines);
  banCheck('description', descriptions);
  banCheck(
    'sitelink',
    sitelinks.flatMap((sl) => [sl.text, sl.description1, sl.description2].filter(Boolean))
  );

  // --- does the ad say what it is advertising? ---
  // An admissions ad that never names the college or the course competes on
  // generic terms against everyone else's generic terms. Google rewards the
  // name being present, and a searcher who typed it expects to see it back.
  const subjectTokens = significantTokens(params.subject ?? '');
  const mentions = (text: string) => {
    const t = text.toLowerCase();
    return subjectTokens.some((tok) => t.includes(tok));
  };
  const subjectInHeadlines = subjectTokens.length ? headlines.filter(mentions).length : 0;
  const subjectInDescriptions = subjectTokens.length ? descriptions.filter(mentions).length : 0;

  if (subjectTokens.length > 0) {
    if (subjectInHeadlines === 0) {
      flags.push(
        flag('error', 'headline', 'No headline names the college, university or course.')
      );
    } else if (subjectInHeadlines < MIN_SUBJECT_HEADLINES) {
      flags.push(
        flag(
          'warning',
          'headline',
          `Only ${subjectInHeadlines} headline(s) name the college, university or course; aim for ${MIN_SUBJECT_HEADLINES}.`
        )
      );
    }
    if (subjectInDescriptions === 0) {
      flags.push(
        flag('warning', 'description', 'No description names the college, university or course.')
      );
    }
  }

  // --- keyword coverage: do headlines reflect winning themes? ---
  const themeTokens = new Set<string>();
  for (const kw of keywordThemes) {
    for (const t of kw.toLowerCase().match(/[a-z]{3,}/g) ?? []) themeTokens.add(t);
  }
  const hay = lowerH.join(' ');
  let covered = 0;
  themeTokens.forEach((t) => {
    if (hay.includes(t)) covered += 1;
  });
  const coverage = themeTokens.size ? covered / themeTokens.size : 0;

  return predictStrength({
    headlines,
    descriptions,
    sitelinkCount: sitelinks.length,
    excludedTermHits,
    subjectInHeadlines,
    subjectInDescriptions,
    uniqueRatio,
    coverage,
    errorCount: flags.filter((f) => f.level === 'error').length,
    flags,
  });
}

/** A simple additive model over the signals Google's Ad Strength rewards. */
function predictStrength(params: {
  headlines: string[];
  descriptions: string[];
  sitelinkCount: number;
  excludedTermHits: number;
  subjectInHeadlines: number;
  subjectInDescriptions: number;
  uniqueRatio: number;
  coverage: number;
  errorCount: number;
  flags: Flag[];
}): ValidationResult {
  const {
    headlines,
    descriptions,
    sitelinkCount,
    excludedTermHits,
    subjectInHeadlines,
    subjectInDescriptions,
    uniqueRatio,
    coverage,
    errorCount,
    flags,
  } = params;

  let points = 0;
  points += Math.min(4, Math.floor(headlines.length / 4)); // up to 4 for headline volume
  points += Math.min(2, descriptions.length); // up to 2 for descriptions
  points += uniqueRatio >= 0.9 ? 2 : uniqueRatio >= 0.7 ? 1 : 0;
  points += coverage >= 0.5 ? 2 : coverage >= 0.25 ? 1 : 0;
  // Google's own Ad Strength rewards the advertiser being named, so the
  // prediction has to react to it, or this screen would call an ad that
  // never says which college it is for "excellent".
  points += subjectInHeadlines >= MIN_SUBJECT_HEADLINES ? 2 : subjectInHeadlines > 0 ? 1 : 0;
  if (errorCount) points = Math.max(0, points - 3);

  const strength: AdStrength = errorCount
    ? 'POOR'
    : points >= 10
      ? 'EXCELLENT'
      : points >= 7
        ? 'GOOD'
        : points >= 4
          ? 'AVERAGE'
          : 'POOR';

  const ctrBand: Record<AdStrength, string> = {
    EXCELLENT: 'above average',
    GOOD: 'average to above average',
    AVERAGE: 'around average',
    POOR: 'below average',
  };
  const qsContrib: Record<AdStrength, string> = {
    EXCELLENT: 'strong positive (ad relevance + expected CTR)',
    GOOD: 'positive',
    AVERAGE: 'neutral',
    POOR: 'at risk — fix errors before launch',
  };

  const round3 = (v: number) => Math.round(v * 1000) / 1000;

  return {
    expectedAdStrength: strength,
    headlineCount: headlines.length,
    descriptionCount: descriptions.length,
    sitelinkCount,
    excludedTermHits,
    subjectInHeadlines,
    subjectInDescriptions,
    uniqueHeadlineRatio: round3(uniqueRatio),
    keywordCoverage: round3(coverage),
    predictedCtrBand: ctrBand[strength],
    qualityScoreContribution: qsContrib[strength],
    flags,
  };
}

/** Trim to a single line and accept only if it fits the limit. Mirrors `_fit`. */
export function fit(text: string, limit: number): string | null {
  const t = (text || '').replace(/\s+/g, ' ').replace(/^[\s\-|]+|[\s\-|]+$/g, '');
  return t.length >= 1 && t.length <= limit ? t : null;
}
