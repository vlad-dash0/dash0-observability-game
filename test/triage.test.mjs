// lib/widgets/triage.mjs: compareAttribute, the share of each attribute value in a slow set
// versus a baseline set. Spec: docs/M1-DESIGN.md §6 Boss checkout-is-slow, §7 P11.
// Asserts strings, numbers and null only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareAttribute } from '../lib/widgets/triage.mjs';

const of = (attr, values) => values.map((v) => ({ [attr]: v }));
const flat = (rows) => rows.map((r) => `${r.value}:${r.slowPct}/${r.baselinePct}`).join(' ');

test('shares: every slow request on 2.4.0 against 1 in 14 normal ones', () => {
  const slow = of('service.version', Array(6).fill('2.4.0'));
  const base = of('service.version', [...Array(13).fill('2.3.9'), '2.4.0']);
  assert.equal(flat(compareAttribute(slow, base, 'service.version')), '2.3.9:0/93 2.4.0:100/7');
});

test('an even attribute reads 50 and 50 in both sets', () => {
  const slow = of('cloud.region', ['eu', 'us', 'eu', 'us']);
  const base = of('cloud.region', ['us', 'eu']);
  assert.equal(flat(compareAttribute(slow, base, 'cloud.region')), 'eu:50/50 us:50/50');
});

test('a value absent from one non-empty set is 0, not null', () => {
  const rows = compareAttribute(of('a', ['x']), of('a', ['y']), 'a');
  assert.equal(flat(rows), 'x:100/0 y:0/100');
});

test('an empty set has null shares, never 0%', () => {
  assert.equal(flat(compareAttribute([], of('a', ['x', 'x']), 'a')), 'x:null/100');
  assert.equal(flat(compareAttribute(of('a', ['x']), [], 'a')), 'x:100/null');
  assert.equal(compareAttribute([], [], 'a').length, 0);
});

test('requests without the attribute count in the denominator and in no row', () => {
  const rows = compareAttribute([{ a: 'x' }, {}], [{ a: 'x' }], 'a');
  assert.equal(flat(rows), 'x:50/100');
});

test('rows are sorted by value, shares round to whole numbers, input is not mutated', () => {
  const slow = of('a', ['b', 'a', 'a']);
  const copy = JSON.stringify(slow);
  assert.equal(flat(compareAttribute(slow, of('a', ['a']), 'a')), 'a:67/100 b:33/0');
  assert.equal(JSON.stringify(slow), copy);
});

test('bad input throws a TypeError', () => {
  assert.throws(() => compareAttribute(null, [], 'a'), TypeError);
  assert.throws(() => compareAttribute([], 'x', 'a'), TypeError);
  assert.throws(() => compareAttribute([], [], ''), TypeError);
});
