// The Sort it help ladder, pure (#156 P3b; docs/M1-DESIGN.md §4.1): lib/widgets/sort-it-help.mjs.
// Which helps a sort step declares (sortHelps, validateSortHelps), the item a hint is for
// (hintTarget), which tiers an item has (hintLadder) and the three hint tiers (hintFor), all
// derived from the answer through bucketOf: there is no second grader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSortState, place } from '../lib/widgets/sort-it.mjs';
import { hintFor, hintLadder, hintTarget, NARROWS_AT, SORT_RULE, sortHelps, validateSortHelps } from '../lib/widgets/sort-it-help.mjs';

// The view test's fixture: i1 -> metric, i2 -> log, i3 -> trace, i4 -> metric.
function signals(extra = {}) {
  return {
    id: 'signals',
    buckets: [
      { id: 'metric', label: 'Metric' },
      { id: 'log', label: 'Log' },
      { id: 'trace', label: 'Trace' },
    ],
    items: [
      { id: 'i1', label: 'Request rate', bucket: 'metric', why: 'A number over time.' },
      { id: 'i2', label: 'Stack trace text', bucket: 'log', why: 'A timestamped record.' },
      { id: 'i3', label: 'Checkout call tree', bucket: 'trace', why: 'Spans with parents.' },
      { id: 'i4', label: 'Queue depth', bucket: 'metric', why: 'A gauge.' },
    ],
    ...extra,
  };
}

// Four buckets so that, with one wrong bucket tried, two wrong ones are left: the decoy is a choice.
// The right bucket is the THIRD, so a candidate list in [right, decoy] order differs from spec order.
function four() {
  return {
    id: 'four',
    buckets: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: `Bucket ${id.toUpperCase()}` })),
    items: [
      { id: 'x', label: 'Item X', bucket: 'c', why: 'C it is.' },
      { id: 'y', label: 'Item Y', bucket: 'a', why: 'A it is.' },
    ],
  };
}

const identity = (list) => [...list];
const reverse = (list) => [...list].reverse();
/** `state` after placing each [item, bucket] in turn. */
function after(spec, moves) {
  let state = newSortState(spec);
  for (const [item, bucket] of moves) ({ state } = place(spec, state, item, bucket));
  return state;
}
const ids = (list) => list.map((x) => (typeof x === 'string' ? x : x.id));

// ---- sortHelps / validateSortHelps ------------------------------------------------

test('sortHelps: hints on only when the step says so; a step with no helps key has hints off', () => {
  assert.equal(sortHelps(signals({ helps: { hints: true } })).hints, true);
  assert.equal(sortHelps(signals({ helps: { hints: false } })).hints, false);
  assert.equal(sortHelps(signals()).hints, false, 'the default ladder: no helps key means no hints');
  assert.equal(sortHelps(signals({ helps: {} })).hints, false, 'an empty helps object turns nothing on');
});

test('validateSortHelps: a valid ladder has no problems; a bad key, a non-boolean, a bad hint and a hint with hints off are each named', () => {
  assert.deepEqual(validateSortHelps(signals()), []);
  assert.deepEqual(validateSortHelps(signals({ helps: { hints: true } })), []);
  assert.deepEqual(validateSortHelps(signals({ helps: { hints: false } })), []);
  assert.deepEqual(validateSortHelps(signals({ helps: { hints: true }, hint: 'Ask what shape the data has.' })), []);

  const queue = validateSortHelps(signals({ helps: { hints: true, queue: true } }));
  assert.deepEqual(queue, ['helps: "queue" is not one of hints']);
  assert.deepEqual(validateSortHelps(signals({ helps: { hints: 'yes' } })), ['helps: "hints" is not true or false']);
  assert.deepEqual(validateSortHelps(signals({ helps: 'all' })), ['helps: not an object']);

  assert.deepEqual(validateSortHelps(signals({ helps: { hints: true }, hint: '  ' })), ['hint: not non-empty text']);
  assert.deepEqual(validateSortHelps(signals({ helps: { hints: true }, hint: 7 })), ['hint: not non-empty text']);

  assert.deepEqual(validateSortHelps(signals({ helps: { hints: false }, hint: 'Never shown.' })), ['hint: shown only when helps.hints is on']);
  assert.deepEqual(validateSortHelps(signals({ hint: 'Never shown.' })), ['hint: shown only when helps.hints is on'],
    'no helps key is hints off, so a hint is never shown either');
});

