// lib/widgets/query-it.mjs and lib/promql/supported.mjs: spec validation, the grading outcomes,
// the supported-subset constant. Spec: docs/M1-DESIGN.md §4.6 and §4.7. Strings, numbers, booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQueryState, normalizeQuery, runQuery, validateQuerySpec } from '../lib/widgets/query-it.mjs';
import { SUPPORTED } from '../lib/promql/supported.mjs';
import { evaluate } from '../lib/promql/eval.mjs';
import { getDataset } from '../lib/promql/datasets.mjs';

const spec = () => ({
  id: 'by-service',
  dataset: 'checkout-http',
  at: 3000,
  reference: 'sum by (service) (rate(http_server_requests_total[5m]))',
  explain: 'Rate per series, then sum away the labels you do not need.',
});
const has = (edit, want) => {
  const s = spec();
  edit(s);
  const got = validateQuerySpec(s);
  assert.ok(got.some((p) => p.includes(want)), `${want}\n  got: ${JSON.stringify(got)}`);
};

test('a valid spec has no problems, with and without given and hint', () => {
  assert.deepEqual(validateQuerySpec(spec()), []);
  assert.deepEqual(validateQuerySpec({ ...spec(), given: 'http_server_requests_total', hint: 'Use <code>rate</code>.' }), []);
});

test('validateQuerySpec names each problem and never throws', () => {
  has((s) => { s.id = 'Not Kebab'; }, 'spec id "Not Kebab" is not kebab-case');
  has((s) => { s.dataset = 'nope'; }, 'unknown dataset "nope"');
  has((s) => { s.dataset = 'constructor'; }, 'unknown dataset "constructor"');
  has((s) => { s.at = 'now'; }, 'at must be a number of seconds');
  has((s) => { s.at = 99999; }, 'at 99999 is outside the dataset (0..3600)');
  has((s) => { s.reference = ''; }, 'reference is not non-empty text');
  has((s) => { s.reference = 'sum(('; }, 'reference does not give data: {"kind":"syntax"');
  has((s) => { s.reference = 'rate(nothing_here[5m])'; }, 'reference does not give data: {"kind":"vector","series":[]}');
  has((s) => { s.reference = 'irate(http_server_requests_total[5m])'; }, 'reference does not give data: {"kind":"unsupported"');
  has((s) => { s.explain = ' '; }, 'explain is not non-empty text');
  has((s) => { s.hint = 5; }, 'hint is not non-empty text');
  has((s) => { s.given = ''; }, 'given is not non-empty text');
  has((s) => { s.given = 'sum without (route, status) (rate(http_server_requests_total[5m]))'; }, 'given already passes');
  for (const bad of [null, 5, [], 'x', { id: 7 }]) assert.ok(validateQuerySpec(bad).length > 0);
});

test('a given that is broken or wrong is allowed (it is a starting point)', () => {
  assert.deepEqual(validateQuerySpec({ ...spec(), given: 'sum by (service) (' }), []);
  assert.deepEqual(validateQuerySpec({ ...spec(), given: 'http_server_requests_total' }), []);
});

test('normalizeQuery trims and collapses whitespace only', () => {
  assert.equal(normalizeQuery('  sum  by (a)\n(x) \t'), 'sum by (a) (x)');
  assert.equal(normalizeQuery('A b'), 'A b');
});

const run = (text, st = newQueryState(spec())) => runQuery(spec(), st, text);

test('the reference and an equivalent alternative both pass; the query text is not compared', () => {
  const a = run(spec().reference);
  assert.equal(a.outcome, 'right');
  assert.equal(a.state.solved, true);
  const b = run('sum without (route, status) (\n  rate(http_server_requests_total[5m]))');
  assert.equal(b.outcome, 'right');
  assert.equal(b.grade.ok, true);
});

test('wrong answers are "wrong" with the grading reason; the same one again is a repeat', () => {
  const cases = [
    ['sum(rate(http_server_requests_total[5m]))', 'wrong-count'],
    ['sum by (route) (rate(http_server_requests_total[5m]))', 'wrong-count'],
    ['sum by (service) (increase(http_server_requests_total[5m]))', 'wrong-values'],
    ['http_server_requests_total', 'wrong-count'],
    ['rate(nothing_here[5m])', 'empty'],
  ];
  for (const [text, reason] of cases) {
    const w = run(text);
    assert.equal(w.outcome, 'wrong', text);
    assert.equal(w.reason, reason, text);
    assert.equal(w.state.solved, false);
    assert.equal(runQuery(spec(), w.state, `  ${text.replace(' ', '   ')} `).outcome, 'repeat', text);
  }
});

