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

const len = (it) => plain(it.label).length;

/**
 * Fewest wrong placements any length rule gets. Two buckets: every cut between two distinct
 * lengths, shorter side to either bucket. More buckets: items ranked by length, cut into runs of
 * floor(n/k) or ceil(n/k), shortest run to the first bucket and the reverse.
 */
function bestByLength(spec) {
  const k = spec.buckets.length;
  const ids = spec.buckets.map((b) => b.id);
  const tries = [];
  if (k === 2) {
    const lengths = [...new Set(spec.items.map(len))].sort((a, b) => a - b);
    for (const cut of lengths.slice(1)) {
      for (const [short, long] of [ids, [...ids].reverse()]) tries.push((it) => (len(it) < cut ? short : long));
    }
  } else {
    for (const dir of [1, -1]) {
      const ranked = [...spec.items].sort((a, b) => dir * (len(a) - len(b)));
      const rank = new Map(ranked.map((it, r) => [it, r]));
      for (const size of new Set([Math.floor(spec.items.length / k), Math.ceil(spec.items.length / k)])) {
        tries.push((it) => ids[Math.min(k - 1, Math.floor(rank.get(it) / size))]);
      }
    }
  }
  return Math.min(...tries.map((pick) => mistakes(spec, pick)));
}

/** Tokens of a label with the markup stripped: lower-case words and %. A dotted key (service.name) is one token. */
const tokens = (it) =>
  new Set((plain(it.label).toLowerCase().match(/[a-z0-9][a-z0-9._-]*|%/g) ?? []).map((t) => t.replace(/[._-]+$/, '')));

/**
 * Fewest wrong placements any single-token rule gets on a two-bucket spec: every token found in
 * two or more labels (CLIENT, SERVER, %, "the" ...) sends the items with it to one bucket and the
 * rest to the other, either way round.
 */
function bestByToken(spec) {
  const ids = spec.buckets.map((b) => b.id);
  const sets = spec.items.map(tokens);
  const counts = new Map();
  for (const s of sets) for (const t of s) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best = { wrong: Infinity, token: null };
  for (const [token, n] of counts) {
    if (n < 2) continue;
    for (const [yes, no] of [ids, [...ids].reverse()]) {
      const wrong = mistakes(spec, (it) => (tokens(it).has(token) ? yes : no));
      if (wrong < best.wrong) best = { wrong, token };
    }
  }
  return best;
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
  // Independent of the spec walk: every level whose raw entry declares the sort mechanic must
  // yield a spec, so a level the walk cannot reach does not slip out of the checks.
  const specs = await allSortSpecs();
  const have = new Set(specs.map((s) => s.level));
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const steps = mod.CONTENT?.steps ?? mod.default.play?.steps ?? [];
      const declares = (mod.default.mechanics ?? []).includes('sort') || steps.some((s) => s.sort);
      if (declares) assert.equal(have.has(level.id), true, `${level.id} declares Sort it but yields no spec`);
    }
  }
  assert.equal(specs.length > 0, true);
});

test('Sort it: "short labels to one bucket, long to the other" never earns 4 stars', async () => {
  for (const { level, spec } of await allSortSpecs()) {
    const wrong = bestByLength(spec);
    assert.equal(wrong >= MIN_WRONG, true, `${level} ${spec.id}: some label-length cut gets ${wrong} wrong`);
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

test('Sort it: "a word or a % shared by labels goes to one bucket" never earns 4 stars', async () => {
  for (const { level, spec } of await allSortSpecs()) {
    if (spec.buckets.length !== 2) continue;
    const { wrong, token } = bestByToken(spec);
    assert.equal(wrong >= MIN_WRONG, true, `${level} ${spec.id}: the token "${token}" alone gets ${wrong} wrong`);
  }
});

test('Sort it: "keep the buckets balanced" wins a spec on at most 1 shuffle in 10', async () => {
  const runs = 200;
  for (const { level, spec } of await allSortSpecs()) {
    const wins = balancedWins(spec, runs);
    assert.equal(wins <= runs / 10, true, `${level} ${spec.id}: balancing sorts it right on ${wins} of ${runs} shuffles`);
  }
});
