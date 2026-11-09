// Leaderboard score encoding: most stars first, then earliest. Spec: #273 design section 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPOCH_MS, MAX_TOTAL, decodeScore, encodeScore } from '../lib/account/score.mjs';

const T1 = EPOCH_MS + 1_000 * 1000;
const T2 = T1 + 5_000;

test('more stars always beat fewer, whatever the time', () => {
  const late = EPOCH_MS + (2 ** 31 - 1) * 1000;
  assert.ok(encodeScore(10, late) > encodeScore(9, EPOCH_MS));
});

test('same total: the earlier time ranks higher', () => {
  assert.ok(encodeScore(10, T1) > encodeScore(10, T2));
});

test('decode round-trips, and total 0 works', () => {
  assert.deepEqual(decodeScore(encodeScore(42, T1)), { total: 42, reachedAtMs: T1 });
  assert.deepEqual(decodeScore(encodeScore(0, T2)), { total: 0, reachedAtMs: T2 });
});

test('every encoding stays within 2^53 and is exact', () => {
  const top = encodeScore(MAX_TOTAL, EPOCH_MS);
  assert.ok(top <= 2 ** 53);
  assert.ok(Number.isSafeInteger(top));
  assert.deepEqual(decodeScore(top), { total: MAX_TOTAL, reachedAtMs: EPOCH_MS });
});

test('refuses totals that are negative, fractional, too large or not numbers', () => {
  for (const bad of [-1, 1.5, MAX_TOTAL + 1, NaN, Infinity, '3', null]) {
    assert.throws(() => encodeScore(bad, T1), RangeError, String(bad));
  }
});

test('refuses times before the epoch or past the span; decode refuses non-scores', () => {
  assert.throws(() => encodeScore(1, EPOCH_MS - 1000), RangeError);
  assert.throws(() => encodeScore(1, NaN), RangeError);
  assert.throws(() => encodeScore(1, EPOCH_MS + 2 ** 31 * 1000), RangeError);
  for (const bad of [-1, 1.5, 2 ** 53, NaN, '5']) assert.throws(() => decodeScore(bad), RangeError);
});