test('wrong-labels: same number of series, different label sets', () => {
  const two = { ...spec(), reference: 'sum by (route) (rate(http_server_requests_total{service="checkout"}[5m]))' };
  assert.equal(runQuery(two, newQueryState(two), 'sum by (status) (rate(http_server_requests_total{service="checkout"}[5m]))').reason, 'wrong-labels');
  assert.equal(runQuery(two, newQueryState(two), 'sum by (route) (rate(http_server_requests_total{service="checkout"}[5m]))').outcome, 'right');
});

test('syntax, unsupported and runtime errors are their own outcomes, never wrong, never remembered', () => {
  const cases = [
    ['sum by (service) (', 'syntax'],
    ['rate(http_server_requests_total[5m]) offset 5m', 'unsupported'],
    ['irate(http_server_requests_total[5m])', 'unsupported'],
    ['topk(1, http_server_requests_total)', 'unsupported'],
    ['rate(http_server_requests_total[5m]) / on(service) rate(http_server_requests_total[5m])', 'error'],
  ];
  for (const [text, outcome] of cases) {
    const r = run(text);
    assert.equal(r.outcome, outcome, text);
    assert.deepEqual(r.state.tried, [], 'free outcomes are not remembered');
    assert.equal(r.state.solved, false);
  }
});

test('blank text is its own free outcome; after a solve the state does not change', () => {
  assert.equal(run('   ').outcome, 'blank');
  const done = run(spec().reference);
  const again = runQuery(spec(), done.state, 'sum(rate(http_server_requests_total[5m]))');
  assert.equal(again.outcome, 'solved');
  assert.equal(again.state.solved, true);
});

test('state is never mutated', () => {
  const st = newQueryState(spec());
  const before = JSON.stringify(st);
  runQuery(spec(), st, 'http_server_requests_total');
  runQuery(spec(), st, spec().reference);
  assert.equal(JSON.stringify(st), before);
});

// ---- SUPPORTED: one source for the widget's list ------------------------------------

const flat = () => SUPPORTED.flatMap((g) => g.items);

test('SUPPORTED groups the subset: every function, aggregation, unit and operator the parser accepts', () => {
  assert.deepEqual(SUPPORTED.map((g) => g.title), ['Selectors', 'Range vectors', 'Functions', 'Aggregations', 'Arithmetic', 'Comparison filters', 'Vector matching']);
  const items = flat();
  for (const want of ['rate', 'increase', 'histogram_quantile', 'sum', 'avg', 'min', 'max', 'count', 'ms', 'w', '+', '/', '>=', '!=', 'on(…)']) {
    assert.ok(items.includes(want), want);
  }
  assert.equal(SUPPORTED.every((g) => g.items.length > 0 && typeof g.note === 'string'), true);
});

test('every function and aggregation SUPPORTED lists really evaluates; none is reported unsupported', () => {
  const d = getDataset('checkout-http');
  const group = (t) => SUPPORTED.find((g) => g.title === t).items;
  const sel = 'http_server_requests_total';
  const bucket = 'http_server_request_duration_seconds_bucket';
  const argOf = { rate: `rate(${sel}[5m])`, increase: `increase(${sel}[5m])`, histogram_quantile: `histogram_quantile(0.9, rate(${bucket}[5m]))` };
  for (const f of group('Functions')) assert.equal(evaluate(d, 3000, argOf[f]).kind, 'vector', f);
  for (const a of group('Aggregations')) assert.equal(evaluate(d, 3000, `${a} by (service) (${sel})`).kind, 'vector', a);
  for (const u of group('Range vectors').filter((x) => /^[a-z]+$/.test(x))) assert.equal(evaluate(d, 3000, `rate(${sel}[1${u}])`).kind === 'syntax', false, u);
  for (const op of [...group('Arithmetic'), ...group('Comparison filters')]) assert.equal(evaluate(d, 3000, `${sel} ${op} 2`).kind, 'vector', op);
});
