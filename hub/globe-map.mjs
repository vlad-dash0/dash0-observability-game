// Hand-written globe map (docs/FOUNDATION.md §2.7): which world region an act is, and which
// country a level is. Pure data plus one lookup; hub/globe-data.mjs holds the generated dots.
//
// TO ADD A LEVEL: add its id to LEVEL_COUNTRY with a country from its act's region that is not
// used yet and has at least MIN_DOTS dots (test/globe-data.test.mjs checks all of that).

// Every country in LEVEL_COUNTRY has at least this many land dots, so it is visible lit.
export const MIN_DOTS = 6;

// act id -> region name and the Natural Earth SUBREGION values it covers. Owner defaults
// (2026-11-04): Southern Europe counts as Western Europe, Central America and the Caribbean
// as North America, Eastern Europe rides with Northern Europe (Russia excepted, below).
export const ACT_REGIONS = Object.freeze({
  'act-0': { region: 'Western Europe', subregions: ['Western Europe', 'Southern Europe'] },
  'act-1': { region: 'Northern Europe', subregions: ['Northern Europe', 'Eastern Europe'] },
  'act-2': { region: 'North America', subregions: ['Northern America', 'Central America', 'Caribbean'] },
  'act-3': { region: 'South America', subregions: ['South America'] },
  'act-4': {
    region: 'Africa',
    subregions: ['Northern Africa', 'Western Africa', 'Middle Africa', 'Eastern Africa', 'Southern Africa'],
  },
  'act-5': { region: 'Middle East and Central Asia', subregions: ['Western Asia', 'Central Asia'] },
  'act-6': { region: 'South Asia', subregions: ['Southern Asia'] },
  'act-7': { region: 'East Asia', subregions: ['Eastern Asia'] },
  'act-8': { region: 'Southeast Asia', subregions: ['South-Eastern Asia'] },
  'act-9': { region: 'Oceania', subregions: ['Australia and New Zealand', 'Melanesia'] },
});

// Countries whose region is not their SUBREGION's: Natural Earth files Russia under Eastern
// Europe, the globe puts it with the Middle East and Central Asia.
export const COUNTRY_ACT = Object.freeze({ RUS: 'act-5' });

// level id -> ADM0_A3 country code (the code hub/globe-data.mjs uses). Bosses carry none:
// a boss pulses its act's whole region.
export const LEVEL_COUNTRY = Object.freeze({
  // act-0 Western Europe
  'monitoring-vs-observability': 'FRA',
  'the-signals': 'DEU',
  'why-opentelemetry': 'ESP',
  // act-1 Northern Europe
  resources: 'NOR',
  'naming-your-service': 'SWE',
  'detectors-and-kubernetes': 'FIN',
  // act-2 North America
  'spans-and-traces': 'USA',
  'span-kinds': 'CAN',
  'status-and-errors': 'MEX',
  'context-propagation': 'GRL',
  baggage: 'CUB',
  'events-and-links': 'GTM',
  'auto-vs-manual': 'HND',
  // act-3 South America
  instruments: 'BRA',
  temporality: 'ARG',
  histograms: 'PER',
  'promql-basics': 'COL',
  cardinality: 'BOL',
  exemplars: 'VEN',
  'red-and-use': 'CHL',
  // act-4 Africa
  'structured-logs': 'DZA',
  correlation: 'COD',
  'collecting-logs': 'ZAF',
  // act-5 Middle East and Central Asia
  pipelines: 'KAZ',
  'order-matters': 'SAU',
  'otlp-endpoints': 'TUR',
  'agent-vs-gateway': 'UZB',
  'ottl-and-transforms': 'TKM',
  distributions: 'IRQ',
  // act-6 South Asia
  'head-sampling': 'IND',
  'tail-sampling': 'IRN',
  'what-costs-money': 'PAK',
  // act-7 East Asia
  'good-alerts': 'JPN',
  // act-9 Oceania
  'the-34-percent-error-rate': 'AUS',
});

// ADM0_A3 code -> display name, for every country in LEVEL_COUNTRY (the ignite announcement,
// "Germany is now lit: ..."; test/globe-ignite.test.mjs checks each one has a name).
export const COUNTRY_NAMES = Object.freeze({
  FRA: 'France', DEU: 'Germany', ESP: 'Spain',
  NOR: 'Norway', SWE: 'Sweden', FIN: 'Finland',
  USA: 'the United States', CAN: 'Canada', MEX: 'Mexico', GRL: 'Greenland', CUB: 'Cuba', GTM: 'Guatemala', HND: 'Honduras',
  BRA: 'Brazil', ARG: 'Argentina', PER: 'Peru', COL: 'Colombia', BOL: 'Bolivia', VEN: 'Venezuela', CHL: 'Chile',
  DZA: 'Algeria', COD: 'the Democratic Republic of the Congo', ZAF: 'South Africa',
  KAZ: 'Kazakhstan', SAU: 'Saudi Arabia', TUR: 'Turkey', UZB: 'Uzbekistan', TKM: 'Turkmenistan', IRQ: 'Iraq',
  IND: 'India', IRN: 'Iran', PAK: 'Pakistan',
  JPN: 'Japan',
  AUS: 'Australia',
});

/** The act id whose region a country (ADM0_A3 code, Natural Earth SUBREGION) is in, else null. */
export function actOfCountry(iso3, subregion) {
  if (Object.hasOwn(COUNTRY_ACT, iso3)) return COUNTRY_ACT[iso3];
  for (const [actId, { subregions }] of Object.entries(ACT_REGIONS)) {
    if (subregions.includes(subregion)) return actId;
  }
  return null;
}
