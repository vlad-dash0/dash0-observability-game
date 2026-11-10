// One rule for what to play next (#313): nextUp, and the counts and globe answers tied to it.
// Spec: docs/FOUNDATION.md §2.7 (Continue, Next up and the globe target name the same act).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentActId, globeCaption } from '../lib/globe-view.mjs';
import { globeState } from '../lib/globe.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { actCounts, isActComplete, levelState, nextUp } from '../lib/unlock.mjs';

const L = (id, no) => ({ id, no, name: `Name ${id}`, icon: '*', rewardTitle: `t-${id}`, mechanics: ['query'], run() {} });
const REG = buildRegistry(
  [
    { id: 'g0', no: 0, name: 'Zeroth', levels: [L('a', '0.1'), L('b', '0.2')], boss: L('boss0', null) },
    { id: 'g1', no: 1, name: 'First', levels: [L('c', '1.1'), L('e', '1.2'), L('f', '1.3')], boss: L('boss1', null) },
    { id: 'g2', no: 2, name: 'Second', levels: [L('d', '2.1')], boss: null },
  ],
  { deck: [], nodeIds: [] },
);
const MAP = { ACT_REGIONS: { g0: { region: 'Zero' }, g1: { region: 'One' }, g2: { region: 'Two' } }, LEVEL_COUNTRY: {} };
const P = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};
const subsets = (xs) => xs.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
const ALL = ['a', 'b', 'boss0', 'c', 'e', 'f', 'boss1', 'd'];
const EMPTY = buildRegistry([], { deck: [], nodeIds: [] });

test('N1 nextUp follows play order: levels in order, then the boss', () => {
  const cases = [
    [[], { actId: 'g0', levelId: 'a' }],
    [['a'], { actId: 'g0', levelId: 'b' }],
    [['b'], { actId: 'g0', levelId: 'a' }],
    [['a', 'b'], { actId: 'g0', levelId: 'boss0' }],
    [['a', 'b', 'boss0', 'e'], { actId: 'g1', levelId: 'c' }],
    [['a', 'b', 'boss0', 'c', 'e', 'f', 'boss1'], { actId: 'g2', levelId: 'd' }],
  ];
  for (const [ids, want] of cases) assert.deepEqual(nextUp(REG, P(ids)), want, ids.join(','));
});

test('N2 an open incident in a later act comes first, and the globe and caption agree', () => {
  const p = P(['a', 'c', 'e', 'f']);
  assert.equal(levelState('boss1', p, REG), 'open');
  assert.deepEqual(nextUp(REG, p), { actId: 'g1', levelId: 'boss1' });
  assert.equal(currentActId(REG, p), 'g1');
  assert.equal(globeCaption(REG, globeState(REG, p, MAP)).actId, 'g1');
});

test('N3 null when every act is complete or there are no acts; the globe stays on the last act', () => {
  assert.equal(nextUp(REG, P(ALL)), null);
  assert.equal(nextUp(EMPTY, P([])), null);
  assert.equal(currentActId(REG, P(ALL)), 'g2');
  assert.equal(currentActId(EMPTY, P([])), null);
});

test('N4 over every progress subset: one answer for nextUp, the globe and the caption', () => {
  for (const ids of subsets(ALL)) {
    const p = P(ids);
    const n = nextUp(REG, p);
    const label = ids.join(',') || '(none)';
    assert.equal(n === null, REG.acts.every((a) => isActComplete(a, p)), label);
    const cap = globeCaption(REG, globeState(REG, p, MAP));
    if (n === null) {
      assert.equal(currentActId(REG, p), 'g2', label);
      assert.equal(cap.phase, 'allSaved', label);
      continue;
    }
    assert.equal(levelState(n.levelId, p, REG), 'open', label);
    assert.equal(REG.levels[n.levelId].actId, n.actId, label);
    const openBoss = REG.acts.find((a) => a.bossId != null && levelState(a.bossId, p, REG) === 'open');
    if (openBoss) assert.deepEqual(n, { actId: openBoss.id, levelId: openBoss.bossId }, label);
    assert.equal(currentActId(REG, p), n.actId, label);
    if (cap.phase === 'saved') {
      const i = REG.acts.findIndex((a) => a.id === n.actId);
      assert.equal(cap.actId, REG.acts[i - 1].id, label);
    } else assert.equal(cap.actId, n.actId, label);
  }
});

test('N5 actCounts counts levels plus boss and matches the globe regions', () => {
  assert.deepEqual(actCounts(REG.acts[1], P(['c', 'boss1', 'a'])), { done: 2, total: 4 });
  assert.deepEqual(actCounts(REG.acts[2], P([])), { done: 0, total: 1 });
  for (const ids of subsets(ALL)) {
    const p = P(ids);
    const { regions } = globeState(REG, p, MAP);
    for (const act of REG.acts) {
      const { done, total } = regions[act.id];
      assert.deepEqual(actCounts(act, p), { done, total }, `${act.id} ${ids.join(',')}`);
    }
  }
});
