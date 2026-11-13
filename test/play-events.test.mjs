// lib/play-events.mjs: the closed wire contract of the game's play events (epic #18 P1, docs/GAME-EVENTS.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorKind, MAX_COUNT, MAX_MS, parseBatch } from '../lib/play-events.mjs';

const registry = {
  levels: {
    'lvl-a': { id: 'lvl-a', scored: true, actId: 'act-1' },
    intro: { id: 'intro', scored: false, actId: 'act-0' },
  },
};
const SID = '0123456789abcdef';
const play = (over = {}) => ({ t: 'play', level: 'lvl-a', outcome: 'complete', durationMs: 61000, agoMs: 1200, stars: 4, mistakes: 1, hints: 0, ...over });
const err = (over = {}) => ({ t: 'error', kind: 'TypeError', agoMs: 0, ...over });
const batch = (events, over = {}) => JSON.stringify({ v: 1, sid: SID, events, ...over });
const field = (text) => {
  const r = parseBatch(text, registry);
  assert.equal(r.ok, false, text);
  return r.field;
};
const accepts = (text) => assert.equal(parseBatch(text, registry).ok, true, text);

test('1 a valid batch parses to exactly what was sent', () => {
  const abandon = { t: 'play', level: 'intro', outcome: 'abandon', durationMs: 5000, agoMs: 10 };
  const r = parseBatch(batch([play(), abandon, err()]), registry);
  assert.deepEqual(r, { ok: true, sid: SID, events: [play(), abandon, err()] });
});

test('2 an unknown key anywhere rejects the whole batch', () => {
  assert.equal(parseBatch(batch([play()], { nick: 'x' }), registry).ok, false);
  assert.equal(parseBatch(batch([play({ email: 'a@b.c' })]), registry).ok, false);
  assert.equal(parseBatch(batch([err({ text: 'hi' })]), registry).ok, false);
});

test('3 a level must be an own key of the registry', () => {
  for (const level of ['nope', '__proto__', 'constructor', 'toString']) assert.equal(field(batch([play({ level })])), 'level', level);
  assert.equal(field(batch([err({ level: '__proto__' })])), 'level');
});

test('4 stars: 1..5 for a scored level, exactly 0 for an unscored one', () => {
  for (const stars of [0, 6, 4.5]) assert.equal(field(batch([play({ stars })])), 'stars', String(stars));
  for (const stars of [1, 5]) accepts(batch([play({ stars })]));
  assert.equal(field(batch([play({ level: 'intro', stars: 3 })])), 'stars');
  accepts(batch([play({ level: 'intro', stars: 0 })]));
});

test('5 abandon forbids the score fields and complete requires them', () => {
  const abandon = { t: 'play', level: 'lvl-a', outcome: 'abandon', durationMs: 1, agoMs: 1 };
  accepts(batch([abandon]));
  assert.equal(parseBatch(batch([{ ...abandon, stars: 3 }]), registry).ok, false);
  assert.equal(parseBatch(batch([{ ...abandon, hints: 0 }]), registry).ok, false);
  const { hints: _h, ...noHints } = play();
  assert.equal(field(batch([noHints])), 'hints');
  const { mistakes: _m, ...noMistakes } = play();
  assert.equal(field(batch([noMistakes])), 'mistakes');
});

test('6 numbers are integers inside their range', () => {
  for (const [key, max] of [['durationMs', MAX_MS], ['agoMs', MAX_MS], ['mistakes', MAX_COUNT], ['hints', MAX_COUNT]]) {
    accepts(batch([play({ [key]: 0 })]));
    accepts(batch([play({ [key]: max })]));
    for (const bad of [max + 1, -1, '5', 1.5, null]) assert.equal(field(batch([play({ [key]: bad })])), key, `${key} ${bad}`);
  }
});

test('7 batch size, session id and version', () => {
  accepts(batch(Array.from({ length: 20 }, () => err())));
  assert.equal(field(batch([])), 'events');
  assert.equal(field(batch(Array.from({ length: 21 }, () => err()))), 'events');
  assert.equal(field(batch([err()], { sid: SID.toUpperCase() })), 'sid');
  assert.equal(field(batch([err()], { sid: SID.slice(1) })), 'sid');
  assert.equal(field(batch([err()], { v: 2 })), 'v');
  assert.equal(field('not json'), 'body');
  assert.equal(field('[]'), 'body');
});

test('8 error kinds are a plain class name or _OTHER', () => {
  accepts(batch([err({ kind: '_OTHER' })]));
  accepts(batch([err({ level: 'lvl-a' })]));
  for (const kind of ['Type Error', 'a'.repeat(41), '', 5]) assert.equal(field(batch([err({ kind })])), 'kind', String(kind));
  assert.equal(errorKind(new RangeError('x')), 'RangeError');
  assert.equal(errorKind('str'), '_OTHER');
  assert.equal(errorKind(undefined), '_OTHER');
});
