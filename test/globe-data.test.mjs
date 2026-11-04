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
  SOURCE_SHA256, SOURCE_URL, SOURCE_VERSION, renderModule, sampleDots, verifyHash,
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
