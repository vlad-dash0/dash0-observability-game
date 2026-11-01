// lib/promql/eval.mjs: instant queries over a series dataset. Spec: docs/M1-DESIGN.md §4.6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../lib/promql/eval.mjs';
import { approx, at, ds } from './helpers/promql.mjs';

const N = (name, extra = {}) => ({ __name__: name, ...extra });
// show(): "labels=value" lines, so a whole result is one comparable string.
const show = (r) => {
  assert.equal(r.kind, 'vector', JSON.stringify(r));
  return r.series.map((s) => `${Object.entries(s.labels).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(',')}=${s.value}`);
};
const D = at(100,
  [N('req', { route: '/a', code: '200' }), 10],
  [N('req', { route: '/a', code: '500' }), 2],
  [N('req', { route: '/b', code: '200' }), 30],
  [N('lim', { route: '/a' }), 100],
  [N('lim', { route: '/b' }), 60],
);

test('selectors match on every operator and sort by label set', () => {
  assert.deepEqual(show(evaluate(D, 100, 'req{route="/a"}')), ['__name__=req,code=200,route=/a=10', '__name__=req,code=500,route=/a=2']);
  assert.deepEqual(show(evaluate(D, 100, 'req{code!="200"}')), ['__name__=req,code=500,route=/a=2']);
  assert.deepEqual(show(evaluate(D, 100, 'req{code=~"5.."}')), ['__name__=req,code=500,route=/a=2']);
  assert.deepEqual(show(evaluate(D, 100, 'req{route="/a",code!~"5.."}')), ['__name__=req,code=200,route=/a=10']);
  assert.deepEqual(show(evaluate(D, 100, 'req{nope=""}')).length, 3, 'a missing label equals ""');
  assert.deepEqual(show(evaluate(D, 100, 'req{nope!="x"}')).length, 3);
  assert.deepEqual(show(evaluate(D, 100, '{__name__="lim",route="/b"}')), ['__name__=lim,route=/b=60']);
});

test('regex matchers are fully anchored', () => {
  assert.equal(show(evaluate(D, 100, 'req{code=~"20"}')).length, 0);
  assert.equal(show(evaluate(D, 100, 'req{code=~"2|500"}')).length, 1, 'alternation spans the whole value');
});

test('an instant selector looks back 5 minutes (left-open) and no further', () => {
  const d = ds([N('g'), [[0, 1], [100, 2]]]);
  assert.deepEqual(show(evaluate(d, 399, 'g')), ['__name__=g=2']);
  assert.deepEqual(show(evaluate(d, 400, 'g')), [], 'the sample at t=100 is exactly 300s old: out');
  assert.deepEqual(show(evaluate(d, 50, 'g')), ['__name__=g=1']);
  assert.deepEqual(show(evaluate(d, -1, 'g')), [], 'before the first sample');
});

test('rate and increase drop the metric name and use the window (t-range, t]', () => {
  // x: 0 at t=0, then +10 every 10s. Window (0,60] excludes the t=0 sample.
  const d = ds([N('x', { a: '1' }), [0, 10, 20, 30, 40, 50, 60].map((t) => [t, t])]);
  assert.deepEqual(show(evaluate(d, 60, 'increase(x[60s])')), ['a=1=60']);
  assert.deepEqual(show(evaluate(d, 60, 'rate(x[1m])')), ['a=1=1']);
  // window (-60,60] holds all 7 samples; the counter starts at 0 on the first one, so the start
  // extrapolation is clamped to zero seconds and the end gap is 0: no extrapolation at all.
  assert.deepEqual(show(evaluate(d, 60, 'increase(x[2m])')), ['a=1=60']);
});

test('a sample exactly at t - range is outside the window', () => {
  // (0,60] holds t=30 and t=60 only: increase 100 over 30s, start gap 30 < 1.1 x 30 -> x2 = 200.
  // Had t=0 counted the delta would be 150.
  const d = ds([N('x'), [[0, 50], [30, 100], [60, 200]]]);
  assert.deepEqual(show(evaluate(d, 60, 'increase(x[60s])')), ['=200']);
});

test('rate over a series with one sample in the window is absent, not zero', () => {
  const d = ds([N('x'), [[50, 1], [300, 5]]]);
  assert.deepEqual(show(evaluate(d, 60, 'rate(x[1m])')), []);
});

test('rate keeps the le label and the other labels', () => {
  const d = ds([N('h_bucket', { le: '1', r: 'a' }), [[10, 0], [20, 5], [30, 10]]]);
  assert.deepEqual(show(evaluate(d, 30, 'rate(h_bucket[30s])')).length, 1);
  assert.equal(evaluate(d, 30, 'rate(h_bucket[30s])').series[0].labels.le, '1');
});

