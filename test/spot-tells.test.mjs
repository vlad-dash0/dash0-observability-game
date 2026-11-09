// Blind strategies must not win any Spot it board (#190). Each rule below ignores what the lines
// mean: it scores every line by something it can count or read off the text (length, digits,
// words, commas, quotes, `=` signs, underscores, whether the key of a `key=value` line starts with a namespace (its first dotted segment, or either of two), distinct label keys, the length of a labelled field such as
// `expr:`, or a numeric field such as `count=`), picks the lines with the most or the fewest, first or after skipping one or two, and plays
// that through the real checkSpot. If it solves a board first time or after one wrong Check,
// the player earns stars without reading. The equal-value pairing rule below reads no meaning either: it groups
// the lines of a `key=value` board by value and takes one line of each group. (Position rules: test/spot-ladder.test.mjs.) Specs
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

// Up to this many orders are tried per rule. A board whose tied lines have more tie-breaks than that
// (nine fully tied lines are 9! = 362880; the 6.2 board has nine and quotes, for one, tie them all) is
// sampled, not enumerated: MAX_RANKINGS random orders from a fixed seed, so the same orders every run.
// The enumerated case (the largest before 6.2 was eight tied lines, 8! = 40320) stays exact.
const MAX_RANKINGS = 50000;
const SAMPLE_SEED = 0x5eed;

/** A small seeded generator (mulberry32): the same numbers in [0, 1) for the same seed, on every Node. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `list` in a random order (Fisher-Yates) drawn from `next`. */
function shuffled(list, next) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A missing score (the line lacks the field) ranks last, whichever way the rule reads. */
const MISSING = -Infinity;

/**
 * The rankings of the line ids by `score` (highest first, MISSING last), ties broken every way: the
 * product of the orders of each group of equal scores. When that product is past MAX_RANKINGS, MAX_RANKINGS
 * of them, each group of ties shuffled on its own from a fixed seed.
 */
function rankings(spec, score) {
  const groups = new Map();
  for (const l of spec.lines) {
    const s = score(l);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(l.id);
  }
  const ordered = [...groups.keys()].sort((a, b) => b - a).map((s) => groups.get(s));
  if (ordered.reduce((n, g) => n * factorial(g.length), 1) > MAX_RANKINGS) {
    const next = seeded(SAMPLE_SEED);
    return Array.from({ length: MAX_RANKINGS }, () => ordered.flatMap((g) => shuffled(g, next)));
  }
  let out = [[]];
  for (const group of ordered) {
    const orders = perms(group);
    out = out.flatMap((head) => orders.map((o) => [...head, ...o]));
  }
  return out;
}

