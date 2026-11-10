// Incident sparks (#309 P3): the pure schedule in lib/globe-sparks.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPARK, sparkSources, sparksAt } from '../lib/globe-sparks.mjs';

const run = (seed, n = 100, from = 0, to = 600, step = 0.05) => {
  const frames = [];
  for (let i = 0; from + i * step <= to; i++) frames.push([from + i * step, sparksAt(from + i * step, n, seed)]);
  return frames;
};

test('sparkSources lists the indices of the pulsing dots, in order', () => {
  assert.deepEqual([...sparkSources(Uint8Array.from([0, 2, 1, 2, 4, 3, 2]))], [1, 3, 6]);
  assert.deepEqual([...sparkSources(Uint8Array.from([0, 1, 4, 3]))], []);
});

test('the same time and seed always give the same sparks; another seed gives others', () => {
  const a = run(7, 100, 0, 120);
  const b = run(7, 100, 0, 120);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, run(8, 100, 0, 120));
  assert.deepEqual(sparksAt(33.3, 50, 1), sparksAt(33.3, 50, 1));
});

test('never more than SLOTS live sparks, each slot once, sorted by slot, dot in range', () => {
  for (const [, sparks] of run(0, 100)) {
    assert.ok(sparks.length <= SPARK.SLOTS);
    const slots = sparks.map((s) => s.slot);
    assert.equal(new Set(slots).size, slots.length);
    assert.deepEqual(slots, [...slots].sort((x, y) => x - y));
    for (const s of sparks) assert.ok(Number.isInteger(s.dot) && s.dot >= 0 && s.dot < 100);
  }
});

test('about 0.75 births a second: 300 to 600 in 600 s, one in every 30 s window, a slot never twice within LIFE', () => {
  const births = new Map();
  for (const [t, sparks] of run(0)) {
    for (const s of sparks) {
      const born = t - s.age * SPARK.LIFE;
      const list = births.get(s.slot) ?? [];
      if (!list.some((b) => Math.abs(b - born) < 1e-6)) list.push(born);
      births.set(s.slot, list);
    }
  }
  const all = [...births.values()].flat().sort((x, y) => x - y);
  assert.ok(all.length >= 300 && all.length <= 600, `births ${all.length}`);
  for (let w = 0; w < 600; w += 30) assert.ok(all.some((b) => b >= w && b < w + 30), `window ${w}`);
  for (const list of births.values()) {
    list.sort((x, y) => x - y);
    for (let i = 1; i < list.length; i++) assert.ok(list[i] - list[i - 1] >= SPARK.LIFE - 1e-6);
  }
});

test('age is in [0, 1) and a spark outlives no period', () => {
  assert.ok(SPARK.LIFE < SPARK.PERIOD);
  let seen = 0;
  for (const [, sparks] of run(3)) for (const s of sparks) { seen++; assert.ok(s.age >= 0 && s.age < 1); }
  assert.ok(seen > 0);
});

test('no dots gives no sparks; a huge time gives no backlog', () => {
  assert.deepEqual(sparksAt(10, 0), []);
  assert.ok(sparksAt(1e6, 100).length <= SPARK.SLOTS);
});
