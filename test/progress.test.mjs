// Progress record: sanitize, migrate, record a completion, merge, totals.
// Spec: docs/FOUNDATION.md §2.5, §3 Progress, §4 and §6 F4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_VERSION,
  MIGRATIONS,
  cardTotals,
  emptyProgress,
  mergeProgress,
  migrate,
  recordCompletion,
  sanitizeProgress,
  starTotals,
} from '../lib/progress.mjs';

// Hand-written §2.4 registry (F4 does not import lib/registry.mjs).
function level(id, extra = {}) {
  return Object.freeze({ id, actId: 'a0', kind: 'level', scored: true, cards: Object.freeze([]), ...extra });
}
const REG = Object.freeze({
  acts: Object.freeze([
    Object.freeze({ id: 'a0', no: 0, name: 'A0', sub: '', levelIds: Object.freeze(['a', 'b', 'u']), bossId: null }),
  ]),
  levels: Object.freeze(Object.assign(Object.create(null), {
    a: level('a', { cards: Object.freeze(['c1', 'c2']) }),
    b: level('b'),
    u: level('u', { scored: false }),
  })),
  order: Object.freeze(['a', 'b', 'u']),
  cardIds: Object.freeze(['c1', 'c2']),
});
const IDS = { levelIds: REG.order, cardIds: REG.cardIds };
const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';
const T3 = '2026-03-01T00:00:00.000Z';

// Structural view (drops prototypes) so plain-object literals can be compared.
const plain = (x) => JSON.parse(JSON.stringify(x));
const raw = (levels, cards) => ({ v: 1, levels, ...(cards === undefined ? {} : { cards }) });
const P = (levels = {}, cards = []) => sanitizeProgress(raw(levels, cards));
const stars = (p) => Object.fromEntries(Object.entries(p.levels).map(([k, e]) => [k, e.stars]));

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

// ---- constants and empty ----

test('version constants and the empty record', () => {
  assert.equal(CURRENT_VERSION, 1);
  assert.deepEqual(plain(MIGRATIONS), {});
  const e = emptyProgress();
  assert.deepEqual(plain(e), { v: 1, levels: {}, cards: [] });
  assert.equal(Object.getPrototypeOf(e.levels), null);
  assert.notEqual(emptyProgress().levels, e.levels, 'a new record every call');
});

// ---- sanitizeProgress ----

