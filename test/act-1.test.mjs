// Act 1 levels 1.1 Resources and 1.3 Detectors and Kubernetes beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's order and what
// inserting levels does to an existing player (docs/FOUNDATION.md §3 Unlock), level fields and lights,
// card fronts and backs, and the facts the copy states (docs/OUTLINE.md §4 Act 1), each checked from
// the level's own data. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { nodeStates } from '../lib/map.mjs';
import { isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';
import { newConfigureState, runConfigure } from '../lib/widgets/configure-it.mjs';

const LIVE = liveRegistry();
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};
const idsOf = (actId) => {
  const act = LIVE.acts.find((a) => a.id === actId);
  return [...act.levelIds, ...(act.bossId ? [act.bossId] : [])];
};
const stepOf = (levelId, key, widgetId) =>
  LIVE.levels[levelId].play.steps.find((s) => s[key] && s[key].id === widgetId)[key];
const choiceOf = (levelId, widgetId) => stepOf(levelId, 'choice', widgetId).choices;
const rightOf = (levelId, widgetId) => choiceOf(levelId, widgetId).find((c) => c.right);

// ---- the act and the players already in it ------------------------------------------

test('act-1 plays 1.1 before 1.2 and 1.3 after it, and keeps its name and no boss', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-1');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 1, name: 'Resources and identity', sub: 'Who is talking?', levelIds: ['resources', 'naming-your-service', 'detectors-and-kubernetes'], bossId: null },
  );
  assert.deepEqual(
    ['resources', 'naming-your-service', 'detectors-and-kubernetes'].map((id) => LIVE.levels[id].no),
    ['1.1', '1.2', '1.3'],
  );
});

test('act-1 levels are scored with no par time, and belong to act-1', () => {
  for (const id of ['resources', 'detectors-and-kubernetes']) {
    const level = LIVE.levels[id];
    assert.equal(level.actId, 'act-1', id);
    assert.equal(level.kind, 'level', id);
    assert.equal(level.scored, true, id);
    assert.equal(level.scoring.parMs, null, id);
  }
});

test('levels in act-1 open in any order: the new ones open next to a finished 1.2, and 1.2 stays done', () => {
  const act0 = idsOf('act-0');
  const done = progressOf([...act0, 'naming-your-service']);
  assert.equal(levelState('naming-your-service', done, LIVE), 'done', 'a saved 1.2 stays completed');
  assert.equal(levelState('resources', done, LIVE), 'open');
  assert.equal(levelState('detectors-and-kubernetes', done, LIVE), 'open');
  assert.equal(levelState('resources', emptyProgress(), LIVE), 'locked', 'act-1 still waits for act-0');
  assert.deepEqual(lockReason('resources', emptyProgress(), LIVE), { kind: 'act', actId: 'act-0' });
  // 1.3 first, then 1.1: the order the map lists them in is not an order of play.
  assert.equal(levelState('resources', progressOf([...act0, 'detectors-and-kubernetes']), LIVE), 'open');
});

test('existing players: a saved 1.2 and Act 0 stay valid; Act 2 waits for 1.1 and 1.3 unless the player already entered it', () => {
  const act0 = idsOf('act-0');
  const old = progressOf([...act0, 'naming-your-service']);
  assert.equal(isActUnlocked(2, old, LIVE), false, 'Act 1 gained two levels, so it is no longer complete');
  assert.deepEqual(lockReason('spans-and-traces', old, LIVE), { kind: 'act', actId: 'act-1' });

  const afterBoth = progressOf([...act0, 'resources', 'naming-your-service', 'detectors-and-kubernetes']);
  assert.equal(levelState('spans-and-traces', afterBoth, LIVE), 'open');

  // A player who already started Act 2 keeps it open.
  const entered = progressOf([...act0, 'naming-your-service', 'spans-and-traces']);
  assert.equal(levelState('span-kinds', entered, LIVE), 'open');
  assert.equal(levelState('spans-and-traces', entered, LIVE), 'done');
});

test('star totals count both new levels: 20 scored levels, max 60', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: 60 });
  assert.deepEqual(starTotals(progressOf(['resources', 'detectors-and-kubernetes']), LIVE), { earned: 6, max: 60 });
});

// ---- level fields and lights --------------------------------------------------------