// ---- hintTarget -------------------------------------------------------------------

test('hintTarget: the selected item while it remains, else the first remaining item in DISPLAY order, else null', () => {
  const spec = signals({ helps: { hints: true } });
  const order = ['i3', 'i1', 'i4', 'i2']; // not spec order: a target read from spec.items gives i1
  const fresh = newSortState(spec);
  assert.equal(hintTarget(spec, fresh, { selected: 'i2', order }), 'i2');
  assert.equal(hintTarget(spec, fresh, { selected: null, order }), 'i3');
  // i3 placed: the first remaining in display order is now i1.
  const s1 = after(spec, [['i3', 'trace']]);
  assert.equal(hintTarget(spec, s1, { selected: null, order }), 'i1');
  // A selected item that is already right is not a target.
  assert.equal(hintTarget(spec, s1, { selected: 'i3', order }), 'i1');
  // A wrong try leaves the item remaining, so it stays the target.
  const s2 = after(spec, [['i4', 'log']]);
  assert.equal(hintTarget(spec, s2, { selected: 'i4', order }), 'i4');
  const all = after(spec, [['i1', 'metric'], ['i2', 'log'], ['i3', 'trace'], ['i4', 'metric']]);
  assert.equal(hintTarget(spec, all, { selected: null, order }), null);
  assert.equal(hintTarget(spec, all, { selected: 'i2', order }), null);
});

// ---- hintFor tier 2 ---------------------------------------------------------------

test('hintFor tier 2: the right bucket and one untried wrong decoy, in SPEC order; the decoy comes from the shuffle; a tried bucket is never a candidate', () => {
  const spec = four();
  const st = after(spec, [['x', 'a']]); // a tried and wrong; untried wrong buckets: b, d
  const one = hintFor(spec, st, 'x', 2, { shuffle: identity });
  assert.deepEqual(ids(one.cands), ['b', 'c'], 'identity shuffle: decoy b; listed b then c (spec order, not right-first)');
  assert.equal(one.apply ?? null, null, 'tier 2 places nothing');
  const two = hintFor(spec, st, 'x', 2, { shuffle: reverse });
  assert.deepEqual(ids(two.cands), ['c', 'd'], 'reverse shuffle: decoy d; still spec order');
  for (const h of [one, two]) {
    assert.equal(ids(h.cands).includes('a'), false, 'the tried bucket a is never offered');
    assert.equal(ids(h.cands).includes('c'), true, 'the right bucket is always a candidate');
  }
  assert.equal(one.html, '<p>It is one of these two, outlined on the board: <b>Bucket B</b> or <b>Bucket C</b>.</p>');
  assert.equal(two.html, '<p>It is one of these two, outlined on the board: <b>Bucket C</b> or <b>Bucket D</b>.</p>');
});

// ---- hintLadder ----------------------------------------------------------------------

// Two buckets: an item has at most two untried, so tier 2 could never narrow it.
function pair() {
  return {
    id: 'pair',
    buckets: [{ id: 'p', label: 'P' }, { id: 'q', label: 'Q' }],
    items: [{ id: 'z', label: 'Item Z', bucket: 'q', why: 'Q it is.' }],
  };
}

test('NARROWS_AT is 3: the right bucket, a decoy and one more', () => {
  assert.equal(NARROWS_AT, 3);
});

test('hintLadder on a 2-bucket item: tiers [1, 3], nothing used, the rule next; the rule then the placement', () => {
  const spec = pair();
  const st = newSortState(spec);
  assert.deepEqual(hintLadder(spec, st, 'z'), { tiers: [1, 3], done: 0, next: 1 });
  assert.deepEqual(hintLadder(spec, st, 'z', { ruleShown: true }), { tiers: [1, 3], done: 1, next: 3 },
    'after the rule, the next is the placement: "Hint 2 of 2"');
  assert.deepEqual(hintLadder(spec, st, 'z', { ruleShown: true, taken: [3] }), { tiers: [1, 3], done: 2, next: null });
});

