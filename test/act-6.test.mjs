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
import { liveRegistry } from '../app.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { litIds } from './helpers/lights.mjs';
import { isActComplete, isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';
import { allPlans, checkTradeoff, evaluatePlan, newTradeoffState, pickOption, validateTradeoffSpec } from '../lib/widgets/trade-off.mjs';
import { checkSpot, newSpotState, toggleLine, validateSpotSpec } from '../lib/widgets/spot-it.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';

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

test('act-6 "Sampling and cost" holds 6.1 to 6.3 after Act 5, then its boss "Errors tripled overnight"', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-6');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 6, name: 'Sampling and cost', sub: 'You can\'t keep everything', levelIds: ['head-sampling', 'tail-sampling', 'what-costs-money'], bossId: 'errors-tripled' },
  );
  const ids = LIVE.acts.map((a) => a.id);
  assert.equal(ids[ids.indexOf('act-6') - 1], 'act-5', 'act-6 follows act-5');
  const at = LIVE.order.indexOf('silence');
  assert.deepEqual(LIVE.order.slice(at, at + 5), ['silence', 'head-sampling', 'tail-sampling', 'what-costs-money', 'errors-tripled']);
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

test('act-6 is not complete until its boss is done too', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-6');
  assert.equal(act.bossId, 'errors-tripled');
  assert.equal(isActComplete(act, progressOf([...act.levelIds])), false, 'the levels alone do not complete the act');
  assert.equal(isActComplete(act, progressOf([...act.levelIds, 'errors-tripled'])), true);
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

test('lights: 6.1 lights the storefront (the root), 6.2 the Collector', () => {
  const lit = (done) => litIds(LIVE, progressOf(done));
  assert.deepEqual(lit([]), []);
  assert.deepEqual(lit(['head-sampling']), ['storefront']);
  assert.deepEqual(lit(['tail-sampling']), ['collector']);
  assert.deepEqual(lit(['head-sampling', 'tail-sampling']), ['storefront', 'collector']);
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

test('spot: the lines are valid, five of them, and exactly one, the traces pipeline that feeds span_metrics after tail_sampling, is the fault', () => {
  const spec = spot();
  assert.deepEqual(validateSpotSpec(spec), []);
  assert.equal(spec.target, 'config');
  const ids = spec.lines.map((l) => l.id);
  assert.deepEqual([...ids].sort(), ['connector-def', 'logs', 'metrics-spans', 'sampler-def', 'traces']);
  // #190: the answer is not the focused first line (nor the last), and sits below metrics-spans and connector-def, the two lines it refers to.
  assert.equal(ids.indexOf('traces') > 0 && ids.indexOf('traces') < ids.length - 1, true, `traces is neither first nor last: ${ids}`);
  assert.equal(ids.indexOf('traces') > ids.indexOf('metrics-spans') && ids.indexOf('traces') > ids.indexOf('connector-def'), true, `traces below metrics-spans and connector-def: ${ids}`);
  const rule = (l) => /processors: \[[^\]]*tail_sampling[^\]]*\]/.test(l.text) && /exporters: \[[^\]]*span_metrics[^\]]*\]/.test(l.text);
  assert.deepEqual(spec.lines.filter(rule).map((l) => l.id), ['traces'], 'the one line that matches the rule');
  assert.deepEqual([...spec.faults], ['traces']);
  assert.equal(spec.lines.find((l) => l.id === 'traces').text, 'traces: receivers: [otlp] processors: [memory_limiter, tail_sampling, batch] exporters: [otlp_grpc/dash0, span_metrics]');
  assert.equal(spec.lines.find((l) => l.id === 'metrics-spans').text, 'metrics/spans: receivers: [span_metrics] processors: [batch] exporters: [otlp_grpc/dash0]');
  assert.equal(spec.lines.every((l) => !l.text.includes('spanmetrics')), true, 'the current component name, span_metrics');
});

