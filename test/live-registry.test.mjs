// The shipped registry and map data are valid together. Spec: docs/FOUNDATION.md §2.7
// and §6 F5 live-registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../lib/registry.mjs';
import { ACTS } from '../levels/index.mjs';
import { DECK } from '../cards/deck.mjs';
import { NODE_IDS } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { COMING_SOON } from '../hub/coming-soon.mjs';
import { runPlay, validatePlay } from '../lib/play.mjs';
import { WIDGETS } from '../lib/registry.mjs';
import { NO_HINTS, howToView } from '../lib/how-to-play.mjs';

const nodeIds = NODE_IDS;

// Extended on purpose with each level PR (docs/M1-DESIGN.md §5): Act 0 (P3) plays before Act 1;
// its boss, the pager (P4), comes after its levels; Act 2 (P6: 2.1, 2.2) plays after Act 1; its boss, checkout-is-slow (P11), comes last; Act 3 (M3 P1: 3.1, 3.2; M3 P2: 3.3, 3.4; M3 P3: 3.5, 3.7; M3 P12: its boss the-bill) plays after Act 2; Act 1 (M3 P4: 1.1 before 1.2, 1.3 after it; M3 P11: its boss who-is-talking); Act 4 (M3 P5: 4.1, 4.2; M3 P6: 4.3 and its boss the-3am-errors) plays after Act 3; Act 5 (M3 P7: 5.1, 5.2; M3 P8: 5.3, 5.4; M3 P9: 5.5, 5.6; M3 P13: its boss silence) plays after Act 4; Act 6 (M4 P1: 6.1, 6.2; M4 P3: its boss errors-tripled) plays after Act 5; Act 7 (#177 P2 of the beta levels: 7.1) plays after Act 6; Act 8 (#177 P3 of the beta levels: 8.2; #136: 8.3; #137: 8.1 before them, 8.4 after; #138: 8.5 last) plays after Act 7; Act 9 (#177 P5: 9.2; #32: 9.1 before it) plays after Act 8.
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
  'good-alerts',
  'slis-and-slos',
  'burn-rate-alerts',
  'synthetic-checks',
  'everything-is-green',
  'dashboards-as-code',
  'semantic-convention-versions',
  'migrating-vendors',
  'frontend-rum',
  'ai-assisted-debugging',
  'filter-or-sampler',
  'the-34-percent-error-rate',
  'connect-to-dash0',
  'the-trace-that-starts-in-the-middle',
  'lost-in-translation',
  'its-us',
];

test('the live registry builds against the real deck and map nodes', () => {
  const reg = buildRegistry(ACTS, { deck: DECK, nodeIds, play: { validatePlay, runPlay } });
  assert.deepEqual(reg.order, EXPECTED_ORDER);
  assert.deepEqual(liveRegistry().order, EXPECTED_ORDER, 'app.mjs builds the same registry');
});