const FIELDS = {
  resources: { no: '1.1', name: 'Resources', mechanics: ['sort'], cards: ['resource-not-span-attribute'], lights: ['recommendations'] },
  'detectors-and-kubernetes': {
    no: '1.3',
    name: 'Detectors and Kubernetes',
    mechanics: ['configure'],
    cards: ['k8sattributes-in-collector'],
    lights: ['redis'],
  },
};

for (const [id, want] of Object.entries(FIELDS)) {
  test(`${id}: level fields, derived mechanics, cards and lights`, () => {
    const level = LIVE.levels[id];
    assert.deepEqual(
      { no: level.no, name: level.name, mechanics: [...level.mechanics], cards: [...level.cards], lights: [...level.lights] },
      want,
    );
    assert.equal(level.run.length, 1, 'a play level gets its run from the registry');
    assert.equal(typeof level.play.finish, 'string');
  });
}

test('lights: 1.1 lights Recommendations and 1.3 Redis, so their edge lights only when both are done', () => {
  const lit = (done) => {
    const s = nodeStates(LIVE, progressOf(done), NODES, EDGES);
    return {
      nodes: NODES.filter((n) => s.nodes[n.id].lit).map((n) => n.id).sort(),
      edge: s.edges.find((e) => e.from === 'recommendations' && e.to === 'redis').lit,
    };
  };
  assert.deepEqual(lit([]), { nodes: [], edge: false });
  assert.deepEqual(lit(['resources']), { nodes: ['recommendations'], edge: false });
  assert.deepEqual(lit(['detectors-and-kubernetes']), { nodes: ['redis'], edge: false });
  assert.deepEqual(lit(['resources', 'detectors-and-kubernetes']), { nodes: ['recommendations', 'redis'], edge: true });
});

// ---- cards --------------------------------------------------------------------------

const CARDS = {
  'resource-not-span-attribute': {
    front:
      'What the telemetry is about (service, pod, host, region) goes on the Resource once, not on every span as a span attribute.',
    back:
      'A Resource describes the entity that produces telemetry, as resource attributes such as service.name, k8s.pod.name, ' +
      'host.name and cloud.region. It is attached to the tracer, meter and logger providers when they are created, and ' +
      'cannot be changed later, so every span, metric and log from the provider carries it. Attributes such as ' +
      'http.request.method, http.route or http.response.status_code describe one operation, so they belong on that span. ' +
      'Setting k8s.pod.name on every span as a span attribute repeats one value on each span and leaves metrics and logs ' +
      'without it.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/resource/sdk/',
    dash0Angle:
      "Dash0's Resources view is built from the resource attributes on your telemetry, such as k8s.pod.uid, so what you put on the " +
      'Resource decides what Dash0 can show.',
  },
  'k8sattributes-in-collector': {
    front:
      'Add pod metadata in the Collector with k8sattributes, and list it in the pipeline: configured but not listed, it does nothing.',
    back:
      'SDK resource detectors run once, when the SDK starts, and the Resource cannot change afterwards. Kubernetes metadata is better ' +
      'added once in the Collector by the k8sattributes processor, which looks up the pod each piece of telemetry came from through ' +
      'the Kubernetes API (by default through the IP address of the incoming connection) and adds attributes such as ' +
      'k8s.pod.name and k8s.namespace.name as resource attributes. The Collector service account needs get, watch and list ' +
      'permissions on pods and namespaces. It is a contrib component, so use a contrib or Kubernetes distribution. ' +
      'Configuring a processor does not enable it: it must also be listed under a pipeline in the service section.',
    specUrl: 'https://opentelemetry.io/docs/platforms/kubernetes/collector/components/#kubernetes-attributes-processor',
    dash0Angle:
      'The Dash0 operator adds k8s.namespace.name, k8s.pod.name, k8s.pod.uid and k8s.container.name to workloads in namespaces ' +
      'enabled for Dash0 monitoring, so you do not set them by hand.',
  },
};

test('Act 1 cards: front, back, spec URL and Dash0 angle are pinned; fronts fit a card (<=140)', () => {
  for (const [id, want] of Object.entries(CARDS)) {
    const card = DECK.find((c) => c.id === id);
    assert.deepEqual(card, { id, ...want });
    assert.equal(want.front.length <= 140, true, `${id} front is ${want.front.length} characters`);
  }
});

// ---- 1.1 Resources ------------------------------------------------------------------

const RESOURCE_ATTRS = ['service.name', 'k8s.pod.name', 'host.name', 'cloud.region'];
const SIGNAL_ATTRS = ['http.request.method', 'http.route', 'http.response.status_code', 'url.path'];

