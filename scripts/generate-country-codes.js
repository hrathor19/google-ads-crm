const fs = require('fs');
const path = require('path');
const t = require('world-atlas/countries-110m.json');

const map = new Map();
for (const g of t.objects.countries.geometries) {
  const n = Number(g.id);
  if (Number.isFinite(n) && n > 0 && g.properties && g.properties.name) map.set(n, g.properties.name);
}

// Small states and territories the 110m atlas omits but Google Ads can target.
const extra = {
  8:'Albania',20:'Andorra',28:'Antigua and Barbuda',48:'Bahrain',52:'Barbados',60:'Bermuda',
  84:'Belize',92:'British Virgin Islands',96:'Brunei',132:'Cabo Verde',136:'Cayman Islands',
  174:'Comoros',184:'Cook Islands',196:'Cyprus',212:'Dominica',233:'Estonia',292:'Gibraltar',
  296:'Kiribati',308:'Grenada',312:'Guadeloupe',316:'Guam',336:'Vatican City',414:'Kuwait',
  428:'Latvia',438:'Liechtenstein',440:'Lithuania',442:'Luxembourg',446:'Macao',462:'Maldives',
  470:'Malta',474:'Martinique',480:'Mauritius',492:'Monaco',499:'Montenegro',500:'Montserrat',
  520:'Nauru',531:'Curacao',534:'Sint Maarten',535:'Bonaire',570:'Niue',574:'Norfolk Island',
  580:'Northern Mariana Islands',583:'Micronesia',584:'Marshall Islands',585:'Palau',
  612:'Pitcairn Islands',634:'Qatar',638:'Reunion',654:'Saint Helena',659:'Saint Kitts and Nevis',
  660:'Anguilla',662:'Saint Lucia',663:'Saint Martin',666:'Saint Pierre and Miquelon',
  670:'Saint Vincent and the Grenadines',674:'San Marino',678:'Sao Tome and Principe',
  688:'Serbia',690:'Seychelles',702:'Singapore',744:'Svalbard and Jan Mayen',772:'Tokelau',
  776:'Tonga',780:'Trinidad and Tobago',796:'Turks and Caicos Islands',798:'Tuvalu',
  807:'North Macedonia',850:'U.S. Virgin Islands',876:'Wallis and Futuna',
};
for (const [k, v] of Object.entries(extra)) if (!map.has(Number(k))) map.set(Number(k), v);

const entries = [...map.entries()].sort((a, b) => a[0] - b[0]);
const body = entries.map(([id, name]) => '  ' + id + ': ' + JSON.stringify(name) + ',').join('\n');

const header = [
  '/**',
  ' * ISO 3166-1 numeric -> English country name.',
  ' *',
  ' * GENERATED from world-atlas/countries-110m.json — the same topojson the map',
  ' * renders — plus the small states and territories that atlas omits at 110m',
  ' * resolution but Google Ads can still target. Regenerate with',
  ' * scripts/generate-country-codes.js.',
  ' *',
  ' * Why keyed on the numeric code: a Google Ads country criterion id is',
  ' * `2000 + ISO 3166-1 numeric` (India\'s 356 becomes criterion 2356), and the',
  ' * topojson keys its features on that same numeric code. One subtraction joins',
  ' * a reporting row to a map polygon, with no country-NAME matching anywhere —',
  ' * which is the part that usually goes wrong ("Ivory Coast" vs "Cote d\'Ivoire").',
  ' *',
  ' * This is the FALLBACK. The authoritative name comes from Google\'s',
  ' * geo_target_constant resource and is cached into',
  ' * campaign_geo_snapshots.location_name by the sync; this table names rows',
  ' * synced before that existed, so nothing renders as a bare id.',
  ' */',
].join('\n');

const footer = [
  '',
  '/** A Google Ads country criterion id is 2000 + the ISO 3166-1 numeric code. */',
  'export const COUNTRY_CRITERION_OFFSET = 2000;',
  '',
  'export function isoNumericFromCriterion(criterionId: number): number {',
  '  return criterionId - COUNTRY_CRITERION_OFFSET;',
  '}',
  '',
  '/** Country name for a Google Ads country criterion id, or null if unknown. */',
  'export function countryNameFromCriterion(criterionId: number | null): string | null {',
  '  if (criterionId === null) return null;',
  '  return COUNTRY_BY_ISO_NUMERIC[isoNumericFromCriterion(criterionId)] ?? null;',
  '}',
  '',
].join('\n');

const out = header + '\nexport const COUNTRY_BY_ISO_NUMERIC: Record<number, string> = {\n' + body + '\n};\n' + footer;
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'ops', 'country-codes.ts'), out);
console.log('generated', entries.length, 'countries; 356 =>', map.get(356));
