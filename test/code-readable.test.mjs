// #321 P2: authored evidence markup. Log output wraps (data-wrap), a multi-line snippet is a code block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../levels/${f}.mjs`, import.meta.url), 'utf8');

test('log and command output is a wrapping pre; the silence error line is one of them', () => {
  for (const f of ['silence', 'everything-is-green', 'ai-assisted-debugging']) {
    assert.match(src(f), /<pre data-wrap><code>/, f);
  }
  assert.match(src('silence'), /<pre data-wrap><code>Error: invalid configuration/);
});

test('a config diff stays a scrolling pre (its indentation is the meaning)', () => {
  assert.doesNotMatch(src('errors-tripled'), /<pre data-wrap>/);
});

test('events-and-links shows the catch/finally snippet as a code block, not inline code', () => {
  const s = src('events-and-links');
  assert.doesNotMatch(s, /<code>catch \(err\)/);
  assert.match(s, /codeBlock\('catch \(err\) \{\\n/);
});

test('a traceparent is marked data-token wherever a level shows one', () => {
  assert.equal((src('context-propagation').match(/<code data-token>/g) ?? []).length, 6);
  assert.match(src('frontend-rum'), /<code data-token>traceparent: 00-/);
  assert.match(src('the-trace-that-starts-in-the-middle'), /header = \(text\) => `<code data-token>/);
});
