// The globe's data: the generated dots, the hand-written level to country table checked against
// the LIVE registry, and the generator's own rules. Spec: issue #149.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DOTS, COUNTRIES, LATTICE_POINTS } from '../hub/globe-data.mjs';
import { ACT_REGIONS, ISLANDS, islandDots, LEVEL_COUNTRY, MIN_DOTS, MIN_DOTS_EXCEPTIONS, COUNTRY_ACT, actOfCountry } from '../hub/globe-map.mjs';
import { liveRegistry } from '../app.mjs';
import { globeState } from '../lib/globe.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { latticePoint } from '../lib/globe-lattice.mjs';
import {
  OVERSEAS_DEG, SOURCE_SHA256, arcDegrees, SOURCE_URL, SOURCE_VERSION, renderModule, sampleDots, verifyHash,
} from '../tools/build-globe-data.mjs';

const REG = liveRegistry();
const levelIds = REG.order.filter((id) => REG.levels[id].kind === 'level');
// Land dots plus the hand-placed island markers (hub/globe-map.mjs ISLANDS): what the globe draws, so a level
// country with no land dot (FJI, VUT, WSM) is found, counted and boxed like any other.
const ALL_DOTS = [...DOTS, ...islandDots()];
const dotsOf = (iso) => ALL_DOTS.filter((d) => d[2] === iso);
const subregionOf = { ...Object.fromEntries(COUNTRIES), ...Object.fromEntries(Object.entries(ISLANDS).map(([iso, { sub }]) => [iso, sub])) };

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
    const need = MIN_DOTS_EXCEPTIONS[iso] ?? MIN_DOTS;
    assert.ok(dotsOf(iso).length >= need, `${iso} has ${dotsOf(iso).length} dots, needs ${need}`);
  }
});