// The Spot it lines are pipelines of one gateway, so together they must be a config the Collector accepts. They are assembled
// into one config here (the traces pipelines read the otlp receiver, which the lines leave out) and checked: every component
// is defined (the real checkConfig), and every connector is the exporter of a traces pipeline AND the receiver of a metrics
// pipeline (checkConfig does not model that pairing, the Collector refuses to start without it, so it is checked here).
const assembled = (lines) => {
  const pipelines = lines.filter((text) => /^(traces|metrics|logs)(\/[a-z]+)?: /.test(text)).map((text) => {
    const [, name, body] = text.match(/^([a-z/]+): (.*)$/);
    const fields = Object.fromEntries([...body.matchAll(/(receivers|processors|exporters): \[([^\]]*)\]/g)].map((m) => [m[1], m[2].split(',').map((s) => s.trim())]));
    return { name, receivers: fields.receivers ?? ['otlp'], processors: fields.processors ?? [], exporters: fields.exporters };
  });
  const ids = (key) => [...new Set(pipelines.flatMap((p) => p[key]))];
  const connectors = [...new Set(ids('exporters').concat(ids('receivers')).filter((id) => id.startsWith('span_metrics')))];
  const yaml = [
    'receivers:\n  otlp:',
    `processors:\n${ids('processors').map((id) => `  ${id}:`).join('\n')}`,
    'exporters:\n  otlp_grpc/dash0:',
    `connectors:\n${connectors.map((id) => `  ${id}:`).join('\n')}`,
    `service:\n  pipelines:\n${pipelines.map((p) => `    ${p.name}:\n      receivers: [${p.receivers.join(', ')}]\n      processors: [${p.processors.join(', ')}]\n      exporters: [${p.exporters.join(', ')}]`).join('\n')}`,
  ].join('\n');
  return { pipelines, yaml };
};
const connectorProblems = ({ pipelines }) => {
  const problems = [];
  const all = new Set(pipelines.flatMap((p) => [...p.exporters, ...p.receivers]).filter((id) => id.startsWith('span_metrics')));
  for (const id of all) {
    const exportedBy = pipelines.filter((p) => p.exporters.includes(id)).map((p) => p.name);
    const receivedBy = pipelines.filter((p) => p.receivers.includes(id)).map((p) => p.name);
    if (exportedBy.length === 0) problems.push(`${id} is received but never an exporter`);
    if (receivedBy.length === 0) problems.push(`${id} is an exporter of ${exportedBy.join(',')} but no pipeline receives it`);
    for (const n of exportedBy) if (!n.startsWith('traces')) problems.push(`${id} exported by ${n}, not a traces pipeline`);
    for (const n of receivedBy) if (!n.startsWith('metrics')) problems.push(`${id} received by ${n}, not a metrics pipeline`);
  }
  return problems;
};

// The single writer rule (the spanmetrics README): two span_metrics connectors that write the same metric names and dimensions
// conflict, so the config has exactly one span_metrics instance, in the lines and in the fix the explain describes.
const instances = (cfg) => [...new Set(cfg.pipelines.flatMap((p) => [...p.exporters, ...p.receivers]).filter((id) => id.startsWith('span_metrics')))];
const accepted = (cfg) => {
  const result = checkConfig(cfg.yaml, COLLECTOR_SCHEMA);
  assert.deepEqual(result.errors.map((e) => `${e.kind} ${e.path}`), []);
  assert.equal(result.verdict.flowing, true);
  assert.deepEqual(result.verdict.inactive, [], 'nothing defined is left unused');
  assert.deepEqual(connectorProblems(cfg), []);
  assert.deepEqual(instances(cfg), ['span_metrics'], 'exactly one span_metrics instance: a single writer');
};
// The fix the explain describes: span_metrics gets its own traces pipeline with no sampling, and tail_sampling stays on the pipeline to the backend.
const FIXED = [
  'traces/metrics: receivers: [otlp] processors: [memory_limiter] exporters: [span_metrics]',
  'traces: receivers: [otlp] processors: [memory_limiter, tail_sampling, batch] exporters: [otlp_grpc/dash0]',
];

test('spot: the lines together are one config the Collector accepts: every component defined, the connector exported by a traces pipeline and received by a metrics one, one writer', () => {
  const cfg = assembled(spot().lines.map((l) => l.text));
  accepted(cfg);
  assert.deepEqual(cfg.pipelines.map((p) => p.name).sort(), ['logs', 'metrics/spans', 'traces']);
});

test('spot: the fix the explain describes is also one valid, single-writer config, and has no sampling before the connector', () => {
  const spec = spot();
  const lines = [...FIXED, ...spec.lines.filter((l) => l.id !== 'traces').map((l) => l.text)];
  const cfg = assembled(lines);
  accepted(cfg);
  const feeding = cfg.pipelines.filter((p) => p.exporters.includes('span_metrics'));
  assert.deepEqual(feeding.map((p) => [p.name, p.processors.includes('tail_sampling')]), [['traces/metrics', false]]);
  assert.equal(plain(spec.explain).includes('traces/metrics'), true, 'the explain names the pipeline of the fix');
});

test('spot: the config check has teeth: a second span_metrics instance, a connector nobody receives, or one received but never exported, is refused', () => {
  const lines = spot().lines.map((l) => l.text);
  const second = lines.map((l) => l.replace('otlp_grpc/dash0, span_metrics]', 'otlp_grpc/dash0, span_metrics, span_metrics/2]'));
  assert.deepEqual(instances(assembled(second)), ['span_metrics', 'span_metrics/2']);
  assert.deepEqual(connectorProblems(assembled(second)), ['span_metrics/2 is an exporter of traces but no pipeline receives it']);
  const noReceiver = lines.map((l) => l.replace('receivers: [span_metrics]', 'receivers: [otlp]'));
  assert.deepEqual(connectorProblems(assembled(noReceiver)), ['span_metrics is an exporter of traces but no pipeline receives it']);
  const noExporter = lines.map((l) => l.replace(', span_metrics]', ']'));
  assert.deepEqual(connectorProblems(assembled(noExporter)), ['span_metrics is received but never an exporter']);
});

