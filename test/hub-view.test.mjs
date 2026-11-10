// continueView (lib/hub-view.mjs): the words and the target of the hub's Continue button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../lib/registry.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { nextUp } from '../lib/unlock.mjs';
import { continueView, hubActs } from '../lib/hub-view.mjs';

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

const rows = (progress, opts) => hubActs(REG, progress, opts).map((r) => [r.id, r.status, r.done, r.total, r.expanded, r.line]);

test('H1 a fresh game: the first act is open and unfolded, the rest locked and folded', () => {
  assert.deepEqual(rows(P([])), [
    ['g0', 'open', 0, 3, true, 'Act 0: Zeroth, 0 of 3'],
    ['g1', 'locked', 0, 4, false, 'Act 1: First, locked, 0 of 4'],
    ['g2', 'locked', 0, 1, false, 'Act 2: Second, locked, 0 of 1'],
  ]);
});

test('H2 a finished act is saved and folded, the next one unfolds', () => {
  const r = rows(P(['a', 'b', 'boss0', 'c']));
  assert.deepEqual(r[0], ['g0', 'saved', 3, 3, false, 'Act 0: Zeroth, saved, 3 of 3']);
  assert.deepEqual(r[1], ['g1', 'open', 1, 4, true, 'Act 1: First, 1 of 4']);
});

test('H3 an open boss makes the act an incident and keeps it unfolded', () => {
  assert.deepEqual(rows(P(['a', 'b']))[0], ['g0', 'incident', 2, 3, true, 'Act 0: Zeroth, incident open, 2 of 3']);
});

test('H4 a completion in a later act unlocks and unfolds it', () => {
  const r = rows(P(['c']));
  assert.equal(r[0][1], 'open');
  assert.equal(r[0][4], true);
  assert.deepEqual(r[1], ['g1', 'open', 1, 4, true, 'Act 1: First, 1 of 4']);
  assert.deepEqual(r[2].slice(1, 5), ['locked', 0, 1, false]);
});

test('H5 the player\'s choice beats the default; ids that are not acts are ignored', () => {
  const r = hubActs(REG, P(['a', 'b', 'boss0']), { overrides: { g0: true, g1: false, nope: true } });
  assert.deepEqual(r.map((x) => x.expanded), [true, false, false]);
  assert.equal(r.length, 3);
});

test('H6 debug unfolds every act and keeps the real statuses', () => {
  const r = hubActs(REG, P(['a', 'b', 'boss0']), { debug: true });
  assert.deepEqual(r.map((x) => [x.status, x.expanded]), [['saved', true], ['open', true], ['locked', true]]);
});
