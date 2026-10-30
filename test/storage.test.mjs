// Safe localStorage access: every absence case keeps its own status, saves merge with
// what is stored, corrupt data is backed up, future data is never overwritten.
// Spec: docs/FOUNDATION.md §3 Concurrency, §4 Absence table and §6 F4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORRUPT_KEY, STORAGE_KEY, loadProgress, saveProgress } from '../lib/storage.mjs';
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
  const r = saveProgress(getter(s), P({ a: lv(1), b: lv(3) }));
  assert.equal(r.saved, true);
  assert.equal(r.reason, undefined);
  assert.deepEqual(stored(s).levels, { a: { stars: 2, at: null }, b: { stars: 3, at: null } });
  assert.deepEqual(plain(r.progress), stored(s));
  assert.equal(s.sets.length, 1);
});

test('save: fresh storage gets the memory record', () => {
  const s = fakeStorage();
  const r = saveProgress(getter(s), P({ b: lv(0) }, ['c1']));
  assert.equal(r.saved, true);
  assert.deepEqual(stored(s), { v: 1, levels: { b: { stars: 0, at: null } }, cards: ['c1'] });
});

test('save: ids this build does not know survive in storage', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: json({ zz: lv(3), 'old-level': lv(1) }, ['c9']) } });
  saveProgress(getter(s), P({ a: lv(1) }, ['c1']));
  assert.deepEqual(Object.keys(stored(s).levels).sort(), ['a', 'old-level', 'zz']);
  assert.deepEqual(stored(s).cards, ['c1', 'c9']);
});

test('save: a throwing setItem, getItem or getter is unavailable', () => {
  const memory = P({ a: lv(1) });
  for (const g of [
    getter(fakeStorage({ throwOn: ['setItem'] })),
    getter(fakeStorage({ throwOn: ['getItem'] })),
    () => { throw new Error('SecurityError'); },
  ]) {
    const r = saveProgress(g, memory);
    assert.deepEqual({ saved: r.saved, reason: r.reason }, { saved: false, reason: 'unavailable' });
    assert.equal(r.progress, memory, 'memory is returned untouched');
  }
});

test('save: future data is never overwritten (zero setItem calls)', () => {
  const raw = json({ a: lv(1) }, [], 99);
  const s = fakeStorage({ initial: { [STORAGE_KEY]: raw } });
  const memory = P({ a: lv(3) });
  const r = saveProgress(getter(s), memory);
  assert.deepEqual({ saved: r.saved, reason: r.reason }, { saved: false, reason: 'future' });
  assert.equal(r.progress, memory);
  assert.equal(s.sets.length, 0);
  assert.equal(s.data.get(STORAGE_KEY), raw);
});

test('save: corrupt data is backed up before the progress write, and the first backup is kept', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: '{bad' } });
  const r = saveProgress(getter(s), P({ a: lv(2) }));
  assert.equal(r.saved, true);
  assert.deepEqual(s.sets.map(([k]) => k), [CORRUPT_KEY, STORAGE_KEY]);
  assert.equal(s.data.get(CORRUPT_KEY), '{bad');
  assert.deepEqual(stored(s).levels, { a: { stars: 2, at: null } });

  s.data.set(STORAGE_KEY, '[]');
  saveProgress(getter(s), P({ b: lv(1) }));
  assert.equal(s.data.get(CORRUPT_KEY), '{bad', 'second corrupt value does not overwrite the backup');
  assert.deepEqual(s.sets.map(([k]) => k), [CORRUPT_KEY, STORAGE_KEY, STORAGE_KEY]);
});

test('save: a failed backup write does not overwrite the corrupt data', () => {
  const s = fakeStorage({ initial: { [STORAGE_KEY]: '{bad' }, throwOn: ['setItem'] });
  const r = saveProgress(getter(s), P({ a: lv(2) }));
  assert.deepEqual({ saved: r.saved, reason: r.reason }, { saved: false, reason: 'unavailable' });
  assert.deepEqual(s.sets.map(([k]) => k), [CORRUPT_KEY]);
  assert.equal(s.data.get(STORAGE_KEY), '{bad');
});
