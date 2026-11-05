// Blind strategies must not win any Spot it board (#190). Each rule below ignores what the lines
// mean: it scores every line by something it can count or read off the text (length, digits,
// words, commas, quotes, `=` signs, distinct label keys, or a numeric field such as `count=`),
// picks the lines with the most or the fewest, first or after skipping one or two, and plays
// that through the real checkSpot. If it solves a board first time or after one wrong Check,
// the player earns stars without reading. (Position rules: test/spot-ladder.test.mjs.) Specs
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

/** Every way to order `list`. */
function perms(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => perms([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));

// Enough for every tie-break of every rule on the current boards (the largest is one board's
// eight tied lines, 8! = 40320); a board past it fails loudly, before building the orders,
// instead of being sampled.
const MAX_RANKINGS = 50000;

/** A missing score (the line lacks the field) ranks last, whichever way the rule reads. */
const MISSING = -Infinity;

/**
 * Every ranking of the line ids by `score` (highest first, MISSING last), ties broken every
 * way: the product of the orders of each group of equal scores.
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
    const group = groups.get(s);
    if (factorial(group.length) * out.length > MAX_RANKINGS) throw new Error(`${spec.id}: more than ${MAX_RANKINGS} tie-breaks`);
    const orders = perms(group);
    out = out.flatMap((head) => orders.map((o) => [...head, ...o]));
  }
  return out;
}

/**
 * Play a ranking blind, knowing only the answer count k, through the real toggleLine and
 * checkSpot. Check 1: the top k. If that is wrong, the player has learned which picks are
 * wrong (the feedback counts them and shows each one's whyNot), so Check 2 drops those and
 * adds as many next-ranked unpicked lines. Returns the wrong Checks before the board is
 * solved: 0, 1, or 2 for "not within one mistake".
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
  const next = ranking.filter((id) => !first.includes(id)).slice(0, r1.extra.length);
  return run([...keep, ...next]).state.solved ? 1 : 2;
}

/** Skip the first j of a ranking (they go last), then read it as before. */
const skipping = (j) => (ranking) => [...ranking.slice(j), ...ranking.slice(0, j)];
const SKIPS = [0, 1, 2];

const count = (re) => (text) => (text.match(re) ?? []).length;

/** The distinct keys (`key=` or `key:`) inside the {...} blocks of a line, quoted values ignored. */
function labelKeys(text) {
  const bare = text.replace(/"[^"]*"/g, '""');
  const keys = new Set();
  let depth = 0;
  let inside = '';
  for (const ch of bare) {
    if (ch === '{') depth += 1;
    if (depth > 0) inside += ch;
    if (ch === '}' && depth > 0) depth -= 1;
    if (depth === 0 && inside) {
      for (const m of inside.matchAll(/([A-Za-z_][\w.]*)\s*[=:]/g)) keys.add(m[1]);
      inside = '';
    }
  }
  return keys.size;
}

/** Text measures: name -> (text) -> number, higher is "most". */
const MEASURES = {
  length: (text) => text.length,
  digits: count(/\d/g),
  words: count(/\w+/g),
  commas: count(/,/g),
  quotes: count(/"/g),
  '`=` signs': count(/=/g),
  'distinct label keys': labelKeys,
};

const UNIT = { '': 1, s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9 };

/**
 * The unquoted numeric fields of a line, `name=<number><unit?>`, as { name: value }: `count=11`,
 * `sum=3.6s`, the exemplar's `value=0.28s`, `p95_s=0.61`. Time units are read as seconds. Ids
 * (`span_id=00f0c7...`) and quoted labels (`build_id="2411"`) are not numbers.
 */
function fields(text) {
  const out = {};
  for (const m of text.matchAll(/(?<![\w."])([A-Za-z_][\w.]*)=(-?\d+(?:\.\d+)?)([a-z]*)(?![\w.])/g)) {
    if (!Object.hasOwn(UNIT, m[3])) continue;
    out[m[1]] ??= Number(m[2]) * UNIT[m[3]];
  }
  return out;
}

/** The fields every board is read for when present, beside any other numeric field it has. */
const NAMED_FIELDS = ['count', 'sum'];
// Not read: an exemplar's `value=` is there or `exemplar: none` is, and that presence is what 3.6 teaches.
const SKIPPED_FIELDS = ['value'];

/**
 * The rule table for one board: name -> score (higher ranks first). Each text measure and each
 * numeric field on the board, read for the most and for the fewest; a line without the field
 * scores MISSING and ranks last both ways.
 */
function scoresFor(spec) {
  const scores = {};
  for (const [name, f] of Object.entries(MEASURES)) {
    scores[`most ${name}`] = (l) => f(l.text);
    scores[`fewest ${name}`] = (l) => -f(l.text);
  }
  const present = new Set(spec.lines.flatMap((l) => Object.keys(fields(l.text))).filter((n) => !SKIPPED_FIELDS.includes(n)));
  for (const name of [...NAMED_FIELDS.filter((n) => present.has(n)), ...[...present].filter((n) => !NAMED_FIELDS.includes(n)).sort()]) {
    const read = (l) => fields(l.text)[name];
    scores[`highest ${name}=`] = (l) => (read(l) === undefined ? MISSING : read(l));
    scores[`lowest ${name}=`] = (l) => (read(l) === undefined ? MISSING : -read(l));
  }
  return scores;
}

const ruleName = (score, j) => (j === 0 ? score : `${score}, skipping ${j}`);

// A rule is a tell when it solves a board within one wrong Check on MORE THAN HALF of its
// tie-break orders (with no ties: when it solves it). Winning on a minority of tie-breaks is a
// guess, not a tell: random ranking with one retry already solves these boards 0.14 to 0.40 of
// the time, depending on the board, so a lower bar would flag luck and a higher one would let
// a rule that usually wins through.
const TELL_SHARE = 0.5;

/**
 * `{ "<no> <spot id>": { <rule>: "<n> of <m> tie-breaks" } }` for every rule that is a tell on a
 * board. Rankings are shared by the skips of one score, and a tie pattern seen before is not
 * replayed.
 */
async function tells() {
  const solving = {};
  for (const { no, spec } of await allSpotSpecs()) {
    const seen = new Map();
    for (const [name, score] of Object.entries(scoresFor(spec))) {
      const all = rankings(spec, score);
      for (const j of SKIPS) {
        const key = `${j} ${JSON.stringify(spec.lines.map((l) => score(l)))}`;
        if (!seen.has(key)) seen.set(key, all.map(skipping(j)).filter((r) => mistakes(spec, r) <= 1).length / all.length);
        const share = seen.get(key);
        if (share > TELL_SHARE) (solving[`${no} ${spec.id}`] ??= {})[ruleName(name, j)] = `${Math.round(share * all.length)} of ${all.length} tie-breaks`;
      }
    }
  }
  return solving;
}

// Known and deferred: 6.2 has five lines and one answer, so some skip rule always lands (#193).
// Pinned to exactly the rules that pass today: fixing #193 fails this test until the entry goes.
// No other board may be listed here.
const KNOWN = {
  '6.2 ts-spot': [
    'most length, skipping 1',
    'most length, skipping 2',
    'fewest length, skipping 1',
    'fewest length, skipping 2',
    'most digits, skipping 2',
    'fewest digits, skipping 1',
    'most words, skipping 1',
    'most words, skipping 2',
    'fewest words, skipping 1',
    'fewest words, skipping 2',
    'most commas, skipping 1',
    'most commas, skipping 2',
    'fewest commas, skipping 1',
    'fewest commas, skipping 2',
  ],
};

test('the rules see every Spot board, read its fields, each board is solved by its own answer, and the retry model counts mistakes', async () => {
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
    // Skipping j moves the top j to the back.
    assert.deepEqual(skipping(2)(ids), [...ids.slice(2), ...ids.slice(0, 2)], key);
    // Ties are broken every way: each ranking orders every line once, and a fully tied score gives all n! orders.
    for (const r of rankings(spec, scoresFor(spec)['most length'])) assert.deepEqual([...r].sort(), [...ids].sort(), key);
    assert.equal(rankings(spec, () => 0).length, factorial(ids.length), `${key}: ${ids.length}! orders`);
  }
  assert.throws(() => rankings({ id: 'wide', lines: [...Array(9).keys()].map((i) => ({ id: `l${i}` })) }, () => 0), /more than 50000 tie-breaks/, 'nine tied lines (9! orders) throw before they are built');
  assert.deepEqual(Object.keys(KNOWN), ['6.2 ts-spot'], 'only 6.2 is a known, deferred board (#193)');

  // The readers, on literal lines: what each measure and field sees.
  const line = 'x{route="/a/{id}", az="eu-1", n: 2} count=12 sum=3.5s exemplar: value=250ms trace_id=ab12 span_id=00f0c7 build_id="2411" p95_s=0.61';
  assert.equal(labelKeys(line), 3, 'route, az, n; {id} inside a quoted value is no key');
  assert.deepEqual(fields(line), { count: 12, sum: 3.5, value: 0.25, p95_s: 0.61 });
  // A missing field ranks last for the highest and for the lowest alike.
  const spec = { id: 'f', lines: [{ id: 'none', text: 'no fields' }, { id: 'lo', text: 'count=1' }, { id: 'hi', text: 'count=9 value=2s' }] };
  const scores = scoresFor(spec);
  assert.deepEqual(rankings(spec, scores['highest count=']), [['hi', 'lo', 'none']]);
  assert.deepEqual(rankings(spec, scores['lowest count=']), [['lo', 'hi', 'none']]);
  assert.deepEqual(Object.keys(scores).filter((n) => n.includes('=')), ['most `=` signs', 'fewest `=` signs', 'highest count=', 'lowest count=']);
});

test('no Spot board is solved, even with one wrong Check, by taking the lines with the most or fewest of anything countable, first or after skipping one or two, ties tried every way (#190)', async () => {
  const found = await tells();
  const { [Object.keys(KNOWN)[0]]: known = {}, ...others } = found;
  assert.deepEqual(others, {}, 'boards a blind rule solves without reading them');
  assert.deepEqual(Object.keys(known).sort(), [...KNOWN['6.2 ts-spot']].sort(), '6.2: the KNOWN tells (#193) are exactly the ones that still pass; drop any that no longer do');
});
