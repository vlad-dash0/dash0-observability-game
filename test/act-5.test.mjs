// Act 5 levels 5.1 Pipelines and 5.2 Order matters beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's place in the
// registry, unlock and map; level fields and lights; card fronts and
// backs; the shortcuts through the real runConfigure; and the facts the copy states
// (docs/OUTLINE.md §4 Act 5), each checked from the level's own data. Asserts strings, numbers
// and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { nodeStates } from '../lib/map.mjs';
import { isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';
import { newConfigureState, runConfigure } from '../lib/widgets/configure-it.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
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

// ---- the act ------------------------------------------------------------------------

test('act-5 "The Collector" holds 5.1 to 5.6 after Act 4, and the boss "Silence"', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-5');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 5, name: 'The Collector', sub: 'The plumbing', levelIds: ['pipelines', 'order-matters', 'otlp-endpoints', 'agent-vs-gateway', 'ottl-and-transforms', 'distributions'], bossId: 'silence' },
  );
  assert.deepEqual(LIVE.acts.map((a) => a.id), ['act-0', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5'], 'act-5 is the last act');
  assert.deepEqual(LIVE.order.slice(-7), ['pipelines', 'order-matters', 'otlp-endpoints', 'agent-vs-gateway', 'ottl-and-transforms', 'distributions', 'silence']);
});

test('act-5 unlocks like the acts before it: every earlier act complete (Act 4 included), or entered', () => {
  const before = [...idsOf('act-0'), ...idsOf('act-1'), ...idsOf('act-2'), ...idsOf('act-3')];
  assert.equal(isActUnlocked(5, progressOf(before), LIVE), false, 'act-4 not complete');
  assert.deepEqual(lockReason('pipelines', progressOf(before), LIVE), { kind: 'act', actId: 'act-4' });
  assert.deepEqual(lockReason('order-matters', emptyProgress(), LIVE), { kind: 'act', actId: 'act-0' });
  assert.equal(levelState('pipelines', emptyProgress(), LIVE), 'locked');

  const all = [...before, ...idsOf('act-4')];
  assert.equal(isActUnlocked(5, progressOf(all), LIVE), true);
  assert.equal(levelState('pipelines', progressOf(all), LIVE), 'open');
  assert.equal(levelState('order-matters', progressOf(all), LIVE), 'open', 'levels open in any order');

  // Entered: one completed level opens the act, even when earlier acts are not done.
  assert.equal(levelState('order-matters', progressOf(['pipelines']), LIVE), 'open');
  assert.equal(levelState('pipelines', progressOf(['order-matters']), LIVE), 'open');
});

test('act-5 levels are scored with no par time, and belong to act-5', () => {
  for (const id of ['pipelines', 'order-matters']) {
    const level = LIVE.levels[id];
    assert.equal(level.actId, 'act-5', id);
    assert.equal(level.kind, 'level', id);
    assert.equal(level.scored, true, id);
    assert.equal(level.scoring.parMs, null, id);
  }
});

test('star totals count 5.1 and 5.2 among the derived scored levels', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  assert.deepEqual(starTotals(progressOf(['pipelines', 'order-matters']), LIVE), { earned: 6, max: MAX_STARS });
});

// ---- level fields and lights --------------------------------------------------------

