// Act 6 levels 6.1 Head sampling and 6.2 Tail sampling beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's place in the
// registry, unlock and map; level fields and lights; card fronts and backs; the shortcuts through
// the real Trade-off and Spot it graders; the arithmetic the copy shows, recomputed here from
// scratch; and the facts the copy states (docs/OUTLINE.md §4 Act 6), each checked from the level's
// own data. Asserts strings, numbers and booleans only.
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
import { allPlans, checkTradeoff, evaluatePlan, newTradeoffState, pickOption, validateTradeoffSpec } from '../lib/widgets/trade-off.mjs';
import { checkSpot, newSpotState, toggleLine, validateSpotSpec } from '../lib/widgets/spot-it.mjs';

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
const stepKinds = (levelId) => LIVE.levels[levelId].play.steps.map((st) => ['choice', 'spot', 'tradeoff'].find((k) => st[k]));

// ---- the act ------------------------------------------------------------------------

test('act-6 "Sampling and cost" holds 6.1 and 6.2 after Act 5, with no boss yet', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-6');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 6, name: 'Sampling and cost', sub: 'You can\'t keep everything', levelIds: ['head-sampling', 'tail-sampling'], bossId: null },
  );
  assert.deepEqual(LIVE.acts.map((a) => a.id).slice(-2), ['act-5', 'act-6']);
  assert.deepEqual(LIVE.order.slice(-3), ['silence', 'head-sampling', 'tail-sampling']);
});

test('act-6 unlocks like the acts before it: every earlier act complete (Act 5 and its boss included), or entered', () => {
  const before = [0, 1, 2, 3, 4].flatMap((n) => idsOf(`act-${n}`));
  assert.equal(isActUnlocked(6, progressOf(before), LIVE), false, 'act-5 not complete');
  assert.deepEqual(lockReason('head-sampling', progressOf(before), LIVE), { kind: 'act', actId: 'act-5' });
  assert.deepEqual(lockReason('tail-sampling', emptyProgress(), LIVE), { kind: 'act', actId: 'act-0' });
  assert.equal(levelState('head-sampling', emptyProgress(), LIVE), 'locked');
  assert.equal(isActUnlocked(6, progressOf([...before, ...idsOf('act-5').filter((id) => id !== 'silence')]), LIVE), false, 'the boss of act-5 counts');

  const all = [...before, ...idsOf('act-5')];
  assert.equal(isActUnlocked(6, progressOf(all), LIVE), true);
  assert.equal(levelState('head-sampling', progressOf(all), LIVE), 'open');
  assert.equal(levelState('tail-sampling', progressOf(all), LIVE), 'open', 'levels open in any order');

  // Entered: one completed level opens the act, even when earlier acts are not done.
  assert.equal(levelState('tail-sampling', progressOf(['head-sampling']), LIVE), 'open');
  assert.equal(levelState('head-sampling', progressOf(['tail-sampling']), LIVE), 'open');
});

test('act-6 is complete once both levels are done: there is no boss to wait for', () => {
  assert.equal(isActUnlocked(7, progressOf([...[0, 1, 2, 3, 4, 5].flatMap((n) => idsOf(`act-${n}`)), 'head-sampling']), LIVE), false);
  assert.equal(LIVE.acts.find((a) => a.id === 'act-6').bossId, null);
});

test('act-6 levels are scored with no par time, belong to act-6, and add 6 stars to the derived total', () => {
  for (const id of ['head-sampling', 'tail-sampling']) {
    const level = LIVE.levels[id];
    assert.equal(level.actId, 'act-6', id);
    assert.equal(level.kind, 'level', id);
    assert.equal(level.scored, true, id);
    assert.equal(level.scoring.parMs, null, id);
    assert.equal(level.run.length, 1, `${id}: a play level gets its run from the registry`);
    assert.equal(Object.hasOwn(level, 'boss'), false);
  }
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  assert.deepEqual(starTotals(progressOf(['head-sampling', 'tail-sampling']), LIVE), { earned: 6, max: MAX_STARS });
});

// ---- level fields and lights --------------------------------------------------------