test('hintLadder on a 4-bucket item: tiers [1, 2, 3], walked in order', () => {
  const spec = four();
  const st = newSortState(spec);
  assert.deepEqual(hintLadder(spec, st, 'x'), { tiers: [1, 2, 3], done: 0, next: 1 });
  assert.deepEqual(hintLadder(spec, st, 'x', { ruleShown: true }), { tiers: [1, 2, 3], done: 1, next: 2 });
  assert.deepEqual(hintLadder(spec, st, 'x', { ruleShown: true, taken: [2] }), { tiers: [1, 2, 3], done: 2, next: 3 });
  assert.deepEqual(hintLadder(spec, st, 'x', { ruleShown: true, taken: [2, 3] }), { tiers: [1, 2, 3], done: 3, next: null });
});

test('hintLadder: exactly NARROWS_AT untried keeps tier 2; one fewer drops it, unless tier 2 was already taken', () => {
  const spec = four();
  const three = after(spec, [['x', 'a']]); // untried b, c, d: exactly 3
  assert.deepEqual(hintLadder(spec, three, 'x', { ruleShown: true }).tiers, [1, 2, 3]);
  const two = after(spec, [['x', 'a'], ['x', 'b']]); // untried c, d: 2
  assert.deepEqual(hintLadder(spec, two, 'x', { ruleShown: true }), { tiers: [1, 3], done: 1, next: 3 },
    'tier 2 would offer the only two left: dropped, the placement is next');
  assert.deepEqual(hintLadder(spec, two, 'x', { ruleShown: true, taken: [2] }), { tiers: [1, 2, 3], done: 2, next: 3 },
    'a tier 2 already given stays counted');
  // Another item's tries do not drop this item's tier 2: untried is per item.
  assert.deepEqual(hintLadder(spec, two, 'y').tiers, [1, 2, 3]);
});

test('hintLadder: the rule counts once shown for any item (ruleShown) or when this item took it; taken tiers of another kind do not', () => {
  const spec = four();
  const st = newSortState(spec);
  assert.equal(hintLadder(spec, st, 'x', { ruleShown: false }).done, 0);
  assert.equal(hintLadder(spec, st, 'x', { ruleShown: true }).done, 1);
  assert.deepEqual(hintLadder(spec, st, 'x', { taken: [1] }), { tiers: [1, 2, 3], done: 1, next: 2 });
  // Without the rule, a taken tier 2 is counted but the rule is still next.
  assert.deepEqual(hintLadder(spec, st, 'x', { taken: [2] }), { tiers: [1, 2, 3], done: 1, next: 1 });
});

// ---- tiers 1 and 3 ---------------------------------------------------------------

test('hintFor tier 1: the step\'s own hint when it has one, else the generic rule; no candidates, nothing placed', () => {
  const spec = four();
  const st = newSortState(spec);
  const generic = hintFor(spec, st, 'x', 1, { shuffle: identity });
  assert.equal(typeof SORT_RULE, 'string');
  assert.ok(SORT_RULE.trim().length > 20, 'a real sentence');
  assert.equal(generic.html, `<p>${SORT_RULE}</p>`);
  assert.deepEqual(ids(generic.cands ?? []), []);
  assert.equal(generic.apply ?? null, null);
  const own = hintFor({ ...spec, helps: { hints: true }, hint: 'Count the <b>shapes</b>.' }, st, 'x', 1, { shuffle: identity });
  assert.equal(own.html, '<p>Count the <b>shapes</b>.</p>', 'the authored hint replaces the generic rule, wrapped as a paragraph');
});

test('hintFor tier 3: applies the RIGHT bucket (from the answer), whichever buckets were tried', () => {
  const spec = four();
  // a tried: untried is [b, c, d], so an apply of untried[0] would give b.
  assert.deepEqual(hintFor(spec, after(spec, [['x', 'a']]), 'x', 3, { shuffle: identity }).apply, { bucket: 'c' });
  assert.deepEqual(hintFor(spec, after(spec, [['x', 'a']]), 'x', 3, { shuffle: reverse }).apply, { bucket: 'c' });
  assert.deepEqual(hintFor(spec, newSortState(spec), 'y', 3, { shuffle: reverse }).apply, { bucket: 'a' });
  // The apply is a placement place() grades right.
  const st = after(spec, [['x', 'a']]);
  const { apply } = hintFor(spec, st, 'x', 3, { shuffle: identity });
  assert.equal(place(spec, st, 'x', apply.bucket).outcome, 'right');
  assert.equal(hintFor(spec, st, 'x', 3, { shuffle: identity }).html, '<p>Placed for you. Item X goes in <b>Bucket C</b>. C it is.</p>');
});
