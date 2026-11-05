// Blind strategies must not win any Sort it in the game (#186). Each rule below ignores what
// the labels mean and uses only a tell in how they look; if one sorts a spec perfectly the
// player can finish without knowing the concept. Specs come from the live registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';

// One wrong placement still earns 4 stars (lib/scoring.mjs), so a blind rule must cost at least two.
const MIN_WRONG = 2;

const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ');

/** Every Sort it spec, as { level, spec }, from declarative (play.steps) and hand-written (CONTENT.steps) levels. */
async function allSortSpecs() {
  const out = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const steps = mod.CONTENT?.steps ?? mod.default.play?.steps ?? [];
      for (const s of steps) if (s.sort) out.push({ level: level.id, spec: s.sort });
    }
  }
  return out;
}

/** How many items a rule places in the wrong bucket; `pick(item, i)` returns a bucket id. */
const mistakes = (spec, pick) => spec.items.filter((it, i) => pick(it, i) !== it.bucket).length;

/** Items ranked by label length, split into equal runs, one run per bucket (shortest run to the first bucket). */
function byLength(spec, dir) {
  const k = spec.buckets.length;
  const ranked = spec.items.map((it, i) => [it, i]).sort((a, b) => dir * (plain(a[0].label).length - plain(b[0].label).length));
  const rank = new Map(ranked.map(([it], r) => [it, r]));
  return mistakes(spec, (it) => spec.buckets[Math.floor((rank.get(it) * k) / spec.items.length)].id);
}

/** Items with `<code>` to the bucket at `codeIndex`, the rest to the other (two buckets only). */
function byCode(spec, codeIndex) {
  return mistakes(spec, (it) => spec.buckets[/<code>/.test(it.label) ? codeIndex : 1 - codeIndex].id);
}

/** A small seeded generator, so the shuffles are the same on every run. */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffles of the spec on which "put it in the emptier bucket" sorts everything right (ties to a random bucket). */
function balancedWins(spec, runs) {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const rand = rng(seed);
    const items = [...spec.items].sort(() => rand() - 0.5);
    const counts = Object.fromEntries(spec.buckets.map((b) => [b.id, 0]));
    let bad = 0;
    for (const it of items) {
      const low = Math.min(...Object.values(counts));
      const open = spec.buckets.filter((b) => counts[b.id] === low);
      const pick = open[Math.floor(rand() * open.length)].id;
      counts[pick]++;
      if (pick !== it.bucket) bad++;
    }
    if (bad === 0) wins++;
  }
  return wins;
}

test('Sort it: the registry has Sort it specs to check', async () => {
  const specs = await allSortSpecs();
  assert.equal(specs.length >= 10, true, `found ${specs.length}`);
});

test('Sort it: "short labels to one bucket, long to the other" never earns 4 stars', async () => {
  for (const { level, spec } of await allSortSpecs()) {
    for (const dir of [1, -1]) {
      const wrong = byLength(spec, dir);
      assert.equal(wrong >= MIN_WRONG, true, `${level} ${spec.id}: label length alone gets ${wrong} wrong (${dir > 0 ? 'short' : 'long'} first)`);
    }
  }
});

test('Sort it: "the items with code formatting go in one bucket" never earns 4 stars', async () => {
  for (const { level, spec } of await allSortSpecs()) {
    if (spec.buckets.length !== 2) continue;
    for (const codeIndex of [0, 1]) {
      const wrong = byCode(spec, codeIndex);
      assert.equal(wrong >= MIN_WRONG, true, `${level} ${spec.id}: <code> alone gets ${wrong} wrong (to bucket ${codeIndex})`);
    }
  }
});

test('Sort it: "keep the buckets balanced" wins a spec on at most 1 shuffle in 10', async () => {
  const runs = 200;
  for (const { level, spec } of await allSortSpecs()) {
    const wins = balancedWins(spec, runs);
    assert.equal(wins <= runs / 10, true, `${level} ${spec.id}: balancing sorts it right on ${wins} of ${runs} shuffles`);
  }
});