test('resources: the resource attributes are service, pod, host and cloud region; HTTP request facts are signal attributes', () => {
  const sort = stepOf('resources', 'sort', 'res-sort');
  assert.deepEqual(sort.buckets.map((b) => `${b.id}=${b.label}`), ['resource=Resource attribute', 'signal=Signal attribute']);
  const nameOf = (it) => it.label.split(' = ')[0];
  assert.deepEqual(sort.items.filter((it) => it.bucket === 'resource').map(nameOf).sort(), [...RESOURCE_ATTRS].sort());
  assert.deepEqual(sort.items.filter((it) => it.bucket === 'signal').map(nameOf).sort(), [...SIGNAL_ATTRS].sort());
});

test('resources: every item says why it is not in the other bucket, and the pod name is explained as a producer fact', () => {
  const sort = stepOf('resources', 'sort', 'res-sort');
  for (const it of sort.items) {
    const other = it.bucket === 'resource' ? 'signal' : 'resource';
    assert.equal(typeof it.whyNot[other], 'string', `${it.id} says why not ${other}`);
  }
  const pod = sort.items.find((it) => it.id === 'pod-name');
  assert.equal(/producer|describes/.test(pod.whyNot.signal), true);
});

test('resources: the nuance is graded: a pod name on every span belongs on the Resource, set once', () => {
  const right = rightOf('resources', 'res-pod');
  assert.equal(right.key, 'set-once');
  const text = plain(right.label + right.why);
  for (const w of ['Resource', 'once', 'k8s.pod.name', 'every span, metric and log']) assert.equal(text.includes(w), true, w);
  assert.equal(/metrics and logs/.test(right.why), true, 'the cost of the per-span habit is named');
  const wrong = choiceOf('resources', 'res-pod').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['cardinality', 'same-thing']);
  const card = wrong.find((c) => c.key === 'cardinality');
  assert.equal(/where it is set/.test(card.why), true, 'the value is fine, the place is wrong');
});

test('resources: the Dash0 tie-in is graded: Resources are built from resource attributes, not registered by hand or read from spans', () => {
  const right = rightOf('resources', 'res-dash0');
  assert.equal(right.key, 'resource-attributes');
  assert.equal(/service\.name/.test(right.label) && /k8s\.pod\.uid/.test(right.label), true);
  assert.deepEqual(choiceOf('resources', 'res-dash0').map((c) => c.key).sort(), ['by-hand', 'resource-attributes', 'span-attributes']);
});

// ---- 1.3 Detectors and Kubernetes ---------------------------------------------------

test('detectors: they run once at SDK start; the Resource is fixed after that', () => {
  const right = rightOf('detectors-and-kubernetes', 'det-when');
  assert.equal(right.key, 'at-start');
  assert.equal(/cannot be changed later/.test(right.why) && /initializes/.test(right.why), true);
  const perSpan = choiceOf('detectors-and-kubernetes', 'det-when').find((c) => c.key === 'per-span');
  assert.equal(/cannot be changed later/.test(perSpan.why), true, 'a Resource cannot change later');
});

test('detectors: pod metadata is better added in the Collector, and k8sattributes is a contrib component', () => {
  const right = rightOf('detectors-and-kubernetes', 'det-where');
  assert.equal(right.key, 'collector');
  assert.equal(right.label.includes('<code>k8sattributes</code>'), true);
  assert.equal(/contrib/.test(right.why) && /not in the core one/.test(right.why), true);
});

const config = () => stepOf('detectors-and-kubernetes', 'configure', 'det-config');

test('detectors config: the given does not start (the pipeline names a processor that is not defined); the reference starts and flows traces', () => {
  const spec = config();
  const given = checkConfig(spec.given, COLLECTOR_SCHEMA);
  assert.equal(given.ok, false);
  assert.deepEqual(given.errors.map((e) => `${e.kind} ${e.path}`), ['unknown-ref service.pipelines.traces.processors[0]']);
  const ref = checkConfig(spec.reference, COLLECTOR_SCHEMA);
  assert.equal(ref.ok, true);
  assert.equal(ref.verdict.flowing, true);
  assert.deepEqual(ref.verdict.pipelines.map((p) => `${p.name}=${p.flowing}`), ['traces=true']);
  assert.equal(Object.hasOwn(spec, 'target'), false, '`uses` names the traces pipeline, so it is also the target');
});

