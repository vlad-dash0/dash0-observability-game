// The OTLP/HTTP JSON trace encoder (lib/otlp/encode.mjs). Spec: docs/DASH0-LAB.md §Encoder;
// https://opentelemetry.io/docs/specs/otlp/ (JSON Protobuf Encoding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_VERSION, encodeResourceSpans, encodeTraces, msToUnixNano } from '../lib/otlp/encode.mjs';

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
  // semconv lists telemetry.sdk.version in the same required group as name and language.
  assert.equal(typeof SERVICE_VERSION, 'string');
  assert.match(SERVICE_VERSION, /^\d+\.\d+\.\d+/);
  assert.deepEqual(attr(resource, 'telemetry.sdk.version'), [{ stringValue: SERVICE_VERSION }]);
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

test('intValue only for safe integers and bigints: an unsafe number throws, a bigint is exact', () => {
  const enc = (v) => attr(spansOf(encodeTraces([{ ...root, attributes: { n: v } }], { sessionId: SESSION }))[0].attributes, 'n');
  assert.deepEqual(enc(Number.MAX_SAFE_INTEGER), [{ intValue: '9007199254740991' }]);
  assert.deepEqual(enc(-Number.MAX_SAFE_INTEGER), [{ intValue: '-9007199254740991' }]);
  assert.deepEqual(enc(0), [{ intValue: '0' }]);
  // 1e21 would print as "1e+21", and 2**53+1 has already lost its last digit.
  for (const v of [1e21, 2 ** 53 + 1, 2 ** 53, -(2 ** 53)]) {
    assert.throws(() => enc(v), RangeError, String(v));
  }
  // A bigint beyond 2**53 (and the int64 edge) is encoded digit for digit.
  assert.deepEqual(enc(2n ** 53n + 1n), [{ intValue: '9007199254740993' }]);
  assert.deepEqual(enc(9223372036854775807n), [{ intValue: '9223372036854775807' }]);
});

test('events encode name, time and attributes', () => {
  const [r, c] = spansOf(encodeTraces([root, child], { sessionId: SESSION }));
  assert.ok(!('events' in r), 'no events key on a span without events');
  assert.deepEqual(c.events, [
    { timeUnixNano: '1762300800250000000', name: 'retry', attributes: [{ key: 'attempt', value: { intValue: '2' } }] },
  ]);
});

test('encodeResourceSpans: uses the given resource and scope and adds no session.id by default', () => {
  const req = encodeResourceSpans([root], {
    resource: { 'service.name': 'svc-x', 'telemetry.sdk.language': 'nodejs' },
    scope: { name: 'svc-x', version: '9' },
  });
  const rs = req.resourceSpans[0];
  assert.deepEqual(rs.resource.attributes, [
    { key: 'service.name', value: { stringValue: 'svc-x' } },
    { key: 'telemetry.sdk.language', value: { stringValue: 'nodejs' } },
  ]);
  assert.deepEqual(rs.scopeSpans[0].scope, { name: 'svc-x', version: '9' });
  for (const span of rs.scopeSpans[0].spans) {
    assert.equal(span.attributes.some((a) => a.key === 'session.id'), false);
  }
});

test('encodeResourceSpans: a stamp beats a draft attribute', () => {
  const req = encodeResourceSpans([{ ...root, attributes: { k: 'draft' } }], {
    resource: { 'service.name': 'svc-x' },
    scope: { name: 'svc-x', version: '9' },
    stamp: { k: 'stamp' },
  });
  const ks = req.resourceSpans[0].scopeSpans[0].spans[0].attributes.filter((a) => a.key === 'k');
  assert.deepEqual(ks, [{ key: 'k', value: { stringValue: 'stamp' } }]);
});

test('encodeResourceSpans refuses an empty batch, a resource without service.name, a bad scope and a bad stamp', () => {
  const ok = { resource: { 'service.name': 'svc-x' }, scope: { name: 'svc-x', version: '9' } };
  assert.doesNotThrow(() => encodeResourceSpans([root], { ...ok, scope: { name: 'svc-x' } }));
  assert.throws(() => encodeResourceSpans([], ok), RangeError);
  assert.throws(() => encodeResourceSpans([root]), TypeError);
  assert.throws(() => encodeResourceSpans([root], { ...ok, resource: undefined }), TypeError);
  for (const resource of [null, 'svc', ['service.name'], {}, { 'service.name': '' }, { 'service.name': 5 }]) {
    assert.throws(() => encodeResourceSpans([root], { ...ok, resource }), TypeError, JSON.stringify(resource));
  }
  for (const scope of [undefined, null, 'svc', {}, { name: '' }, { name: 5 }, { name: 'a', version: 9 }]) {
    assert.throws(() => encodeResourceSpans([root], { ...ok, scope }), TypeError, JSON.stringify(scope));
  }
  for (const stamp of [null, 'abc', ['a'], 5]) {
    assert.throws(() => encodeResourceSpans([root], { ...ok, stamp }), TypeError, JSON.stringify(stamp));
  }
});
