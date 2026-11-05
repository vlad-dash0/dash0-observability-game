// lib/lesson-kit.mjs: escaping, speech, shuffle, reduced motion.
// Spec: docs/FOUNDATION.md §6 F3 kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, speech, shuffle, prefersReducedMotion } from '../lib/lesson-kit.mjs';
import { lesson } from '../lib/ui/index.mjs';

test('escapeHtml encodes & < > " and the single quote', () => {
  assert.equal(escapeHtml('<b>"x"</b> & y'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('plain'), 'plain');
});

test('escapeHtml turns null and undefined into empty text and stringifies numbers', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(5), '5');
  assert.equal(escapeHtml(0), '0');
});

test('speech is the kit lesson card around trusted HTML, not escaped (#158)', () => {
  assert.equal(speech('<b>hi</b>'), lesson('<b>hi</b>'));
  assert.ok(speech('<b>hi</b>').includes('<b>hi</b>'));
  assert.throws(() => speech(undefined), { name: 'TypeError', message: /^lesson:/ });
});

test('shuffle returns a new permutation and leaves a frozen input alone', () => {
  const input = Object.freeze([1, 2, 3, 4, 5]);
  const out = shuffle(input, () => 0);
  assert.notEqual(out, input);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.notDeepEqual(out, [1, 2, 3, 4, 5], 'rand() = 0 moves elements');
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
});

test('shuffle with a fixed rand gives the same order twice', () => {
  const seq = () => {
    let i = 0;
    const r = [0.1, 0.7, 0.3, 0.9];
    return () => r[i++ % r.length];
  };
  const a = shuffle(['a', 'b', 'c', 'd', 'e'], seq());
  const b = shuffle(['a', 'b', 'c', 'd', 'e'], seq());
  assert.deepEqual(a, b);
});

test('prefersReducedMotion reads matchMedia and never throws', () => {
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(
    prefersReducedMotion({
      matchMedia: () => {
        throw new Error('no');
      },
    }),
    false,
  );
});

test('prefersReducedMotion without a window returns false (module imported fine)', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(prefersReducedMotion(), false);
});
