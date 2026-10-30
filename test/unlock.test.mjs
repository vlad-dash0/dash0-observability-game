// Unlock rules: an act opens when every earlier act is complete or once it is entered (a
// level or its boss completed), levels in any order, boss after its act's levels,
// completed always shown. Spec: docs/FOUNDATION.md §3 Unlock and §6 F4, docs/M1-DESIGN.md §3.
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

test('an un-entered act unlocks only when EVERY earlier act is complete, and done is never hidden', () => {
  const p = P({ l1a: 3, l1b: 3 });
  assert.equal(isActUnlocked(1, p, REG), true, 'a1 is entered (M1-DESIGN §3)');
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

test('a level whose actId names no act is locked with an unknown reason', () => {
  const reg = Object.freeze({
    ...REG,
    levels: Object.freeze(Object.assign(Object.create(null), { ...REG.levels, ghost: level('ghost', 'a9', 'level') })),
  });
  assert.equal(levelState('ghost', P(), reg), 'locked');
  assert.deepEqual(lockReason('ghost', P(), reg), { kind: 'unknown' });
});

test('an act whose bossId is undefined counts as having no boss', () => {
  const act = Object.freeze({ id: 'a1', no: 1, name: 'A1', sub: '', levelIds: Object.freeze(['l1a', 'l1b']), bossId: undefined });
  assert.equal(isActComplete(act, P({ l1a: 1, l1b: 1 })), true);
  assert.equal(isActComplete(act, P({ l1a: 1 })), false);
});

// M1-DESIGN §3: an act stays open once entered (a level or its boss completed).

test('an un-entered later act still waits for the whole chain', () => {
  const p = P({ l0a: 3, l0b: 3, b0: 3 });
  assert.equal(isActUnlocked(1, p, REG), true);
  assert.equal(isActUnlocked(2, p, REG), false);
  assert.equal(levelState('l2a', p, REG), 'locked');
  assert.deepEqual(lockReason('l2a', p, REG), { kind: 'act', actId: 'a1' });
});

test('one completed level enters its act: the rest of it opens while earlier acts are incomplete', () => {
  const p = P({ l1a: 2 });
  assert.equal(isActUnlocked(1, p, REG), true);
  assert.equal(levelState('l1b', p, REG), 'open');
  assert.equal(lockReason('l1b', p, REG), null);
  assert.equal(levelState('l0a', p, REG), 'open');
  assert.equal(isActUnlocked(2, p, REG), false);
});

test('a completed boss alone enters its act; the boss rule still holds for the rest', () => {
  const p = P({ b2: 0 });
  assert.equal(isActUnlocked(2, p, REG), true);
  assert.equal(levelState('l2a', p, REG), 'open');
  assert.equal(levelState('b2', p, REG), 'done');
  assert.equal(lockReason('l2a', p, REG), null);
  assert.equal(levelState('l1a', p, REG), 'locked');
});

test('the boss gate still holds in an act open only by entry (earlier act incomplete)', () => {
  const r = reg([
    { id: 'a0', levelIds: ['l0'], bossId: null },
    { id: 'a1', levelIds: ['l1a', 'l1b'], bossId: 'b1' },
  ]);
  const one = P({ l1a: 3 });
  assert.equal(isActUnlocked(1, one, r), true);
  assert.equal(isActComplete(r.acts[0], one), false);
  assert.equal(levelState('b1', one, r), 'locked');
  assert.deepEqual(lockReason('b1', one, r), { kind: 'boss', remaining: ['l1b'] });
  const both = P({ l1a: 3, l1b: 3 });
  assert.equal(levelState('b1', both, r), 'open');
  assert.equal(lockReason('b1', both, r), null);
});

// Before/after inserting a level into act 0: the shipped registry, then the same with one more
// act-0 level. A player who entered act 1 keeps it open; one who did not is re-locked.
function reg(acts) {
  const lv = Object.create(null);
  const order = [];
  for (const a of acts) {
    for (const id of a.levelIds) { lv[id] = level(id, a.id, 'level'); order.push(id); }
    if (a.bossId != null) { lv[a.bossId] = level(a.bossId, a.id, 'boss'); order.push(a.bossId); }
  }
  return Object.freeze({
    acts: Object.freeze(acts.map((a) => Object.freeze({ no: 0, name: a.id, sub: '', ...a, levelIds: Object.freeze([...a.levelIds]) }))),
    levels: Object.freeze(lv),
    order: Object.freeze(order),
    cardIds: Object.freeze([]),
  });
}

test('an entered act stays open after an earlier act gains a new level', () => {
  const before = reg([
    { id: 'a0', levelIds: ['l0a'], bossId: null },
    { id: 'a1', levelIds: ['l1a', 'l1b'], bossId: null },
  ]);
  const after = reg([
    { id: 'a0', levelIds: ['l0a', 'l0new'], bossId: null },
    { id: 'a1', levelIds: ['l1a', 'l1b'], bossId: null },
  ]);
  const entered = P({ l0a: 3, l1a: 3 });
  assert.equal(levelState('l1b', entered, before), 'open');
  assert.equal(levelState('l1b', entered, after), 'open');
  assert.equal(lockReason('l1b', entered, after), null);
  assert.equal(levelState('l0new', entered, after), 'open');
  assert.equal(isActComplete(after.acts[0], entered), false);

  const notEntered = P({ l0a: 3 });
  assert.equal(levelState('l1a', notEntered, before), 'open');
  assert.equal(levelState('l1a', notEntered, after), 'locked');
  assert.deepEqual(lockReason('l1a', notEntered, after), { kind: 'act', actId: 'a0' });
});

test('existing player migration: {naming-your-service:3} against an M1-shaped registry', () => {
  const m1 = reg([
    { id: 'act-0', levelIds: ['l01', 'l02', 'l03'], bossId: 'the-pager' },
    { id: 'act-1', levelIds: ['naming-your-service'], bossId: null },
    { id: 'act-2', levelIds: ['l21', 'l22'], bossId: 'checkout-is-slow' },
  ]);
  const p = P({ 'naming-your-service': 3 });
  assert.equal(levelState('naming-your-service', p, m1), 'done');
  assert.equal(isActUnlocked(1, p, m1), true);
  for (const id of ['l01', 'l02', 'l03']) assert.equal(levelState(id, p, m1), 'open', id);
  assert.equal(levelState('the-pager', p, m1), 'locked');
  assert.equal(isActUnlocked(2, p, m1), false);
  assert.equal(levelState('l21', p, m1), 'locked');
  assert.deepEqual(lockReason('l21', p, m1), { kind: 'act', actId: 'act-0' });

  const act0 = { l01: 3, l02: 3, l03: 3, 'the-pager': 0 };
  assert.equal(levelState('l21', P(act0), m1), 'locked', 'act 1 not complete');
  assert.deepEqual(lockReason('l21', P(act0), m1), { kind: 'act', actId: 'act-1' });
  const both = P({ ...act0, 'naming-your-service': 3 });
  assert.equal(levelState('l21', both, m1), 'open');
  assert.equal(levelState('checkout-is-slow', both, m1), 'locked');
});

test('lockReason and levelState agree for every id across progress shapes', () => {
  const shapes = [{}, { l1a: 3 }, { b2: 1 }, { l0a: 3, l0b: 3 }, { l0a: 3, l0b: 3, b0: 3 }, { l2a: 2 }];
  for (const s of shapes) {
    const p = P(s);
    for (const id of REG.order) {
      if (isCompleted(p, id)) continue;
      const open = lockReason(id, p, REG) === null;
      assert.equal(levelState(id, p, REG), open ? 'open' : 'locked', `${id} with ${JSON.stringify(s)}`);
    }
  }
});
