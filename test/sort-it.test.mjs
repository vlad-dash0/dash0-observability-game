// lib/widgets/sort-it.mjs: the Sort it widget core (validate, place, progress).
// Spec: docs/M1-DESIGN.md §4.1, §7 P2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isComplete,
  newSortState,
  place,
  remaining,
  untried,
  validateSortSpec,
} from '../lib/widgets/sort-it.mjs';

// Two items (i1, i4) deliberately share a bucket.
function fixture() {
  return {
    id: 'signals',
    buckets: [
      { id: 'metric', label: 'Metric' },
      { id: 'log', label: 'Log' },
      { id: 'trace', label: 'Trace' },
    ],
    items: [
      { id: 'i1', label: 'Request rate', bucket: 'metric', why: 'A number over time.' },
      { id: 'i2', label: 'Stack trace text', bucket: 'log', why: 'A timestamped record.', whyNot: { metric: 'Not a number.' } },
      { id: 'i3', label: 'Checkout call tree', bucket: 'trace', why: 'Spans with parents.' },
      { id: 'i4', label: 'Queue depth', bucket: 'metric', why: 'A gauge.' },
    ],
  };
}

/** Recursively freeze, so any in-place write throws in strict-mode module code. */
function deepFreeze(v) {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

const SPEC = deepFreeze(fixture());
const has = (problems, text) => problems.some((p) => p.includes(text));

// validateSortSpec

test('validateSortSpec: the fixture is valid', () => {
  assert.equal(validateSortSpec(SPEC).length, 0);
});

test('validateSortSpec reports every problem at once, not just the first', () => {
  const spec = fixture();
  spec.id = 'Not Kebab';
  spec.buckets.push({ id: 'metric', label: 'Metric again' });
  spec.items[0].bucket = 'span';
  spec.items[1].why = '';
  spec.items[2].id = 'i1';
  const problems = validateSortSpec(spec);
  assert.equal(has(problems, '"Not Kebab"'), true);
  assert.equal(has(problems, 'duplicate bucket id "metric"'), true);
  assert.equal(has(problems, 'unknown bucket "span"'), true);
  assert.equal(has(problems, 'item "i2": empty why'), true);
  assert.equal(has(problems, 'duplicate item id "i1"'), true);
  assert.equal(problems.length, 5);
});

test('validateSortSpec: bucket count must be 2..5', () => {
  const one = fixture();
  one.buckets = [{ id: 'metric', label: 'Metric' }];
  one.items = one.items.map((it) => ({ ...it, bucket: 'metric' }));
  assert.equal(has(validateSortSpec(one), 'buckets: 1, expected 2..5'), true);
  const six = fixture();
  for (const id of ['b4', 'b5', 'b6']) six.buckets.push({ id, label: id });
  assert.equal(has(validateSortSpec(six), 'buckets: 6, expected 2..5'), true);
  const five = fixture();
  for (const id of ['b4', 'b5']) five.buckets.push({ id, label: id });
  assert.equal(validateSortSpec(five).length, 0);
});

test('validateSortSpec: item count must be 2..12', () => {
  const one = fixture();
  one.items = one.items.slice(0, 1);
  assert.equal(has(validateSortSpec(one), 'items: 1, expected 2..12'), true);
  const many = fixture();
  for (let n = 5; n <= 13; n += 1) many.items.push({ id: `i${n}`, label: 'x', bucket: 'log', why: 'y' });
  assert.equal(many.items.length, 13);
  assert.equal(has(validateSortSpec(many), 'items: 13, expected 2..12'), true);
  many.items.pop();
  assert.equal(validateSortSpec(many).length, 0);
});

test('validateSortSpec: ids must be kebab-case', () => {
  const spec = fixture();
  spec.buckets[0].id = 'Metric';
  spec.items.forEach((it) => { if (it.bucket === 'metric') it.bucket = 'Metric'; });
  delete spec.items[1].whyNot;
  spec.items[1].id = 'i_2';
  spec.items[2].id = '__proto__';
  const problems = validateSortSpec(spec);
  assert.equal(has(problems, 'bucket id "Metric"'), true);
  assert.equal(has(problems, 'item id "i_2"'), true);
  assert.equal(has(problems, 'item id "__proto__"'), true);
  assert.equal(problems.length, 3);
});

test('validateSortSpec: whyNot keys must be known buckets', () => {
  const spec = fixture();
  spec.items[1].whyNot = { span: 'nope' };
  assert.equal(has(validateSortSpec(spec), 'item "i2": whyNot has unknown bucket "span"'), true);
});

test('validateSortSpec never throws on junk', () => {
  for (const junk of [undefined, null, 7, 'x', [], {}, { buckets: 'x', items: {} }, { buckets: [null], items: [7] }]) {
    const problems = validateSortSpec(junk);
    assert.equal(Array.isArray(problems), true);
    assert.equal(problems.length > 0, true);
  }
});

// newSortState / place

test('newSortState starts with nothing right and nothing tried', () => {
  const st = newSortState(SPEC);
  assert.equal(Object.keys(st.right).length, 0);
  assert.equal(Object.keys(st.tried).length, 0);
  assert.equal(remaining(SPEC, st).join(','), 'i1,i2,i3,i4');
  assert.equal(isComplete(SPEC, st), false);
});

test('the reference answer gives four rights and ends complete (I7)', () => {
  let st = deepFreeze(newSortState(SPEC));
  const outcomes = [];
  for (const item of SPEC.items) {
    const r = place(SPEC, st, item.id, item.bucket);
    outcomes.push(r.outcome);
    st = deepFreeze(r.state);
  }
  assert.equal(outcomes.join(','), 'right,right,right,right');
  assert.equal(isComplete(SPEC, st), true);
  assert.equal(remaining(SPEC, st).length, 0);
});

test('place never mutates its (frozen) input and returns new state', () => {
  const st0 = deepFreeze(newSortState(SPEC));
  const wrong = place(SPEC, st0, 'i1', 'log');
  assert.equal(wrong.outcome, 'wrong');
  assert.equal(wrong.state === st0, false);
  assert.equal(Object.keys(st0.tried).length, 0);
  const st1 = deepFreeze(wrong.state);
  const right = place(SPEC, st1, 'i1', 'metric');
  assert.equal(right.outcome, 'right');
  assert.equal(Object.keys(st1.right).length, 0);
  assert.equal(untried(SPEC, st1, 'i1').join(','), 'metric,trace');
});

test('a wrong bucket again is a repeat, not another wrong', () => {
  const st1 = deepFreeze(place(SPEC, newSortState(SPEC), 'i2', 'metric').state);
  const again = place(SPEC, st1, 'i2', 'metric');
  assert.equal(again.outcome, 'repeat');
  assert.equal(untried(SPEC, again.state, 'i2').join(','), 'log,trace');
  assert.equal(place(SPEC, st1, 'i2', 'trace').outcome, 'wrong');
});

test('placing an item that is already right is placed, whatever the bucket', () => {
  const st1 = deepFreeze(place(SPEC, newSortState(SPEC), 'i3', 'trace').state);
  assert.equal(place(SPEC, st1, 'i3', 'trace').outcome, 'placed');
  assert.equal(place(SPEC, st1, 'i3', 'log').outcome, 'placed');
  assert.equal(place(SPEC, st1, 'i3', 'log').state === st1, true);
});

test('an unknown item or bucket is unknown and changes nothing', () => {
  const st0 = deepFreeze(newSortState(SPEC));
  for (const [item, bucket] of [['nope', 'metric'], ['i1', 'span'], ['__proto__', 'log'], ['i1', '__proto__'], ['toString', 'metric']]) {
    const r = place(SPEC, st0, item, bucket);
    assert.equal(r.outcome, 'unknown');
    assert.equal(r.state === st0, true);
  }
});

// remaining / untried / isComplete

test('remaining lists not-yet-right items in spec order', () => {
  let st = newSortState(SPEC);
  st = place(SPEC, st, 'i3', 'trace').state;
  st = place(SPEC, st, 'i1', 'metric').state;
  st = place(SPEC, st, 'i2', 'trace').state; // wrong: still remaining
  assert.equal(remaining(SPEC, st).join(','), 'i2,i4');
});

test('untried lists untried buckets in spec order; unknown item gives none', () => {
  let st = newSortState(SPEC);
  assert.equal(untried(SPEC, st, 'i4').join(','), 'metric,log,trace');
  st = place(SPEC, st, 'i4', 'trace').state;
  st = place(SPEC, st, 'i4', 'log').state;
  assert.equal(untried(SPEC, st, 'i4').join(','), 'metric');
  assert.equal(untried(SPEC, st, 'i1').join(','), 'metric,log,trace');
  assert.equal(untried(SPEC, st, 'nope').length, 0);
});

test('isComplete stays false until the last item is right', () => {
  let st = newSortState(SPEC);
  const items = SPEC.items;
  for (let n = 0; n < items.length; n += 1) {
    assert.equal(isComplete(SPEC, st), false);
    st = place(SPEC, st, items[n].id, items[n].bucket).state;
  }
  assert.equal(isComplete(SPEC, st), true);
});

test('isComplete: wrong placements and a shared bucket do not count as right', () => {
  let st = newSortState(SPEC);
  st = place(SPEC, st, 'i1', 'metric').state;
  st = place(SPEC, st, 'i2', 'metric').state;
  st = place(SPEC, st, 'i3', 'metric').state;
  st = place(SPEC, st, 'i4', 'log').state;
  assert.equal(isComplete(SPEC, st), false);
  assert.equal(remaining(SPEC, st).join(','), 'i2,i3,i4');
});
