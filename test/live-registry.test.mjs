// The shipped registry and map data are valid together. Spec: docs/FOUNDATION.md §2.7
// and §6 F5 live-registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../lib/registry.mjs';
import { ACTS } from '../levels/index.mjs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { runPlay, validatePlay } from '../lib/play.mjs';

const nodeIds = NODES.map((n) => n.id);

// Extended on purpose with each level PR (docs/M1-DESIGN.md §5): Act 0 (P3) plays before Act 1;
// its boss, the pager (P4), comes after its levels; Act 2 (P6: 2.1, 2.2) plays after Act 1; its boss, checkout-is-slow (P11), comes last; Act 3 (M3 P1: 3.1, 3.2; M3 P2: 3.3, 3.4; M3 P3: 3.5, 3.7) plays after Act 2; Act 1 (M3 P4: 1.1 before 1.2, 1.3 after it); Act 4 (M3 P5: 4.1, 4.2; M3 P6: 4.3 and its boss the-3am-errors) plays after Act 3; Act 5 (M3 P7: 5.1, 5.2; M3 P8: 5.3, 5.4; M3 P9: 5.5, 5.6) plays after Act 4.
const EXPECTED_ORDER = [
  'monitoring-vs-observability',
  'the-signals',
  'why-opentelemetry',
  'the-pager',
  'resources',
  'naming-your-service',
  'detectors-and-kubernetes',
  'spans-and-traces',
  'span-kinds',
  'status-and-errors',
  'context-propagation',
  'baggage',
  'events-and-links',
  'auto-vs-manual',
  'checkout-is-slow',
  'instruments',
  'temporality',
  'histograms',
  'promql-basics',
  'cardinality',
  'red-and-use',
  'structured-logs',
  'correlation',
  'collecting-logs',
  'the-3am-errors',
  'pipelines',
  'order-matters',
  'otlp-endpoints',
  'agent-vs-gateway',
  'ottl-and-transforms',
  'distributions',
];

test('the live registry builds against the real deck and map nodes', () => {
  const reg = buildRegistry(ACTS, { deck: DECK, nodeIds, play: { validatePlay, runPlay } });
  assert.deepEqual(reg.order, EXPECTED_ORDER);
  assert.deepEqual(liveRegistry().order, EXPECTED_ORDER, 'app.mjs builds the same registry');
});

test('acts in unlock order: Act 0 "Orientation" (M1-DESIGN §6), Act 1, Act 2 "Traces", Act 3 "Metrics", Act 4 "Logs", then Act 5 "The Collector"', () => {
  const acts = liveRegistry().acts.map((a) => ({ id: a.id, no: a.no, name: a.name, sub: a.sub, levelIds: [...a.levelIds], bossId: a.bossId }));
  assert.deepEqual(acts, [
    {
      id: 'act-0',
      no: 0,
      name: 'Orientation',
      sub: 'Day one',
      levelIds: ['monitoring-vs-observability', 'the-signals', 'why-opentelemetry'],
      bossId: 'the-pager',
    },
    {
      id: 'act-1',
      no: 1,
      name: 'Resources and identity',
      sub: 'Who is talking?',
      levelIds: ['resources', 'naming-your-service', 'detectors-and-kubernetes'],
      bossId: null,
    },
    {
      id: 'act-2',
      no: 2,
      name: 'Traces',
      sub: 'Follow the request',
      levelIds: ['spans-and-traces', 'span-kinds', 'status-and-errors', 'context-propagation', 'baggage', 'events-and-links', 'auto-vs-manual'],
      bossId: 'checkout-is-slow',
    },
    {
      id: 'act-3',
      no: 3,
      name: 'Metrics',
      sub: 'How much, how often',
      levelIds: ['instruments', 'temporality', 'histograms', 'promql-basics', 'cardinality', 'red-and-use'],
      bossId: null,
    },
    {
      id: 'act-4',
      no: 4,
      name: 'Logs',
      sub: 'What did it say?',
      levelIds: ['structured-logs', 'correlation', 'collecting-logs'],
      bossId: 'the-3am-errors',
    },
    {
      id: 'act-5',
      no: 5,
      name: 'The Collector',
      sub: 'The plumbing',
      levelIds: ['pipelines', 'order-matters', 'otlp-endpoints', 'agent-vs-gateway', 'ottl-and-transforms', 'distributions'],
      bossId: null,
    },
  ]);
});

test('map nodes: the §2.7 ids, unique, valid kinds and positions in the viewBox', () => {
  assert.deepEqual([...nodeIds].sort(), [
    'api-gateway', 'cart', 'catalog', 'checkout', 'collector', 'inventory', 'kafka', 'notifications', 'orders',
    'payment-provider', 'payments', 'postgres', 'recommendations', 'redis', 'shipping', 'storefront',
  ]);
  assert.equal(new Set(nodeIds).size, nodeIds.length, 'node ids are unique');
  for (const n of NODES) {
    assert.ok(['service', 'datastore', 'queue', 'external', 'telemetry'].includes(n.kind), `${n.id} kind ${n.kind}`);
    assert.ok(typeof n.label === 'string' && n.label.length > 0, `${n.id} label`);
    assert.ok(Number.isFinite(n.x) && n.x >= 0 && n.x <= 100, `${n.id} x ${n.x}`);
    assert.ok(Number.isFinite(n.y) && n.y >= 0 && n.y <= 60, `${n.id} y ${n.y}`);
  }
  assert.equal(NODES.find((n) => n.id === 'payment-provider').kind, 'external');
  const collector = NODES.find((n) => n.id === 'collector');
  assert.equal(collector.label, 'Collector');
  assert.equal(collector.kind, 'telemetry', 'a Collector is telemetry plumbing, not on the request path');
  assert.ok(!EDGES.some((e) => e.from === 'collector' || e.to === 'collector'), 'no request-flow edge to the Collector');
});

// Labels sit 5.4 below a node centre, so two nodes closer than the tightest pair in the
// current layout (shipping and notifications, 10 apart in the same column) risk touching
// labels. This pins that floor for every pair, including any node added later.
const MIN_NODE_DISTANCE = 10;
test(`map nodes: no two nodes closer than ${MIN_NODE_DISTANCE} (keeps circles and labels apart)`, () => {
  for (let i = 0; i < NODES.length; i++) {
    for (let j = i + 1; j < NODES.length; j++) {
      const d = Math.hypot(NODES[i].x - NODES[j].x, NODES[i].y - NODES[j].y);
      assert.ok(d >= MIN_NODE_DISTANCE, `${NODES[i].id} and ${NODES[j].id} are ${d.toFixed(2)} apart`);
    }
  }
});

test('map edges reference real nodes, never loop and never repeat', () => {
  const ids = new Set(nodeIds);
  const seen = new Set();
  assert.ok(EDGES.length > 0);
  for (const e of EDGES) {
    assert.ok(ids.has(e.from), `edge from unknown node ${e.from}`);
    assert.ok(ids.has(e.to), `edge to unknown node ${e.to}`);
    assert.notEqual(e.from, e.to, `self-edge on ${e.from}`);
    const key = [e.from, e.to].sort().join('|');
    assert.ok(!seen.has(key), `duplicate edge ${key}`);
    seen.add(key);
  }
  const linked = new Set(EDGES.flatMap((e) => [e.from, e.to]));
  // Every request-path node has an edge; telemetry plumbing (the Collector) deliberately has none.
  const requestPath = NODES.filter((n) => n.kind !== 'telemetry').map((n) => n.id);
  assert.deepEqual(requestPath.filter((id) => !linked.has(id)), [], 'every request-path node has an edge');
});
