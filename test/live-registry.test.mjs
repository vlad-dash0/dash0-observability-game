// The shipped registry and map data are valid together. Spec: docs/FOUNDATION.md §2.7
// and §6 F5 live-registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../lib/registry.mjs';
import { ACTS } from '../levels/index.mjs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';

const nodeIds = NODES.map((n) => n.id);

// Extended on purpose with each level PR (docs/M1-DESIGN.md §5): Act 0 (P3) plays before Act 1;
// its boss, the pager (P4), comes after its levels; Act 2 (P6: 2.1, 2.2) plays after Act 1.
const EXPECTED_ORDER = [
  'monitoring-vs-observability',
  'the-signals',
  'why-opentelemetry',
  'the-pager',
  'naming-your-service',
  'spans-and-traces',
  'span-kinds',
  'status-and-errors',
  'context-propagation',
  'baggage',
  'events-and-links',
  'auto-vs-manual',
];

test('the live registry builds against the real deck and map nodes', () => {
  const reg = buildRegistry(ACTS, { deck: DECK, nodeIds });
  assert.deepEqual(reg.order, EXPECTED_ORDER);
  assert.deepEqual(liveRegistry().order, EXPECTED_ORDER, 'app.mjs builds the same registry');
});

test('acts in unlock order: Act 0 "Orientation" (M1-DESIGN §6), Act 1, then Act 2 "Traces"', () => {
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
      levelIds: ['naming-your-service'],
      bossId: null,
    },
    {
      id: 'act-2',
      no: 2,
      name: 'Traces',
      sub: 'Follow the request',
      levelIds: ['spans-and-traces', 'span-kinds', 'status-and-errors', 'context-propagation', 'baggage', 'events-and-links', 'auto-vs-manual'],
      bossId: null,
    },
  ]);
});

test('map nodes: the §2.7 ids, unique, valid kinds and positions in the viewBox', () => {
  assert.deepEqual([...nodeIds].sort(), [
    'api-gateway', 'cart', 'catalog', 'checkout', 'inventory', 'kafka', 'notifications', 'orders',
    'payment-provider', 'payments', 'postgres', 'recommendations', 'redis', 'shipping', 'storefront',
  ]);
  assert.equal(new Set(nodeIds).size, nodeIds.length, 'node ids are unique');
  for (const n of NODES) {
    assert.ok(['service', 'datastore', 'queue', 'external'].includes(n.kind), `${n.id} kind ${n.kind}`);
    assert.ok(typeof n.label === 'string' && n.label.length > 0, `${n.id} label`);
    assert.ok(Number.isFinite(n.x) && n.x >= 0 && n.x <= 100, `${n.id} x ${n.x}`);
    assert.ok(Number.isFinite(n.y) && n.y >= 0 && n.y <= 60, `${n.id} y ${n.y}`);
  }
  assert.equal(NODES.find((n) => n.id === 'payment-provider').kind, 'external');
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
  assert.deepEqual(nodeIds.filter((id) => !linked.has(id)), [], 'every node has an edge');
});