test('sanitize: not a plain object, or levels not a plain object, gives the empty record', () => {
  for (const bad of [null, undefined, 'x', 42, [], { v: 1, levels: [] }, { v: 1 }, { v: 1, levels: 'x' }, new Date(0)]) {
    assert.deepEqual(plain(sanitizeProgress(bad)), plain(emptyProgress()), `input ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(plain(sanitizeProgress({ v: 1, levels: {} })), { v: 1, levels: {}, cards: [] }, 'missing cards → []');
});

test('sanitize: stars are floored and clamped to 0..3', () => {
  const p = P({ a: { stars: 2.7, at: null }, b: { stars: 5, at: null }, u: { stars: -1, at: null } });
  assert.deepEqual(stars(p), { a: 2, b: 3, u: 0 });
});

test('sanitize: non-finite or non-number stars drop the entry', () => {
  for (const s of [NaN, Infinity, '3', null, undefined, true]) {
    const p = P({ a: { stars: s, at: null } });
    assert.deepEqual(Object.keys(p.levels), [], `stars ${String(s)}`);
  }
  assert.deepEqual(Object.keys(P({ a: { at: null } }).levels), [], 'missing stars');
  assert.deepEqual(Object.keys(P({ a: 3 }).levels), [], 'entry not an object');
});

test('sanitize: __proto__, constructor and prototype keys are ignored; levels has no prototype', () => {
  const p = sanitizeProgress(JSON.parse(
    '{"v":1,"levels":{"__proto__":{"stars":3,"at":null},"constructor":{"stars":3,"at":null},"prototype":{"stars":3,"at":null}}}',
  ));
  assert.deepEqual(Object.keys(p.levels), []);
  assert.equal(Object.getPrototypeOf(p.levels), null);
  assert.equal(({}).stars, undefined, 'Object.prototype not polluted');
});

test('sanitize: unknown ids are dropped with levelIds/cardIds and kept without', () => {
  const r = raw({ a: { stars: 1, at: null }, zz: { stars: 2, at: null } }, ['c1', 'zz']);
  assert.deepEqual(Object.keys(sanitizeProgress(r, IDS).levels), ['a']);
  assert.deepEqual(sanitizeProgress(r, IDS).cards, ['c1']);
  assert.deepEqual(Object.keys(sanitizeProgress(r).levels), ['a', 'zz']);
  assert.deepEqual(sanitizeProgress(r).cards, ['c1', 'zz']);
});

test('sanitize: cards are valid id strings only, deduped and sorted', () => {
  assert.deepEqual(sanitizeProgress(raw({}, ['c2', 'c1', 'c1', 'zz', 7]), IDS).cards, ['c1', 'c2']);
  assert.deepEqual(sanitizeProgress(raw({}, ['c2', 'c1', 'c1', 'Bad Id', 7, null])).cards, ['c1', 'c2']);
  assert.deepEqual(sanitizeProgress(raw({}, 'c1')).cards, [], 'cards not an array');
});

test('sanitize: at is normalized to ISO UTC or null', () => {
  const at = (v) => P({ a: { stars: 1, at: v } }).levels.a.at;
  assert.equal(at('2026-10-30T10:00:00Z'), '2026-10-30T10:00:00.000Z');
  assert.equal(at('yesterday'), null);
  assert.equal(at(5), null);
  assert.equal(at(null), null);
  assert.equal(P({ a: { stars: 1 } }).levels.a.at, null, 'missing at');
});

test('sanitize: a malformed id is dropped, never cleaned into a real one', () => {
  const r = raw({ 'naming-your-service<x>': { stars: 3, at: null } });
  const p = sanitizeProgress(r, { levelIds: ['naming-your-service'], cardIds: [] });
  assert.deepEqual(plain(p.levels), {});
  assert.deepEqual(plain(sanitizeProgress(r).levels), {});
  assert.deepEqual(plain(sanitizeProgress(raw({ 'A': { stars: 1, at: null } })).levels), {}, 'upper case dropped');
});

test('sanitize: ids over 64 chars are dropped; caps keep the first 500 by sorted id', () => {
  const long = 'a'.repeat(65);
  assert.deepEqual(Object.keys(P({ [long]: { stars: 1, at: null }, ['b'.repeat(64)]: { stars: 1, at: null } }).levels), ['b'.repeat(64)]);
  const many = {};
  const cards = [];
  for (let i = 599; i >= 0; i--) {
    const id = `l${String(i).padStart(3, '0')}`;
    many[id] = { stars: 1, at: null };
    cards.push(`c${String(i).padStart(3, '0')}`);
  }
  const p = sanitizeProgress(raw(many, cards));
  const keys = Object.keys(p.levels);
  assert.equal(keys.length, 500);
  assert.equal(keys[0], 'l000');
  assert.equal(keys[499], 'l499');
  assert.equal(p.cards.length, 500);
  assert.equal(p.cards[499], 'c499');
});

test('sanitize: never mutates (frozen input) and never throws', () => {
  const r = deepFreeze(raw({ a: { stars: 2.5, at: '2026-10-30T10:00:00Z' }, zz: { stars: 1, at: null } }, ['c2', 'c1']));
  const before = JSON.stringify(r);
  const p = sanitizeProgress(r, IDS);
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual(plain(p), { v: 1, levels: { a: { stars: 2, at: '2026-10-30T10:00:00.000Z' } }, cards: ['c1', 'c2'] });
  const hostile = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
  assert.deepEqual(plain(sanitizeProgress(hostile)), plain(emptyProgress()));
});

test('sanitize: output is a fresh record, never the input', () => {
  const r = raw({ a: { stars: 1, at: null } }, ['c1']);
  const p = sanitizeProgress(r);
  assert.notEqual(p.levels, r.levels);
  assert.notEqual(p.levels.a, r.levels.a);
  assert.notEqual(p.cards, r.cards);
});

// ---- migrate ----

test('migrate: steps v n → n+1 up to current, leaves current alone, a gap is null (corrupt)', () => {
  const opts = { current: 2, migrations: { 1: (r) => ({ ...r, v: 2, x: 1 }) } };
  assert.deepEqual(migrate({ v: 1 }, opts), { v: 2, x: 1 });
  assert.deepEqual(migrate({ v: 2 }, opts), { v: 2 });
  assert.equal(migrate({ v: 1 }, { current: 3, migrations: opts.migrations }), null, 'no 2 → 3 step');
  assert.equal(migrate({ v: 0 }, opts), null, 'no 0 → 1 step');
  assert.equal(migrate({ v: 1 }, { current: 2, migrations: { 1: (r) => ({ ...r, v: 1 }) } }), null, 'step must advance v');
  assert.equal(migrate({ v: 1 }, { current: 2, migrations: { 1: () => { throw new Error('x'); } } }), null);
  assert.equal(migrate({ v: '1' }, opts), null, 'v not an integer');
  assert.equal(migrate({}, opts), null, 'v missing');
  const frozen = Object.freeze({ v: 1 });
  migrate(frozen, opts);
  assert.deepEqual(frozen, { v: 1 });
});

test('migrate: defaults to CURRENT_VERSION and MIGRATIONS', () => {
  assert.deepEqual(migrate({ v: 1, levels: {} }), { v: 1, levels: {} });
});

// ---- recordCompletion ----

test('recordCompletion: first completion keeps only the level\'s cards and reports what is new', () => {
  const r = recordCompletion(emptyProgress(), 'a', { stars: 2, cards: ['c1', 'zz'], at: T1 }, REG);
  assert.deepEqual(plain(r.progress), { v: 1, levels: { a: { stars: 2, at: T1 } }, cards: ['c1'] });
  assert.equal(r.firstCompletion, true);
  assert.equal(r.newBest, true);
  assert.deepEqual(r.newCards, ['c1']);
});

test('recordCompletion: never downgrades stars or the first-completion time', () => {
  const p1 = recordCompletion(emptyProgress(), 'a', { stars: 2, cards: ['c1'], at: T1 }, REG).progress;
  const r2 = recordCompletion(p1, 'a', { stars: 1, cards: [], at: T2 }, REG);
  assert.deepEqual(plain(r2.progress.levels.a), { stars: 2, at: T1 });
  assert.equal(r2.firstCompletion, false);
  assert.equal(r2.newBest, false);
  assert.deepEqual(r2.progress.cards, ['c1'], 'cards never dropped');
  const r3 = recordCompletion(r2.progress, 'a', { stars: 3, cards: ['c2'], at: T3 }, REG);
  assert.deepEqual(plain(r3.progress.levels.a), { stars: 3, at: T1 });
  assert.equal(r3.newBest, true);
  assert.deepEqual(r3.newCards, ['c2']);
  assert.deepEqual(r3.progress.cards, ['c1', 'c2']);
});

test('recordCompletion: the same call twice is idempotent', () => {
  const done = { stars: 2, cards: ['c1'], at: T1 };
  const once = recordCompletion(emptyProgress(), 'a', done, REG);
  const twice = recordCompletion(once.progress, 'a', done, REG);
  assert.deepEqual(plain(twice.progress), plain(once.progress));
  assert.deepEqual(twice.newCards, []);
  assert.equal(twice.firstCompletion, false);
  assert.equal(twice.newBest, false);
});

test('recordCompletion: stars 0 is a completion; stars are clamped; at is normalized', () => {
  const r = recordCompletion(emptyProgress(), 'b', { stars: 0, cards: [], at: null }, REG);
  assert.deepEqual(plain(r.progress.levels), { b: { stars: 0, at: null } });
  assert.equal(r.firstCompletion, true);
  const r7 = recordCompletion(emptyProgress(), 'b', { stars: 7, at: '2026-10-30T10:00:00Z' }, REG);
  assert.deepEqual(plain(r7.progress.levels.b), { stars: 3, at: '2026-10-30T10:00:00.000Z' });
  assert.deepEqual(r7.progress.cards, [], 'missing cards → none');
});

test('recordCompletion: an unknown level or unusable stars returns the progress unchanged', () => {
  const p = P({ a: { stars: 1, at: T1 } }, ['c1']);
  const none = { firstCompletion: false, newBest: false, newCards: [] };
  for (const [id, stars] of [['zz', 3], ['__proto__', 3], ['constructor', 3], ['a', NaN], ['b', '3']]) {
    const r = recordCompletion(p, id, { stars, cards: ['c2'], at: T2 }, REG);
    assert.equal(r.progress, p, `${id}/${String(stars)}`);
    assert.deepEqual({ firstCompletion: r.firstCompletion, newBest: r.newBest, newCards: r.newCards }, none);
  }
});

test('recordCompletion: never mutates its input', () => {
  const p = deepFreeze(P({ a: { stars: 1, at: T1 } }, ['c1']));
  const before = JSON.stringify(p);
  const r = recordCompletion(p, 'a', { stars: 3, cards: ['c2'], at: T2 }, REG);
  assert.equal(JSON.stringify(p), before);
  assert.notEqual(r.progress, p);
});

// ---- mergeProgress ----

const A = P({ a: { stars: 2, at: T2 }, b: { stars: 0, at: null } }, ['c1']);
const B = P({ a: { stars: 1, at: T1 }, u: { stars: 0, at: null } }, ['c2']);
const C = P({ b: { stars: 3, at: T3 }, u: { stars: 1, at: T2 } }, ['c2', 'c3']);

test('merge: best stars and earliest at per field, union of entries and cards', () => {
  assert.deepEqual(plain(mergeProgress(A, B)), {
    v: 1,
    levels: { a: { stars: 2, at: T1 }, b: { stars: 0, at: null }, u: { stars: 0, at: null } },
    cards: ['c1', 'c2'],
  });
  assert.equal(Object.getPrototypeOf(mergeProgress(A, B).levels), null);
});

test('merge: a null at never beats a date', () => {
  const x = P({ a: { stars: 1, at: null } });
  const y = P({ a: { stars: 1, at: T3 } });
  assert.equal(mergeProgress(x, y).levels.a.at, T3);
  assert.equal(mergeProgress(y, x).levels.a.at, T3);
});

test('merge: commutative, idempotent, associative', () => {
  const eq = (x, y, msg) => assert.deepEqual(plain(x), plain(y), msg);
  eq(mergeProgress(A, B), mergeProgress(B, A), 'A∪B');
  eq(mergeProgress(A, C), mergeProgress(C, A), 'A∪C');
  eq(mergeProgress(B, C), mergeProgress(C, B), 'B∪C');
  for (const X of [A, B, C]) eq(mergeProgress(X, X), X, 'idempotent');
  eq(mergeProgress(mergeProgress(A, B), C), mergeProgress(A, mergeProgress(B, C)), 'associative');
  eq(mergeProgress(mergeProgress(C, A), B), mergeProgress(C, mergeProgress(A, B)), 'associative');
});

test('merge: never mutates either side', () => {
  const a = deepFreeze(P({ a: { stars: 1, at: T2 } }, ['c1']));
  const b = deepFreeze(P({ a: { stars: 3, at: T1 } }, ['c2']));
  const m = mergeProgress(a, b);
  assert.equal(a.levels.a.stars, 1);
  assert.notEqual(m.levels.a, a.levels.a);
  assert.notEqual(m.levels.a, b.levels.a);
});

// ---- totals ----

test('starTotals counts scored registered levels only, on both sides', () => {
  assert.deepEqual(starTotals(P({ a: { stars: 2, at: null }, u: { stars: 0, at: null } }), REG), { earned: 2, max: 6 });
  assert.deepEqual(starTotals(P({ u: { stars: 3, at: null }, zz: { stars: 3, at: null } }), REG), { earned: 0, max: 6 });
  assert.deepEqual(starTotals(emptyProgress(), REG), { earned: 0, max: 6 });
});

test('cardTotals counts the registered levels\' card union', () => {
  assert.deepEqual(cardTotals(P({}, ['c1']), REG), { earned: 1, max: 2 });
  assert.deepEqual(cardTotals(P({}, ['c1', 'zz']), REG), { earned: 1, max: 2 }, 'unknown card not earned');
  assert.deepEqual(cardTotals(emptyProgress(), REG), { earned: 0, max: 2 });
});

test('reads award nothing: sanitize and totals leave stars and cards as stored', () => {
  const r = raw({ b: { stars: 0, at: null } }, []);
  const p = sanitizeProgress(r, IDS);
  assert.deepEqual(plain(p), { v: 1, levels: { b: { stars: 0, at: null } }, cards: [] });
  starTotals(p, REG);
  cardTotals(p, REG);
  assert.deepEqual(plain(p), { v: 1, levels: { b: { stars: 0, at: null } }, cards: [] });
});
