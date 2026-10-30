// Safe localStorage access: every absence case keeps its own status, saves merge with
// what is stored, corrupt data is backed up, future data is never overwritten.
// Spec: docs/FOUNDATION.md §3 Concurrency, §4 Absence table and §6 F4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORRUPT_KEY, CORRUPT_LATEST_KEY, STORAGE_KEY, loadProgress, saveProgress } from '../lib/storage.mjs';
import { emptyProgress, sanitizeProgress } from '../lib/progress.mjs';
import { fakeStorage } from './helpers/fake-storage.mjs';

const REG = Object.freeze({
  acts: Object.freeze([
    Object.freeze({ id: 'a0', no: 0, name: 'A0', sub: '', levelIds: Object.freeze(['a', 'b']), bossId: null }),
  ]),
  levels: Object.freeze(Object.assign(Object.create(null), {
    a: Object.freeze({ id: 'a', actId: 'a0', kind: 'level', scored: true, cards: Object.freeze(['c1']) }),
    b: Object.freeze({ id: 'b', actId: 'a0', kind: 'level', scored: true, cards: Object.freeze([]) }),
  })),
  order: Object.freeze(['a', 'b']),
  cardIds: Object.freeze(['c1']),
});

const plain = (x) => JSON.parse(JSON.stringify(x));
const EMPTY = plain(emptyProgress());
const json = (levels, cards = [], v = 1) => JSON.stringify({ v, levels, cards });
const lv = (stars) => ({ stars, at: null });
const P = (levels, cards = []) => sanitizeProgress({ v: 1, levels, cards });
const getter = (s) => () => s;
const stored = (s) => JSON.parse(s.data.get(STORAGE_KEY));

test('storage keys', () => {
  assert.equal(STORAGE_KEY, 'oncall.progress');
  assert.equal(CORRUPT_KEY, 'oncall.progress.corrupt');
  assert.equal(CORRUPT_LATEST_KEY, 'oncall.progress.corrupt.latest');
});

// ---- loadProgress ----

test('load: nothing stored is fresh', () => {
  const r = loadProgress(getter(fakeStorage()), REG);
  assert.equal(r.status, 'fresh');
  assert.deepEqual(plain(r.progress), EMPTY);
});

test('load: a v1 record is ok and filtered to the registry for memory', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: json({ a: lv(2), zz: lv(3) }, ['c1', 'c9']) } });
  const r = loadProgress(getter(s), REG);
  assert.equal(r.status, 'ok');
  assert.deepEqual(plain(r.progress), { v: 1, levels: { a: { stars: 2, at: null } }, cards: ['c1'] });
  assert.deepEqual(s.sets, [], 'a read never writes');
});

test('load: corrupt values are corrupt, never fresh, with empty memory', () => {
  for (const bad of ['{bad', '[]', '{"levels":{}}', 'null', '42', '"x"', '{"v":"1","levels":{}}', '{"v":1.5,"levels":{}}', '{"v":0,"levels":{}}', '{"v":1,"levels":[]}']) {
    const s = fakeStorage({ initial: { [STORAGE_KEY]: bad } });
    const r = loadProgress(getter(s), REG);
    assert.equal(r.status, 'corrupt', bad);
    assert.deepEqual(plain(r.progress), EMPTY, bad);
    assert.deepEqual(s.sets, [], `${bad}: a read never writes`);
  }
});

test('load: a newer version is future, with a best-effort sanitized view', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: json({ a: lv(3), zz: lv(1) }, ['c1'], 99) } });
  const r = loadProgress(getter(s), REG);
  assert.equal(r.status, 'future');
  assert.deepEqual(plain(r.progress), { v: 1, levels: { a: { stars: 3, at: null } }, cards: ['c1'] });
});

test('load: a throwing getter, a missing storage or a throwing getItem is unavailable', () => {
  const cases = [
    () => { throw new Error('SecurityError'); },
    () => undefined,
    getter(fakeStorage({ throwOn: ['getItem'] })),
  ];
  for (const g of cases) {
    const r = loadProgress(g, REG);
    assert.equal(r.status, 'unavailable');
    assert.deepEqual(plain(r.progress), EMPTY);
  }
});

