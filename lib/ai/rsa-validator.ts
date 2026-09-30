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

export type FlagLevel = 'error' | 'warning' | 'info';
export type Flag = { level: FlagLevel; field: string; message: string };

export type AdStrength = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR';

export type ValidationResult = {
  expectedAdStrength: AdStrength;
  headlineCount: number;
  descriptionCount: number;
  uniqueHeadlineRatio: number;
  keywordCoverage: number;
  predictedCtrBand: string;
  qualityScoreContribution: string;
  flags: Flag[];
};

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
  keywordThemes?: string[];
}): ValidationResult {
  const { headlines, descriptions } = params;
  const displayPaths = params.displayPaths ?? [];
  const callouts = params.callouts ?? [];
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
  uniqueRatio: number;
  coverage: number;
  errorCount: number;
  flags: Flag[];
}): ValidationResult {
  const { headlines, descriptions, uniqueRatio, coverage, errorCount, flags } = params;

  let points = 0;
  points += Math.min(4, Math.floor(headlines.length / 4)); // up to 4 for headline volume
  points += Math.min(2, descriptions.length); // up to 2 for descriptions
  points += uniqueRatio >= 0.9 ? 2 : uniqueRatio >= 0.7 ? 1 : 0;
  points += coverage >= 0.5 ? 2 : coverage >= 0.25 ? 1 : 0;
  if (errorCount) points = Math.max(0, points - 3);

  const strength: AdStrength = errorCount
    ? 'POOR'
    : points >= 8
      ? 'EXCELLENT'
      : points >= 6
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
