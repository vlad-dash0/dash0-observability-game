// Globe lit / pulse state. Spec: issue #149; the rules of the retired system map's nodeStates
// (docs/FOUNDATION.md §2.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../lib/registry.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { globeState } from '../lib/globe.mjs';

const L = (id, no) => ({ id, no, name: id, icon: '*', rewardTitle: `t-${id}`, mechanics: ['query'], run() {} });
const REG = buildRegistry(
  [
    { id: 'g0', no: 0, levels: [L('a', '0.1'), L('b', '0.2')], boss: L('boss0', null) },
    { id: 'g1', no: 1, levels: [L('c', '1.1')], boss: null },
    { id: 'g2', no: 2, levels: [L('d', '2.1')], boss: L('boss2', null) },
  ],
  { deck: [], nodeIds: [] },
);
const MAP = {
  ACT_REGIONS: { g0: { region: 'Zero' }, g1: { region: 'One' }, g2: { region: 'Two' } },
  LEVEL_COUNTRY: { a: 'AAA', b: 'BBB', c: 'CCC', d: 'DDD' },
};
function progress(levels) {
  const p = emptyProgress();
  for (const [id, stars] of Object.entries(levels)) p.levels[id] = { stars, at: null };
  return p;
}
const state = (levels, map = MAP) => globeState(REG, progress(levels), map);

test('a country is lit exactly when its level is completed (stars 0 counts)', () => {
  const s = state({ a: 0 });
  assert.equal(s.countries.AAA.lit, true);
  assert.equal(s.countries.BBB.lit, false);
  assert.equal(s.countries.CCC.lit, false);
});

test('countries and the region pulse only while the act boss is open', () => {
  const before = state({ a: 1 });
  assert.equal(before.regions.g0.pulse, false, 'boss still locked');
  assert.equal(before.countries.AAA.pulse, false);
  const open = state({ a: 1, b: 1 });
  assert.equal(open.regions.g0.pulse, true, 'every level done, boss open');
  assert.equal(open.countries.AAA.pulse, true);
  assert.equal(open.countries.BBB.pulse, true);
  assert.equal(open.regions.g1.pulse, false, 'another act does not pulse');
  assert.equal(open.countries.CCC.pulse, false);
  const done = state({ a: 1, b: 1, boss0: 2 });
  assert.equal(done.regions.g0.pulse, false, 'a completed boss stops pulsing');
  assert.equal(done.countries.AAA.pulse, false);
});

test('a boss in a locked act does not pulse', () => {
  assert.equal(state({}).regions.g2.pulse, false);
  assert.equal(state({ a: 1, b: 1 }).regions.g2.pulse, false, 'act g2 is still behind g0 and g1');
});

test('an act with no boss never pulses', () => {
  const s = state({ c: 1 });
  assert.equal(s.regions.g1.pulse, false);
  assert.equal(s.countries.CCC.lit, true);
});

test('region done and total count the act levels and its boss', () => {
  assert.deepEqual(state({}).regions.g0, { region: 'Zero', done: 0, total: 3, pulse: false });
  assert.equal(state({ a: 1 }).regions.g0.done, 1);
  assert.equal(state({ a: 1, boss0: 1 }).regions.g0.done, 2);
  assert.equal(state({ c: 1 }).regions.g1.total, 1, 'no boss: levels only');
});

test('a progress id the registry does not know is ignored', () => {
  const s = state({ a: 1, 'not-a-level': 3, 'also-unknown': 0 });
  assert.equal(s.regions.g0.done, 1);
  assert.deepEqual(Object.keys(s.countries).sort(), ['AAA', 'BBB', 'CCC', 'DDD']);
  assert.deepEqual(s, state({ a: 1 }));
});

test('acts without a region and levels without a country are left out', () => {
  const s = state({}, { ACT_REGIONS: { g0: { region: 'Zero' } }, LEVEL_COUNTRY: { a: 'AAA' } });
  assert.deepEqual(Object.keys(s.regions), ['g0']);
  assert.deepEqual(Object.keys(s.countries), ['AAA']);
});

test('does not mutate registry or progress, and the result is plain data', () => {
  const p = progress({ a: 1, b: 1 });
  const before = JSON.stringify([p, REG.acts]);
  const s = globeState(REG, p, MAP);
  assert.equal(JSON.stringify([p, REG.acts]), before);
  assert.equal(Object.getPrototypeOf(s.countries), null);
  assert.equal(s.countries.constructor, undefined, 'no prototype keys');
});
