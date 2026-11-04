// The globe's data: the generated dots, the hand-written level to country table checked against
// the LIVE registry, and the generator's own rules. Spec: issue #149.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DOTS, COUNTRIES, LATTICE_POINTS } from '../hub/globe-data.mjs';
import { ACT_REGIONS, LEVEL_COUNTRY, MIN_DOTS, COUNTRY_ACT, actOfCountry } from '../hub/globe-map.mjs';
import { liveRegistry } from '../app.mjs';
import { globeState } from '../lib/globe.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { latticePoint } from '../lib/globe-lattice.mjs';
import {
  OVERSEAS_DEG, SOURCE_SHA256, SOURCE_URL, SOURCE_VERSION, renderModule, sampleDots, verifyHash,
} from '../tools/build-globe-data.mjs';

const REG = liveRegistry();
const levelIds = REG.order.filter((id) => REG.levels[id].kind === 'level');
const dotsOf = (iso) => DOTS.filter((d) => d[2] === iso);
const subregionOf = Object.fromEntries(COUNTRIES);

test('every registry level has exactly one country, and no key is stale', () => {
  const missing = levelIds.filter((id) => !Object.hasOwn(LEVEL_COUNTRY, id));
  assert.deepEqual(
    missing,
    [],
    `level(s) without a country: add them to LEVEL_COUNTRY in hub/globe-map.mjs (a country in the act's region, not used yet): ${missing.join(', ')}`,
  );
  const stale = Object.keys(LEVEL_COUNTRY).filter((id) => !levelIds.includes(id));
  assert.deepEqual(stale, [], `LEVEL_COUNTRY keys that are not levels (bosses carry no country): ${stale.join(', ')}`);
});

test('every act has a region', () => {
  const missing = REG.acts.map((a) => a.id).filter((id) => !Object.hasOwn(ACT_REGIONS, id));
  assert.deepEqual(missing, [], `act(s) without a region in ACT_REGIONS: ${missing.join(', ')}`);
});

test('countries are distinct across the whole game and exist in the data', () => {
  const codes = Object.values(LEVEL_COUNTRY);
  assert.equal(new Set(codes).size, codes.length, 'a country is used by two levels');
  for (const c of codes) assert.ok(Object.hasOwn(subregionOf, c), `${c} is not a country in hub/globe-data.mjs`);
});

test("each level's country is in its act's region", () => {
  for (const id of levelIds) {
    const iso = LEVEL_COUNTRY[id];
    const actId = REG.levels[id].actId;
    assert.equal(actOfCountry(iso, subregionOf[iso]), actId, `${id} -> ${iso} (${subregionOf[iso]}) is outside ${actId}`);
  }
});

test(`every mapped country has at least ${MIN_DOTS} dots (K)`, () => {
  assert.equal(MIN_DOTS, 6);
  for (const iso of Object.values(LEVEL_COUNTRY)) {
    assert.ok(dotsOf(iso).length >= MIN_DOTS, `${iso} has ${dotsOf(iso).length} dots, needs ${MIN_DOTS}`);
  }
});

test('region lookup: Russia goes to act-5, Antarctica to nothing, unknown subregion to nothing', () => {
  assert.equal(COUNTRY_ACT.RUS, 'act-5');
  assert.equal(actOfCountry('RUS', 'Eastern Europe'), 'act-5');
  assert.equal(actOfCountry('UKR', 'Eastern Europe'), 'act-1');
  assert.equal(actOfCountry('ITA', 'Southern Europe'), 'act-0');
  assert.equal(actOfCountry('CUB', 'Caribbean'), 'act-2');
  assert.equal(actOfCountry('ATA', 'Antarctica'), null);
  assert.equal(actOfCountry('XXX', 'constructor'), null);
});

test('globeState lights the live registry country by country and counts every level', () => {
  const p = emptyProgress();
  p.levels['monitoring-vs-observability'] = { stars: 1, at: null };
  const s = globeState(REG, p);
  assert.equal(s.countries.FRA.lit, true);
  assert.equal(s.countries.DEU.lit, false);
  assert.equal(Object.keys(s.countries).length, levelIds.length);
  assert.equal(Object.keys(s.regions).length, REG.acts.length);
  assert.equal(s.regions['act-0'].region, 'Western Europe');
  assert.deepEqual([s.regions['act-0'].done, s.regions['act-0'].total], [1, 4]);
});