const FIELDS = {
  'head-sampling': { no: '6.1', name: 'Head sampling', mechanics: ['tradeoff'], cards: ['parent-based-sampling'], lights: ['storefront'] },
  'tail-sampling': { no: '6.2', name: 'Tail sampling', mechanics: ['tradeoff', 'spot'], cards: ['spanmetrics-before-sampling'], lights: ['collector'] },
};

for (const [id, want] of Object.entries(FIELDS)) {
  test(`${id}: level fields, derived mechanics, cards and lights`, () => {
    const level = LIVE.levels[id];
    assert.deepEqual(
      { no: level.no, name: level.name, mechanics: [...level.mechanics], cards: [...level.cards], lights: [...level.lights] },
      want,
    );
    assert.equal(typeof level.play.finish, 'string');
  });
}

test('steps: 6.1 is a Trade-off step and a closing Choice step; 6.2 is a Trade-off step and then a Spot it step; no Configure it step', () => {
  assert.deepEqual(stepKinds('head-sampling'), ['tradeoff', 'choice']);
  assert.deepEqual(stepKinds('tail-sampling'), ['tradeoff', 'spot']);
});

test('lights: 6.1 lights the storefront (the root), 6.2 the Collector; each node and no edge', () => {
  const lit = (done) => {
    const s = nodeStates(LIVE, progressOf(done), NODES, EDGES);
    return { nodes: NODES.filter((n) => s.nodes[n.id].lit).map((n) => n.id), edges: s.edges.filter((e) => e.lit).length };
  };
  assert.deepEqual(lit([]), { nodes: [], edges: 0 });
  assert.deepEqual(lit(['head-sampling']), { nodes: ['storefront'], edges: 0 });
  assert.deepEqual(lit(['tail-sampling']), { nodes: ['collector'], edges: 0 });
  assert.deepEqual(lit(['head-sampling', 'tail-sampling']), { nodes: ['storefront', 'collector'], edges: 0 });
});

// ---- cards --------------------------------------------------------------------------

const CARDS = {
  'parent-based-sampling': {
    front:
      'Head sampling decides once, at the root. Child services must follow the parent\'s sampled flag, or traces come out with holes.',
    back:
      'Head sampling decides before the trace is complete, at its root span: OTEL_TRACES_SAMPLER=parentbased_traceidratio with ' +
      'OTEL_TRACES_SAMPLER_ARG=0.1 keeps about one trace in ten. ParentBased uses its root sampler only for a span with no ' +
      'parent. For a span with a parent it follows the parent\'s sampled flag, which travels in the W3C traceparent header: by ' +
      'default a sampled parent means sampled and an unsampled parent means dropped. A child that ignores the flag, such as one ' +
      'set to always_on, exports spans of traces whose root was dropped, and the backend shows traces with holes. ' +
      'TraceIdRatioBased ignores the parent\'s flag by design, so the spec recommends it only for root spans, in combination ' +
      'with ParentBased. If you set nothing, the default sampler is parentbased_always_on. Head sampling never sees the whole trace, ' +
      'so it cannot promise to keep the errors: that is what tail sampling is for.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/trace/sdk/#parentbased',
    dash0Angle: null,
  },
  'spanmetrics-before-sampling': {
    front:
      'Compute span metrics before sampling: a connector fed from a tail_sampling pipeline counts only the traces that were kept.',
    back:
      'The span_metrics connector counts the spans it receives, for each set of dimensions, into calls and duration metrics. ' +
      'A connector is an exporter at the end of one pipeline and a receiver at the start of another, so it receives what leaves ' +
      'the processors of the traces pipeline that lists it. List it in a pipeline that has tail_sampling and it sees only the ' +
      'kept traces: the request rate comes out too low, and when the policies keep every error the error ratio comes out too ' +
      'high. Give the connector a traces pipeline of its own with no sampling processor, and let the sampled pipeline feed the ' +
      'backend. A receiver can be listed in more than one pipeline, so both pipelines can read the same one. The component was ' +
      'renamed from spanmetrics to span_metrics, and the old name still works but is deprecated.',
    specUrl: 'https://opentelemetry.io/docs/collector/configuration/#connectors',
    dash0Angle: null,
  },
};

