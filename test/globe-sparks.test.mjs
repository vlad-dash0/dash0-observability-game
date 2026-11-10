// Incident sparks (#309 P3): the pure schedule in lib/globe-sparks.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BURST, SPARK, burstDir, burstSpeed, sparkSources, sparksAt, tangentFrame } from '../lib/globe-sparks.mjs';

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

test('a burst fans out: unit directions in a cone round the outward normal, spread apart, each deterministic', () => {
  const cone = Math.cos(BURST.CONE);
  for (let slot = 0; slot < SPARK.SLOTS; slot++) {
    for (const epoch of [-3, 0, 41]) {
      const dirs = Array.from({ length: BURST.COUNT }, (_, j) => burstDir(slot, epoch, 9, j));
      for (const [j, d] of dirs.entries()) {
        assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9, 'unit length');
        assert.ok(d[2] >= cone - 1e-9 && d[2] < 1, 'inside the cone, outward');
        assert.deepEqual(burstDir(slot, epoch, 9, j), d);
        const v = burstSpeed(slot, epoch, 9, j);
        assert.ok(v >= 0.7 && v <= 1);
      }
      // spread: the tangent angles fall in distinct sectors, so no two particles share a heading
      const sector = dirs.map((d) => Math.floor(((Math.atan2(d[1], d[0]) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / BURST.COUNT)));
      assert.deepEqual(sector, [...sector.keys()], 'particle j heads into sector j');
      assert.notDeepEqual(dirs[0], burstDir(slot, epoch, 10, 0), 'the seed changes it');
    }
  }
  assert.ok(BURST.COUNT >= 6 && BURST.COUNT <= 8);
  assert.ok(BURST.TRAVEL >= 0.15 && BURST.TRAVEL <= 0.25);
});

test('tangentFrame gives two unit tangents, orthogonal to the normal and each other, right-handed', () => {
  for (const raw of [[0, 0, 1], [0, 1, 0], [1, 0, 0], [0.3, -0.5, 0.8], [0, -0.99, 0.1]]) {
    const len = Math.hypot(...raw);
    const n = raw.map((v) => v / len);
    const [t1, t2] = tangentFrame(n);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    assert.ok(Math.abs(Math.hypot(...t1) - 1) < 1e-9 && Math.abs(Math.hypot(...t2) - 1) < 1e-9);
    assert.ok(Math.abs(dot(t1, n)) < 1e-9 && Math.abs(dot(t2, n)) < 1e-9 && Math.abs(dot(t1, t2)) < 1e-9);
    const cross = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
    cross.forEach((v, i) => assert.ok(Math.abs(v - n[i]) < 1e-9));
  }
});

test('every live spark carries its epoch, for the burst directions', () => {
  const [, sparks] = run(0).find(([, s]) => s.length > 0);
  for (const s of sparks) assert.ok(Number.isInteger(s.epoch));
});
