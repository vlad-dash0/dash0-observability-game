// lib/scoring.mjs: the one star rule. Spec: docs/FOUNDATION.md §2.6 and §6 F3 scoring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STARS, scoreStars } from '../lib/scoring.mjs';

const LEVEL = { scored: true, scoring: { parMs: null } };
const PAR = { scored: true, scoring: { parMs: 60000 } };
const run = (mistakes, hintsUsed = 0, elapsedMs = 0) => ({ mistakes, hintsUsed, elapsedMs });

test('the maximum is five stars', () => {
  assert.equal(MAX_STARS, 5);
});

test('penalties 0 to 6 map to 5, 4, 3, 2, 2, 1, 1 stars (every boundary)', () => {
  const expected = [5, 4, 3, 2, 2, 1, 1];
  expected.forEach((stars, penalties) => {
    assert.equal(scoreStars(run(penalties), LEVEL), stars, `${penalties} penalties`);
  });
});

test('a large penalty count stays at 1 star, never 0', () => {
  assert.equal(scoreStars(run(100), LEVEL), 1);
});

test('mistakes and hints are summed into one penalty count', () => {
  assert.equal(scoreStars(run(0, 1), LEVEL), 4);
  assert.equal(scoreStars(run(1, 1), LEVEL), 3);
  assert.equal(scoreStars(run(2, 1), LEVEL), 2);
  assert.equal(scoreStars(run(1, 3), LEVEL), 2, '4 penalties');
  assert.equal(scoreStars(run(2, 3), LEVEL), 1, '5 penalties');
  assert.equal(scoreStars(run(0, 5), LEVEL), 1);
});

test('going over par is one extra penalty; landing exactly on par is not', () => {
  assert.equal(scoreStars(run(0, 0, 60000), PAR), 5);
  assert.equal(scoreStars(run(0, 0, 60001), PAR), 4);
  assert.equal(scoreStars(run(2, 0, 60001), PAR), 2, 'two mistakes plus over par is 3 penalties');
  assert.equal(scoreStars(run(4, 0, 60001), PAR), 1, 'four mistakes plus over par is 5 penalties');
  assert.equal(scoreStars(run(4, 0, 60000), PAR), 2, 'four mistakes on par is 4 penalties');
});

test('over par counts once however far over', () => {
  assert.equal(scoreStars(run(0, 0, 10 ** 9), PAR), 4);
});

test('no par means elapsed time never costs a star', () => {
  assert.equal(scoreStars(run(0, 0, 10 ** 9), LEVEL), 5);
});

test('an unscored level always earns 0 stars', () => {
  assert.equal(scoreStars(run(0), { scored: false, scoring: { parMs: null } }), 0);
  assert.equal(scoreStars(run(7, 2, 10 ** 9), { scored: false, scoring: { parMs: 1 } }), 0);
});