test('sum by, sum without, avg, min, max, count', () => {
  assert.deepEqual(show(evaluate(D, 100, 'sum by (route) (req)')), ['route=/a=12', 'route=/b=30']);
  assert.deepEqual(show(evaluate(D, 100, 'sum(req) by (route)')), ['route=/a=12', 'route=/b=30']);
  assert.deepEqual(show(evaluate(D, 100, 'sum without (code) (req)')), ['route=/a=12', 'route=/b=30']);
  assert.deepEqual(show(evaluate(D, 100, 'sum(req)')), ['=42']);
  assert.deepEqual(show(evaluate(D, 100, 'sum by () (req)')), ['=42']);
  assert.deepEqual(show(evaluate(D, 100, 'avg(req)')), ['=14']);
  assert.deepEqual(show(evaluate(D, 100, 'min(req)')), ['=2']);
  assert.deepEqual(show(evaluate(D, 100, 'max by (route) (req)')), ['route=/a=10', 'route=/b=30']);
  assert.deepEqual(show(evaluate(D, 100, 'count by (code) (req)')), ['code=200=2', 'code=500=1']);
  assert.deepEqual(show(evaluate(D, 100, 'sum by (nope) (req)')), ['=42'], 'grouping by an absent label is one group');
});

test('an aggregate over no series is empty, not zero', () => {
  assert.deepEqual(show(evaluate(D, 100, 'sum(nothing)')), []);
  assert.deepEqual(show(evaluate(D, 100, 'count(nothing)')), []);
});

test('min and max ignore NaN unless everything is NaN', () => {
  const d = at(1, [N('v', { i: '1' }), NaN], [N('v', { i: '2' }), 4], [N('v', { i: '3' }), 7]);
  assert.deepEqual(show(evaluate(d, 1, 'min(v)')), ['=4']);
  assert.deepEqual(show(evaluate(d, 1, 'max(v)')), ['=7']);
  assert.deepEqual(show(evaluate(at(1, [N('v'), NaN]), 1, 'max(v)')), ['=NaN']);
});

test('scalar arithmetic and precedence', () => {
  const num = (q) => {
    const r = evaluate(D, 100, q);
    assert.equal(r.kind, 'scalar', q);
    return r.value;
  };
  assert.equal(num('1 + 2 * 3'), 7);
  assert.equal(num('10 - 2 - 3'), 5);
  assert.equal(num('2 * (3 + 4)'), 14);
  assert.equal(num('-2 + 1'), -1);
  assert.equal(num('1 / 0'), Infinity);
  assert.ok(Number.isNaN(num('0 / 0')));
  assert.equal(num('1e3'), 1000);
});

test('vector with scalar arithmetic drops the name, comparison keeps it', () => {
  assert.deepEqual(show(evaluate(D, 100, 'lim * 2')), ['route=/a=200', 'route=/b=120']);
  assert.deepEqual(show(evaluate(D, 100, '1 / lim')), ['route=/a=0.01', 'route=/b=' + 1 / 60]);
  assert.deepEqual(show(evaluate(D, 100, '-lim')), ['route=/a=-100', 'route=/b=-60']);
  assert.deepEqual(show(evaluate(D, 100, 'lim > 80')), ['__name__=lim,route=/a=100']);
  assert.deepEqual(show(evaluate(D, 100, '80 < lim')), ['__name__=lim,route=/a=100'], 'scalar on the left keeps the vector value');
  assert.deepEqual(show(evaluate(D, 100, 'lim >= 100')), ['__name__=lim,route=/a=100']);
  assert.deepEqual(show(evaluate(D, 100, 'lim <= 60')), ['__name__=lim,route=/b=60']);
  assert.deepEqual(show(evaluate(D, 100, 'lim == 60')), ['__name__=lim,route=/b=60']);
  assert.deepEqual(show(evaluate(D, 100, 'lim != 60')), ['__name__=lim,route=/a=100']);
});

test('vector with vector matches one-to-one on identical label sets (name ignored)', () => {
  const a = evaluate(D, 100, 'sum by (route) (req) / sum by (route) (lim)');
  assert.deepEqual(show(a), ['route=/a=' + 12 / 100, 'route=/b=' + 30 / 60]);
  assert.deepEqual(show(evaluate(D, 100, 'sum by (route) (req) / on(route) lim')), ['route=/a=' + 12 / 100, 'route=/b=' + 30 / 60]);
  assert.deepEqual(show(evaluate(D, 100, 'req{code="200"} - ignoring(code) lim')), ['route=/a=-90', 'route=/b=-30']);
  assert.deepEqual(show(evaluate(D, 100, 'sum by (route) (req) > on(route) lim')), []);
  assert.deepEqual(show(evaluate(D, 100, 'sum by (route) (req) < on(route) lim')), ['route=/a=12', 'route=/b=30']);
});