const FIELDS = {
  pipelines: { no: '5.1', name: 'Pipelines', mechanics: ['configure'], cards: ['configured-not-enabled'], lights: ['collector'] },
  'order-matters': { no: '5.2', name: 'Order matters', mechanics: ['spot'], cards: ['memory-limiter-first'], lights: ['collector'] },
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

test('lights: finishing any Act 5 level lights the Collector node and nothing else; no edge lights', () => {
  const lit = (done) => {
    const s = nodeStates(LIVE, progressOf(done), NODES, EDGES);
    return { nodes: NODES.filter((n) => s.nodes[n.id].lit).map((n) => n.id), edges: s.edges.filter((e) => e.lit).length };
  };
  assert.deepEqual(lit([]), { nodes: [], edges: 0 });
  assert.deepEqual(lit(['pipelines']), { nodes: ['collector'], edges: 0 });
  assert.deepEqual(lit(['order-matters']), { nodes: ['collector'], edges: 0 });
  assert.deepEqual(lit(['pipelines', 'order-matters']), { nodes: ['collector'], edges: 0 });
});

// ---- cards --------------------------------------------------------------------------

const CARDS = {
  'configured-not-enabled': {
    front:
      'Configuring a Collector component does not enable it: list it in a pipeline (extensions under service.extensions) or it does nothing.',
    back:
      'A Collector config has five kinds of component. Receivers take data in, processors change it, exporters send it out, ' +
      'connectors join two pipelines (an exporter at the end of one and a receiver at the start of another), and extensions ' +
      'add abilities that are not part of the data path, such as a health check. Defining one under its section only ' +
      'configures it. Receivers, processors and exporters are enabled by listing them in a pipeline under service.pipelines, ' +
      'a connector by listing it in both pipelines it joins, and an extension under service.extensions. A component that is ' +
      'defined but not listed is not enabled, so a memory_limiter nobody listed protects nothing; one that is listed but not ' +
      'defined keeps the Collector from starting.',
    specUrl: 'https://opentelemetry.io/docs/collector/configuration/#service',
    dash0Angle: null,
  },
  'memory-limiter-first': {
    front:
      'Processor order is processing order, per pipeline: memory_limiter first, drops and context readers before batch, batch late.',
    back:
      'The processors in a pipeline run in the order they are listed, and every pipeline has its own list, so the same ' +
      'processors can be right in one pipeline and wrong in another. memory_limiter goes first: when memory runs high it ' +
      'refuses data by returning an error to the component before it, so receivers can retry and slow their senders before ' +
      'later processors pile up more. batch goes late, after the processors that drop, filter or change data, so it does not ' +
      'batch what is discarded afterwards. A processor that reads the request context, such as k8sattributes, must run before ' +
      'batch, because batching clears that context. The processor docs also say to prefer an exporter\'s own batching where ' +
      'it has one.',
    specUrl: 'https://opentelemetry.io/docs/collector/configuration/#processors',
    dash0Angle: null,
  },
};

test('Act 5 cards: front, back, spec URL and Dash0 angle are pinned; fronts fit a card (<=140)', () => {
  for (const [id, want] of Object.entries(CARDS)) {
    const card = DECK.find((c) => c.id === id);
    assert.deepEqual(card, { id, ...want });
    assert.equal(want.front.length <= 140, true, `${id} front is ${want.front.length} characters`);
  }
});

// ---- 5.1 Pipelines ------------------------------------------------------------------

test('pipelines: a connector is what ends one pipeline and starts another; a processor or extension cannot', () => {
  const right = rightOf('pipelines', 'pipe-connector');
  assert.equal(right.key, 'connector');
  const text = plain(right.label + right.why);
  for (const w of ['connector', 'exporter', 'receiver', 'both']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(choiceOf('pipelines', 'pipe-connector').map((c) => c.key).sort(), ['connector', 'extension', 'processor']);
  const processor = choiceOf('pipelines', 'pipe-connector').find((c) => c.key === 'processor');
  assert.equal(/within a pipeline|inside one pipeline/.test(processor.why), true);
});

const config = () => stepOf('pipelines', 'configure', 'pipe-config');
const GIVEN_DOC = () => checkConfig(config().given, COLLECTOR_SCHEMA);
const REF = () => config().reference;
const run = (text, state = newConfigureState()) => runConfigure(config(), state, text);
const verdictOf = (r) => ({ outcome: r.outcome, reason: r.reason, unmet: r.unmet });

test('pipelines config: the given does not start (health_check is enabled but not defined) and leaves memory_limiter unused', () => {
  const given = GIVEN_DOC();
  assert.equal(given.ok, false);
  assert.deepEqual(given.errors.map((e) => `${e.kind} ${e.path}`), ['unknown-ref service.extensions[0]']);
  assert.deepEqual(given.verdict.inactive, [{ section: 'processors', id: 'memory_limiter' }], 'defined, in no pipeline');
  assert.deepEqual(given.doc.service.pipelines.traces.processors, ['batch']);
  assert.deepEqual(given.doc.service.pipelines.metrics.processors, ['batch']);
});

test('pipelines config: the reference starts, flows traces and metrics, wires memory_limiter into both, and leaves nothing unused', () => {
  const ref = checkConfig(REF(), COLLECTOR_SCHEMA);
  assert.equal(ref.ok, true);
  assert.equal(ref.verdict.flowing, true);
  assert.deepEqual(ref.verdict.pipelines.map((p) => `${p.name}=${p.flowing}`), ['traces=true', 'metrics=true']);
  assert.deepEqual(ref.verdict.inactive, []);
  assert.deepEqual(ref.doc.service.pipelines.traces.processors, ['memory_limiter', 'batch']);
  assert.deepEqual(ref.doc.service.pipelines.metrics.processors, ['memory_limiter', 'batch']);
  assert.deepEqual(ref.doc.service.extensions, ['health_check']);
  assert.deepEqual(Object.keys(ref.doc.extensions), ['health_check']);
  assert.deepEqual(config().uses, { traces: ['memory_limiter'], metrics: ['memory_limiter'] });
  assert.equal(Object.hasOwn(config(), 'target'), false, '`uses` names both pipelines, so they are also the target');
  assert.deepEqual(verdictOf(run(REF())), { outcome: 'right', reason: undefined, unmet: undefined });
});

// Each shortcut starts from the reference and changes one thing, so what fails is that thing.
const without = (text, ...lines) => lines.reduce((t, l) => { assert.equal(t.includes(l), true, l); return t.replace(l, ''); }, text);
const MEMORY_DEF = /  memory_limiter:\n    check_interval: 1s\n    limit_mib: 400\n    spike_limit_mib: 100\n/;
const LISTED = '      processors: [memory_limiter, batch]\n';

test('pipelines config: deleting memory_limiter (definition and mentions) starts the Collector but does not pass: `uses` refuses it', () => {
  const deleted = REF().replace(MEMORY_DEF, '').split(LISTED).join('      processors: [batch]\n');
  assert.equal(deleted.includes('memory_limiter'), false);
  assert.equal(checkConfig(deleted, COLLECTOR_SCHEMA).ok, true, 'the Collector would start, so only `uses` can refuse it');
  const wrong = run(deleted);
  assert.deepEqual(verdictOf(wrong), { outcome: 'wrong', reason: 'uses', unmet: ['traces', 'metrics'] });
  assert.equal(run(deleted, wrong.state).outcome, 'repeat', 'the same text again is free');
  assert.equal(run(REF(), wrong.state).outcome, 'right');
});

test('pipelines config: deleting only the definition leaves a pipeline naming a processor that is not there', () => {
  const noDef = REF().replace(MEMORY_DEF, '');
  const r = run(noDef);
  assert.deepEqual(verdictOf(r), { outcome: 'wrong', reason: 'invalid', unmet: undefined });
  assert.deepEqual(r.result.errors.map((e) => `${e.kind} ${e.path}`), [
    'unknown-ref service.pipelines.traces.processors[0]',
    'unknown-ref service.pipelines.metrics.processors[0]',
  ]);
});

test('pipelines config: listing memory_limiter in the wrong pipeline (only one of the two) is one mistake naming the other', () => {
  const tracesOnly = REF().replace(`    metrics:\n      receivers: [otlp]\n${LISTED}`, '    metrics:\n      receivers: [otlp]\n      processors: [batch]\n');
  assert.notEqual(tracesOnly, REF());
  assert.deepEqual(verdictOf(run(tracesOnly)), { outcome: 'wrong', reason: 'uses', unmet: ['metrics'] });
  const metricsOnly = REF().replace(`    traces:\n      receivers: [otlp]\n${LISTED}`, '    traces:\n      receivers: [otlp]\n      processors: [batch]\n');
  assert.notEqual(metricsOnly, REF());
  assert.deepEqual(verdictOf(run(metricsOnly)), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
});

test('pipelines config: renaming memory_limiter (a new id used everywhere) is a different component, so `uses` refuses it', () => {
  const renamed = REF().replace('  memory_limiter:\n', '  memory_limiter/main:\n').split('[memory_limiter, batch]').join('[memory_limiter/main, batch]');
  assert.equal(renamed.includes('memory_limiter/main'), true);
  assert.equal(checkConfig(renamed, COLLECTOR_SCHEMA).ok, true, 'a valid config under another name');
  assert.deepEqual(verdictOf(run(renamed)), { outcome: 'wrong', reason: 'uses', unmet: ['traces', 'metrics'] });
  // Renaming only the definition leaves the pipelines naming a processor that is not defined.
  const half = REF().replace('  memory_limiter:\n', '  memory_limiter/main:\n');
  assert.deepEqual(verdictOf(run(half)), { outcome: 'wrong', reason: 'invalid', unmet: undefined });
});

test('pipelines config: deleting the metrics pipeline leaves a required pipeline that does not flow', () => {
  const noMetrics = REF().replace(/    metrics:\n      receivers: \[otlp\]\n      processors: \[memory_limiter, batch\]\n      exporters: \[otlp\/dash0\]\n/, '');
  assert.equal(noMetrics.includes('metrics:'), false);
  assert.equal(checkConfig(noMetrics, COLLECTOR_SCHEMA).ok, true);
  assert.deepEqual(verdictOf(run(noMetrics)), { outcome: 'wrong', reason: 'target', unmet: ['metrics'] });
});

test('pipelines config: memory_limiter under a pipeline stage that is not processors is refused by the checker', () => {
  const stage = REF().replace('exporters: [otlp/dash0]\n    metrics', 'exporters: [otlp/dash0, memory_limiter]\n    metrics');
  assert.notEqual(stage, REF());
  const r = run(stage);
  assert.deepEqual(verdictOf(r), { outcome: 'wrong', reason: 'invalid', unmet: undefined });
  assert.deepEqual(r.result.errors.map((e) => `${e.kind} ${e.path}`), ['unknown-ref service.pipelines.traces.exporters[1]']);
});

test('pipelines config: the extension part is not what is graded: dropping the health_check line passes, the wiring is what counts', () => {
  const noExt = without(REF(), 'extensions:\n  health_check:\n', '  extensions: [health_check]\n');
  assert.equal(run(noExt).outcome, 'right');
  // But enabling it without defining it (the given's error) never passes.
  const enabledOnly = without(REF(), 'extensions:\n  health_check:\n');
  assert.deepEqual(verdictOf(run(enabledOnly)), { outcome: 'wrong', reason: 'invalid', unmet: undefined });
});

test('pipelines config: where memory_limiter sits in the list is not graded here; the next level is about order', () => {
  const lastInList = REF().split('[memory_limiter, batch]').join('[batch, memory_limiter]');
  assert.equal(run(lastInList).outcome, 'right');
  const text = plain(config().explain);
  for (const w of ['defined', 'listed', 'does nothing', 'refuses to start', 'order', 'checks the wiring, not the settings']) {
    assert.equal(text.includes(w), true, w);
  }
});

test('pipelines: an extension is enabled under service.extensions, not in a pipeline', () => {
  const right = rightOf('pipelines', 'pipe-extension');
  assert.equal(right.key, 'service-extensions');
  const text = plain(right.label + right.why);
  for (const w of ['service', 'extensions', 'health_check', 'pipeline']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(choiceOf('pipelines', 'pipe-extension').map((c) => c.key).sort(), ['in-pipeline', 'service-extensions', 'start-order']);
});

// ---- 5.2 Order matters --------------------------------------------------------------

const SPOT = () => stepOf('order-matters', 'spot', 'order-spot');
/** The processors a spot line lists: `traces: processors: [a, b]`. */
const listOf = (line) => /processors: \[(.*)\]$/.exec(line.text)[1].split(', ');
// The two rules the level teaches, written once from the processor docs, not from the answer.
const ordered = (procs) => {
  const limiter = procs.indexOf('memory_limiter');
  const batch = procs.indexOf('batch');
  const memoryFirst = limiter === -1 || limiter === 0;
  const batchLast = batch === -1 || batch === procs.length - 1;
  return memoryFirst && batchLast;
};

test('order-matters: the misordered lists are exactly the ones that break a rule (memory_limiter first, batch after the rest)', () => {
  const spot = SPOT();
  assert.equal(spot.target, 'config');
  const broken = spot.lines.filter((l) => !ordered(listOf(l))).map((l) => l.id);
  assert.deepEqual(broken, spot.faults);
  assert.deepEqual(spot.faults, ['metrics', 'traces-checkout', 'logs-audit', 'logs-noisy']);
  assert.equal(spot.lines.length, 8);
});

test('order-matters: order is per pipeline: the same two processors are right in traces and wrong in metrics', () => {
  const spot = SPOT();
  const by = (id) => listOf(spot.lines.find((l) => l.id === id));
  assert.deepEqual(by('traces').filter((p) => p === 'memory_limiter' || p === 'batch'), ['memory_limiter', 'batch']);
  assert.deepEqual(by('metrics'), ['batch', 'memory_limiter']);
  assert.deepEqual(by('metrics-infra'), ['memory_limiter', 'batch']);
  assert.equal(/own|each pipeline|per pipeline/.test(plain(spot.explain)), true);
});

test('order-matters: a pipeline without batch is not a fault, and every correct line says why it is fine', () => {
  const spot = SPOT();
  assert.deepEqual(listOf(spot.lines.find((l) => l.id === 'traces-edge')), ['memory_limiter']);
  assert.deepEqual(Object.keys(spot.whyNot).sort(), spot.lines.map((l) => l.id).filter((id) => !spot.faults.includes(id)).sort());
  assert.equal(/optional|not required|own batching|exporter/.test(spot.whyNot['traces-edge']), true);
});

test('order-matters: the explanation names all four faults and the reason context readers go before batch', () => {
  const text = plain(SPOT().explain);
  for (const w of ['memory_limiter', 'first', 'batch', 'k8sattributes', 'context', 'discard']) assert.equal(text.includes(w), true, w);
});

test('order-matters: memory_limiter goes first so it can refuse data early and receivers can retry or slow down', () => {
  const right = rightOf('order-matters', 'order-why');
  assert.equal(right.key, 'refuse-early');
  const text = plain(right.label + right.why);
  for (const w of ['memory', 'refuse', 'receivers', 'retry', 'backpressure']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(choiceOf('order-matters', 'order-why').map((c) => c.key).sort(), ['any-position', 'cleans-data', 'refuse-early']);
});

test('order-matters: batch goes late, and exporter-side batching is an option the docs prefer where it exists; batch itself is still shipped', () => {
  const right = rightOf('order-matters', 'order-batch');
  assert.equal(right.key, 'late');
  const text = plain(right.label + right.why);
  for (const w of ['Late', 'discarded', 'context', 'exporter', 'sending_queue']) assert.equal(text.includes(w), true, w);
  const removed = choiceOf('order-matters', 'order-batch').find((c) => c.key === 'removed');
  assert.equal(/core|contrib/.test(removed.why), true, 'the wrong option is corrected: the processor is still in the distributions');
  assert.deepEqual(choiceOf('order-matters', 'order-batch').map((c) => c.key).sort(), ['early', 'late', 'removed']);
});

// ---- both levels --------------------------------------------------------------------

test('the Act 5 level files cite the pages their facts come from', () => {
  const urls = (f) =>
    read(`levels/${f}.mjs`).split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  const pipes = urls('pipelines');
  for (const u of [
    'https://opentelemetry.io/docs/collector/configuration/#service',
    'https://opentelemetry.io/docs/collector/configuration/#connectors',
    'https://opentelemetry.io/docs/collector/configuration/#extensions',
    'https://opentelemetry.io/docs/collector/components/',
  ]) assert.equal(pipes.includes(u), true, u);
  const order = urls('order-matters');
  for (const u of [
    'https://opentelemetry.io/docs/collector/configuration/#processors',
    'https://opentelemetry.io/docs/collector/components/processor/',
  ]) assert.equal(order.includes(u), true, u);
  for (const f of ['pipelines', 'order-matters']) {
    const src = read(`levels/${f}.mjs`);
    assert.equal(/\bthe spec says\b/i.test(src), false, f);
    assert.equal(/^\/\/ Docs \(GitHub/m.test(src), true, `${f} cites the component READMEs on a Docs line`);
  }
});
