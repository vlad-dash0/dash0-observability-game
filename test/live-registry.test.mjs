// The shipped registry and map data are valid together. Spec: docs/FOUNDATION.md §2.7
// and §6 F5 live-registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../lib/registry.mjs';
import { ACTS } from '../levels/index.mjs';
import { DECK } from '../cards/deck.mjs';
import { NODE_IDS } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { runPlay, validatePlay } from '../lib/play.mjs';

const nodeIds = NODE_IDS;

// Extended on purpose with each level PR (docs/M1-DESIGN.md §5): Act 0 (P3) plays before Act 1;
// its boss, the pager (P4), comes after its levels; Act 2 (P6: 2.1, 2.2) plays after Act 1; its boss, checkout-is-slow (P11), comes last; Act 3 (M3 P1: 3.1, 3.2; M3 P2: 3.3, 3.4; M3 P3: 3.5, 3.7; M3 P12: its boss the-bill) plays after Act 2; Act 1 (M3 P4: 1.1 before 1.2, 1.3 after it; M3 P11: its boss who-is-talking); Act 4 (M3 P5: 4.1, 4.2; M3 P6: 4.3 and its boss the-3am-errors) plays after Act 3; Act 5 (M3 P7: 5.1, 5.2; M3 P8: 5.3, 5.4; M3 P9: 5.5, 5.6; M3 P13: its boss silence) plays after Act 4; Act 6 (M4 P1: 6.1, 6.2; M4 P3: its boss errors-tripled) plays after Act 5.
const EXPECTED_ORDER = [
  'monitoring-vs-observability',
  'the-signals',
  'why-opentelemetry',
  'the-pager',
  'resources',
  'naming-your-service',
  'detectors-and-kubernetes',
  'who-is-talking',
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
  'exemplars',
  'red-and-use',
  'the-bill',
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
  'silence',
  'head-sampling',
  'tail-sampling',
  'what-costs-money',
  'errors-tripled',
];

test('the live registry builds against the real deck and map nodes', () => {
  const reg = buildRegistry(ACTS, { deck: DECK, nodeIds, play: { validatePlay, runPlay } });
  assert.deepEqual(reg.order, EXPECTED_ORDER);
  assert.deepEqual(liveRegistry().order, EXPECTED_ORDER, 'app.mjs builds the same registry');
});

test('acts in unlock order: Act 0 "Orientation" (M1-DESIGN §6), Act 1, Act 2 "Traces", Act 3 "Metrics", Act 4 "Logs", Act 5 "The Collector", then Act 6 "Sampling and cost"', () => {
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
      bossId: 'who-is-talking',
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
      levelIds: ['instruments', 'temporality', 'histograms', 'promql-basics', 'cardinality', 'exemplars', 'red-and-use'],
      bossId: 'the-bill',
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
      bossId: 'silence',
    },
    {
      id: 'act-6',
      no: 6,
      name: 'Sampling and cost',
      sub: 'You can\'t keep everything',
      levelIds: ['head-sampling', 'tail-sampling', 'what-costs-money'],
      bossId: 'errors-tripled',
    },
  ]);
});

test('lights ids: the §2.7 ids, unique (levels name them in `lights`; the globe does not draw them)', () => {
  assert.deepEqual([...nodeIds].sort(), [
    'api-gateway', 'cart', 'catalog', 'checkout', 'collector', 'inventory', 'kafka', 'notifications', 'orders',
    'payment-provider', 'payments', 'postgres', 'recommendations', 'redis', 'shipping', 'storefront',
  ]);
  assert.equal(new Set(nodeIds).size, nodeIds.length, 'ids are unique');
});
