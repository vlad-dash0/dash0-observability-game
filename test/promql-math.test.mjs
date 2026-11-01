// lib/promql/math.mjs: rate/increase extrapolation and histogram_quantile, on hand-computed inputs.
// Spec: docs/M1-DESIGN.md §4.6. Window is (end - range, end].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketQuantile, extrapolatedDelta } from '../lib/promql/math.mjs';
import { approx } from './helpers/promql.mjs';

const S = (...vs) => vs.map(([t, v]) => [t, v]);
const INCREASE = (samples, end = 60, range = 60) => extrapolatedDelta(samples, end - range, end, range, false);

test('increase extrapolates to the window edges when samples are near them', () => {
  // t=10..60 step 10, values 10..60: delta 50, interval 50, both edges within 1.1 x 10 of the
  // window (start gap 10, end gap 0) -> extrapolated to 60s, factor 1.2 -> 60.
  assert.ok(approx(INCREASE(S([10, 10], [20, 20], [30, 30], [40, 40], [50, 50], [60, 60])), 60));
});

test('rate divides the extrapolated increase by the range, not by the sampled interval', () => {
  const s = S([10, 10], [20, 20], [30, 30], [40, 40], [50, 50], [60, 60]);
  assert.ok(approx(extrapolatedDelta(s, 0, 60, 60, true), 1));
});

test('extrapolation to the start stops where the counter would have been zero', () => {
  // t=20,30,40 values 2,4,6; delta 4 over 20s. Zero is 10s before t=20 (20 * 2/4), that is
  // inside the 11s threshold -> +10. End gap 20 >= 11 -> + half an interval (5). 35/20 * 4 = 7.
  assert.ok(approx(INCREASE(S([20, 2], [30, 4], [40, 6])), 7));
});

test('a gap at the end extrapolates by half a sample interval only', () => {
  // t=10,20,30 values 10,20,30: start gap 10 (+10), end gap 30 >= 11 (+5): 35/20 * 20 = 35.
  assert.ok(approx(INCREASE(S([10, 10], [20, 20], [30, 30])), 35));
});

test('a counter reset adds the value before the reset', () => {
  // 10,20,30,5,15,25: last - first = 15, plus 30 at the reset = 45; factor 1.2 -> 54.
  const s = S([10, 10], [20, 20], [30, 30], [40, 5], [50, 15], [60, 25]);
  assert.ok(approx(INCREASE(s), 54));
  assert.ok(approx(extrapolatedDelta(s, 0, 60, 60, true), 0.9));
});

test('fewer than two samples gives no result, not zero', () => {
  assert.equal(INCREASE(S([60, 5])), null);
  assert.equal(INCREASE([]), null);
});

test('a flat counter increases by zero, which is a result', () => {
  assert.equal(INCREASE(S([10, 7], [30, 7], [50, 7])), 0);
});

const B = (...pairs) => pairs.map(([le, count]) => ({ le, count }));
const INF = Infinity;

test('histogram_quantile interpolates linearly inside the bucket', () => {
  const b = B([0.1, 10], [0.5, 30], [1, 40], [INF, 50]);
  assert.ok(approx(bucketQuantile(0.5, b), 0.4)); // rank 25: 0.1 + 0.4 * 15/20
  assert.ok(approx(bucketQuantile(0.1, b), 0.05)); // first bucket starts at 0: 0.1 * 5/10
  assert.equal(bucketQuantile(0, b), 0);
});

test('a rank in the +Inf bucket answers the highest finite bound', () => {
  const b = B([0.1, 10], [0.5, 30], [1, 40], [INF, 50]);
  assert.equal(bucketQuantile(0.9, b), 1);
  assert.equal(bucketQuantile(1, b), 1);
});

test('histogram_quantile edge cases follow Prometheus', () => {
  const b = B([0.1, 10], [0.5, 30], [INF, 40]);
  assert.equal(bucketQuantile(-0.1, b), -INF);
  assert.equal(bucketQuantile(1.1, b), INF);
  assert.ok(Number.isNaN(bucketQuantile(NaN, b)));
  assert.ok(Number.isNaN(bucketQuantile(0.5, B([0.1, 10], [0.5, 30]))), 'no +Inf bucket');
  assert.ok(Number.isNaN(bucketQuantile(0.5, B([INF, 10]))), 'only +Inf');
  assert.ok(Number.isNaN(bucketQuantile(0.5, B([0.1, 0], [INF, 0]))), 'no observations');
  assert.equal(bucketQuantile(0.5, B([-1, 5], [INF, 5])), -1, 'first bucket bound <= 0');
});

test('buckets are sorted, coalesced and made monotonic first', () => {
  assert.ok(approx(bucketQuantile(0.5, B([INF, 20], [0.5, 8], [0.1, 10])), 0.1), 'unsorted, 8 < 10 raised to 10');
  assert.ok(approx(bucketQuantile(0.5, B([0.5, 5], [0.5, 5], [INF, 10])), 0.25), 'same bound summed to 10');
});