test('6.1 and 6.2 cards: front, back, spec URL and Dash0 angle are pinned; fronts fit a card (<=140)', () => {
  for (const [id, want] of Object.entries(CARDS)) {
    assert.deepEqual(DECK.find((c) => c.id === id), { id, ...want });
    assert.equal(want.front.length <= 140, true, `${id} front is ${want.front.length} characters`);
  }
  const back = DECK.find((c) => c.id === 'parent-based-sampling').back;
  assert.equal(/never specified|disagree|inconsistent/.test(back), false, 'the card teaches ParentBased, not a one-sided SDK-disagreement claim');
  assert.equal(back.includes('ignores the parent\'s flag by design') && back.includes('only for root spans'), true);
  assert.equal(DECK.some((c) => c.id === 'tail-sampling-needs-one-collector'), true, 'the existing sampling card stays');
});

// ---- 6.1 Head sampling --------------------------------------------------------------

const hs = () => stepOf('head-sampling', 'tradeoff', 'hs-plan');
const option = (spec, knob, id) => spec.knobs.find((k) => k.id === knob).options.find((o) => o.id === id);
const HS = { sampler: 'ratio-10pct' };
const hsPlan = (id) => ({ sampler: id });
const play = (spec, picks) => {
  let state = newTradeoffState(spec);
  for (const [knob, opt] of Object.entries(picks)) state = pickOption(spec, state, knob, opt).state;
  return checkTradeoff(spec, state);
};
const verdictOf = (r) => ({ outcome: r.outcome, total: r.total, over: r.over, lost: r.lost });

// The table behind the copy, recomputed here: 400 traces a second; storefront, checkout and
// payments make 4, 5 and 3 spans of each.
const TRACES = 400;
const SPANS = { storefront: 4, checkout: 5, payments: 3 };
const WHOLE = SPANS.storefront + SPANS.checkout + SPANS.payments;
const CHILDREN = SPANS.checkout + SPANS.payments;

test('head sampling: the table behind the copy, recomputed: 12 spans a trace, 4,800 spans/s unsampled, 480 at one in ten', () => {
  assert.equal(WHOLE, 12);
  assert.equal(TRACES * WHOLE, 4800);
  assert.equal(TRACES * 0.1 * WHOLE, 480);
  assert.equal(TRACES * 0.01 * WHOLE, 48);
  assert.equal(TRACES * 0.9 * CHILDREN, 2880, 'the children\'s spans of the 360 traces the root dropped');
  const spec = hs();
  assert.deepEqual(validateTradeoffSpec(spec), []);
  assert.equal(spec.unit, 'spans/s');
  assert.equal(spec.cap, 600);
  assert.equal(option(spec, 'sampler', 'defaults').cost, 4800);
  assert.equal(option(spec, 'sampler', 'ratio-1pct').cost, 48);
  assert.equal(option(spec, 'sampler', 'ratio-10pct').cost, 480);
  assert.equal(option(spec, 'sampler', 'children-always-on').cost, 480 + 2880);
  assert.deepEqual(spec.knobs[0].options.map((o) => o.id), ['defaults', 'ratio-1pct', 'ratio-10pct', 'children-always-on'], 'no option about a child traceidratio: the level teaches always_on against ParentBased');
  const intro = plain(LIVE.levels['head-sampling'].play.steps[0].intro);
  for (const w of ['400 traces', '12 spans', '4,800 spans', '600 spans', 'storefront', 'checkout', 'payments']) assert.equal(intro.includes(w), true, w);
  assert.equal(/authored|not run|does not run|simulat/.test(intro + plain(spec.explain)), true, 'the copy says the arithmetic is worked out, not run by an engine');
});

test('head sampling: exactly one plan passes, the one-in-ten ParentBased setup on every service, at 480 of 600 spans/s', () => {
  const spec = hs();
  assert.deepEqual(spec.answer, HS);
  const plans = allPlans(spec).map((picks) => ({ picks, ...evaluatePlan(spec, picks) }));
  const passing = plans.filter((p) => p.over === 0 && p.lost.length === 0);
  assert.deepEqual(passing.map((p) => p.picks), [HS]);
  assert.equal(passing[0].total, 480);
  assert.deepEqual(verdictOf(play(spec, HS)), { outcome: 'right', total: 480, over: 0, lost: [] });
});