test('dots: lattice order, valid coordinates, known countries, no Antarctica', () => {
  assert.ok(DOTS.length > 6000 && DOTS.length < 8000, `${DOTS.length} dots`);
  for (const [lat, lon, iso, sub] of DOTS) {
    assert.ok(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180);
    assert.equal(sub, subregionOf[iso]);
  }
  assert.equal(dotsOf('ATA').length, 0);
  const keys = DOTS.map((d) => `${d[0]},${d[1]}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate positions');
});

test('dots sit where the countries are', () => {
  const inBox = (iso, [la0, la1, lo0, lo1]) =>
    dotsOf(iso).every(([lat, lon]) => lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1);
  assert.ok(inBox('JPN', [30, 46, 128, 146]));
  assert.ok(inBox('BRA', [-34, 6, -75, -34]));
  assert.ok(inBox('AUS', [-44, -10, 112, 154]));
  assert.ok(inBox('IND', [6, 36, 67, 98]));
});

test('lattice points are the documented Fibonacci sphere, 2 decimals', () => {
  assert.deepEqual(latticePoint(0, 26000), [89.5, 0]);
  const [lat, lon] = latticePoint(13000, 26000);
  assert.ok(Math.abs(lat) < 0.01);
  assert.equal(lon, Math.round(lon * 100) / 100);
  assert.equal(LATTICE_POINTS, 26000);
  const onLattice = new Set(Array.from({ length: LATTICE_POINTS }, (_, i) => latticePoint(i, LATTICE_POINTS).join(',')));
  assert.ok(DOTS.every((d) => onLattice.has(`${d[0]},${d[1]}`)), 'every dot is a lattice point');
});

test('generator: refuses a file with the wrong hash, accepts the pinned hash', () => {
  assert.throws(() => verifyHash(Buffer.from('tampered')), /refusing: source SHA-256/);
  const bytes = Buffer.from('x');
  assert.doesNotThrow(() => verifyHash(bytes, createHash('sha256').update(bytes).digest('hex')));
});

const SQUARE = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const FIXTURE = {
  features: [
    { properties: { ADM0_A3: 'BBB', SUBREGION: 'S2' }, geometry: { type: 'Polygon', coordinates: [SQUARE(0, 0, 60, 60), SQUARE(20, 20, 40, 40)] } },
    { properties: { ADM0_A3: 'AAA', SUBREGION: 'S1' }, geometry: { type: 'MultiPolygon', coordinates: [[SQUARE(-60, -60, -20, -20)]] } },
    { properties: { ADM0_A3: 'ATA', SUBREGION: 'Antarctica' }, geometry: { type: 'Polygon', coordinates: [SQUARE(-180, -90, 180, -70)] } },
  ],
};

test('generator: keeps only land, respects holes, skips Antarctica, sorts countries', () => {
  const { countries, dots } = sampleDots(FIXTURE, 2000);
  assert.deepEqual(countries, [['AAA', 'S1'], ['BBB', 'S2']]);
  assert.ok(dots.length > 10);
  for (const [i, c] of dots) {
    const [lat, lon] = latticePoint(i, 2000);
    if (c === 1) {
      assert.ok(lat >= 0 && lat <= 60 && lon >= 0 && lon <= 60);
      assert.ok(!(lat > 20 && lat < 40 && lon > 20 && lon < 40), 'inside the hole');
    } else {
      assert.ok(lat >= -60 && lat <= -20 && lon >= -60 && lon <= -20);
    }
  }
  assert.deepEqual(dots.map((d) => d[0]), dots.map((d) => d[0]).sort((a, b) => a - b));
});

test('generator: same input gives byte-identical output', () => {
  assert.equal(renderModule(sampleDots(FIXTURE, 2000), 2000), renderModule(sampleDots(FIXTURE, 2000), 2000));
});

test('the committed module names the pinned source and hash', () => {
  const head = readFileSync(new URL('../hub/globe-data.mjs', import.meta.url), 'utf8').split('\n', 8).join('\n');
  assert.ok(head.includes(SOURCE_URL) && head.includes(SOURCE_SHA256) && head.includes(SOURCE_VERSION));
  assert.match(SOURCE_URL, new RegExp(`natural-earth-vector/${SOURCE_VERSION}/`), 'a tagged release, not a branch');
  assert.match(SOURCE_SHA256, /^[0-9a-f]{64}$/);
});

// [minLat, maxLat, minLon, maxLon]: each mapped country's home area, a little wider than the
// country. Overseas parts that stay on purpose (Alaska, Hawaii, Svalbard) are inside their box.
const HOME = {
  FRA: [41, 51.5, -5.5, 9.8], DEU: [47, 55.2, 5.8, 15.2], ESP: [35.5, 44, -9.5, 4.5],
  NOR: [57.5, 81, 4, 32], SWE: [55, 69.5, 10.5, 24.5], FIN: [59.5, 70.5, 20, 32],
  USA: [18, 72, -170, -66], CAN: [41, 84, -142, -52], MEX: [14, 33, -118, -86],
  GRL: [59, 84, -74, -11], CUB: [19.5, 23.5, -85.5, -74], GTM: [13.5, 18, -92.5, -88],
  HND: [12.5, 16.5, -89.5, -83], BRA: [-34, 6, -74, -34], ARG: [-56, -21.5, -74, -53],
  PER: [-19, 0, -82, -68.5], COL: [-4.5, 13.5, -79, -66], BOL: [-23, -9.5, -70, -57.5],
  VEN: [0, 12.5, -73.5, -59.5], CHL: [-56, -17.5, -76, -66.5], DZA: [18.9, 37.5, -9, 12],
  COD: [-13.5, 5.5, 12, 31.5], ZAF: [-35, -22, 16, 33], KAZ: [40.5, 55.5, 46, 88],
  SAU: [16, 32.5, 34.5, 56], TUR: [35.5, 42.5, 25.5, 45], UZB: [37, 45.5, 55, 73],
  TKM: [35, 42.5, 52, 66], IRQ: [29, 37.5, 38.5, 48.5], IND: [6.5, 36, 68, 97.5],
  IRN: [25, 40, 44, 63.5], PAK: [23.5, 37.5, 60.5, 77.5],
};

test('every mapped country has a home box, and all its dots lie inside it', () => {
  assert.deepEqual(Object.keys(HOME).sort(), Object.values(LEVEL_COUNTRY).sort(), 'a box for exactly the mapped countries');
  for (const [iso, [la0, la1, lo0, lo1]] of Object.entries(HOME)) {
    for (const [lat, lon] of dotsOf(iso)) {
      assert.ok(lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1, `${iso} dot at ${lat},${lon} is outside its home area`);
    }
  }
});

test('generator: a part far from its country main landmass is dropped, a near one stays', () => {
  const far = (iso, lon) => ({
    properties: { ADM0_A3: iso, SUBREGION: 'S' },
    geometry: { type: 'MultiPolygon', coordinates: [[SQUARE(0, 0, 40, 40)], [SQUARE(lon, 0, lon + 20, 20)]] },
  });
  assert.ok(OVERSEAS_DEG < 90);
  const dotsIn = (f, lonMin) => sampleDots({ features: [f] }, 4000).dots.filter(([i]) => latticePoint(i, 4000)[1] >= lonMin);
  assert.equal(dotsIn(far('NEAR', 45), 41).length > 0, true, 'a part 45 degrees away stays');
  assert.equal(dotsIn(far('FAR', 120), 99).length, 0, 'a part 100 degrees away is dropped');
});

test('generator: indices that do not fit the packed format throw', () => {
  const c = [['AAA', 'S']];
  assert.throws(() => renderModule({ countries: c, dots: [[70000, 0]] }), /does not fit in a u16/);
  assert.throws(() => renderModule({ countries: c, dots: [[1, 300]] }), /does not fit in a u8/);
  assert.doesNotThrow(() => renderModule({ countries: c, dots: [[65535, 255]] }));
});

test('the committed module is exactly what the generator renders for its own dots', () => {
  const countryIndex = new Map(COUNTRIES.map(([iso], i) => [iso, i]));
  const dots = [];
  let at = 0;
  for (const [lat, lon, iso] of DOTS) {
    // DOTS is in lattice order: walk forward to the next lattice point at this position.
    while (latticePoint(at, LATTICE_POINTS).join() !== `${lat},${lon}`) at += 1;
    dots.push([at, countryIndex.get(iso)]);
    at += 1;
  }
  const committed = readFileSync(new URL('../hub/globe-data.mjs', import.meta.url), 'utf8');
  assert.equal(renderModule({ countries: COUNTRIES, dots }, LATTICE_POINTS), committed, 'hub/globe-data.mjs was edited by hand or is stale');
});

// The renderModule comparison above cannot see a hand edit to COUNTRIES (it renders from them),
// so the file is also pinned by digest. Regenerating changes it: run the generator, then paste
// the new `shasum -a 256 hub/globe-data.mjs` here.
const MODULE_SHA256 = 'e95d16159163d39189dccac65e9907510eecce4d50f6646e46aa66f3abac09af';

test('the committed module has the digest the generator produced', () => {
  const committed = readFileSync(new URL('../hub/globe-data.mjs', import.meta.url));
  assert.equal(
    createHash('sha256').update(committed).digest('hex'),
    MODULE_SHA256,
    'hub/globe-data.mjs differs from the generator output: regenerate it, do not edit it, then update MODULE_SHA256',
  );
});
