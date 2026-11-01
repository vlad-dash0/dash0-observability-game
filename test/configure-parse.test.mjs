// lib/configure/parse.mjs: untrusted YAML text in, a plain mapping or ONE error object out.
// Spec: docs/M1-DESIGN.md §4.8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, MAX_CHARS } from '../lib/configure/parse.mjs';

const fail = (text) => {
  const r = parseYaml(text);
  assert.equal(r.ok, false, `expected a failure for ${JSON.stringify(text.slice(0, 40))}`);
  return r.error;
};

test('a mapping parses to a plain object', () => {
  const r = parseYaml('alpha: 1\nbeta:\n  - x\n  - true\ngamma: {delta: null}\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc, { alpha: 1, beta: ['x', true], gamma: { delta: null } });
});

test('the input must be a string', () => {
  for (const bad of [undefined, null, 5, {}]) assert.throws(() => parseYaml(bad), TypeError);
});

test('text over MAX_CHARS is refused before it is parsed; exactly MAX_CHARS is accepted', () => {
  assert.equal(MAX_CHARS, 32768);
  const pad = (n) => `k: ${'x'.repeat(n - 3)}`;
  assert.equal(parseYaml(pad(MAX_CHARS)).ok, true);
  assert.deepEqual(fail(pad(MAX_CHARS + 1)), {
    kind: 'too-large', path: '', message: 'the file is longer than 32768 characters', line: null, column: null,
  });
});

test('a syntax error carries the library reason and a 1-based line and column', () => {
  assert.deepEqual(fail('a: b: c'), {
    kind: 'parse', path: '', message: 'bad indentation of a mapping entry', line: 1, column: 5,
  });
  assert.deepEqual(fail('x:\n  - b\n c: d'), {
    kind: 'parse', path: '', message: 'bad indentation of a mapping entry', line: 3, column: 2,
  });
});

test('a second document is a parse error without a position', () => {
  assert.deepEqual(fail('a: 1\n---\nb: 2'), {
    kind: 'parse', path: '', message: 'expected a single document in the stream, but found more', line: null, column: null,
  });
});

test('a duplicate key is its own error kind, with the position of the second key', () => {
  assert.deepEqual(fail('one: 1\ntwo: 2\none: 3'), {
    kind: 'duplicate-key', path: '', message: 'duplicate key', line: 3, column: 1,
  });
  assert.deepEqual(fail('svc:\n  a: 1\n  b: 2\n  b: 3'), {
    kind: 'duplicate-key', path: '', message: 'duplicate key', line: 4, column: 3,
  });
  assert.equal(fail('{p: 1, p: 2}').kind, 'duplicate-key', 'flow mappings too');
});

test('the top level must be a mapping', () => {
  const root = (text) => fail(text);
  assert.deepEqual(root('- 1\n- 2'), { kind: 'root', path: '', message: 'the top level must be a mapping, got a list', line: null, column: null });
  assert.equal(root('just words').message, 'the top level must be a mapping, got a string');
  assert.equal(root('42').message, 'the top level must be a mapping, got a number');
  assert.equal(root('true').message, 'the top level must be a mapping, got a boolean');
  assert.equal(root('null').message, 'the top level must be a mapping, got null');
  assert.equal(root('').message, 'the top level must be a mapping, got an empty document');
  assert.equal(root('  \n\t\n').message, 'the top level must be a mapping, got an empty document');
  assert.equal(root('---').message, 'the top level must be a mapping, got null');
  assert.equal(root('# only a comment\n').message, 'the top level must be a mapping, got an empty document');
});

test('safe load: only the core schema, no custom or language-specific tags', () => {
  assert.deepEqual(fail('a: !!js/function x'), {
    kind: 'parse', path: '', message: 'unknown scalar tag !<tag:yaml.org,2002:js/function>', line: 1, column: 4,
  });
  assert.equal(fail('a: !!binary x').kind, 'parse');
  // Core schema: a timestamp stays text and `<<` is an ordinary key.
  assert.deepEqual(parseYaml('when: 2001-01-01\n<<: {m: 1}').doc, { when: '2001-01-01', '<<': { m: 1 } });
});

test('an alias of a collection is refused, naming where the shared node is reused', () => {
  assert.deepEqual(fail('base: &b\n  x: 1\nuse: *b'), {
    kind: 'alias', path: 'use', message: 'aliases (*name) are not supported', line: null, column: null,
  });
  assert.equal(fail('a: &a [1]\nl: [2, *a]').path, 'l[1]');
});

test('an alias of a scalar is accepted: it copies a value and cannot grow', () => {
  assert.deepEqual(parseYaml('a: &v hello\nb: *v').doc, { a: 'hello', b: 'hello' });
});

test('an alias bomb is refused quickly, without expanding', () => {
  const names = 'abcdefghijklmnop'.split('');
  const lines = [`${names[0]}: &${names[0]} [x, x, x, x, x, x, x, x, x]`];
  for (let i = 1; i < names.length; i++) {
    lines.push(`${names[i]}: &${names[i]} [${Array(9).fill(`*${names[i - 1]}`).join(', ')}]`);
  }
  const t0 = Date.now();
  const e = fail(lines.join('\n'));
  assert.ok(Date.now() - t0 < 1000, 'the guard must not walk the expanded tree');
  assert.deepEqual([e.kind, e.path], ['alias', 'b[0]']);
});

test('absurd nesting is a parse error, not a crash', () => {
  assert.equal(fail('['.repeat(30000)).kind, 'parse');
  assert.equal(fail(`a: ${'['.repeat(300)}${']'.repeat(300)}`).kind, 'parse');
});

test('a __proto__ key is an ordinary own key and pollutes nothing', () => {
  const { doc } = parseYaml('__proto__: {polluted: yes}');
  assert.deepEqual(Object.keys(doc), ['__proto__']);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(doc), Object.prototype);
});
