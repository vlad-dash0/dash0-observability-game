// lib/configure/paths.mjs: key paths as strings, and path patterns that find values.
// Spec: docs/M1-DESIGN.md §4.8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinPath, resolvePattern, parsePattern } from '../lib/configure/paths.mjs';

test('joinPath builds readable key paths', () => {
  assert.equal(joinPath('', 'service'), 'service');
  assert.equal(joinPath('service', 'pipelines'), 'service.pipelines');
  assert.equal(joinPath('service.pipelines.traces', 'exporters'), 'service.pipelines.traces.exporters');
  assert.equal(joinPath('a', 0), 'a[0]');
  assert.equal(joinPath('', 3), '[3]');
  assert.equal(joinPath('a[1]', 'b'), 'a[1].b');
  assert.equal(joinPath('exporters', 'otlp/backend-2'), 'exporters.otlp/backend-2');
  assert.equal(joinPath('p', 'my_key'), 'p.my_key');
});

test('joinPath quotes keys that would be ambiguous', () => {
  assert.equal(joinPath('x', 'a.b'), 'x["a.b"]');
  assert.equal(joinPath('', 'has space'), '["has space"]');
  assert.equal(joinPath('x', 'say "hi"'), 'x["say \\"hi\\""]');
  assert.equal(joinPath('x', 'a[0]'), 'x["a[0]"]');
  assert.equal(joinPath('x', ''), 'x[""]');
});

test('parsePattern splits dotted segments; `*` is any key and a trailing [] is each list item', () => {
  assert.deepEqual(parsePattern('service.pipelines.*.receivers[]'), [
    { key: 'service', each: false }, { key: 'pipelines', each: false },
    { key: '*', each: false }, { key: 'receivers', each: true },
  ]);
  assert.deepEqual(parsePattern('exporters'), [{ key: 'exporters', each: false }]);
});

test('parsePattern rejects malformed patterns', () => {
  for (const bad of ['', '.a', 'a.', 'a..b', 'a[', 'a[0]', '*[]x', '[]']) {
    assert.throws(() => parsePattern(bad), /bad path pattern/, bad);
  }
});

const DOC = {
  service: {
    pipelines: {
      traces: { receivers: ['r1', 'r2'], exporters: ['e1'] },
      'logs/x': { receivers: ['r3'], exporters: 'not-a-list' },
      broken: 7,
    },
  },
};

test('resolvePattern returns each matching value with its key path, in document order', () => {
  assert.deepEqual(resolvePattern(DOC, 'service.pipelines.*.receivers[]'), [
    { path: 'service.pipelines.traces.receivers[0]', value: 'r1' },
    { path: 'service.pipelines.traces.receivers[1]', value: 'r2' },
    { path: 'service.pipelines.logs/x.receivers[0]', value: 'r3' },
  ]);
});

test('resolvePattern skips what is not there or has the wrong shape (the schema reports that)', () => {
  assert.deepEqual(resolvePattern(DOC, 'service.pipelines.*.exporters[]').map((m) => m.path),
    ['service.pipelines.traces.exporters[0]']);
  assert.deepEqual(resolvePattern(DOC, 'nothing.here[]'), []);
  assert.deepEqual(resolvePattern(DOC, 'service.pipelines.broken.receivers[]'), []);
  assert.deepEqual(resolvePattern(DOC, 'service.pipelines.traces'), [
    { path: 'service.pipelines.traces', value: DOC.service.pipelines.traces },
  ]);
});

test('resolvePattern does not follow inherited properties', () => {
  assert.deepEqual(resolvePattern({}, 'constructor'), []);
  assert.deepEqual(resolvePattern({}, 'toString.name'), []);
});