test('spot: the real grader accepts exactly the traces line; any decoy, or all lines, fail', () => {
  assert.deepEqual(spotRun(['traces']), { outcome: 'right', extra: [], missing: [] });
  assert.deepEqual(spotRun(spot().lines.map((l) => l.id)).outcome, 'wrong');
  assert.deepEqual(spotRun(['sampler-def']), { outcome: 'wrong', extra: ['sampler-def'], missing: ['traces'] }, 'tail_sampling alone is not the fault');
  assert.deepEqual(spotRun(['connector-def']).extra, ['connector-def'], 'the connector alone is not the fault');
  assert.deepEqual(spotRun(['metrics-spans']), { outcome: 'wrong', extra: ['metrics-spans'], missing: ['traces'] });
  assert.deepEqual(spotRun(['logs']).extra, ['logs']);
  assert.deepEqual(spotRun(['traces', 'metrics-spans']), { outcome: 'wrong', extra: ['metrics-spans'], missing: [] });
  assert.equal(spotRun([]).outcome, 'empty');
});

test('spot: every decoy says why it is fine, and the fault is never explained as fine', () => {
  const spec = spot();
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['connector-def', 'logs', 'metrics-spans', 'sampler-def']);
  assert.equal(/receiv/.test(plain(spec.whyNot['metrics-spans'])), true);
  assert.equal(/singular|the connector/.test(plain(spec.whyNot['metrics-spans'])) && !/four/.test(plain(spec.whyNot['metrics-spans'])), true, 'one connector again');
  assert.equal(/connector is not in it/.test(plain(spec.whyNot.logs)), true);
  assert.equal(/definition|only defines/.test(plain(spec.whyNot['connector-def'])), true);
  assert.equal(/definition|only defines/.test(plain(spec.whyNot['sampler-def'])), true);
});

test('spot: the explain teaches the nuance with the recomputed figures: 39 of 400 requests a second, 8 errors of 39 is 21%, not 2%', () => {
  assert.equal(Math.round((KEPT_ERRORS / KEPT) * 100), 21);
  assert.equal(KEPT_ERRORS / TRACES, 0.02);
  const t = plain(spot().explain);
  for (const w of ['39', '400', '21%', '2%', 'exporter', 'end of', 'before', 'its own', 'span_metrics', 'spanmetrics', 'deprecated']) assert.equal(t.includes(w), true, w);
  for (const w of ['39 of 400', '8 of 39', 'traces/metrics', 'no sampling processor', 'one span_metrics']) assert.equal(t.includes(w), true, w);
  assert.equal(t.includes('take span_metrics out of the exporters of traces, so traces/metrics is the only pipeline that feeds it'), true, 'the fix removes the connector from traces, or two pipelines feed one instance');
  // The sampler decoy shows the policies of the Trade-off answer, derived from that option, so the 39 of 400 holds.
  const answerOption = ts().knobs.find((k) => k.id === 'policies').options.find((o) => o.id === ts().answer.policies);
  const answerLabel = answerOption.label;
  const wantTypes = [...answerLabel.matchAll(/<code>(\w+)<\/code>/g)].map((m) => m[1]);
  assert.deepEqual(wantTypes, ['status_code', 'latency', 'probabilistic']);
  const wantMs = Number(answerLabel.match(/above (\d+) seconds/)[1]) * 1000;
  const wantPercent = Number(answerLabel.match(/at (\d+)% of the rest/)[1]);
  const samplerLine = spot().lines.find((l) => l.id === 'sampler-def').text;
  assert.deepEqual([...samplerLine.matchAll(/type: (\w+)/g)].map((m) => m[1]), wantTypes, 'exactly the answer\'s policies, in order');
  assert.equal(Number(samplerLine.match(/threshold_ms: (\d+)/)[1]), wantMs);
  assert.equal(Number(samplerLine.match(/sampling_percentage: (\d+)/)[1]), wantPercent);
  assert.equal(wantMs, 2000);
  assert.equal(wantPercent, 5);
  assert.equal(answerLabel.includes('8 + 12 + 19 = 39 of 400'), true, 'the policies keep the 39 of 400 the explain uses');
  assert.equal(KEPT_ERRORS + KEPT_SLOW + KEPT_BASELINE, 39);
  assert.equal(/ERROR/.test(samplerLine), true);
  assert.equal(t.includes('the sampler kept every error and few of the rest'), true);
  assert.equal(t.split('. ').some((s) => s.length > 260), false, 'no run-on sentence in the explain');
  assert.equal(/four|all of them together|own connector/.test(t), false, 'one connector, no namespaces');
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