test('every dot-count exception is used by a level, equals its real dot count, and is a real shortfall', () => {
  assert.equal(Object.keys(MIN_DOTS_EXCEPTIONS).length > 0, true);
  for (const [iso, need] of Object.entries(MIN_DOTS_EXCEPTIONS)) {
    assert.equal(Object.values(LEVEL_COUNTRY).includes(iso), true, `${iso} is in the table but no level uses it`);
    assert.equal(dotsOf(iso).length, need, `${iso} has ${dotsOf(iso).length} dots, the exception allows ${need} (a change means the exception is stale)`);
    assert.equal(dotsOf(iso).length < MIN_DOTS, true, `${iso} reaches MIN_DOTS, so it needs no exception`);
  }
  assert.deepEqual({ ...MIN_DOTS_EXCEPTIONS }, { KOR: 5, SLB: 2, NCL: 2 }, 'the table lists exactly these three countries');
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

const GREAT_CIRCLE_DEG = (a, b) => {
  const r = Math.PI / 180;
  const c = Math.sin(a[0] * r) * Math.sin(b[0] * r) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.cos((a[1] - b[1]) * r);
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
};

test('islandDots: deterministic, k points per island, none on land, each near its coordinate', () => {
  assert.deepEqual(islandDots(), islandDots());
  const landKeys = new Set(DOTS.map((d) => `${d[0]},${d[1]}`));
  for (const k of [1, 3, 5]) {
    const dots = islandDots(k);
    assert.equal(dots.length, k * Object.keys(ISLANDS).length);
    for (const [iso, { sub, at }] of Object.entries(ISLANDS)) {
      const mine = dots.filter((d) => d[2] === iso);
      assert.equal(mine.length, k, `${iso} has ${k} markers`);
      for (const d of mine) {
        assert.equal(d[3], sub);
        assert.ok(GREAT_CIRCLE_DEG([d[0], d[1]], at) < 3, `${iso} marker ${d[0]},${d[1]} is within 3 degrees of ${at}`);
      }
    }
  }
  const all = islandDots();
  for (const d of all) assert.ok(!landKeys.has(`${d[0]},${d[1]}`), `${d[0]},${d[1]} is a land dot`);
  assert.equal(new Set(all.map((d) => `${d[0]},${d[1]}`)).size, all.length, 'no two markers share a position');
  const onLattice = new Set(Array.from({ length: LATTICE_POINTS }, (_, i) => latticePoint(i, LATTICE_POINTS).join(',')));
  assert.ok(all.every((d) => onLattice.has(`${d[0]},${d[1]}`)), 'every marker is a lattice point');
});

test('islandDots: skips lattice points that are land, taking the next nearest', () => {
  const at = ISLANDS.FJI.at;
  const first = islandDots(1)[0];
  const blocked = islandDots(1, [...DOTS, [first[0], first[1], 'FJI', 'Melanesia']], { FJI: ISLANDS.FJI })[0];
  assert.notDeepEqual(blocked.slice(0, 2), first.slice(0, 2));
  assert.ok(GREAT_CIRCLE_DEG(first, at) <= GREAT_CIRCLE_DEG(blocked, at));
});

test('ISLANDS pins the capitals (Suva, Port Vila, Apia) and their subregions', () => {
  const plain = Object.fromEntries(Object.entries(ISLANDS).map(([k, v]) => [k, { sub: v.sub, at: [...v.at] }]));
  assert.deepEqual(plain, {
    FJI: { sub: 'Melanesia', at: [-18.14, 178.44] },
    VUT: { sub: 'Melanesia', at: [-17.73, 168.32] },
    WSM: { sub: 'Polynesia', at: [-13.83, -171.76] },
  });
  assert.ok(Object.isFrozen(ISLANDS) && Object.isFrozen(ISLANDS.FJI) && Object.isFrozen(ISLANDS.FJI.at));
});

test('every island country has no land dot, a lit-able subregion in an act, and the data stays as generated', () => {
  for (const [iso, { sub, at }] of Object.entries(ISLANDS)) {
    assert.equal(DOTS.filter((d) => d[2] === iso).length, 0, `${iso} has land dots now: drop it from ISLANDS`);
    assert.equal(actOfCountry(iso, sub), 'act-9', `${iso} (${sub}) is not in Oceania`);
    assert.ok(Math.abs(at[0]) <= 90 && Math.abs(at[1]) <= 180);
  }
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

// [minLat, maxLat, minLon, maxLon]: each mapped country's home area, at least the country's
// outline (overseas parts dropped) plus half a degree. Overseas parts that stay on purpose (Alaska, Hawaii, Svalbard) are
// inside their box.
const HOME = {
  FRA: [40, 52, -6, 11], DEU: [46, 56, 5, 16], ESP: [35, 45, -10, 4], NOR: [57, 82, 4, 32], SWE: [54, 70, 10, 25], FIN: [59, 71, 20, 33], USA: [18, 72, -173, -66], CAN: [41, 84, -142, -52], MEX: [14, 34, -118, -86], GRL: [59, 85, -74, -11], CUB: [19, 24, -86, -73], GTM: [13, 19, -93, -87], HND: [12, 17, -90, -82], BRA: [-35, 6, -75, -34], ARG: [-56, -21, -74, -53], PER: [-19, 1, -82, -68], COL: [-5, 13, -80, -66], BOL: [-24, -9, -71, -56], VEN: [0, 13, -74, -59], CHL: [-57, -17, -77, -66], DZA: [18, 38, -10, 13], COD: [-14, 6, 11, 32], ZAF: [-36, -21, 15, 34], KAZ: [40, 56, 45, 88], SAU: [15, 33, 34, 57], TUR: [35, 43, 25, 46], UZB: [36, 47, 55, 74], TKM: [34, 44, 52, 68], IRQ: [28, 38, 38, 50], IND: [7, 36, 67, 98], IRN: [24, 41, 43, 64], PAK: [23, 38, 60, 79], JPN: [30, 46, 128, 146], CHN: [18, 54, 73, 135], MNG: [41, 52, 87, 121], KOR: [33, 39, 125, 130], AUS: [-44, -10, 112, 154], NZL: [-48, -34, 166, 179], THA: [5, 21, 97, 106], VNM: [7.5, 24, 101.5, 110], IDN: [-11.5, 6.5, 94.5, 141.5], MYS: [0.3, 7.9, 99, 119.8], PHL: [4.5, 21.5, 116.5, 127], PNG: [-12.5, 0, 140.5, 158], NCL: [-23, -19.5, 163.5, 168.5], SLB: [-11.5, -6, 155.5, 162.5],
};

test('every mapped country has a home box, and all its dots lie inside it', () => {
  assert.deepEqual(Object.keys(HOME).sort(), Object.values(LEVEL_COUNTRY).sort(), 'a box for exactly the mapped countries');
  for (const [iso, [la0, la1, lo0, lo1]] of Object.entries(HOME)) {
    for (const [lat, lon] of dotsOf(iso)) {
      assert.ok(lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1, `${iso} dot at ${lat},${lon} is outside its home area`);
    }
  }
});

test('generator: an overseas part is kept at 55 degrees from the main landmass and dropped at 65', () => {
  // Main part: the square lon 0..40, lat 0..40 (centre 20,20). The second part is a 20-degree
  // square on the equator, centred (c, 10).
  const mainCentre = [20, 20];
  const country = (iso, c) => ({
    properties: { ADM0_A3: iso, SUBREGION: 'S' },
    geometry: { type: 'MultiPolygon', coordinates: [[SQUARE(0, 0, 40, 40)], [SQUARE(c - 10, 0, c + 10, 20)]] },
  });
  const inside = 76;
  const outside = 87;
  assert.equal(OVERSEAS_DEG, 60);
  const arc = (c) => arcDegrees(mainCentre, [c, 10]);
  assert.ok(arc(inside) > 54 && arc(inside) < 56, `fixture part is ${arc(inside)} degrees away`);
  assert.ok(arc(outside) > 64 && arc(outside) < 66, `fixture part is ${arc(outside)} degrees away`);
  const farDots = (iso, c) =>
    sampleDots({ features: [country(iso, c)] }, 8000).dots.filter(([i]) => latticePoint(i, 8000)[1] > 50);
  assert.ok(farDots('IN', inside).length > 0, 'a part 55 degrees out stays');
  assert.equal(farDots('OUT', outside).length, 0, 'a part 65 degrees out is dropped');
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