test('head sampling: every shortcut fails the real grader for its own reason', () => {
  const spec = hs();
  const run = (id) => verdictOf(play(spec, hsPlan(id)));
  assert.deepEqual(run('defaults'), { outcome: 'wrong', total: 4800, over: 4200, lost: [] }, 'sampling everything keeps every need and blows the budget');
  assert.deepEqual(run('ratio-1pct'), { outcome: 'wrong', total: 48, over: 0, lost: ['enough-traces'] }, 'cheap and too few traces');
  assert.deepEqual(run('children-always-on'), { outcome: 'wrong', total: 3360, over: 2760, lost: ['whole-traces'] }, 'children that ignore the parent: holes and over budget');
});

test('head sampling: a plan with nothing picked is incomplete and free, and a repeated wrong plan is a repeat', () => {
  const spec = hs();
  assert.equal(checkTradeoff(spec, newTradeoffState(spec)).outcome, 'incomplete');
  const first = play(spec, hsPlan('defaults'));
  assert.equal(first.outcome, 'wrong');
  assert.equal(checkTradeoff(spec, first.state).outcome, 'repeat');
});

test('head sampling: the nuance is graded: the wrong options say why a child that decides on its own breaks traces', () => {
  const spec = hs();
  const alwaysOn = plain(spec.whyNot['sampler:children-always-on']);
  for (const w of ['360 traces', '8 spans', '2,880', 'root', 'holes']) assert.equal(alwaysOn.includes(w), true, w);
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['sampler:children-always-on', 'sampler:defaults', 'sampler:ratio-1pct']);
  const label = plain(option(spec, 'sampler', 'children-always-on').label);
  assert.equal(label.includes('always_on'), true);
  assert.equal(label.includes('3,360'), true);
  assert.equal(plain(option(spec, 'sampler', 'defaults').label).includes('parentbased_always_on'), true, 'the default sampler is named');
});

test('head sampling: the closing Choice grades the nuance in words: a child that decides on its own, not the root\'s flag, breaks traces', () => {
  const choices = stepOf('head-sampling', 'choice', 'hs-why').choices;
  assert.deepEqual(choices.map((c) => c.key).sort(), ['header-lost', 'own-decision', 'ratio-stacks']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['own-decision']);
  const rightChoice = choices.find((c) => c.right);
  const right = plain(rightChoice.label + rightChoice.why);
  for (const w of ['always_on', 'sampled flag', 'traceparent', 'ParentBased', 'root', 'holes', 'ignore']) assert.equal(right.includes(w), true, w);
  for (const w of ['traceidratio', 'TraceIdRatioBased', 'never specified', 'and so does']) assert.equal(right.includes(w), false, `the right answer is about always_on only: ${w}`);
  const lost = plain(choices.find((c) => c.key === 'header-lost').why);
  for (const w of ['propagat', 'sampler']) assert.equal(lost.includes(w), true, w);
  const stacks = plain(choices.find((c) => c.key === 'ratio-stacks').why);
  assert.equal(stacks.includes('never runs'), true);
  assert.equal(stacks.includes('traceidratio'), false);
  const step = LIVE.levels['head-sampling'].play.steps[1];
  assert.equal(step.qid, 'hs-q-why');
  assert.equal(plain(step.intro).includes('always_on'), true);
});

test('head sampling: the explain states the plan, the env vars, and what head sampling cannot do', () => {
  const t = plain(hs().explain);
  for (const w of ['480 of 600', 'OTEL_TRACES_SAMPLER', 'OTEL_TRACES_SAMPLER_ARG', 'parentbased_traceidratio', 'sampled flag', 'cannot', 'errors', 'tail sampling']) {
    assert.equal(t.includes(w), true, w);
  }
});

// ---- 6.2 Tail sampling: the trade-off -----------------------------------------------

const ts = () => stepOf('tail-sampling', 'tradeoff', 'ts-budget');
const TS = { policies: 'errors-slow-baseline', wait: 'wait-30s' };
const MIB_PER_TRACE = 0.05;
const KEPT_ERRORS = TRACES * 0.02;
const KEPT_SLOW = TRACES * 0.03;
const KEPT_BASELINE = (TRACES - KEPT_ERRORS - KEPT_SLOW) * 0.05;
const KEPT = KEPT_ERRORS + KEPT_SLOW + KEPT_BASELINE;