test('series without a partner are dropped, and on() result carries only the on labels', () => {
  const d = at(1, [N('p', { a: '1', x: 'u' }), 4], [N('p', { a: '2', x: 'u' }), 6], [N('q', { a: '1', y: 'w' }), 2]);
  assert.deepEqual(show(evaluate(d, 1, 'p / on(a) q')), ['a=1=2']);
  assert.deepEqual(show(evaluate(d, 1, 'p / q')), [], 'full label sets differ (x vs y)');
});

test('many-to-one matching is an evaluation error, not a silent pick', () => {
  const r = evaluate(D, 100, 'req / on(route) lim');
  assert.equal(r.kind, 'error');
  assert.match(r.message, /many-to-one|duplicate|multiple/);
  assert.equal(evaluate(D, 100, 'lim / on(route) req').kind, 'error');
});

test('colliding label sets after dropping the name is an error', () => {
  const d = at(1, [N('m1', { a: '1' }), 1], [N('m2', { a: '1' }), 2]);
  assert.equal(evaluate(d, 1, '{a="1"} * 2').kind, 'error');
});

test('histogram_quantile groups by every label except le', () => {
  const b = (route, le, v) => [N('h_bucket', { route, le }), v];
  const d = at(5, b('/a', '0.1', 10), b('/a', '0.5', 30), b('/a', '1', 40), b('/a', '+Inf', 50),
    b('/b', '0.1', 0), b('/b', '0.5', 10), b('/b', '+Inf', 10));
  assert.deepEqual(show(evaluate(d, 5, 'histogram_quantile(0.5, h_bucket)')).map((l) => l.replace(/=([^=]+)$/, (_, v) => '=' + Number(v).toFixed(6))),
    ['route=/a=0.400000', 'route=/b=0.300000']);
  assert.deepEqual(show(evaluate(d, 5, 'histogram_quantile(0.9, sum by (le) (h_bucket))')), ['=1']);
  assert.deepEqual(show(evaluate(d, 5, 'histogram_quantile(0.9, h_bucket{route="/a"})')), ['route=/a=1']);
});

test('histogram_quantile skips series without a parsable le and is empty without buckets', () => {
  const d = at(5, [N('h_bucket', { le: 'x' }), 1], [N('h_bucket'), 1]);
  assert.deepEqual(show(evaluate(d, 5, 'histogram_quantile(0.5, h_bucket)')), []);
  assert.deepEqual(show(evaluate(d, 5, 'histogram_quantile(0.5, nothing)')), []);
});

test('histogram_quantile over rate() equals the quantile of the bucket counts', () => {
  const grow = (le, k) => [N('h_bucket', { le }), [10, 20, 30, 40, 50, 60].map((t) => [t, (t / 10) * k])];
  const d = ds(grow('0.1', 10), grow('0.5', 30), grow('1', 40), grow('+Inf', 50));
  const r = evaluate(d, 60, 'histogram_quantile(0.5, rate(h_bucket[1m]))');
  assert.ok(approx(r.series[0].value, 0.4), String(r.series[0].value));
});

test('failures come back as results, never thrown', () => {
  assert.equal(evaluate(D, 100, 'x offset 5m').kind, 'unsupported');
  assert.equal(evaluate(D, 100, 'rate(').kind, 'syntax');
  const r = evaluate(D, 100, 'req[5m]');
  assert.equal(r.kind, 'unsupported');
  assert.match(r.what, /range vector/);
});

test('output is deterministic and the dataset is not mutated', () => {
  const before = JSON.stringify(D);
  const a = JSON.stringify(evaluate(D, 100, 'sum by (code) (req)'));
  assert.equal(a, JSON.stringify(evaluate(D, 100, 'sum by (code) (req)')));
  assert.equal(before, JSON.stringify(D));
});

test('an escaped backslash gives a working regex digit class, a bare \\d is rejected', () => {
  const d = at(1, [N('v', { a: '12' }), 1], [N('v', { a: 'ab' }), 2]);
  assert.deepEqual(show(evaluate(d, 1, 'v{a=~"\\\\d+"}')), ['__name__=v,a=12=1']);
  assert.equal(evaluate(d, 1, 'v{a=~"\\d+"}').kind, 'syntax');
});