/** Pick `ids` through the real toggleLine and press Check through the real checkSpot. */
function play(spec, ids) {
  let state = newSpotState(spec);
  for (const id of ids) state = toggleLine(spec, state, id).state;
  return checkSpot(spec, state);
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
  const run = (ids) => play(spec, ids);
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
  underscores: count(/_/g),
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

/** The text after the first `{`, `=` or `:` of a line with no labelled field, read as one segment. */
const FALLBACK_SEGMENT = 'text after the first brace, equals sign or colon';

/**
 * The labelled fields of a line, `key: value`, as { key: value length }: `alert: X expr: Y for: 5m`
 * gives the lengths of `X`, `Y` and `5m`. A key starts the line or follows a space, ends in `:`
 * and a space (so `09:14:00` is none), and sits outside every bracket and quote (so `{n: 2}` is
 * none); its value runs to the next key, trimmed. A key seen twice on a line sums its values. A
 * line with no key gives one segment, FALLBACK_SEGMENT, when it has a `{`, `=` or `:`.
 */
function segments(text) {
  const keys = [];
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if ('{[('.includes(ch)) depth += 1;
    if ('}])'.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth > 0 || (i > 0 && text[i - 1] !== ' ')) continue;
    const m = /^([A-Za-z_][\w./-]*):(?: |$)/.exec(text.slice(i));
    if (m) keys.push({ key: m[1], start: i, end: i + m[0].length });
  }
  const out = {};
  if (keys.length === 0) {
    const at = text.search(/[{=:]/);
    if (at >= 0) out[FALLBACK_SEGMENT] = text.slice(at + 1).trim().length;
    return out;
  }
  keys.forEach(({ key, end }, n) => {
    out[key] = (out[key] ?? 0) + text.slice(end, keys[n + 1]?.start ?? text.length).trim().length;
  });
  return out;
}

// Not read: `exemplar:` is `none` or a list of exemplars, and which lines have one is what 3.6 teaches.
const SKIPPED_SEGMENTS = ['exemplar'];

/**
 * The rule table for one board: name -> score (higher ranks first). Each text measure, each
 * labelled field's length found on two lines or more, and each numeric field on the board, read
 * for the most and for the fewest; a line without the field scores MISSING and ranks last both ways.
 */
function scoresFor(spec) {
  const scores = {};
  for (const [name, f] of Object.entries(MEASURES)) {
    scores[`most ${name}`] = (l) => f(l.text);
    scores[`fewest ${name}`] = (l) => -f(l.text);
  }
  const keyLines = new Map();
  for (const l of spec.lines) for (const k of Object.keys(segments(l.text))) keyLines.set(k, (keyLines.get(k) ?? 0) + 1);
  for (const [key, n] of keyLines) {
    if (n < 2 || SKIPPED_SEGMENTS.includes(key)) continue;
    const read = (l) => segments(l.text)[key];
    const name = key === FALLBACK_SEGMENT ? FALLBACK_SEGMENT : `\`${key}:\``;
    scores[`longest ${name}`] = (l) => (read(l) === undefined ? MISSING : read(l));
    scores[`shortest ${name}`] = (l) => (read(l) === undefined ? MISSING : -read(l));
  }
  const present = new Set(spec.lines.flatMap((l) => Object.keys(fields(l.text))).filter((n) => !SKIPPED_FIELDS.includes(n)));
  for (const name of [...NAMED_FIELDS.filter((n) => present.has(n)), ...[...present].filter((n) => !NAMED_FIELDS.includes(n)).sort()]) {
    const read = (l) => fields(l.text)[name];
    scores[`highest ${name}=`] = (l) => (read(l) === undefined ? MISSING : read(l));
    scores[`lowest ${name}=`] = (l) => (read(l) === undefined ? MISSING : -read(l));
  }
  for (const set of prefixSets(spec)) {
    scores[`keys starting ${set.join(' or ')}.`] = (l) => (set.includes(namespaceOf(l.text)) ? 1 : 0);
  }
  for (const { set, sub } of minusRules(spec)) {
    scores[minusName(set, sub)] = (l) => (set.includes(namespaceOf(l.text)) && subNamespaceOf(l.text) !== sub ? 1 : 0);
  }
  return scores;
}

/** The first dotted segment of a `key=value` line's key (`http` for `http.route=/checkout`), or null for any other shape. */
function namespaceOf(text) {
  const m = /^(\w+)(?:\.[\w.-]*)?=/.exec(text);
  return m ? m[1] : null;
}

/**
 * Every key-prefix set worth trying on a board: each first dotted segment that occurs, and each union of two. A set
 * that holds every line or none is no rule, and a board with fewer than two segments has nothing to split.
 */
function prefixSets(spec) {
  const segs = [...new Set(spec.lines.map((l) => namespaceOf(l.text)).filter((n) => n !== null))].sort();
  const sets = [...segs.map((x) => [x]), ...choose(segs, 2)];
  return segs.length < 2 ? [] : sets.filter((set) => spec.lines.some((l) => set.includes(namespaceOf(l.text))) && spec.lines.some((l) => !set.includes(namespaceOf(l.text))));
}

/** The first two dotted segments of a key with three or more (`http.request` for `http.request.method=POST`), or null. */
function subNamespaceOf(text) {
  const m = /^(\w+\.[\w-]+)\.[\w.-]*=/.exec(text);
  return m ? m[1] : null;
}

/**
 * Rules "first-segment set S minus sub-namespace P": S is each first segment that occurs or a union of two (as in
 * prefixSets, but a board with one segment counts), P each first-two-segment prefix of a key of three or more segments
 * whose first segment is in S. A rule that picks every line or none is no rule. Bounded by the sets times the prefixes.
 */
function minusRules(spec) {
  const segs = [...new Set(spec.lines.map((l) => namespaceOf(l.text)).filter((n) => n !== null))].sort();
  const subs = [...new Set(spec.lines.map((l) => subNamespaceOf(l.text)).filter((n) => n !== null))].sort();
  const out = [];
  for (const set of [...segs.map((x) => [x]), ...choose(segs, 2)]) {
    for (const sub of subs.filter((p) => set.includes(p.split('.')[0]))) {
      const picked = spec.lines.filter((l) => set.includes(namespaceOf(l.text)) && subNamespaceOf(l.text) !== sub).length;
      if (picked > 0 && picked < spec.lines.length) out.push({ set, sub });
    }
  }
  return out;
}

const minusName = (set, sub) => `keys starting ${set.join(' or ')}. not under ${sub}.`;

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
    const pairing = pairingShare(spec);
    if (pairing > TELL_SHARE) (solving[`${no} ${spec.id}`] ??= {})[PAIRING] = pairing.toFixed(2);
  }
  return solving;
}

