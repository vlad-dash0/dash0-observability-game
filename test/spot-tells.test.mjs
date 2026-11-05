// Blind strategies must not win any Spot it board (#190). A rule below ignores what the lines
// say and ranks them by how long they are, or how many digits or words they hold; if it solves a
// board through the real checkSpot, first time or after one wrong Check, the player earns stars
// without reading. (Position rules: test/spot-ladder.test.mjs.) Specs
// come from the live registry, so a new Spot board is covered without editing this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';
import { checkSpot, newSpotState, toggleLine } from '../lib/widgets/spot-it.mjs';

/** Every Spot it spec, as { no, spec }, from declarative (play.steps) and hand-written (CONTENT.steps) levels. */
async function allSpotSpecs() {
  const out = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const byId = new Map();
      for (const s of [...(mod.default.play?.steps ?? []), ...(mod.CONTENT?.steps ?? [])]) if (s?.spot) byId.set(s.spot.id, s.spot);
      for (const spec of byId.values()) out.push({ no: mod.default.no, spec });
    }
  }
  return out;
}

/** Every way to order `list` (tie groups are small: the largest is one board's eight lines). */
function perms(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => perms([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

// Enough for every tie-break of every rule on the current boards (the largest is 8! = 40320);
// a board past it fails loudly instead of being sampled.
const MAX_RANKINGS = 50000;

/**
 * Every ranking of the line ids by `score` (highest first), ties broken every way: the
 * product of the orders of each group of equal scores.
 */
function rankings(spec, score) {
  const groups = new Map();
  for (const l of spec.lines) {
    const s = score(l);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(l.id);
  }
  let out = [[]];
  for (const s of [...groups.keys()].sort((a, b) => b - a)) {
    const orders = perms(groups.get(s));
    out = out.flatMap((head) => orders.map((o) => [...head, ...o]));
    if (out.length > MAX_RANKINGS) throw new Error(`${spec.id}: more than ${MAX_RANKINGS} tie-breaks`);
  }
  return out;
}

/**
 * Play a ranking blind, knowing only the answer count k, through the real toggleLine and
 * checkSpot. Check 1: the top k. If that is wrong, the player has learned which picks are
 * wrong (the feedback counts them and shows each one's whyNot), so Check 2 drops those and
 * adds as many next-ranked unpicked lines (one, if none was wrong). Returns the wrong Checks
 * before the board is solved: 0, 1, or 2 for "not within one mistake".
 */
function mistakes(spec, ranking) {
  const k = spec.faults.length;
  const run = (ids) => {
    let state = newSpotState(spec);
    for (const id of ids) state = toggleLine(spec, state, id).state;
    return checkSpot(spec, state);
  };
  const first = ranking.slice(0, k);
  const r1 = run(first);
  if (r1.state.solved) return 0;
  const keep = first.filter((id) => !r1.extra.includes(id));
  const next = ranking.filter((id) => !first.includes(id)).slice(0, Math.max(1, r1.extra.length));
  return run([...keep, ...next]).state.solved ? 1 : 2;
}

/** Skip the first j of a ranking (they go last), then read it as before. */
const skipping = (j) => (ranking) => [...ranking.slice(j), ...ranking.slice(0, j)];

const count = (re) => (l) => (l.text.match(re) ?? []).length;
const LENGTH = (l) => l.text.length;
/** name -> [score (higher ranks first), ranking transform]. */
const LENGTH_RULES = {
  'the longest lines': [LENGTH, skipping(0)],
  'skip the longest, then the longest': [LENGTH, skipping(1)],
  'skip the two longest, then the longest': [LENGTH, skipping(2)],
  'the shortest lines': [(l) => -LENGTH(l), skipping(0)],
  'skip the shortest, then the shortest': [(l) => -LENGTH(l), skipping(1)],
  'skip the two shortest, then the shortest': [(l) => -LENGTH(l), skipping(2)],
};
const COUNT_RULES = {
  'the lines with the most digits': [count(/\d/g), skipping(0)],
  'the lines with the most words': [count(/\w+/g), skipping(0)],
};

/** The share of `rankings` that solve the board within one wrong Check. */
const winShare = (spec, all) => all.filter((r) => mistakes(spec, r) <= 1).length / all.length;

/**
 * `{ "<no> <spot id>": { <rule>: "<n> of <m> tie-breaks" } }` for every rule that is a tell on a
 * board: it solves within one wrong Check on more than half of its tie-break orders (with no
 * ties, that is: it solves it). Winning on a minority of tie-breaks is a lottery, not a tell.
 */
async function tells(rules) {
  const solving = {};
  for (const { no, spec } of await allSpotSpecs()) {
    for (const [name, [score, transform]] of Object.entries(rules)) {
      const all = rankings(spec, score).map(transform);
      const share = winShare(spec, all);
      if (share > 0.5) (solving[`${no} ${spec.id}`] ??= {})[name] = `${Math.round(share * all.length)} of ${all.length} tie-breaks`;
    }
  }
  return solving;
}

// Known and deferred: 6.2 has five lines and one answer, so some skip rule always lands (#193).
// Pinned to exactly the rules that pass today: fixing #193 fails this test until the entry goes.
// No other board may be listed here.
const KNOWN = {
  '6.2 ts-spot': [
    'skip the longest, then the longest',
    'skip the two longest, then the longest',
    'skip the shortest, then the shortest',
    'skip the two shortest, then the shortest',
  ],
};

/** `found` minus the KNOWN rules, after asserting each KNOWN rule of this rule set is still a tell. */
function unknownTells(found, rules) {
  const rest = structuredClone(found);
  for (const [key, names] of Object.entries(KNOWN)) {
    const mine = names.filter((n) => Object.hasOwn(rules, n)).sort();
    assert.deepEqual(Object.keys(rest[key] ?? {}).filter((n) => mine.includes(n)).sort(), mine, `${key}: the KNOWN tells (#193) still pass; drop any that no longer do`);
    for (const n of mine) delete rest[key][n];
    if (rest[key] && Object.keys(rest[key]).length === 0) delete rest[key];
  }
  return rest;
}

test('the rules see every Spot board, each board is solved by its own answer, and the retry model counts mistakes', async () => {
  const specs = await allSpotSpecs();
  assert.equal(specs.length, 6, 'all six Spot boards');
  for (const { no, spec } of specs) {
    const key = `${no} ${spec.id}`;
    const ids = spec.lines.map((l) => l.id);
    const decoys = ids.filter((id) => !spec.faults.includes(id));
    assert.equal(decoys.length >= 2, true, `${key}: two decoys to rank ahead of the answer`);
    // The answer first: no mistake. One decoy in the top k, an answer next: one. Two decoys ahead
    // of an answer that is not next in line (k = 1: two decoys first): more than one.
    assert.equal(mistakes(spec, [...spec.faults, ...decoys]), 0, `${key}: its own answer solves it`);
    const [d1, d2, ...restDecoys] = decoys;
    const [f1, ...restFaults] = spec.faults;
    assert.equal(mistakes(spec, [d1, ...restFaults, f1, d2, ...restDecoys]), 1, `${key}: one swap costs one Check`);
    assert.equal(mistakes(spec, [d1, ...restFaults, d2, f1, ...restDecoys]), 2, `${key}: a wrong retry is a second mistake`);
    // Ties are broken every way: each ranking orders every line once, and a fully tied score gives all n! orders.
    for (const r of rankings(spec, LENGTH)) assert.deepEqual([...r].sort(), [...ids].sort(), key);
    const n = ids.length;
    assert.equal(rankings(spec, () => 0).length, [...Array(n).keys()].reduce((p, i) => p * (i + 1), 1), `${key}: ${n}! orders`);
  }
  assert.deepEqual(Object.keys(KNOWN), ['6.2 ts-spot'], 'only 6.2 is a known, deferred board (#193)');
});

test('picking the longest or the shortest lines, first or after skipping one or two, solves no Spot board, even with one wrong Check, ties tried every way (#190)', async () => {
  assert.deepEqual(unknownTells(await tells(LENGTH_RULES), LENGTH_RULES), {}, 'boards a length rule solves without reading them');
});

test('picking the lines with the most digits or the most words solves no Spot board, even with one wrong Check, ties tried every way (#190)', async () => {
  assert.deepEqual(unknownTells(await tells(COUNT_RULES), COUNT_RULES), {}, 'boards a counting rule solves without reading them');
});