test('tail sampling: the table behind the copy, recomputed: 400 traces/s held for the wait at 0.05 MiB each, 39 of 400 kept', () => {
  assert.deepEqual([KEPT_ERRORS, KEPT_SLOW, KEPT_BASELINE, KEPT], [8, 12, 19, 39]);
  assert.equal(TRACES * 10 * MIB_PER_TRACE, 200);
  assert.equal(TRACES * 30 * MIB_PER_TRACE, 600);
  assert.equal(TRACES * 120 * MIB_PER_TRACE, 2400);
  assert.equal(TRACES * 30 < 50000, true, '12,000 traces held is under the default num_traces of 50,000');
  const spec = ts();
  assert.deepEqual(validateTradeoffSpec(spec), []);
  assert.equal(spec.unit, 'MiB');
  assert.equal(spec.cap, 1000);
  assert.equal(option(spec, 'wait', 'wait-10s').cost, 200);
  assert.equal(option(spec, 'wait', 'wait-30s').cost, 600);
  assert.equal(option(spec, 'wait', 'wait-120s').cost, 2400);
  for (const o of spec.knobs.find((k) => k.id === 'policies').options) assert.equal(o.cost, 0, `${o.id}: the policies do not change what is held while waiting`);
  assert.equal(plain(option(spec, 'policies', 'errors-slow-baseline').label).includes('39 of 400'), true);
  assert.equal(plain(option(spec, 'policies', 'errors-slow').label).includes('20 of 400'), true);
  assert.equal(plain(option(spec, 'policies', 'probabilistic').label).includes('40 of 400'), true);
  const intro = plain(LIVE.levels['tail-sampling'].play.steps[0].intro);
  for (const w of ['400 new traces', '20 seconds', '2%', '3%', '1,000 MiB', 'decision_wait', '30 seconds']) assert.equal(intro.includes(w), true, w);
});

test('tail sampling: exactly one plan passes: errors, slow and a baseline, with a 30 s wait, at 600 of 1,000 MiB', () => {
  const spec = ts();
  assert.deepEqual(spec.answer, TS);
  const plans = allPlans(spec).map((picks) => ({ picks, ...evaluatePlan(spec, picks) }));
  const passing = plans.filter((p) => p.over === 0 && p.lost.length === 0);
  assert.deepEqual(passing.map((p) => p.picks), [TS]);
  assert.equal(passing[0].total, 600);
  assert.deepEqual(verdictOf(play(spec, TS)), { outcome: 'right', total: 600, over: 0, lost: [] });
});

test('tail sampling: every shortcut fails the real grader for its own reason', () => {
  const spec = ts();
  const run = (policies, wait) => verdictOf(play(spec, { policies, wait }));
  assert.deepEqual(run('errors-slow-baseline', 'wait-10s'), { outcome: 'wrong', total: 200, over: 0, lost: ['whole-traces'] }, 'cheap, and decides before the 20 s traces are whole');
  assert.deepEqual(run('errors-slow-baseline', 'wait-120s'), { outcome: 'wrong', total: 2400, over: 1400, lost: [] }, 'a wait far longer than needed is the memory bill');
  assert.deepEqual(run('probabilistic', 'wait-30s'), { outcome: 'wrong', total: 600, over: 0, lost: ['errors-kept', 'slow-kept'] }, 'a plain ratio is head sampling again: it drops the errors and the slow traces');
  assert.deepEqual(run('errors-slow', 'wait-30s'), { outcome: 'wrong', total: 600, over: 0, lost: ['baseline-kept'] }, 'no healthy baseline to compare against');
  assert.deepEqual(run('errors-slow', 'wait-10s'), { outcome: 'wrong', total: 200, over: 0, lost: ['baseline-kept', 'whole-traces'] });
  assert.deepEqual(run('probabilistic', 'wait-120s'), { outcome: 'wrong', total: 2400, over: 1400, lost: ['errors-kept', 'slow-kept'] });
});