/** The value of a `key=value` line (everything after the first `=`), or null for a line of any other shape. */
function valueOf(text) {
  const m = /^[\w.]+=(.*)$/.exec(text);
  return m ? m[1] : null;
}

/** Every way to choose `n` of `list`. */
function choose(list, n) {
  if (n === 0) return [[]];
  return list.flatMap((x, i) => choose(list.slice(i + 1), n - 1).map((c) => [x, ...c]));
}

/** The product of the lists: one member from each, every way. */
function product(lists) {
  return lists.reduce((acc, list) => acc.flatMap((head) => list.map((x) => [...head, x])), [[]]);
}

/**
 * The share of equal-value pickings that solve the board within one wrong Check. Lines with the same
 * value form a group (a line without a `key=value` shape is a group of one). The player takes one line of
 * each of k groups, with no idea which is the answer: the groups of two or more lines first (any k of
 * them when there are more than k), then single lines to make up k, any of them. If the Check flags picks,
 * each flagged line is swapped for another line of its group (it has the same value, so it is the pick's
 * partner) and the player Checks again. A board where every equal-value pair is one answer plus one
 * non-answer, as many pairs as answers, is solved by this whichever way the picks fall, since the swap
 * finds the partner.
 */
function pairingShare(spec) {
  const k = spec.faults.length;
  const groups = [...Map.groupBy(spec.lines, (l) => valueOf(l.text) ?? l.id).values()].map((g) => g.map((l) => l.id));
  let wins = 0;
  let total = 0;
  const shared = groups.filter((g) => g.length > 1);
  const single = groups.filter((g) => g.length === 1);
  const picked = shared.length >= k ? choose(shared, k) : choose(single, k - shared.length).map((c) => [...shared, ...c]);
  for (const chosen of picked) {
    for (const picks of product(chosen)) {
      total += 1;
      const r1 = play(spec, picks);
      if (r1.state.solved) {
        wins += 1;
        continue;
      }
      const swapped = picks.map((id, n) => {
        const group = chosen[n];
        return r1.extra.includes(id) ? group[(group.indexOf(id) + 1) % group.length] : id;
      });
      if (play(spec, swapped).state.solved) wins += 1;
    }
  }
  return wins / total;
}

const PAIRING = 'one line of each equal-value group';

// Rules that solve a board because they encode its concept, not a surface tell: "<no> <spot id>" -> exact rule -> why.
// Narrow on purpose: only this rule on this board, and the test fails if it stops passing.
const CONCEPT_RULES = {
  '8.2 scv-spot': {
    'keys starting http or net. not under http.request.': 'the rule encodes the concept: stable HTTP names nest under http.request./http.response. (#206, #207)',
  },
};