test('acts in unlock order: Act 0 "Orientation" (M1-DESIGN §6), Act 1, Act 2 "Traces", Act 3 "Metrics", Act 4 "Logs", Act 5 "The Collector", Act 6 "Sampling and cost", Act 7 "Alerting and SLOs", Act 8 "Operating at scale", then Act 9 "Live Demo"', () => {
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
    {
      id: 'act-7',
      no: 7,
      name: 'Alerting and SLOs',
      sub: 'Wake me only when it matters',
      levelIds: ['good-alerts', 'slis-and-slos', 'burn-rate-alerts', 'synthetic-checks'],
      bossId: 'everything-is-green',
    },
    {
      id: 'act-8',
      no: 8,
      name: 'Operating at scale',
      sub: 'As code',
      levelIds: ['dashboards-as-code', 'semantic-convention-versions', 'migrating-vendors', 'frontend-rum', 'ai-assisted-debugging'],
      bossId: null,
    },
    {
      id: 'act-9',
      no: 9,
      name: 'Live Demo',
      sub: 'Does that answer hold?',
      levelIds: ['filter-or-sampler', 'the-34-percent-error-rate', 'connect-to-dash0', 'the-trace-that-starts-in-the-middle', 'lost-in-translation'],
      bossId: 'its-us',
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

// What each hand-written level plays, in the order its run() plays it (verified against the
// mount calls). Not derived: `mechanics` has no choice and is wrong for these two.
const HAND_WRITTEN_WIDGETS = {
  'monitoring-vs-observability': ['sort', 'choice'],
  'the-signals': ['sort', 'choice'],
  'why-opentelemetry': ['sort', 'choice'],
  'the-pager': [],
  'naming-your-service': ['choice', 'configure'],
  'spans-and-traces': ['choice', 'build'],
  'span-kinds': ['build', 'choice'],
  'status-and-errors': ['sort', 'choice'],
  'context-propagation': ['choice', 'build'],
  'baggage': ['sort', 'choice'],
  'events-and-links': ['choice', 'build'],
  'checkout-is-slow': ['incident'],
  'connect-to-dash0': [],
  'its-us': [],
};
// Declares a mechanic its board is not (custom, unscored, unwinnable), so no help is offered.
const NOT_A_WIDGET = {
  'the-pager': 'No help card: its intro explains the board (it is not scored).',
  'connect-to-dash0': 'No help card: its form is its own kit markup, not a shared widget.',
  'its-us': 'No help card: its trace view and questions are its own kit markup, not a shared widget.',
};

test('hand-written levels declare their widgets', () => {
  const reg = liveRegistry();
  const hand = reg.order.filter((id) => !reg.levels[id].play);
  assert.deepEqual(Object.fromEntries(hand.map((id) => [id, [...reg.levels[id].widgets]])), HAND_WRITTEN_WIDGETS);
  for (const id of hand) {
    const lv = reg.levels[id];
    if (id in NOT_A_WIDGET) continue;
    assert.deepEqual([...lv.widgets].filter((w) => w !== 'choice').sort(), [...lv.mechanics].sort(), id);
  }
});

test('every play level has widgets, all known; non-choice ones equal its mechanics', () => {
  const reg = liveRegistry();
  const plays = reg.order.filter((id) => reg.levels[id].play);
  assert.ok(plays.length > 0);
  for (const id of plays) {
    const lv = reg.levels[id];
    assert.ok(lv.widgets.length > 0, id);
    assert.ok(lv.widgets.every((w) => WIDGETS.includes(w)), id);
    assert.deepEqual([...lv.widgets].filter((w) => w !== 'choice').sort(), [...lv.mechanics].sort(), id);
  }
});

// The widgets with no Hint button on any step of the level (every other live level
// has none listed). Play levels derive it from their steps; the two hand-written ones declare it.
const HINTLESS = {
  baggage: ['sort'],
  'events-and-links': ['build'],
  'auto-vs-manual': ['sort'],
  instruments: ['sort'],
  'structured-logs': ['sort'],
  distributions: ['sort'],
  'filter-or-sampler': ['sort'],
  'order-matters': ['spot'],
  'tail-sampling': ['spot'],
  'ottl-and-transforms': ['spot'],
  'good-alerts': ['spot'],
  'synthetic-checks': ['sort'],
  'dashboards-as-code': ['spot'],
  'semantic-convention-versions': ['spot'],
  'migrating-vendors': ['sort'],
  'frontend-rum': ['build'],
  'lost-in-translation': ['spot'], // a live-demo question: no helps on its Spot (#240)
  'the-34-percent-error-rate': ['tradeoff'], // a live-demo question: no helps on its Trade-off (#160)
  'the-trace-that-starts-in-the-middle': ['build'], // Act 9 has no helps (#240)
};

test('which widgets have no hints on each live level is pinned, and the how-to-play help says so', () => {
  const reg = liveRegistry();
  assert.deepEqual(Object.keys(HINTLESS).filter((id) => !reg.order.includes(id)), []);
  for (const id of reg.order) {
    const lv = reg.levels[id];
    const want = HINTLESS[id] ?? [];
    assert.deepEqual([...lv.hintless], want, id);
    for (const t of howToView(lv).topics) {
      const none = want.includes(t.key) || t.key === 'choice';
      assert.equal(t.hints === NO_HINTS, none, `${id} ${t.key}`);
    }
  }
});

test('act badges: Acts 7 and 8 are Dash0, Act 9 is From customer calls, the rest have none', () => {
  const want = { 'act-7': ['dash0'], 'act-8': ['dash0'], 'act-9': ['customer-calls'] };
  for (const act of liveRegistry().acts) {
    assert.deepEqual([...act.badges], want[act.id] ?? [], act.id);
  }
});

test('every act, live and coming soon, has a one-line plain-text teaser', () => {
  for (const act of [...ACTS, ...COMING_SOON]) {
    assert.equal(typeof act.teaser, 'string', `${act.id} teaser is a string`);
    assert.ok(act.teaser.trim().length > 0, `${act.id} teaser is not blank`);
    assert.ok(act.teaser.length <= 160, `${act.id} teaser is ${act.teaser.length} characters`);
    assert.ok(!act.teaser.includes('<'), `${act.id} teaser is plain text`);
    assert.ok(!/[\r\n]/.test(act.teaser), `${act.id} teaser is one line`);
  }
});
