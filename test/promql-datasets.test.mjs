// lib/promql/datasets.mjs: the named fake TSDBs. Spec: docs/M1-DESIGN.md §4.6.
// Every figure below is hand-computed from the table in the dataset's generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATASETS, getDataset, datasetNames } from '../lib/promql/datasets.mjs';
import { evaluate, labelKey } from '../lib/promql/eval.mjs';
import { approx } from './helpers/promql.mjs';

const D = getDataset('checkout-http');
const { deployAt, end } = D.meta;
const val = (q, t) => {
  const r = evaluate(D, t, q);
  assert.equal(r.kind, 'vector', q + JSON.stringify(r));
  return Object.fromEntries(r.series.map((s) => [labelKey(s.labels), s.value]));
};
const one = (q, t) => {
  const v = Object.values(val(q, t));
  assert.equal(v.length, 1, q);
  return v[0];
};
const PAY = 'route="/pay"';

test('datasets are registered by name, deterministic and read-only', () => {
  assert.deepEqual(datasetNames(), ['checkout-http', 'checkout-spanmetrics']);
  assert.equal(typeof DATASETS['checkout-http'], 'function');
  assert.equal(JSON.stringify(DATASETS['checkout-http']()), JSON.stringify(DATASETS['checkout-http']()));
  assert.equal(getDataset('checkout-http'), getDataset('checkout-http'));
  assert.equal(Object.isFrozen(D.series), true);
  assert.throws(() => getDataset('nope'), /unknown dataset "nope"/);
  assert.deepEqual([D.meta.scrape, deployAt, end], [15, 2400, 3600]);
});

test('series are sorted by label set, samples by time, and counters never need a reset except at the deploy', () => {
  const keys = D.series.map((s) => labelKey(s.labels));
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(new Set(keys).size, keys.length);
  for (const s of D.series) {
    assert.equal(s.samples[0][0], 0);
    assert.equal(s.samples.at(-1)[0], end);
    assert.equal(s.samples.length, end / 15 + 1);
    const resets = s.samples.filter((p, i) => i > 0 && p[1] < s.samples[i - 1][1]).length;
    const grewBeforeDeploy = s.samples[deployAt / 15 - 1][1] > 0;
    assert.equal(resets, s.labels.service === 'checkout' && grewBeforeDeploy ? 1 : 0, labelKey(s.labels));
  }
});

test('histogram count, +Inf bucket and request counters agree at every scrape', () => {
  const by = (name) => D.series.filter((s) => s.labels.__name__ === name);
  const sums = new Map();
  for (const s of by('http_server_requests_total')) {
    const k = `${s.labels.service}${s.labels.route}`;
    sums.set(k, s.samples.map(([, v], i) => v + (sums.get(k)?.[i] ?? 0)));
  }
  for (const c of by('http_server_request_duration_seconds_count')) {
    const k = `${c.labels.service}${c.labels.route}`;
    assert.deepEqual(c.samples.map((p) => p[1]), sums.get(k), k);
    const inf = D.series.find((s) => s.labels.__name__.endsWith('_bucket') && s.labels.le === '+Inf' && s.labels.route === c.labels.route && s.labels.service === c.labels.service);
    assert.deepEqual(inf.samples, c.samples, k + ' +Inf');
  }
});

test('before the deploy /pay takes 4 req/s with 2 of 60 per scrape failing', () => {
  const t = 2100;
  assert.ok(approx(one(`sum(rate(http_server_requests_total{${PAY}}[5m]))`, t), 4));
  assert.ok(approx(one(`sum(rate(http_server_requests_total{${PAY},status="500"}[5m]))`, t), 2 / 15));
  assert.ok(approx(one(`sum(rate(http_server_requests_total{${PAY},status=~"5.."}[5m])) / sum(rate(http_server_requests_total{${PAY}}[5m]))`, t), 1 / 30));
});

test('after the deploy /pay errors jump to 25% and p99 to 2.5s while other routes do not move', () => {
  const ratio = 'sum by (route) (rate(http_server_requests_total{status=~"5.."}[5m])) / sum by (route) (rate(http_server_requests_total[5m]))';
  const before = val(ratio, 2100);
  const after = val(ratio, end);
  assert.ok(approx(after['route="/pay"'], 0.25));
  assert.ok(approx(before['route="/pay"'], 1 / 30));
  for (const r of ['/quote', '/add', '/view']) assert.equal(after[`route="${r}"`], 0, r);
  const q = (phi) => `histogram_quantile(${phi}, sum by (le) (rate(http_server_request_duration_seconds_bucket{${PAY}}[5m])))`;
  assert.ok(approx(one(q(0.99), 2100), 0.9), 'before: rank 59.4 in (0.5, 1]: 0.5 + 0.5 * 2.4/3');
  assert.ok(approx(one(q(0.9), 2100), 0.25 + 0.25 * (6 / 9)));
  assert.ok(approx(one(q(0.5), end), 0.5), 'after: rank 30 lands on the 0.5 bound');
  assert.ok(approx(one(q(0.9), end), 1.9), 'after: 1 + 1.5 * 6/10');
  assert.ok(approx(one(q(0.99), end), 2.5), 'after: rank in +Inf, highest finite bound');
});