test('the rules see every Spot board, read its fields, each board is solved by its own answer, and the retry model counts mistakes', async () => {
  const specs = await allSpotSpecs();
  assert.equal(specs.length, 10, 'all ten Spot boards');
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
    assert.equal(rankings(spec, () => 0).length, Math.min(factorial(ids.length), MAX_RANKINGS), `${key}: ${ids.length}! orders, or the sample`);
  }
  // Past MAX_RANKINGS tie-breaks the orders are sampled: the same MAX_RANKINGS orders every call, each a permutation, and a higher score still ranks first.
  const wide = { id: 'wide', lines: [...Array(10).keys()].map((i) => ({ id: `l${i}`, score: i === 0 ? 1 : 0 })) };
  const sampled = rankings(wide, (l) => l.score);
  assert.equal(sampled.length, MAX_RANKINGS, 'nine tied lines are 9! = 362880 orders, past the limit: a sample');
  assert.deepEqual(sampled, rankings(wide, (l) => l.score), 'the same orders on every call');
  assert.equal(sampled.every((r) => r[0] === 'l0' && [...r].sort().join() === wide.lines.map((l) => l.id).sort().join()), true, 'each is a permutation, the higher score first');
  assert.equal(new Set(sampled.map((r) => r.join())).size > MAX_RANKINGS * 0.9, true, 'and mostly different ones');
  assert.equal(rankings({ id: 'eight', lines: wide.lines.slice(2) }, () => 0).length, factorial(8), 'eight tied lines are enumerated in full');
  assert.equal(new Set(rankings({ id: 'three', lines: wide.lines.slice(1, 4) }, () => 0).map((r) => r.join())).size, 6, 'few ties: every order exactly once');

  // The readers, on literal lines: what each measure and field sees.
  const line = 'x{route="/a/{id}", az="eu-1", n: 2} count=12 sum=3.5s exemplar: value=250ms trace_id=ab12 span_id=00f0c7 build_id="2411" p95_s=0.61';
  assert.equal(labelKeys(line), 3, 'route, az, n; {id} inside a quoted value is no key');
  assert.deepEqual(fields(line), { count: 12, sum: 3.5, value: 0.25, p95_s: 0.61 });
  // Labelled fields: each value's length up to the next key; none inside brackets or quotes, none in a clock time.
  assert.deepEqual(segments('alert: Ab expr: f{job="a: b", n: 2}[5m] > 1 for: 10m'), { alert: 2, expr: 27, for: 3 });
  assert.deepEqual(segments('09:14:00 m{a="b"} exemplar: v=1 x exemplar: none'), { exemplar: 9 }, 'a repeated key sums: "v=1 x" and "none"');
  assert.deepEqual(segments('traces/edge: processors: [a, b: c]'), { 'traces/edge': 0, processors: 9 });
  assert.deepEqual(segments('m_total{service="x"}'), { [FALLBACK_SEGMENT]: 12 }, 'no key: the text after the first {');
  assert.deepEqual(segments('f(span.attributes)'), {}, 'no key and no { = or :: no segment');
  // A field on two lines or more is read; one on a single line is not; exemplar: is skipped.
  const seg = scoresFor({ id: 's', lines: [{ id: 'a', text: 'k: xx j: y exemplar: none' }, { id: 'b', text: 'k: x exemplar: v' }, { id: 'c', text: 'no key' }] });
  assert.deepEqual(Object.keys(seg).filter((n) => n.includes('`')), ['most `=` signs', 'fewest `=` signs', 'longest `k:`', 'shortest `k:`']);
  assert.deepEqual(rankings({ lines: [{ id: 'a', text: 'k: xx j: y' }, { id: 'b', text: 'k: x' }, { id: 'c', text: 'no key' }] }, seg['shortest `k:`']), [['b', 'a', 'c']]);
  // A missing field ranks last for the highest and for the lowest alike.
  const spec = { id: 'f', lines: [{ id: 'none', text: 'no fields' }, { id: 'lo', text: 'count=1' }, { id: 'hi', text: 'count=9 value=2s' }] };
  const scores = scoresFor(spec);
  assert.deepEqual(rankings(spec, scores['highest count=']), [['hi', 'lo', 'none']]);
  assert.deepEqual(rankings(spec, scores['lowest count=']), [['lo', 'hi', 'none']]);
  assert.deepEqual(Object.keys(scores).filter((n) => n.includes('=')), ['most `=` signs', 'fewest `=` signs', 'highest count=', 'lowest count=']);
});

test('no Spot board is solved, even with one wrong Check, by taking the lines with the most or fewest of anything countable, first or after skipping one or two, ties tried every way (#190)', async () => {
  const found = await tells();
  const rest = found;
  const others = {};
  for (const [board, rules] of Object.entries(rest)) {
    const concept = Object.keys(CONCEPT_RULES[board] ?? {});
    const surface = Object.keys(rules).filter((r) => !concept.includes(r));
    if (surface.length) others[board] = Object.fromEntries(surface.map((r) => [r, rules[r]]));
  }
  assert.deepEqual(others, {}, 'boards a blind rule solves without reading them');
  for (const [board, rules] of Object.entries(CONCEPT_RULES)) assert.deepEqual(Object.keys(found[board] ?? {}), Object.keys(rules), `${board}: the concept rules are exactly the ones that still pass; drop any that no longer do`);
});