test('tail sampling: the trade-off teaches the cost: the wait holds traces in memory, policies do not, and late spans are named', () => {
  const spec = ts();
  const t = plain(spec.explain);
  for (const w of ['600 of 1,000 MiB', '12,000 traces', 'num_traces', '50,000', 'decision_wait', 'whichever policies', 'late']) assert.equal(t.includes(w), true, w);
  const long = plain(spec.whyNot['wait:wait-120s']);
  for (const w of ['48,000', '2,400']) assert.equal(long.includes(w), true, w);
  assert.equal(TRACES * 120 > 50000, false, '48,000 held traces fit the default num_traces of 50,000');
  assert.equal(/num_traces|dropped/.test(long), false, 'no claim that traces are dropped for want of buffer: 48,000 is under 50,000');
  const short = plain(spec.whyNot['wait:wait-10s']);
  for (const w of ['20 seconds', 'late', 'different']) assert.equal(short.includes(w), true, w);
  assert.equal(plain(spec.whyNot['policies:probabilistic']).includes('head sampling'), true);
});

// ---- 6.2 Tail sampling: the Spot it step --------------------------------------------

const spot = () => stepOf('tail-sampling', 'spot', 'ts-spot');
const spotRun = (ids) => {
  const spec = spot();
  let state = newSpotState(spec);
  for (const id of ids) state = toggleLine(spec, state, id).state;
  const r = checkSpot(spec, state);
  return { outcome: r.outcome, extra: r.extra, missing: r.missing };
};

test('spot: the lines are valid, six pipelines, and exactly the two that feed span_metrics after tail_sampling are the faults', () => {
  const spec = spot();
  assert.deepEqual(validateSpotSpec(spec), []);
  assert.equal(spec.target, 'config');
  assert.equal(spec.lines.length, 6);
  const text = (id) => spec.lines.find((l) => l.id === id).text;
  const rule = (l) => /processors: \[[^\]]*tail_sampling[^\]]*\]/.test(l.text) && /exporters: \[[^\]]*span_metrics[^\]]*\]/.test(l.text);
  assert.deepEqual(spec.lines.filter(rule).map((l) => l.id).sort(), [...spec.faults].sort(), 'the faults are exactly the lines that match the rule');
  assert.deepEqual([...spec.faults].sort(), ['traces', 'traces-checkout']);
  assert.equal(text('traces-metrics').includes('processors: [memory_limiter] exporters: [span_metrics/all]'), true, 'the connector fed with nothing in between');
  assert.equal(text('metrics-spans').startsWith('metrics/spans: receivers: [span_metrics/all]'), true, 'the receiving end of the connector');
  // A connector that is the exporter of several pipelines counts all of them together, so each traces pipeline names its own.
  const connectors = spec.lines.flatMap((l) => (/^traces/.test(l.text) ? l.text.match(/span_metrics\/[a-z]+/g) ?? [] : []));
  assert.deepEqual(connectors.sort(), ['span_metrics/all', 'span_metrics/audit', 'span_metrics/checkout', 'span_metrics/web']);
  assert.equal(new Set(connectors).size, connectors.length, 'no connector is fed by two pipelines');
  assert.equal(spec.lines.every((l) => !l.text.includes('spanmetrics')), true, 'the current component name, span_metrics');
});

test('spot: the real grader accepts exactly the two faults; one, all, the decoys or a mix fail', () => {
  assert.deepEqual(spotRun(['traces', 'traces-checkout']), { outcome: 'right', extra: [], missing: [] });
  assert.deepEqual(spotRun(['traces-checkout', 'traces']), { outcome: 'right', extra: [], missing: [] }, 'order is irrelevant');
  assert.deepEqual(spotRun(['traces']), { outcome: 'wrong', extra: [], missing: ['traces-checkout'] });
  assert.deepEqual(spotRun(['traces-checkout']), { outcome: 'wrong', extra: [], missing: ['traces'] });
  assert.deepEqual(spotRun(spot().lines.map((l) => l.id)).outcome, 'wrong');
  assert.deepEqual(spotRun(['traces-sampled']), { outcome: 'wrong', extra: ['traces-sampled'], missing: ['traces', 'traces-checkout'] }, 'tail_sampling alone is not the fault');
  assert.deepEqual(spotRun(['traces-metrics']).extra, ['traces-metrics'], 'the connector alone is not the fault');
  assert.deepEqual(spotRun(['traces', 'traces-checkout', 'traces-audit']), { outcome: 'wrong', extra: ['traces-audit'], missing: [] });
  assert.deepEqual(spotRun(['traces', 'traces-checkout', 'metrics-spans']).extra, ['metrics-spans']);
  assert.equal(spotRun([]).outcome, 'empty');
});