// ---- saveProgress ----

test('save: merges with what is stored (read, merge, write) and returns what it wrote', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: json({ a: lv(2) }) } });
  const r = saveProgress(getter(s), P({ a: lv(1), b: lv(3) }), REG);
  assert.equal(r.saved, true);
  assert.equal(r.reason, undefined);
  assert.deepEqual(stored(s).levels, { a: { stars: 2, at: null }, b: { stars: 3, at: null } });
  assert.deepEqual(plain(r.progress), stored(s));
  assert.equal(s.sets.length, 1);
});

test('save: fresh storage gets the memory record', () => {
  const s = fakeStorage();
  const r = saveProgress(getter(s), P({ b: lv(0) }, ['c1']), REG);
  assert.equal(r.saved, true);
  assert.deepEqual(stored(s), { v: 1, levels: { b: { stars: 0, at: null } }, cards: ['c1'] });
});

test('save: ids this build does not know survive in storage but never reach memory', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: json({ zz: lv(3), 'old-level': lv(1) }, ['c9']) } });
  const r = saveProgress(getter(s), P({ a: lv(1), yy: lv(2) }, ['c1', 'c8']), REG);
  assert.equal(r.saved, true);
  assert.deepEqual(Object.keys(stored(s).levels).sort(), ['a', 'old-level', 'yy', 'zz']);
  assert.deepEqual(stored(s).cards, ['c1', 'c8', 'c9']);
  assert.deepEqual(plain(r.progress), { v: 1, levels: { a: { stars: 1, at: null } }, cards: ['c1'] });
});

test('save: the written record keeps at most 500 entries, the first by sorted id', () => {
  const side = (prefix) => {
    const levels = {};
    for (let i = 0; i < 500; i++) levels[`${prefix}${String(i).padStart(3, '0')}`] = lv(1);
    return levels;
  };
  const s = fakeStorage({ initial: { [STORAGE_KEY]: json(side('a')) } });
  saveProgress(getter(s), P(side('z')), REG);
  const keys = Object.keys(stored(s).levels).sort();
  assert.equal(keys.length, 500);
  assert.deepEqual(keys, Object.keys(side('a')).sort());
});

test('save: a throwing setItem, getItem or getter is unavailable', () => {
  const memory = P({ a: lv(1), zz: lv(2) });
  for (const g of [
    getter(fakeStorage({ throwOn: ['setItem'] })),
    getter(fakeStorage({ throwOn: ['getItem'] })),
    () => { throw new Error('SecurityError'); },
  ]) {
    const r = saveProgress(g, memory, REG);
    assert.deepEqual({ saved: r.saved, reason: r.reason }, { saved: false, reason: 'unavailable' });
    assert.deepEqual(plain(r.progress), { v: 1, levels: { a: { stars: 1, at: null } }, cards: [] }, 'memory, filtered');
  }
});

test('save: future data is never overwritten (zero setItem calls)', () => {
  const raw = json({ a: lv(1) }, [], 99);
  const s = fakeStorage({ initial: { [STORAGE_KEY]: raw } });
  const memory = P({ a: lv(3), zz: lv(1) });
  const r = saveProgress(getter(s), memory, REG);
  assert.deepEqual({ saved: r.saved, reason: r.reason }, { saved: false, reason: 'future' });
  assert.deepEqual(plain(r.progress), { v: 1, levels: { a: { stars: 3, at: null } }, cards: [] }, 'memory, filtered');
  assert.equal(s.sets.length, 0);
  assert.equal(s.data.get(STORAGE_KEY), raw);
});