test('the underscore measure: it solves the 6.2 board as first reviewed (sampler 7, memory 3, the answers 2, the rest 1), the counts that put the answers third and fourth (#193)', () => {
  const lines = (rows) => rows.map(([id, text]) => ({ id, text }));
  const share = (spec, name, skip) => {
    const all = rankings(spec, scoresFor(spec)[name]);
    return all.map(skipping(skip)).filter((r) => mistakes(spec, r) <= 1).length / all.length;
  };
  const before = {
    id: 'before',
    faults: ['tp', 'te'],
    lines: lines([
      ['md', 'processors: {memory_limiter: {check_interval: 1s, limit_percentage: 80}}'],
      ['mr', 'service: {pipelines: {metrics/spans: {receivers: [span_metrics]}}}'],
      ['cd', 'connectors: {span_metrics: {histogram: {explicit: {buckets: [100ms, 1s]}}}}'],
      ['tp', 'service: {pipelines: {traces: {processors: [memory_limiter, tail_sampling, batch]}}}'],
      ['lp', 'service: {pipelines: {logs: {processors: [memory_limiter, k8sattributes, batch]}}}'],
      ['sd', 'processors: {tail_sampling: {decision_wait: 30s, policies: [{name: errors, type: status_code, status_code: {status_codes: [ERROR]}}, {name: slow, type: latency, latency: {threshold_ms: 2000}}, {name: baseline, type: probabilistic, probabilistic: {sampling_percentage: 5}}]}}'],
      ['te', 'service: {pipelines: {traces: {exporters: [otlp_grpc/dash0, span_metrics]}}}'],
      ['mp', 'service: {pipelines: {metrics: {processors: [memory_limiter, resource, batch]}}}'],
    ]),
  };
  assert.equal(scoresFor(before)['most underscores'](before.lines[3]), 2);
  assert.equal(share(before, 'most underscores', 2) > TELL_SHARE, true, 'skipping the sampler and the memory line, the next two are the answers');
  assert.equal(share(before, 'fewest underscores', 2) > TELL_SHARE, true, 'fewest, skipping two, lands on them too');
});

test('the equal-value pairing rule: it solves a board whose equal-value pairs are each one old name and one stable name, and no live board (#177)', async () => {
  const board = (lines, faults) => ({ id: 'literal', lines: lines.map(([id, text]) => ({ id, text })), faults });
  // 8.2 as first written: POST, 500 and 8443 each shared by one old name (an answer) and its stable name.
  const paired = board(
    [['m', 'http.method=POST'], ['cp', 'client.port=51234'], ['rm', 'http.request.method=POST'], ['sp', 'server.port=8443'], ['sc', 'http.status_code=500'], ['rt', 'http.route=/checkout'], ['rs', 'http.response.status_code=500'], ['nh', 'net.host.port=8443']],
    ['m', 'sc', 'nh'],
  );
  assert.equal(pairingShare(paired), 1, 'one line of each pair, swapped for its partner when flagged, always solves it');
  // The same pairs plus one equal-value pair with no answer in it (url.path and http.route) and an answer with no partner.
  const mixed = board(
    [['t', 'http.target=/checkout?step=pay'], ['sp', 'server.port=8443'], ['ca', 'client.address=gw.kettle.example'], ['up', 'url.path=/checkout'], ['nh', 'net.host.port=8443'], ['rt', 'http.route=/checkout'], ['cp', 'client.port=51234'], ['sc', 'http.status_code=500']],
    ['t', 'nh', 'sc'],
  );
  assert.equal(pairingShare(mixed) <= TELL_SHARE, true, `${pairingShare(mixed)}`);
  // Values read after the first `=`; other shapes group alone.
  assert.equal(valueOf('http.target=/checkout?step=pay'), '/checkout?step=pay');
  assert.equal(valueOf('url.query=step=pay'), 'step=pay');
  assert.equal(valueOf('m{a="b"} count=12'), null);
  assert.deepEqual(choose([1, 2, 3], 2), [[1, 2], [1, 3], [2, 3]]);
  assert.deepEqual(product([[1, 2], [3]]), [[1, 3], [2, 3]]);
  // The live boards: none is a tell; assert the bar.
  for (const { no, spec } of await allSpotSpecs()) assert.equal(pairingShare(spec) <= TELL_SHARE, true, `${no} ${spec.id}: ${pairingShare(spec)}`);
});