test('spot: every decoy says why it is fine, and the faults are never explained as fine', () => {
  const spec = spot();
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['metrics-spans', 'traces-audit', 'traces-metrics', 'traces-sampled']);
  assert.equal(/every span/.test(plain(spec.whyNot['traces-metrics'])), true);
  assert.equal(/no connector|nothing to count/.test(plain(spec.whyNot['traces-sampled'])), true);
  assert.equal(/no sampling/.test(plain(spec.whyNot['traces-audit'])), true);
  assert.equal(/receiv/.test(plain(spec.whyNot['metrics-spans'])), true);
});

test('spot: the explain teaches the nuance with the recomputed figures: 39 of 400 requests a second, 8 errors of 39 is 21%, not 2%', () => {
  assert.equal(Math.round((KEPT_ERRORS / KEPT) * 100), 21);
  assert.equal(KEPT_ERRORS / TRACES, 0.02);
  const t = plain(spot().explain);
  for (const w of ['39', '400', '21%', '2%', 'exporter', 'end of', 'before', 'its own', 'span_metrics', 'spanmetrics', 'deprecated']) assert.equal(t.includes(w), true, w);
  for (const w of ['counts the spans of all of them together', 'own connector', 'a pipeline whose connector sees only']) assert.equal(t.includes(w), true, w);
  const intro = plain(LIVE.levels['tail-sampling'].play.steps[1].intro);
  for (const w of ['span_metrics', 'tail_sampling']) assert.equal(intro.includes(w), true, w);
});

// ---- both levels --------------------------------------------------------------------

const urls = (f, prefix) =>
  read(`levels/${f}.mjs`).split('\n').filter((l) => l.startsWith(prefix)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);

test('the 6.1 and 6.2 level files cite the pages their facts come from: Spec lines on allowed hosts, Docs lines for the READMEs', () => {
  const head = urls('head-sampling', '// Spec: ');
  for (const u of [
    'https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/',
    'https://opentelemetry.io/docs/specs/otel/trace/sdk/#parentbased',
    'https://opentelemetry.io/docs/specs/otel/trace/sdk/#traceidratiobased',
    'https://www.w3.org/TR/trace-context-2/#sampled-flag',
    'https://opentelemetry.io/docs/concepts/sampling/#head-sampling',
  ]) assert.equal(head.includes(u), true, u);
  const tail = urls('tail-sampling', '// Spec: ');
  for (const u of [
    'https://opentelemetry.io/docs/concepts/sampling/#tail-sampling',
    'https://opentelemetry.io/docs/collector/configuration/#connectors',
  ]) assert.equal(tail.includes(u), true, u);
  const docs = urls('tail-sampling', '// Docs').join(' ');
  for (const u of [
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector/blob/main/connector/README.md',
  ]) assert.equal(docs.includes(u), true, u);
  for (const f of ['head-sampling', 'tail-sampling']) {
    for (const u of [...urls(f, '// Spec: ')]) assert.equal(['opentelemetry.io', 'www.w3.org', 'prometheus.io'].includes(new URL(u).host), true, `${f} Spec line ${u}`);
    assert.equal(/^\/\/ Spec: .*github\.com/m.test(read(`levels/${f}.mjs`)), false, `${f}: GitHub is a Docs source, not a Spec source`);
  }
});

test('the level headers say which widget grades what, and why Spot it stands in for a config check', () => {
  const head = read('levels/head-sampling.mjs');
  assert.equal(/Trade-off/.test(head) && /not run|does not simulate|authored/.test(head), true, 'the header says Trade-off prices authored options');
  const tail = read('levels/tail-sampling.mjs');
  assert.equal(/Spot it/.test(tail) && /does not parse/.test(tail), true, 'the header says Spot it does not parse the config');
});

test('no em dash in the two level files or the two new cards', () => {
  const dash = String.fromCharCode(0x2014);
  for (const f of ['head-sampling', 'tail-sampling']) assert.equal(read(`levels/${f}.mjs`).includes(dash), false, f);
  for (const c of DECK.filter((d) => Object.keys(CARDS).includes(d.id))) assert.equal(JSON.stringify(c).includes(dash), false, c.id);
});