test('save: every corrupt value is copied once before the progress write; the first copy is kept', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: '{bad' } });
  const r = saveProgress(getter(s), P({ a: lv(2) }), REG);
  assert.equal(r.saved, true);
  assert.deepEqual(s.sets.map(([k]) => k), [CORRUPT_KEY, STORAGE_KEY], 'first corrupt value: one copy');
  assert.equal(s.data.get(CORRUPT_KEY), '{bad');
  assert.equal(s.data.has(CORRUPT_LATEST_KEY), false);
  assert.deepEqual(stored(s).levels, { a: { stars: 2, at: null } });

  s.data.set(STORAGE_KEY, '[]');
  saveProgress(getter(s), P({ b: lv(1) }), REG);
  assert.equal(s.data.get(CORRUPT_KEY), '{bad', 'the first corrupt value is kept');
  assert.equal(s.data.get(CORRUPT_LATEST_KEY), '[]', 'a different corrupt value is copied to latest');
  assert.deepEqual(s.sets.map(([k]) => k).slice(2), [CORRUPT_LATEST_KEY, STORAGE_KEY]);

  s.data.set(STORAGE_KEY, '{bad');
  saveProgress(getter(s), P({ b: lv(1) }), REG);
  assert.deepEqual(s.sets.map(([k]) => k).slice(4), [STORAGE_KEY], 'a value already in CORRUPT_KEY is not copied again');
  assert.equal(s.data.get(CORRUPT_LATEST_KEY), '[]');
});

test('save: a registered completion is never evicted by the cap (levels and cards)', () => {
  const reg = Object.freeze({
    ...REG,
    levels: Object.freeze(Object.assign(Object.create(null), {
      ...REG.levels,
      'zzz-final': Object.freeze({ id: 'zzz-final', actId: 'a0', kind: 'level', scored: true, cards: Object.freeze(['zzz-card']) }),
    })),
    order: Object.freeze([...REG.order, 'zzz-final']),
    cardIds: Object.freeze([...REG.cardIds, 'zzz-card']),
  });
  const levels = {};
  const cards = [];
  for (let i = 0; i < 500; i++) {
    levels[`a${String(i).padStart(4, '0')}`] = lv(1);
    cards.push(`ac${String(i).padStart(4, '0')}`);
  }
  const s = fakeStorage({ initial: { [STORAGE_KEY]: json(levels, cards) } });
  const r = saveProgress(getter(s), P({ 'zzz-final': lv(3) }, ['zzz-card']), reg);
  assert.equal(r.saved, true);
  assert.deepEqual(stored(s).levels['zzz-final'], { stars: 3, at: null });
  assert.equal(Object.keys(stored(s).levels).length, 500);
  assert.equal(stored(s).levels.a0499, undefined, 'the last unknown id by sort makes room');
  assert.ok(stored(s).cards.includes('zzz-card'));
  assert.equal(stored(s).cards.length, 500);
  assert.deepEqual(plain(r.progress), { v: 1, levels: { 'zzz-final': { stars: 3, at: null } }, cards: ['zzz-card'] });
});

test('save: a missing or invalid registry throws TypeError before any read or write', () => {
  for (const bad of [undefined, null, {}, { order: ['a'] }]) {
    const s = fakeStorage({ initial: { [STORAGE_KEY]: json({ a: lv(1) }) } });
    let reads = 0;
    const g = () => { reads += 1; return s; };
    assert.throws(() => saveProgress(g, P({ a: lv(2) }), bad), TypeError);
    assert.equal(reads, 0, 'storage never touched');
    assert.deepEqual(s.sets, []);
  }
});

test('save: a failed latest-backup write aborts before the progress write', () => {
  const s = fakeStorage({
    initial: { [STORAGE_KEY]: '[]', [CORRUPT_KEY]: '{bad' },
    throwOn: [`setItem:${CORRUPT_LATEST_KEY}`],
  });
  const r = saveProgress(getter(s), P({ a: lv(2) }), REG);
  assert.deepEqual({ saved: r.saved, reason: r.reason }, { saved: false, reason: 'unavailable' });
  assert.deepEqual(s.sets.map(([k]) => k), [CORRUPT_LATEST_KEY]);
  assert.equal(s.data.get(STORAGE_KEY), '[]');
});

test('save: a failed backup write does not overwrite the corrupt data', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: '{bad' }, throwOn: ['setItem'] });
  const r = saveProgress(getter(s), P({ a: lv(2) }), REG);
  assert.deepEqual({ saved: r.saved, reason: r.reason }, { saved: false, reason: 'unavailable' });
  assert.deepEqual(s.sets.map(([k]) => k), [CORRUPT_KEY]);
  assert.equal(s.data.get(STORAGE_KEY), '{bad');
});
