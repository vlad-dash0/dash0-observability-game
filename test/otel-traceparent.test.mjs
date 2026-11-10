// lib/otel/traceparent.mjs: W3C trace-context traceparent parsing.
// Spec: https://www.w3.org/TR/trace-context/#traceparent-header
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTraceparent } from '../lib/otel/traceparent.mjs';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';
const tp = (v = '00', t = TRACE, p = PARENT, f = '01') => `${v}-${t}-${p}-${f}`;

test('a valid header parses; only the sampled bit of the flags counts', () => {
  assert.deepEqual(parseTraceparent(tp()), { traceId: TRACE, parentId: PARENT, sampled: true });
  assert.equal(parseTraceparent(tp('00', TRACE, PARENT, '00')).sampled, false);
  assert.equal(parseTraceparent(tp('00', TRACE, PARENT, '03')).sampled, true);
  assert.equal(parseTraceparent(tp('00', TRACE, PARENT, '02')).sampled, false);
});

test('malformed headers are refused', () => {
  const bad = [
    null, undefined, '', 42, 'a, b',
    tp('00', '0'.repeat(32)), tp('00', TRACE, '0'.repeat(16)),
    tp('00', TRACE.toUpperCase()), tp('00', TRACE, PARENT.toUpperCase()), tp('ff'),
    tp('00').slice(0, 54), `${tp('00')}-`, `${tp('00')}x`, tp('00', TRACE, PARENT, 'zz'), tp('0G'),
  ];
  for (const v of bad) assert.equal(parseTraceparent(v), null, String(v));
});

test('a higher version parses its first 55 characters and ignores what follows a dash', () => {
  assert.deepEqual(parseTraceparent(`${tp('01')}-extra`), { traceId: TRACE, parentId: PARENT, sampled: true });
  assert.equal(parseTraceparent(tp('01'))?.traceId, TRACE);
  assert.equal(parseTraceparent(tp('01').slice(0, 54)), null);
  assert.equal(parseTraceparent(`${tp('01')}x`), null);
});