test('detectors config: the reference lists k8sattributes in the traces pipeline, before batch, and defines it', () => {
  const ref = checkConfig(config().reference, COLLECTOR_SCHEMA).doc;
  assert.deepEqual(ref.service.pipelines.traces.processors, ['k8sattributes', 'batch']);
  assert.equal(Object.hasOwn(ref.processors, 'k8sattributes'), true);
  assert.deepEqual(ref.processors.k8sattributes.extract.metadata.slice(0, 3), ['k8s.namespace.name', 'k8s.pod.name', 'k8s.pod.uid']);
  assert.deepEqual(checkConfig(config().given, COLLECTOR_SCHEMA).doc.processors, { batch: null }, 'the given only defines batch');
});

test('detectors config: deleting k8sattributes from the traces pipeline is wrong and costs one mistake; the reference is right', () => {
  const spec = config();
  assert.deepEqual(spec.uses, { traces: ['k8sattributes'] });
  const unlisted = spec.reference.replace('processors: [k8sattributes, batch]', 'processors: [batch]');
  assert.equal(checkConfig(unlisted, COLLECTOR_SCHEMA).ok, true, 'the Collector would start, so only `uses` can refuse it');
  const wrong = runConfigure(spec, newConfigureState(), unlisted);
  assert.deepEqual({ outcome: wrong.outcome, reason: wrong.reason, unmet: wrong.unmet }, { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
  const same = runConfigure(spec, wrong.state, unlisted);
  assert.equal(same.outcome, 'repeat', 'the same text again is free');
  assert.equal(runConfigure(spec, wrong.state, spec.reference).outcome, 'right');
  // Removing the reference's definition as well still does not pass: the given's error is the other way in.
  const dropped = spec.reference.replace(/  k8sattributes:[\s\S]*?(?=  batch:)/, '');
  assert.equal(runConfigure(spec, newConfigureState(), dropped).reason, 'invalid');
});

test('detectors config: the copy says what is graded (wiring) and what is not (settings)', () => {
  const text = plain(config().explain);
  for (const w of ['defined', 'listed', 'extract.metadata', 'IP address', 'checks the wiring, not the settings', 'Removing it']) {
    assert.equal(text.includes(w), true, w);
  }
});

test('detectors: the processor needs get, watch and list on pods and namespaces, a Kubernetes permission and not a Dash0 key', () => {
  const right = rightOf('detectors-and-kubernetes', 'det-rbac');
  assert.equal(right.key, 'pods-namespaces');
  for (const w of ['get', 'watch', 'list', 'pods', 'namespaces', 'ClusterRole']) assert.equal(plain(right.label).includes(w), true, w);
  const key = choiceOf('detectors-and-kubernetes', 'det-rbac').find((c) => c.key === 'api-key');
  assert.equal(/Kubernetes API/.test(key.why), true);
});

test('detectors: the Dash0 operator instruments supported runtimes and adds the four Kubernetes resource attributes', () => {
  const right = rightOf('detectors-and-kubernetes', 'det-dash0');
  assert.equal(right.key, 'operator-adds');
  for (const a of ['k8s.namespace.name', 'k8s.pod.name', 'k8s.pod.uid', 'k8s.container.name']) assert.equal(right.why.includes(a), true, a);
  assert.equal(/supported/.test(right.label), true, 'instrumentation covers supported runtimes only');
  const logs = choiceOf('detectors-and-kubernetes', 'det-dash0').find((c) => c.key === 'logs-only');
  assert.equal(/does collect pod logs/.test(logs.why), true, 'the wrong option is corrected, not dismissed');
});

// ---- both levels --------------------------------------------------------------------

test('the Act 1 level files cite the pages their facts come from', () => {
  const urls = (f) =>
    read(`levels/${f}.mjs`).split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  const res = urls('resources');
  assert.equal(res.includes('https://opentelemetry.io/docs/specs/otel/resource/sdk/'), true);
  assert.equal(res.includes('https://opentelemetry.io/docs/specs/semconv/resource/k8s/#pod'), true);
  const det = urls('detectors-and-kubernetes');
  assert.equal(det.includes('https://opentelemetry.io/docs/platforms/kubernetes/collector/components/#kubernetes-attributes-processor'), true);
  assert.equal(det.includes('https://opentelemetry.io/docs/collector/components/processor/'), true);
  for (const f of ['resources', 'detectors-and-kubernetes']) {
    assert.equal(/\bthe spec says\b/i.test(read(`levels/${f}.mjs`)), false, f);
  }
});
