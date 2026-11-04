// lib/widgets/trace.mjs: the trace waterfall and service-map edges.
// Spec: docs/M1-DESIGN.md §4.2, §7 P5. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceEdges, timeAxis, waterfall } from '../lib/widgets/trace.mjs';
import { A, B, C, D, E, OTHER_TRACE, TRACE, b1Spans } from './fixtures/build-b1.mjs';

function deepFreeze(v) {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

const T1 = '11111111111111111111111111111111';
const T2 = '22222222222222222222222222222222';
/** A span with defaults; `id` is padded to 16 hex. */
function sp(id, { trace = T1, parent = null, start = 0, end = 10, kind = 'INTERNAL', service = 'svc', links = [] } = {}) {
  return {
    spanId: id.padStart(16, '0'), traceId: trace, name: `op ${id}`, service, kind,
    startMs: start, endMs: end, status: 'UNSET', attributes: {}, events: [],
    parentId: parent === null ? null : parent.padStart(16, '0'), links: links.map((l) => l.padStart(16, '0')),
  };
}
const order = (spans) => waterfall(spans).rows.map((r) => `${r.spanId.replace(/^0+/, '')}@${r.depth}`);

// waterfall

test('waterfall on fixture B1: rows in trace and DFS order with depth, x and width', () => {
  const { rows, traces } = waterfall(deepFreeze(b1Spans()));
  assert.deepEqual(traces, [TRACE, OTHER_TRACE], 'by earliest start, not by trace id');
  assert.deepEqual(rows, [
    { spanId: A, traceId: TRACE, depth: 0, x: 0, width: 100, name: 'POST /checkout', service: 'storefront', kind: 'SERVER', status: 'UNSET', orphan: false, crossTrace: false },
    { spanId: B, traceId: TRACE, depth: 1, x: 10, width: 80, name: 'POST', service: 'storefront', kind: 'CLIENT', status: 'UNSET', orphan: false, crossTrace: false },
    { spanId: C, traceId: TRACE, depth: 2, x: 15, width: 70, name: 'POST /checkout', service: 'api-gateway', kind: 'SERVER', status: 'UNSET', orphan: false, crossTrace: false },
    { spanId: D, traceId: TRACE, depth: 3, x: 20, width: 10, name: 'validate cart', service: 'api-gateway', kind: 'INTERNAL', status: 'UNSET', orphan: false, crossTrace: false },
    { spanId: E, traceId: OTHER_TRACE, depth: 0, x: 40, width: 20, name: 'GET /products', service: 'storefront', kind: 'SERVER', status: 'UNSET', orphan: false, crossTrace: false },
  ]);
});

test('waterfall: x and width are percentages of the whole time range, not milliseconds', () => {
  const rows = waterfall([
    sp('a', { start: 1000, end: 1400 }),
    sp('b', { parent: 'a', start: 1100, end: 1200 }),
    sp('c', { trace: T2, start: 1300, end: 1400 }),
  ]).rows;
  assert.deepEqual(rows.map((r) => [r.x, r.width]), [[0, 100], [25, 25], [75, 25]]);
});

test('waterfall: children by startMs, then spanId on a tie; each subtree before the next sibling', () => {
  const spans = [
    sp('1', { start: 0, end: 100 }),
    sp('aa', { parent: '1', start: 20, end: 30 }),
    sp('0b', { parent: '1', start: 20, end: 25 }),
    sp('ff', { parent: '1', start: 10, end: 50 }),
    sp('c', { parent: 'ff', start: 40, end: 45 }),
    sp('2', { parent: '1', start: 60, end: 70 }),
  ];
  assert.deepEqual(order(spans), ['1@0', 'ff@1', 'c@2', 'b@1', 'aa@1', '2@1']);
  assert.deepEqual(order([...spans].reverse()), ['1@0', 'ff@1', 'c@2', 'b@1', 'aa@1', '2@1'], 'input order does not matter');
});

test('waterfall: traces by earliest start, ties by trace id; several roots in a trace by startMs', () => {
  const spans = [
    sp('9', { trace: T2, start: 5 }),
    sp('8', { trace: T1, start: 5 }),
    sp('7', { trace: T2, start: 0 }),
  ];
  assert.deepEqual(waterfall(spans).traces, [T2, T1]);
  assert.deepEqual(order(spans), ['7@0', '9@0', '8@0']);
  const tie = [sp('9', { trace: T2, start: 3 }), sp('8', { trace: T1, start: 3 })];
  assert.deepEqual(waterfall(tie).traces, [T1, T2]);
});

test('waterfall: a parent that is not among the spans makes an orphan root, its children still nested', () => {
  const rows = waterfall([sp('1', { start: 0, end: 50 }), sp('2', { parent: 'dead', start: 10, end: 40 }), sp('3', { parent: '2', start: 20, end: 30 })]).rows;
  assert.deepEqual(rows.map((r) => [r.spanId.replace(/^0+/, ''), r.depth, r.orphan, r.crossTrace]), [
    ['1', 0, false, false],
    ['2', 0, true, false],
    ['3', 1, false, false],
  ]);
});

test('waterfall: a parent in another trace makes a cross-trace root in its own trace', () => {
  const spans = b1Spans();
  spans[4].parentId = C; // E (other trace) under C
  const rows = waterfall(spans).rows;
  const e = rows.find((r) => r.spanId === E);
  assert.deepEqual([e.depth, e.crossTrace, e.orphan, e.traceId], [0, true, false, OTHER_TRACE]);
  assert.deepEqual(rows.map((r) => r.spanId), [A, B, C, D, E], 'E stays in its own trace');
  assert.equal(rows.filter((r) => r.crossTrace).length, 1);
});

test('waterfall: no spans, one instant span, and a parent loop all terminate without NaN', () => {
  assert.deepEqual(waterfall([]), { rows: [], traces: [] });
  const [one] = waterfall([sp('1', { start: 5, end: 5 })]).rows;
  assert.deepEqual([one.x, one.width, one.depth], [0, 0, 0]);
  const loop = waterfall([sp('1', { parent: '2', start: 0, end: 10 }), sp('2', { parent: '1', start: 5, end: 10 })]).rows;
  assert.deepEqual(loop.map((r) => `${r.spanId.replace(/^0+/, '')}@${r.depth}`), ['1@0', '2@1'], 'every span exactly once');
});

// serviceEdges

test('serviceEdges on fixture B1: the storefront CLIENT to the api-gateway SERVER', () => {
  assert.deepEqual(serviceEdges(deepFreeze(b1Spans())), [{ from: 'storefront', to: 'api-gateway', via: 'client-server' }]);
});

test('serviceEdges: CONSUMER from a PRODUCER parent or link in another service, sorted and unique', () => {
  const spans = [
    sp('1', { service: 'orders', kind: 'PRODUCER', start: 0 }),
    sp('2', { service: 'shipping', kind: 'CONSUMER', parent: '1', start: 1 }),
    sp('3', { trace: T2, service: 'orders', kind: 'PRODUCER', start: 2 }),
    sp('4', { trace: T2, service: 'billing', kind: 'CONSUMER', links: ['3', '1'], start: 3 }),
    sp('5', { service: 'shipping', kind: 'CONSUMER', parent: '1', start: 4 }),
    sp('6', { service: 'web', kind: 'CLIENT', start: 5 }),
    sp('7', { service: 'api', kind: 'SERVER', parent: '6', start: 6 }),
  ];
  assert.deepEqual(serviceEdges(spans), [
    { from: 'orders', to: 'billing', via: 'producer-consumer' },
    { from: 'orders', to: 'shipping', via: 'producer-consumer' },
    { from: 'web', to: 'api', via: 'client-server' },
  ]);
});

test('serviceEdges: no edge without a CLIENT→SERVER or PRODUCER→CONSUMER pair across two services', () => {
  const spans = [
    sp('1', { service: 'web', kind: 'CLIENT' }),
    sp('2', { service: 'web', kind: 'SERVER', parent: '1' }), // same service
    sp('3', { service: 'api', kind: 'INTERNAL', parent: '1' }), // child not SERVER
    sp('4', { service: 'api', kind: 'SERVER' }),
    sp('5', { service: 'db', kind: 'SERVER', parent: '4' }), // SERVER parent
    sp('6', { service: 'db', kind: 'CLIENT', parent: '4' }), // CLIENT under SERVER: wrong direction
    sp('7', { service: 'q', kind: 'CONSUMER', parent: '1', links: ['4'] }), // CLIENT parent, SERVER link
    sp('8', { service: 'q', kind: 'PRODUCER' }),
    sp('9', { service: 'q', kind: 'CONSUMER', parent: '8', links: ['8'] }), // same service
    sp('a', { service: 'w', kind: 'SERVER', links: ['8'] }), // a link only counts for a CONSUMER
    sp('b', { service: 'x', kind: 'SERVER', parent: 'dead' }), // unknown parent
    sp('c', { trace: T2, service: 'api', kind: 'SERVER', parent: '1' }), // parent in another trace
  ];
  assert.deepEqual(serviceEdges(spans), []);
});

// timeAxis (#113)

test('T1 timeAxis: with no times it is the spans\' own range; times widen it; waterfall follows', () => {
  const spans = b1Spans();
  const plain = timeAxis(spans);
  assert.deepEqual([plain.min, plain.range, plain.pct(0), plain.pct(40), plain.pct(100)], [0, 100, 0, 40, 100]);
  assert.deepEqual(waterfall(spans, {}), waterfall(spans), 'no times: identical output');
  assert.deepEqual(waterfall(spans, { times: [] }), waterfall(spans));
  const wide = timeAxis(spans, [-40, 140]);
  assert.deepEqual([wide.min, wide.range], [-40, 180]);
  assert.equal(wide.pct(-40), 0);
  assert.equal(wide.pct(140), 100);
  assert.equal(wide.pct(50), 50);
  const rows = waterfall(spans, { times: [-100] }).rows;
  assert.deepEqual([rows[0].x, rows[0].width], [50, 50], 'bars shift and shrink on the widened axis');
  assert.equal(rows.length, spans.length, 'times add no rows');
  const flat = timeAxis([sp('a', { start: 5, end: 5 })]);
  assert.deepEqual([flat.range, flat.pct(5)], [0, 0], 'a zero range puts everything at 0');
  assert.deepEqual([timeAxis([]).range, timeAxis([], [3, 9]).min, timeAxis([], [3, 9]).range], [0, 3, 6]);
});
