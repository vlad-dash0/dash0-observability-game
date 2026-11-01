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
  assert.deepEqual(datasetNames(), ['checkout-http']);
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
  assert.ok(approx(one(q(0.9), end), 2), 'after: 1 + 1.5 * 6/9');
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
  // per scrape: 0*.03 + 6*.07 + 12*.17 + 12*.4 + 18*.8 + 9*1.8 + 3*4 = 49.86 over 60
  assert.ok(approx(avg, 49.86 / 60, 1e-6), String(avg));
});
