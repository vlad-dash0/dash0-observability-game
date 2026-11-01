// Self-test for test/helpers/stars.mjs: the expected star max is derived from the registry
// (scored levels x 3), not restated per level PR. Issue #88.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARS_PER_LEVEL, expectedStarMax, scoredLevelCount } from './helpers/stars.mjs';
import { liveRegistry } from '../app.mjs';

// The unscored levels in the live registry, listed on purpose: marking another level
// unscored (or scoring the pager) is a deliberate change that edits this one line.
const UNSCORED = ['the-pager'];

const fixture = (scoredFlags) => {
  const levels = Object.fromEntries(scoredFlags.map(([id, scored]) => [id, { id, scored }]));
  return { order: scoredFlags.map(([id]) => id), levels };
};

test('the helper counts scored levels only: an unscored boss in the fixture is left out', () => {
  const reg = fixture([['a', true], ['b', true], ['boss', false], ['c', true]]);
  assert.equal(scoredLevelCount(reg), 3);
  assert.equal(expectedStarMax(reg), 9);
  assert.equal(STARS_PER_LEVEL, 3);
});

test('the helper only walks the order: a level outside it adds nothing', () => {
  const reg = { ...fixture([['a', true]]) };
  reg.levels.stray = { id: 'stray', scored: true };
  assert.equal(scoredLevelCount(reg), 1);
});

test('the helper on the live registry: the pager is in the order but not counted', () => {
  const live = liveRegistry();
  assert.ok(live.order.includes('the-pager'));
  assert.equal(live.levels['the-pager'].scored, false);
  assert.equal(scoredLevelCount(live), live.order.filter((id) => id !== 'the-pager').length);
});

test('the live scored count is the order length minus exactly the listed unscored levels', () => {
  const live = liveRegistry();
  const unscored = live.order.filter((id) => live.levels[id].scored !== true);
  assert.deepEqual(unscored, UNSCORED);
  assert.equal(scoredLevelCount(live), live.order.length - UNSCORED.length);
  assert.equal(expectedStarMax(live), 3 * (live.order.length - UNSCORED.length));
});
