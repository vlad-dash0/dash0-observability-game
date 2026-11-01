// lib/promql/grade.mjs: grading compares RESULT series, never the query text.
// Spec: docs/M1-DESIGN.md §4.6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeQuery, TOLERANCE, sameNumber } from '../lib/promql/grade.mjs';
import { at, ds } from './helpers/promql.mjs';

const N = (name, extra = {}) => ({ __name__: name, ...extra });
// x: two routes, counters growing +10 / +20 per 10s, sampled every 10s up to t=300.
const grow = (route, per) => [N('x', { route }), Array.from({ length: 31 }, (_, i) => [i * 10, i * per])];
const D = ds(grow('/a', 10), grow('/b', 20));
const REF = 'sum by (route) (rate(x[5m]))';
const grade = (q, ref = REF) => gradeQuery(D, 300, q, ref);

test('the reference passes its own grading', () => {
  assert.equal(grade(REF).ok, true);
});

test('equivalent formulations pass', () => {
  assert.equal(grade('sum(rate(x[5m])) by (route)').ok, true, 'grouping clause after');
  assert.equal(grade('sum by (route) (rate(x[300s]))').ok, true, 'same window in seconds');
  assert.equal(grade('sum without (__name__) (rate(x[5m]))').ok, true, 'without the name');
  assert.equal(grade('sum by (route) (increase(x[5m])) / 300').ok, true, 'increase / seconds equals rate');
  assert.equal(grade('sum by (route) (increase(x[5m])/300)').ok, true);
  assert.equal(grade('max by (route) (rate(x[5m]))').ok, true, 'one series per route, so max = sum');
  assert.equal(grade('rate(x[5m])').ok, true, 'rate on its own already has one series per route');
});

test('a different window or aggregation fails on values', () => {
  assert.equal(grade('sum by (route) (rate(x[5m])) * 2').reason, 'wrong-values');
  assert.equal(grade('sum by (route) (rate(x[5m])) + 1').reason, 'wrong-values');
});

test('wrong grouping fails on labels or count', () => {
  assert.equal(grade('sum(rate(x[5m]))').reason, 'wrong-count');
  assert.equal(grade('sum by (route) (rate(x[5m]))', 'sum(rate(x[5m]))').reason, 'wrong-count', 'more series than expected');
  assert.equal(grade('sum by (other) (rate(x[5m]))').reason, 'wrong-count');
});

test('same number of series with different label sets is wrong-labels', () => {
  const d = ds(
    [N('x', { route: '/a', zone: 'u' }), [[100, 100], [200, 200], [300, 300]]],
    [N('x', { route: '/b', zone: 'v' }), [[100, 100], [200, 200], [300, 300]]],
  );
  assert.equal(gradeQuery(d, 300, 'sum by (zone) (rate(x[5m]))', 'sum by (route) (rate(x[5m]))').reason, 'wrong-labels');
});

test('nothing returned is empty, an unknown metric included', () => {
  assert.equal(grade('sum by (route) (rate(nope[5m]))').reason, 'empty');
  assert.equal(grade('x{route="/zzz"}').reason, 'empty');
});

test('unsupported and syntax are their own categories, never wrong', () => {
  const u = grade('sum by (route) (rate(x[5m] offset 1h))');
  assert.equal(u.ok, false);
  assert.equal(u.reason, 'unsupported');
  assert.match(u.what, /offset/);
  const s = grade('sum by (route) (rate(x[5m])');
  assert.equal(s.reason, 'syntax');
  assert.equal(typeof s.at, 'number');
  assert.equal(grade('topk(1, x)').reason, 'unsupported');
});

test('an evaluation error is its own category', () => {
  const d = at(1, [N('a', { r: '1', z: '1' }), 1], [N('a', { r: '1', z: '2' }), 2], [N('b', { r: '1' }), 3]);
  assert.equal(gradeQuery(d, 1, 'a / on(r) b', 'a{z="1"} / on(r) b').reason, 'error');
});

test('a scalar answer to a vector question is wrong-labels, a scalar compared to a scalar by value', () => {
  assert.equal(grade('1').reason, 'wrong-labels');
  assert.equal(gradeQuery(D, 300, '2 * 3', '6').ok, true);
  assert.equal(gradeQuery(D, 300, '7', '6').reason, 'wrong-values');
});

test('the query text is never compared', () => {
  assert.equal(gradeQuery(D, 300, '  sum  by(route)(rate( x[5m] ))  # same thing', REF).ok, true);
});

test('the result of the graded query rides along for the view to show', () => {
  const g = grade(REF);
  assert.equal(g.result.kind, 'vector');
  assert.equal(g.result.series.length, 2);
  assert.equal(grade('sum(rate(x[5m]))').result.series.length, 1);
});

test('a reference that cannot produce an answer is an authoring error and throws', () => {
  assert.throws(() => gradeQuery(D, 300, 'x', 'rate('), /reference/);
  assert.throws(() => gradeQuery(D, 300, 'x', 'x offset 5m'), /reference/);
  assert.throws(() => gradeQuery(D, 300, 'x', 'nope'), /reference/);
  assert.throws(() => gradeQuery('no-such-dataset', 300, 'x', 'x'), /dataset/);
});

test('numbers compare with a relative and absolute tolerance', () => {
  assert.equal(TOLERANCE.relative, 1e-6);
  assert.equal(sameNumber(1, 1 + 5e-7), true);
  assert.equal(sameNumber(1, 1 + 5e-6), false);
  assert.equal(sameNumber(0, 5e-10), true);
  assert.equal(sameNumber(0, 5e-8), false);
  assert.equal(sameNumber(1e9, 1e9 + 500), true);
  assert.equal(sameNumber(NaN, NaN), true);
  assert.equal(sameNumber(Infinity, Infinity), true);
  assert.equal(sameNumber(Infinity, -Infinity), false);
  assert.equal(sameNumber(NaN, 0), false);
});

test('a dataset can be named', () => {
  assert.equal(gradeQuery('checkout-http', 3600, 'sum(rate(http_server_requests_total[5m]))', 'sum(rate(http_server_requests_total[5m]))').ok, true);
});
