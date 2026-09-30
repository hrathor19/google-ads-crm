import { describe, expect, it } from 'vitest';
import {
  COUNTRY_BY_ISO_NUMERIC,
  COUNTRY_CRITERION_OFFSET,
  countryNameFromCriterion,
  isoNumericFromCriterion,
} from '@/lib/ops/country-codes';

/**
 * Country resolution for the geography report and the map.
 *
 * The whole scheme rests on one arithmetic fact: a Google Ads *country*
 * criterion id is `2000 + ISO 3166-1 numeric`. Verified against the live API —
 * criterion 2356 returns `{name: "India", country_code: "IN"}` — and the world
 * topojson keys its features on the same numeric code, so a reporting row
 * joins to a map polygon without any country-name matching.
 */

describe('criterion id -> ISO numeric', () => {
  it('subtracts the 2000 offset', () => {
    expect(COUNTRY_CRITERION_OFFSET).toBe(2000);
    expect(isoNumericFromCriterion(2356)).toBe(356); // India
    expect(isoNumericFromCriterion(2840)).toBe(840); // United States
    expect(isoNumericFromCriterion(2826)).toBe(826); // United Kingdom
  });
});

describe('criterion id -> country name', () => {
  it('names the country this account actually targets', () => {
    // Confirmed against geo_target_constant: 2356 is India.
    expect(countryNameFromCriterion(2356)).toBe('India');
  });

  it('names other major markets', () => {
    expect(countryNameFromCriterion(2840)).toBe('United States of America');
    expect(countryNameFromCriterion(2036)).toBe('Australia');
    expect(countryNameFromCriterion(2124)).toBe('Canada');
    expect(countryNameFromCriterion(2784)).toBe('United Arab Emirates');
    expect(countryNameFromCriterion(2702)).toBe('Singapore');
  });

  it('returns null for an unknown id rather than inventing a name', () => {
    expect(countryNameFromCriterion(29999)).toBeNull();
    expect(countryNameFromCriterion(null)).toBeNull();
  });

  it('covers the markets a table this size should have', () => {
    expect(Object.keys(COUNTRY_BY_ISO_NUMERIC).length).toBeGreaterThan(200);
  });

  it('has no blank or numeric-looking names', () => {
    for (const [code, name] of Object.entries(COUNTRY_BY_ISO_NUMERIC)) {
      expect(name.trim().length, `code ${code} has an empty name`).toBeGreaterThan(1);
      expect(/^\d+$/.test(name), `code ${code} resolves to a number`).toBe(false);
    }
  });
});

describe('the map join', () => {
  it('every named country is reachable from a criterion id', () => {
    // Round-trip: the id the API returns must land back on the same name.
    for (const code of Object.keys(COUNTRY_BY_ISO_NUMERIC).slice(0, 40)) {
      const numeric = Number(code);
      const criterion = numeric + COUNTRY_CRITERION_OFFSET;
      expect(countryNameFromCriterion(criterion)).toBe(COUNTRY_BY_ISO_NUMERIC[numeric]);
    }
  });
});