test('the request rate survives the checkout restart because rate() handles the reset', () => {
  const rate = (t) => one(`sum(rate(http_server_requests_total{service="checkout",${PAY}}[5m]))`, t);
  assert.ok(approx(rate(2100), 4));
  assert.ok(approx(rate(end), 4));
  assert.ok(rate(deployAt + 60) > 3 && rate(deployAt + 60) < 5, String(rate(deployAt + 60)));
  const cart = one('sum(rate(http_server_requests_total{service="cart"}[5m]))', deployAt + 60);
  assert.ok(approx(cart, (90 + 150) / 15));
});

test('the last 5 minutes show 3 ok req/s on /pay and the average latency matches the buckets', () => {
  assert.ok(approx(one(`sum(rate(http_server_requests_total{${PAY},status="200"}[5m]))`, end), 3));
  const avg = one(`sum(rate(http_server_request_duration_seconds_sum{${PAY}}[5m])) / sum(rate(http_server_request_duration_seconds_count{${PAY}}[5m]))`, end);
  // per scrape: 0*.03 + 6*.07 + 12*.17 + 12*.4 + 18*.8 + 10*1.8 + 2*4 = 47.66 over 60
  assert.ok(approx(avg, 47.66 / 60, 1e-6), String(avg));
});

// ---- checkout-spanmetrics: what a spanmetrics connector in the Collector emits for the same traffic ----
// Hand-computed from the generator's per-scrape table (15s): /pay 60 calls (2 failing, 15 after the
// deploy), /quote 120, cart /add 90, cart /view 150 (1 failing), and checkout's outbound POST to the
// payment provider (a CLIENT span) once per /pay.

const S = getDataset('checkout-spanmetrics');
const sval = (q, t = end) => {
  const r = evaluate(S, t, q);
  assert.equal(r.kind, 'vector', q + JSON.stringify(r));
  return Object.fromEntries(r.series.map((x) => [labelKey(x.labels), x.value]));
};
const CALLS = 'traces_span_metrics_calls_total';
const SERVER = 'span_kind="SPAN_KIND_SERVER"';

test('checkout-spanmetrics: named by the connector, translated like 3.4, sorted, and counters only ever grow', () => {
  assert.equal(S.meta.scrape, 15);
  assert.equal(S.meta.end, 3600);
  const names = [...new Set(S.series.map((x) => x.labels.__name__))].sort();
  assert.deepEqual(names, [
    'traces_span_metrics_calls_total',
    'traces_span_metrics_duration_milliseconds_bucket',
    'traces_span_metrics_duration_milliseconds_count',
    'traces_span_metrics_duration_milliseconds_sum',
  ]);
  const keys = S.series.map((x) => labelKey(x.labels));
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(new Set(keys).size, keys.length);
  for (const x of S.series) {
    assert.equal(x.samples.length, 3600 / 15 + 1);
    assert.equal(x.samples.every((p, i) => i === 0 || p[1] >= x.samples[i - 1][1]), true, 'the connector, not the service, holds the count: a deploy is no reset');
    assert.deepEqual(Object.keys(x.labels).filter((k) => !['__name__', 'le'].includes(k)).sort(), ['service_name', 'span_kind', 'span_name', 'status_code']);
  }
});

test('checkout-spanmetrics: a success is UNSET, and a series exists only for a status the span has had', () => {
  const statuses = (name) => [...new Set(S.series.filter((x) => x.labels.__name__ === CALLS && x.labels.span_name === name).map((x) => x.labels.status_code))].sort();
  assert.deepEqual(statuses('POST /pay'), ['STATUS_CODE_ERROR', 'STATUS_CODE_UNSET']);
  assert.deepEqual(statuses('GET /quote'), ['STATUS_CODE_UNSET'], 'never failed: no error series, and no STATUS_CODE_OK either');
  assert.deepEqual(statuses('POST /add'), ['STATUS_CODE_UNSET']);
  assert.deepEqual(statuses('GET /view'), ['STATUS_CODE_ERROR', 'STATUS_CODE_UNSET']);
  assert.equal(S.series.some((x) => x.labels.status_code === 'STATUS_CODE_OK'), false);
});

