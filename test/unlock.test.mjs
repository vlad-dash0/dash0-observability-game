// Unlock rules: acts in order (whole chain), levels in any order, boss after its act's
// levels, completed always shown. Spec: docs/FOUNDATION.md §3 Unlock and §6 F4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isActComplete,
  isActUnlocked,
  isCompleted,
  levelState,
  lockReason,
} from '../lib/unlock.mjs';

// Hand-written §2.4 registry (F4 does not import lib/registry.mjs).
function level(id, actId, kind) {
  return Object.freeze({ id, actId, kind, scored: true, cards: Object.freeze([]) });
}
const levels = Object.assign(Object.create(null), {
  l0a: level('l0a', 'a0', 'level'),
  l0b: level('l0b', 'a0', 'level'),
  b0: level('b0', 'a0', 'boss'),
  l1a: level('l1a', 'a1', 'level'),
  l1b: level('l1b', 'a1', 'level'),
  l2a: level('l2a', 'a2', 'level'),
  b2: level('b2', 'a2', 'boss'),
});
const REG = Object.freeze({
  acts: Object.freeze([
    Object.freeze({ id: 'a0', no: 0, name: 'A0', sub: '', levelIds: Object.freeze(['l0a', 'l0b']), bossId: 'b0' }),
    Object.freeze({ id: 'a1', no: 1, name: 'A1', sub: '', levelIds: Object.freeze(['l1a', 'l1b']), bossId: null }),
    Object.freeze({ id: 'a2', no: 2, name: 'A2', sub: '', levelIds: Object.freeze(['l2a']), bossId: 'b2' }),
  ]),
  levels: Object.freeze(levels),
  order: Object.freeze(['l0a', 'l0b', 'b0', 'l1a', 'l1b', 'l2a', 'b2']),
  cardIds: Object.freeze([]),
});

// Progress with the given stars per id (at null), shaped as sanitizeProgress returns.
function P(stars = {}) {
  const lv = Object.create(null);
  for (const [id, s] of Object.entries(stars)) lv[id] = { stars: s, at: null };
  return { v: 1, levels: lv, cards: [] };
}

function states(progress) {
  const out = {};
  for (const id of REG.order) out[id] = levelState(id, progress, REG);
  return out;
}

test('empty progress: only the first act is open, its boss and later acts locked', () => {
  assert.deepEqual(states(P()), {
    l0a: 'open', l0b: 'open', b0: 'locked', l1a: 'locked', l1b: 'locked', l2a: 'locked', b2: 'locked',
  });
});

test('levels of an act open in any order', () => {
  assert.equal(levelState('l0b', P({ l0a: 0 }), REG), 'open');
  assert.equal(levelState('l0a', P({ l0b: 3 }), REG), 'open');
  assert.equal(levelState('l0b', P({ l0b: 3 }), REG), 'done');
});

test('all levels done opens the boss but not the next act (the boss is part of the act)', () => {
  const p = P({ l0a: 3, l0b: 3 });
  assert.equal(levelState('b0', p, REG), 'open');
  assert.equal(levelState('l1a', p, REG), 'locked');
  assert.equal(isActComplete(REG.acts[0], p), false);
});

test('stars 0 counts as completed: a 0-star boss completes the act', () => {
  const p = P({ l0a: 1, l0b: 2, b0: 0 });
  assert.equal(isCompleted(p, 'b0'), true);
  assert.equal(isActComplete(REG.acts[0], p), true);
  assert.equal(levelState('l1a', p, REG), 'open');
  assert.equal(levelState('b0', p, REG), 'done');
});

test('one finished level is not enough for the boss', () => {
  assert.equal(levelState('b0', P({ l0a: 3 }), REG), 'locked');
});

test('an act is complete only when EVERY level is: an imported boss plus one level is not', () => {
  const p = P({ l0a: 3, b0: 3 });
  assert.equal(levelState('b0', p, REG), 'done');
  assert.equal(isActComplete(REG.acts[0], p), false);
  assert.equal(levelState('l1a', p, REG), 'locked');
});

test('an act without a boss is complete when its levels are', () => {
  const p = P({ l0a: 3, l0b: 3, b0: 3, l1a: 1, l1b: 1 });
  assert.equal(isActComplete(REG.acts[1], p), true);
  assert.equal(levelState('l2a', p, REG), 'open');
  assert.equal(levelState('b2', p, REG), 'locked');
});

test('an act unlocks only when EVERY earlier act is complete, and done is never hidden', () => {
  const p = P({ l1a: 3, l1b: 3 });
  assert.equal(isActUnlocked(1, p, REG), false);
  assert.equal(isActUnlocked(2, p, REG), false);
  assert.equal(levelState('l2a', p, REG), 'locked');
  assert.equal(levelState('l1a', p, REG), 'done');
  assert.equal(levelState('l1b', p, REG), 'done');
  assert.equal(isActUnlocked(0, P(), REG), true);
});

test('unknown id is locked and does not throw', () => {
  assert.equal(levelState('nope', P(), REG), 'locked');
  assert.equal(levelState('__proto__', P(), REG), 'locked');
  assert.equal(isCompleted(P(), 'constructor'), false);
});

test('lockReason names the blocking act, the remaining boss levels, or nothing', () => {
  assert.deepEqual(lockReason('l1a', P(), REG), { kind: 'act', actId: 'a0' });
  assert.deepEqual(lockReason('l2a', P({ l0a: 3, l0b: 3, b0: 3 }), REG), { kind: 'act', actId: 'a1' });
  assert.deepEqual(lockReason('b0', P({ l0b: 3 }), REG), { kind: 'boss', remaining: ['l0a'] });
  assert.deepEqual(lockReason('b0', P(), REG), { kind: 'boss', remaining: ['l0a', 'l0b'] });
  assert.equal(lockReason('l0a', P(), REG), null);
  assert.equal(lockReason('l1a', P({ l1a: 2 }), REG), null);
});

test('lockReason for an unknown id is a distinct reason, not null (null means unlocked)', () => {
  assert.deepEqual(lockReason('nope', P(), REG), { kind: 'unknown' });
});