test('the key-prefix rule: lines whose key starts with a namespace, or either of two, solve a board whose old names share namespaces; no live board (#177)', async () => {
  const board = (lines, faults) => ({ id: 'literal', lines: lines.map(([id, text]) => ({ id, text })), faults });
  const shareOf = (spec, name) => {
    const score = scoresFor(spec)[name];
    assert.equal(typeof score, 'function', `${name} is a rule on this board`);
    const all = rankings(spec, score);
    return all.filter((r) => mistakes(spec, r) <= 1).length / all.length;
  };
  // 8.2 as first reviewed: the old names are the http. and net. lines, plus http.route.
  const before = board(
    [['t', 'http.target=/checkout?step=pay'], ['sp', 'server.port=8443'], ['ca', 'client.address=gw.kettle.example'], ['up', 'url.path=/checkout'], ['nh', 'net.host.port=8444'], ['rt', 'http.route=/checkout'], ['cp', 'client.port=51234'], ['sc', 'http.status_code=500']],
    ['t', 'nh', 'sc'],
  );
  assert.deepEqual(prefixSets(before).map((s) => s.join('+')).filter((n) => n.includes('http')), ['http', 'client+http', 'http+net', 'http+server', 'http+url']);
  assert.equal(shareOf(before, 'keys starting http or net.') > TELL_SHARE, true, 'http. or net. solves it');
  // The same board with two more stable names under http. (a method, a header) beside http.route: the rule loses.
  const after = board(
    [['t', 'http.target=/checkout?step=pay'], ['sp', 'server.port=8443'], ['rm', 'http.request.method=POST'], ['ca', 'client.address=gw.kettle.example'], ['nh', 'net.host.port=8443'], ['rt', 'http.route=/checkout'], ['rh', 'http.request.header.content-type=["application/json"]'], ['sc', 'http.status_code=500']],
    ['t', 'nh', 'sc'],
  );
  assert.equal(shareOf(after, 'keys starting http or net.') <= TELL_SHARE, true);
  // Hyphens in a key stay in the key; other shapes have no namespace.
  assert.equal(namespaceOf('http.request.header.content-type=["a"]'), 'http');
  assert.equal(namespaceOf('plain=1'), 'plain');
  assert.equal(namespaceOf('expr: up'), null);
  assert.deepEqual(prefixSets(board([['a', 'k.x=1'], ['b', 'k.y=2']], ['a'])), [], 'one namespace: nothing to split');
  // Depth 2: "http or net. not under http.request." solves `after` (which plain "http or net." loses) and not a board whose answer is under http.request.
  const minus = 'keys starting http or net. not under http.request.';
  assert.deepEqual(minusRules(after).map((r) => minusName(r.set, r.sub)).filter((n) => n.includes('http or net')), [minus, 'keys starting http or net. not under net.host.']);
  assert.equal(shareOf(after, minus) > TELL_SHARE, true, 'the minus rule solves it');
  const nested = board(
    [['t', 'http.target=/checkout?step=pay'], ['sp', 'server.port=8443'], ['rm', 'http.request.method=POST'], ['ca', 'client.address=gw.kettle.example'], ['nh', 'net.host.port=8443'], ['rt', 'http.route=/checkout'], ['rh', 'http.request.header.content-type=["application/json"]'], ['sc', 'http.status_code=500']],
    ['rm', 'rh', 'sc'],
  );
  assert.equal(shareOf(nested, minus) <= TELL_SHARE, true, 'the answer is under http.request.: the rule misses it');
  assert.equal(subNamespaceOf('http.request.method=POST'), 'http.request');
  assert.equal(subNamespaceOf('http.route=/x'), null, 'two segments: no sub-namespace');
  assert.deepEqual(minusRules(board([['a', 'k.x=1'], ['b', 'k.x.y=2']], ['a'])).map((r) => minusName(r.set, r.sub)), ['keys starting k. not under k.x.'], 'one namespace is enough');
  assert.deepEqual(minusRules(board([['a', 'k.x.y=1'], ['b', 'k.x.z=2']], ['a'])), [], 'a rule that picks no line is none');
  // No live board is one (tells() runs every set on every board).
  for (const { no, spec } of await allSpotSpecs()) for (const set of prefixSets(spec)) assert.equal(shareOf(spec, `keys starting ${set.join(' or ')}.`) <= TELL_SHARE, true, `${no}: ${set}`);
  // Depth-2 rules on live boards: counted here, judged (with CONCEPT_RULES) in the test above.
  for (const { no, spec } of await allSpotSpecs()) assert.equal(minusRules(spec).length <= 20, true, `${no} ${spec.id}: ${minusRules(spec).length} depth-2 rules, keep the combinatorics bounded`);
});
