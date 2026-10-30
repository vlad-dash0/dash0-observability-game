// lib/scoring.mjs: the one star rule. Spec: docs/FOUNDATION.md §2.6 and §6 F3 scoring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreStars } from '../lib/scoring.mjs';

const LEVEL = { scored: true, scoring: { parMs: null } };
const PAR = { scored: true, scoring: { parMs: 60000 } };
const run = (mistakes, hintsUsed = 0, elapsedMs = 0) => ({ mistakes, hintsUsed, elapsedMs });

test('a clean run earns 3 stars', () => {
  assert.equal(scoreStars(run(0), LEVEL), 3);
});

test('one or two penalties earn 2 stars', () => {
  assert.equal(scoreStars(run(1), LEVEL), 2);
  assert.equal(scoreStars(run(2), LEVEL), 2);
  assert.equal(scoreStars(run(0, 1), LEVEL), 2);
});

test('three or more penalties earn 1 star', () => {
  assert.equal(scoreStars(run(3), LEVEL), 1);
  assert.equal(scoreStars(run(100), LEVEL), 1);
  assert.equal(scoreStars(run(1, 2), LEVEL), 1);
});

test('going over par costs one penalty; landing exactly on par does not', () => {
  assert.equal(scoreStars(run(0, 0, 60000), PAR), 3);
  assert.equal(scoreStars(run(0, 0, 60001), PAR), 2);
});

test('no par means elapsed time never costs a star', () => {
  assert.equal(scoreStars(run(0, 0, 10 ** 9), LEVEL), 3);
});

test('an unscored level always earns 0 stars', () => {
  assert.equal(scoreStars(run(0), { scored: false, scoring: { parMs: null } }), 0);
});
