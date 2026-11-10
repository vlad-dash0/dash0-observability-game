// continueView (lib/hub-view.mjs): the words and the target of the hub's Continue button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../lib/registry.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { nextUp } from '../lib/unlock.mjs';
import { continueView } from '../lib/hub-view.mjs';

const L = (id, no) => ({ id, no, name: `Name ${id}`, icon: '*', rewardTitle: `t-${id}`, mechanics: ['query'], run() {} });
const REG = buildRegistry([
  { id: 'g0', no: 0, name: 'Zeroth', levels: [L('a', '0.1'), L('b', '0.2')], boss: L('boss0', null) },
  { id: 'g1', no: 1, name: 'First', levels: [L('c', '1.1'), L('e', '1.2'), L('f', '1.3')], boss: L('boss1', null) },
  { id: 'g2', no: 2, name: 'Second', levels: [L('d', '2.1')], boss: null },
], { deck: [], nodeIds: [] });
const P = (ids) => { const p = emptyProgress(); for (const id of ids) p.levels[id] = { stars: 3, at: null }; return p; };
const subsets = (xs) => xs.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
const ALL = ['a', 'b', 'boss0', 'c', 'e', 'f', 'boss1', 'd'];

test('C1 Start until anything is completed anywhere, then Continue with the number', () => {
  assert.deepEqual(continueView(REG, P([])), { levelId: 'a', label: 'Start: 0.1 Name a' });
  assert.deepEqual(continueView(REG, P(['a'])), { levelId: 'b', label: 'Continue: 0.2 Name b' });
  assert.equal(continueView(REG, P(['d'])).label, 'Continue: 0.1 Name a', 'a completion in a later act counts as started');
  // buildRegistry insists on a number, so this copy sets one level's number to null.
  const NONO = { ...REG, levels: { ...REG.levels, a: { ...REG.levels.a, no: null } } };
  assert.equal(continueView(NONO, P([])).label, 'Start: Name a');
  assert.equal(continueView(NONO, P(['b'])).label, 'Continue: Name a');
});

test('C2 a boss reads as an incident to tend to', () => {
  assert.deepEqual(continueView(REG, P(['a', 'b'])), { levelId: 'boss0', label: 'Tend to the incident: Name boss0' });
});

test('C3 nothing to continue in debug, when all is done, or with no acts', () => {
  assert.equal(continueView(REG, P(ALL)), null);
  assert.equal(continueView(REG, P([]), { debug: true }), null);
  assert.equal(continueView(buildRegistry([], { deck: [], nodeIds: [] }), P([])), null);
});

test('C4 the button always opens the level nextUp names', () => {
  for (const ids of subsets(ALL)) {
    const n = nextUp(REG, P(ids));
    const v = continueView(REG, P(ids));
    assert.equal(v?.levelId ?? null, n?.levelId ?? null, ids.join());
  }
});