test('checkout-spanmetrics: the last 5 minutes: server rate 12 and 16 req/s, and the client span adds 4 more to checkout', () => {
  assert.ok(approx(sval(`sum by (service_name) (rate(${CALLS}{${SERVER}}[5m]))`)['service_name="checkout"'], 12));
  assert.ok(approx(sval(`sum by (service_name) (rate(${CALLS}{${SERVER}}[5m]))`)['service_name="cart"'], 16));
  assert.ok(approx(sval(`sum by (service_name) (rate(${CALLS}[5m]))`)['service_name="checkout"'], 16), 'unfiltered: /pay counted twice');
  assert.ok(approx(sval(`sum(rate(${CALLS}{span_kind="SPAN_KIND_CLIENT"}[5m]))`)[''], 4));
});

test('checkout-spanmetrics: errors per second are 1 on checkout and 1/15 on cart, so the ratios are 1/12 and 1/240', () => {
  const err = `sum by (service_name) (rate(${CALLS}{${SERVER}, status_code="STATUS_CODE_ERROR"}[5m]))`;
  const all = `sum by (service_name) (rate(${CALLS}{${SERVER}}[5m]))`;
  const e = sval(err);
  assert.ok(approx(e['service_name="checkout"'], 1));
  assert.ok(approx(e['service_name="cart"'], 1 / 15));
  const ratio = sval(`${err} / ${all}`);
  assert.ok(approx(ratio['service_name="checkout"'], 1 / 12));
  assert.ok(approx(ratio['service_name="cart"'], 1 / 240));
  assert.ok(approx(sval(`${err} / ${all}`, 2100)['service_name="checkout"'], 2 / 15 / 12), 'before the deploy: 2 of 180 per scrape');
});

test('checkout-spanmetrics: histogram count, +Inf bucket and calls agree per span and status, and the p95 per service is the one 3.3 found, in milliseconds', () => {
  const by = (name, span, status) => S.series.filter((x) => x.labels.__name__ === name && x.labels.span_name === span && x.labels.span_kind === 'SPAN_KIND_SERVER' && x.labels.status_code === status);
  for (const [span, status] of [['POST /pay', 'STATUS_CODE_ERROR'], ['POST /pay', 'STATUS_CODE_UNSET'], ['GET /view', 'STATUS_CODE_ERROR'], ['GET /quote', 'STATUS_CODE_UNSET']]) {
    const [calls] = by(CALLS, span, status);
    const [count] = by('traces_span_metrics_duration_milliseconds_count', span, status);
    const inf = by('traces_span_metrics_duration_milliseconds_bucket', span, status).find((x) => x.labels.le === '+Inf');
    assert.deepEqual(count.samples, calls.samples, `${span} ${status}`);
    assert.deepEqual(inf.samples, calls.samples, `${span} ${status} +Inf`);
  }
  const p95 = sval(`histogram_quantile(0.95, sum by (service_name, le) (rate(traces_span_metrics_duration_milliseconds_bucket{${SERVER}}[5m])))`);
  // checkout: per scrape [60,46,27,17,18,10,2] of 180, rank 171 in (1000, 2500]: 1000 + 1500 * 3/10; cart: [135,70,25,10] of 240, rank 228 in (100, 250]: 100 + 150 * 23/25
  assert.ok(approx(p95['service_name="checkout"'], 1450, 1e-6));
  assert.ok(approx(p95['service_name="cart"'], 238, 1e-6));
  const unfiltered = sval(`histogram_quantile(0.95, sum by (service_name, le) (rate(traces_span_metrics_duration_milliseconds_bucket[5m])))`);
  assert.equal(Math.abs(unfiltered['service_name="checkout"'] - 1450) > 1, true, 'the client span moves checkout\'s p95');
});

const sone = (q, t = end) => {
  const v = Object.values(sval(q, t));
  assert.equal(v.length, 1, q);
  return v[0];
};

test('checkout-spanmetrics: failing requests are the slowest ones: /pay errors after the deploy land 3, 10 and 2 per scrape in (500,1000], (1000,2500] and +Inf', () => {
  const failed = (le) => sone(`sum(rate(traces_span_metrics_duration_milliseconds_bucket{span_name="POST /pay", span_kind="SPAN_KIND_SERVER", status_code="STATUS_CODE_ERROR", le="${le}"}[5m]))`, end);
  assert.ok(approx(failed('500'), 0), 'none under 500ms');
  assert.ok(approx(failed('1000'), 3 / 15));
  assert.ok(approx(failed('2500'), 13 / 15));
  assert.ok(approx(failed('+Inf'), 15 / 15));
  const ok = (le) => sone(`sum(rate(traces_span_metrics_duration_milliseconds_bucket{span_name="POST /pay", span_kind="SPAN_KIND_SERVER", status_code="STATUS_CODE_UNSET", le="${le}"}[5m]))`, end);
  assert.ok(approx(ok('+Inf'), 45 / 15), 'the other 45 of 60 per scrape succeeded');
  assert.ok(approx(ok('2500'), 45 / 15), 'and none of them is above 2.5s');
});
