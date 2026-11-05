// The OTLP/HTTP JSON trace encoder (lib/otlp/encode.mjs). Spec: docs/DASH0-LAB.md §Encoder;
// https://opentelemetry.io/docs/specs/otlp/ (JSON Protobuf Encoding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeTraces, msToUnixNano } from '../lib/otlp/encode.mjs';

const SESSION = 's-7k2m9q';
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const ROOT_ID = '00f067aa0ba902b7';
const CHILD_ID = 'a1b2c3d4e5f60718';

const root = {
  traceId: TRACE,
  spanId: ROOT_ID,
  name: 'level.complete',
  startMs: 1762300800123,
  endMs: 1762300800456,
  attributes: { 'game.level.id': 'otlp-endpoints', 'game.level.stars': 3, 'game.debug': false },
};
const child = {
  traceId: TRACE,
  spanId: CHILD_ID,
  parentSpanId: ROOT_ID,
  name: 'storage.write',
  kind: 'client',
  startMs: 1762300800200,
  endMs: 1762300800300,
  status: { code: 'error', message: 'write failed' },
  // A draft cannot override the session stamp.
  attributes: { 'session.id': 'spoofed' },
  events: [{ name: 'retry', timeMs: 1762300800250, attributes: { attempt: 2 } }],
};

const spansOf = (req) => req.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
const attr = (list, key) => list.filter((a) => a.key === key).map((a) => a.value);

test('encodeTraces puts spans under one resource with service.name and stamps session.id on every span', () => {
  const req = encodeTraces([root, child], { sessionId: SESSION });
  assert.equal(req.resourceSpans.length, 1);
  const resource = req.resourceSpans[0].resource.attributes;
  assert.deepEqual(attr(resource, 'service.name'), [{ stringValue: 'oncall-game' }]);
  assert.deepEqual(attr(resource, 'telemetry.sdk.name'), [{ stringValue: 'oncall-game-otlp' }]);
  assert.deepEqual(attr(resource, 'telemetry.sdk.language'), [{ stringValue: 'webjs' }]);
  assert.deepEqual(attr(resource, 'session.id'), [], 'the session is a span attribute, not a resource one');
  const spans = spansOf(req);
  assert.deepEqual(spans.map((s) => s.name), ['level.complete', 'storage.write']);
  for (const s of spans) {
    assert.deepEqual(attr(s.attributes, 'session.id'), [{ stringValue: SESSION }], `${s.name} session.id`);
  }
  // The draft's own attributes survive next to the stamp.
  assert.deepEqual(attr(spans[0].attributes, 'game.level.id'), [{ stringValue: 'otlp-endpoints' }]);
});

test('encodeTraces rejects a missing session id and an empty batch', () => {
  assert.throws(() => encodeTraces([root], {}), TypeError);
  assert.throws(() => encodeTraces([], { sessionId: SESSION }), RangeError);
});

test("ids are lowercase hex (JSON encoding), traceId 32 and spanId 16 characters; a root has no parentSpanId, a child has its parent's", () => {
  const [r, c] = spansOf(encodeTraces([root, child], { sessionId: SESSION }));
  assert.equal(r.traceId, TRACE);
  assert.equal(r.spanId, ROOT_ID);
  assert.match(r.traceId, /^[0-9a-f]{32}$/);
  assert.match(c.spanId, /^[0-9a-f]{16}$/);
  assert.equal(c.spanId, CHILD_ID);
  assert.equal(c.traceId, TRACE);
  assert.ok(!('parentSpanId' in r), 'a root has no parentSpanId');
  assert.equal(c.parentSpanId, ROOT_ID);
  // Upper case or the wrong length is a bug upstream, not something to pass on.
  assert.throws(() => encodeTraces([{ ...root, traceId: TRACE.toUpperCase() }], { sessionId: SESSION }), TypeError);
  assert.throws(() => encodeTraces([{ ...root, spanId: ROOT_ID.slice(1) }], { sessionId: SESSION }), TypeError);
});

test('timestamps are decimal-string unix nanos without float loss', () => {
  // ms * 1e6 as a double is 1762300800123000064; only integer arithmetic gives the exact value.
  assert.equal(msToUnixNano(1762300800123), '1762300800123000000');
  assert.equal(msToUnixNano(1762300800001), '1762300800001000000');
  assert.equal(msToUnixNano(1762300800123.5), '1762300800123500000');
  assert.equal(msToUnixNano(0), '0');
  assert.throws(() => msToUnixNano(-1), RangeError);
  assert.throws(() => msToUnixNano(Number.NaN), RangeError);
  const [r, c] = spansOf(encodeTraces([root, child], { sessionId: SESSION }));
  assert.equal(r.startTimeUnixNano, '1762300800123000000');
  assert.equal(r.endTimeUnixNano, '1762300800456000000');
  assert.equal(c.startTimeUnixNano, '1762300800200000000');
});

test('int attributes are intValue strings, bools boolValue, kind and status enums are integers', () => {
  const [r, c] = spansOf(encodeTraces([root, child], { sessionId: SESSION }));
  assert.deepEqual(attr(r.attributes, 'game.level.stars'), [{ intValue: '3' }]);
  assert.deepEqual(attr(r.attributes, 'game.debug'), [{ boolValue: false }]);
  assert.equal(r.kind, 1, 'INTERNAL is the default kind');
  assert.equal(c.kind, 3, 'CLIENT');
  assert.deepEqual(c.status, { code: 2, message: 'write failed' });
  assert.ok(!('status' in r) || r.status.code !== 2, 'an unset status is not ERROR');
  assert.equal(r.status, undefined);
  const [d] = spansOf(encodeTraces([{ ...root, attributes: { ratio: 0.25 } }], { sessionId: SESSION }));
  assert.deepEqual(attr(d.attributes, 'ratio'), [{ doubleValue: 0.25 }]);
});

test('events encode name, time and attributes', () => {
  const [r, c] = spansOf(encodeTraces([root, child], { sessionId: SESSION }));
  assert.ok(!('events' in r), 'no events key on a span without events');
  assert.deepEqual(c.events, [
    { timeUnixNano: '1762300800250000000', name: 'retry', attributes: [{ key: 'attempt', value: { intValue: '2' } }] },
  ]);
});
