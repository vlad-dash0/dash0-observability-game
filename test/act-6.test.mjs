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
      'Compute span metrics before sampling: a connector fed from a tail_sampling pipeline counts only the spans of the traces kept.',
    back:
      'The span_metrics connector counts the spans it receives, for each set of dimensions, into calls and duration metrics. ' +
      'A connector is an exporter at the end of one pipeline and a receiver at the start of another, so it receives what leaves ' +
      'the processors of the traces pipeline that lists it. List it in a pipeline that has tail_sampling and it sees only the ' +
      'spans of the kept traces: the request rate comes out too low, and when the policies keep every error the error ratio comes out too ' +
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
const HS = { checkout: 'follow', payments: 'follow' };
const hsPlan = (checkout, payments = 'follow') => ({ checkout, payments });
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

test('head sampling: the table behind the copy, recomputed: 12 spans a trace, 4,800 spans/s unsampled, 160 for storefront at one in ten, 600 left', () => {
  assert.equal(WHOLE, 12);
  assert.equal(TRACES * WHOLE, 4800);
  assert.equal(TRACES * 0.1 * SPANS.storefront, 160);
  assert.equal(760 - 160, 600);
  assert.equal(TRACES * 0.9 * SPANS.checkout, 1800, 'the checkout spans of the 360 traces the root dropped');
  assert.equal(TRACES * 0.9 * SPANS.payments, 1080);
  const spec = hs();
  assert.deepEqual(validateTradeoffSpec(spec), []);
  assert.equal(spec.unit, 'spans/s');
  assert.equal(spec.cap, 600);
  assert.equal(option(spec, 'checkout', 'follow').cost, TRACES * 0.1 * SPANS.checkout);
  assert.equal(option(spec, 'checkout', 'follow').cost, 200);
  assert.equal(option(spec, 'checkout', 'always-on').cost, 2000);
  assert.equal(option(spec, 'checkout', 'ratio').cost, 500);
  assert.equal(option(spec, 'checkout', 'ratio-5pct').cost, 100);
  assert.equal(option(spec, 'checkout', 'always-off').cost, 0);
  assert.equal(option(spec, 'payments', 'follow').cost, 120);
  assert.equal(option(spec, 'payments', 'always-on').cost, 1200);
  assert.equal(option(spec, 'payments', 'ratio').cost, 600);
  assert.deepEqual(spec.knobs.map((k) => k.options.map((o) => o.id)), [['always-on', 'ratio-5pct', 'ratio', 'follow', 'always-off'], ['follow', 'ratio', 'always-on']]);
  const intro = plain(LIVE.levels['head-sampling'].play.steps[0].intro);
  for (const w of ['400 traces', '12 spans', '4,800 spans', '760 spans', 'storefront', 'checkout', 'payments', '160 spans', '600 of the 760']) assert.equal(intro.includes(w), true, w);
  assert.equal(/authored|not run|does not run|simulat/.test(intro + plain(spec.explain)), true, 'the copy says the arithmetic is worked out, not run by an engine');
});

test('head sampling: exactly one plan passes, the children following the root at one in ten: 320 of 440 spans/s', () => {
  const spec = hs();
  assert.deepEqual(spec.answer, HS);
  const plans = allPlans(spec).map((picks) => ({ picks, ...evaluatePlan(spec, picks) }));
  const passing = plans.filter((p) => p.over === 0 && p.lost.length === 0);
  assert.deepEqual(passing.map((p) => p.picks), [HS]);
  assert.equal(passing[0].total, 320);
  assert.deepEqual(verdictOf(play(spec, HS)), { outcome: 'right', total: 320, over: 0, lost: [] });
});

test('head sampling: every shortcut fails the real grader for its own reason', () => {
  const spec = hs();
  const run = (checkout, payments) => verdictOf(play(spec, hsPlan(checkout, payments)));
  assert.deepEqual(run('always-on', 'follow'), { outcome: 'wrong', total: 2120, over: 1520, lost: [] }, 'a child that ignores the root samples every trace: over the budget');
  assert.deepEqual(run('follow', 'always-on'), { outcome: 'wrong', total: 1400, over: 800, lost: [] });
  assert.deepEqual(run('follow', 'ratio'), { outcome: 'wrong', total: 800, over: 200, lost: [] }, 'a plain ratio keeps the root\'s traces and more whose root was dropped: over budget');
  assert.deepEqual(run('ratio', 'follow'), { outcome: 'wrong', total: 620, over: 20, lost: [] }, 'the nearest miss: over by 20 spans a second');
  assert.deepEqual(run('ratio-5pct', 'follow'), { outcome: 'wrong', total: 220, over: 0, lost: ['checkout-whole'] }, 'a child ratio below the root\'s keeps only some of the root\'s traces');
  assert.deepEqual(run('always-off', 'follow'), { outcome: 'wrong', total: 120, over: 0, lost: ['checkout-whole'] }, 'cheap, and checkout is missing from every kept trace');
  assert.deepEqual(run('always-off', 'ratio'), { outcome: 'wrong', total: 600, over: 0, lost: ['checkout-whole'] }, 'the dearest plan that fits still drops checkout');
});

test('head sampling: a plan with nothing picked is incomplete and free, and a repeated wrong plan is a repeat', () => {
  const spec = hs();
  assert.equal(checkTradeoff(spec, newTradeoffState(spec)).outcome, 'incomplete');
  const first = play(spec, hsPlan('always-off'));
  assert.equal(first.outcome, 'wrong');
  assert.equal(checkTradeoff(spec, first.state).outcome, 'repeat');
});

test('head sampling: the nuance is graded: the wrong options say why a child that decides on its own breaks traces', () => {
  const spec = hs();
  const alwaysOn = plain(spec.whyNot['checkout:always-on']);
  for (const w of ['360 of every 400', '1,800', 'root', '2,000']) assert.equal(alwaysOn.includes(w), true, w);
  const payments = plain(spec.whyNot['payments:always-on']);
  for (const w of ['1,080', '1,200', 'root']) assert.equal(payments.includes(w), true, w);
  const ratio = plain(spec.whyNot['checkout:ratio']);
  for (const w of ["ignore the parent's sampled flag", 'a higher ratio samples every trace a lower one does', '60 more whose root was dropped', '300 of them with no root above them']) assert.equal(ratio.includes(w), true, w);
  assert.equal(plain(spec.whyNot['checkout:ratio-5pct']).includes('a lower ratio samples only some of the traces a higher one does'), true);
  assert.equal(plain(spec.whyNot['payments:ratio']).includes('160 more whose root was dropped'), true);
  assert.equal(plain(spec.whyNot['payments:ratio']).includes('480 of them'), true);
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['checkout:always-off', 'checkout:always-on', 'checkout:ratio', 'checkout:ratio-5pct', 'payments:always-on', 'payments:ratio']);
  assert.equal(plain(option(spec, 'checkout', 'always-on').label).includes('always_on'), true);
  assert.equal(plain(option(spec, 'checkout', 'follow').label).includes('parentbased_always_on'), true, 'the default sampler is named');
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
  assert.equal(/of 600/.test(t), false, 'the widget already says what the plan costs');
  for (const w of ['40 of 400', 'OTEL_TRACES_SAMPLER', 'parentbased_always_on', 'sampled flag', 'cannot', 'errors', 'tail sampling']) {
    assert.equal(t.includes(w), true, w);
  }
});

// ---- 6.2 Tail sampling: the trade-off -----------------------------------------------

const ts = () => stepOf('tail-sampling', 'tradeoff', 'ts-budget');
const TS = { wait: 'wait-25s', policies: 'errors-slow-baseline' };
const MIB_PER_TRACE = 0.05;
const KEPT_ERRORS = TRACES * 0.02;
const KEPT_SLOW = TRACES * 0.03;
const KEPT_BASELINE = (TRACES - KEPT_ERRORS - KEPT_SLOW) * 0.05;
const KEPT = KEPT_ERRORS + KEPT_SLOW + KEPT_BASELINE;

test('tail sampling: the table behind the copy, recomputed: 400 traces/s held for the wait at 0.05 MiB each, 39 of 400 kept', () => {
  assert.deepEqual([KEPT_ERRORS, KEPT_SLOW, KEPT_BASELINE, KEPT], [8, 12, 19, 39]);
  const held = (seconds) => TRACES * seconds * MIB_PER_TRACE;
  assert.deepEqual([5, 10, 15, 25, 30].map(held), [100, 200, 300, 500, 600]);
  assert.equal(TRACES * 25 < 50000, true, '10,000 traces held is under the default num_traces of 50,000');
  const spec = ts();
  assert.deepEqual(validateTradeoffSpec(spec), []);
  assert.equal(spec.unit, 'MiB');
  assert.equal(spec.cap, 550);
  for (const [id, sec] of [['wait-5s', 5], ['wait-10s', 10], ['wait-15s', 15], ['wait-25s', 25], ['wait-30s', 30]]) assert.equal(option(spec, 'wait', id).cost, held(sec), id);
  for (const o of spec.knobs.find((k) => k.id === 'policies').options) assert.equal(o.cost, 0, `${o.id}: the policies do not change what is held while waiting`);
  assert.equal(plain(option(spec, 'policies', 'errors-slow-baseline').label).includes('8 + 12 + about 19 more = 39 of 400'), true);
  assert.equal(plain(option(spec, 'policies', 'errors-slow').label).includes('20 of 400'), true);
  assert.equal(plain(option(spec, 'policies', 'probabilistic').label).includes('40 of 400'), true);
  const intro = plain(LIVE.levels['tail-sampling'].play.steps[0].intro);
  for (const w of ['400 new traces', '20 seconds', '2%', '3%', '550 MiB', 'decision_wait', '30 seconds']) assert.equal(intro.includes(w), true, w);
  assert.equal(/more until it is sent/.test(intro), false, 'no invented hold for kept traces');
});

test('tail sampling: exactly one plan passes: errors, slow and a 5% baseline with a 25 s wait, at 500 of 550 MiB', () => {
  const spec = ts();
  assert.deepEqual(spec.answer, TS);
  const plans = allPlans(spec).map((picks) => ({ picks, ...evaluatePlan(spec, picks) }));
  const passing = plans.filter((p) => p.over === 0 && p.lost.length === 0);
  assert.deepEqual(passing.map((p) => p.picks), [TS]);
  assert.equal(passing[0].total, 500);
  assert.deepEqual(verdictOf(play(spec, TS)), { outcome: 'right', total: 500, over: 0, lost: [] });
});

test('tail sampling: every shortcut fails the real grader for its own reason', () => {
  const spec = ts();
  const run = (wait, policies) => verdictOf(play(spec, { wait, policies }));
  assert.deepEqual(run('wait-30s', 'errors-slow-baseline'), { outcome: 'wrong', total: 600, over: 50, lost: [] }, 'the default wait keeps every need and is over the memory');
  assert.deepEqual(run('wait-15s', 'errors-slow-baseline'), { outcome: 'wrong', total: 300, over: 0, lost: ['whole-traces'] }, 'cheap, and decides before the 20 s traces are whole');
  assert.deepEqual(run('wait-25s', 'errors-slow'), { outcome: 'wrong', total: 500, over: 0, lost: ['baseline-kept'] }, 'no healthy baseline to compare against');
  assert.deepEqual(run('wait-25s', 'probabilistic'), { outcome: 'wrong', total: 500, over: 0, lost: ['errors-kept', 'slow-kept'] }, 'a plain ratio is head sampling again');
  assert.deepEqual(run('wait-25s', 'errors'), { outcome: 'wrong', total: 500, over: 0, lost: ['slow-kept', 'baseline-kept'] }, 'the slow traces and the baseline are dropped');
});

test('tail sampling: the trade-off teaches the cost: the wait holds traces in memory, the 20 s traces set how long, and late spans are named', () => {
  const spec = ts();
  const t = plain(spec.explain);
  for (const w of ['10,000 traces', 'num_traces', '50,000', 'decision_wait', '30-second default', 'late', '20 seconds', 'whichever policies']) assert.equal(t.includes(w), true, w);
  assert.equal(/of 550 MiB|500 of/.test(t), false, 'the widget already says what the plan costs');
  assert.equal(/until it is sent/.test(t), false, 'no invented hold for kept traces');
  const dflt = plain(spec.whyNot['wait:wait-30s']);
  for (const w of ['12,000', '600', '100 MiB', 'whichever policies']) assert.equal(dflt.includes(w), true, w);
  for (const id of ['wait-5s', 'wait-10s', 'wait-15s']) for (const w of ['20 seconds', 'late']) assert.equal(plain(spec.whyNot[`wait:${id}`]).includes(w), true, `${id} ${w}`);
  assert.equal(/head sampling|cheapest/.test(plain(spec.hint)), false, 'the hint names the concept, not a heuristic');
  assert.equal(plain(LIVE.levels['tail-sampling'].play.steps[0].question), 'Pick the wait and the policies: keep what the team wants and stay within the memory.');
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

const FIELD_LINE = /^service: \{pipelines: \{([a-z0-9_/]+): \{(receivers|processors|exporters): \[([^\]]*)\]\}\}\}$/;
const PIPELINES = ['metrics/dash0', 'traces/archive', 'traces/count', 'traces/dash0'];

test('spot: the lines are valid, ten of them, and exactly two, the processors and the exporters of the traces/dash0 pipeline that feeds span_metrics after tail_sampling, are the faults', () => {
  const spec = spot();
  assert.deepEqual(validateSpotSpec(spec), []);
  assert.equal(spec.target, 'config');
  const ids = spec.lines.map((l) => l.id);
  assert.deepEqual([...ids].sort(), ['archive-exporters', 'archive-processors', 'count-exporters', 'count-processors', 'metrics-exporters', 'metrics-processors', 'metrics-receivers', 'traces-exporters', 'traces-processors', 'traces-receivers']);
  // #190: no answer is the focused first line or the last, and both sit below metrics-receivers, the line they refer to. #193: ten lines, two answers.
  for (const id of ['traces-processors', 'traces-exporters']) {
    assert.equal(ids.indexOf(id) > 0 && ids.indexOf(id) < ids.length - 1, true, `${id} is neither first nor last: ${ids}`);
    assert.equal(ids.indexOf(id) > ids.indexOf('metrics-receivers'), true, `${id} below metrics-receivers: ${ids}`);
  }
  // Each fault is right alone; together they are the rule: tail_sampling among the processors and span_metrics among the exporters of one pipeline.
  const field = (l) => { const m = FIELD_LINE.exec(l.text); return m && { pipeline: m[1], field: m[2], list: m[3].split(',').map((x) => x.trim()) }; };
  const parsed = spec.lines.map((l) => ({ id: l.id, ...field(l) }));
  const sampled = parsed.filter((x) => x.field === 'processors' && x.list.includes('tail_sampling')).map((x) => x.pipeline);
  const feeding = parsed.filter((x) => x.field === 'exporters' && x.list.includes('span_metrics')).map((x) => x.pipeline);
  assert.deepEqual(sampled, ['traces/dash0'], 'tail_sampling is on one pipeline, the connector\'s; the archive pipeline samples with probabilistic_sampler');
  assert.deepEqual(feeding, ['traces/dash0']);
  const lines = (name) => parsed.filter((x) => x.pipeline === name).map((x) => x.id).sort();
  assert.deepEqual(lines('traces/dash0'), ['traces-exporters', 'traces-processors', 'traces-receivers'], 'the pipeline of the two lines is the same, and has a third line');
  assert.deepEqual(PIPELINES.map((name) => lines(name).length), [3, 2, 2, 3], 'lines per pipeline, so the pair is one of several');
  assert.deepEqual([...spec.faults], ['traces-processors', 'traces-exporters']);
  assert.equal(spec.lines.find((l) => l.id === 'traces-processors').text, 'service: {pipelines: {traces/dash0: {processors: [tail_sampling]}}}');
  assert.equal(spec.lines.find((l) => l.id === 'traces-exporters').text, 'service: {pipelines: {traces/dash0: {exporters: [otlp_grpc/dash0, span_metrics]}}}');
  assert.equal(spec.lines.find((l) => l.id === 'metrics-receivers').text, 'service: {pipelines: {metrics/dash0: {receivers: [span_metrics, count]}}}');
  assert.equal(spec.lines.every((l) => !l.text.includes('spanmetrics')), true, 'the current component name, span_metrics');
  assert.equal(plain(LIVE.levels['tail-sampling'].play.steps[1].question).includes('two lines that together'), true, 'the question says how many');
});

// The Spot it lines are pipelines of one gateway, so together they must be a config the Collector accepts. They are assembled
// into one config here, the pipeline lines merged by pipeline; what the lines leave out is the part of the config the board does not
// show: the definitions of the components, the otlp receiver, the one backend exporter, an empty entry for each component a pipeline lists. The real checkConfig then checks every
// reference, and the connector pairing it does not model (the Collector refuses to start without it) is checked here.
// The connectors of the board: span_metrics, and count, which pairs traces with metrics too (the connector README's supported pairs).
const isConnector = (id) => ['span_metrics', 'count'].includes(id.split('/')[0]);
const assembled = (lines) => {
  const byName = new Map();
  for (const text of lines) {
    const m = FIELD_LINE.exec(text);
    if (m) byName.set(m[1], { ...byName.get(m[1]), [m[2]]: m[3].split(',').map((x) => x.trim()) });
  }
  const pipelines = [...byName].map(([name, f]) => ({ name, receivers: f.receivers ?? ['otlp'], processors: f.processors ?? [], exporters: f.exporters ?? ['otlp_grpc/dash0'] }));
  const ids = (key) => [...new Set(pipelines.flatMap((p) => p[key]))];
  const connectors = [...new Set(ids('exporters').concat(ids('receivers')).filter(isConnector))];
  const referenced = { receivers: ids('receivers').filter((id) => !isConnector(id)), processors: ids('processors'), exporters: ids('exporters').filter((id) => !isConnector(id)), connectors };
  const section = (kind) => {
    return `${kind}: {${referenced[kind].map((id) => `${id}: {}`).join(', ')}}`;
  };
  const yaml = [
    ...['receivers', 'processors', 'exporters', 'connectors'].map(section),
    `service:\n  pipelines:\n${pipelines.map((p) => `    ${p.name}:\n      receivers: [${p.receivers.join(', ')}]\n      processors: [${p.processors.join(', ')}]\n      exporters: [${p.exporters.join(', ')}]`).join('\n')}`,
  ].join('\n');
  return { pipelines, yaml };
};
const connectorProblems = ({ pipelines }) => {
  const problems = [];
  const all = new Set(pipelines.flatMap((p) => [...p.exporters, ...p.receivers]).filter(isConnector));
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
const instances = (cfg) => [...new Set(cfg.pipelines.flatMap((p) => [...p.exporters, ...p.receivers]).filter((id) => id.split('/')[0] === 'span_metrics'))];
const accepted = (cfg) => {
  const result = checkConfig(cfg.yaml, COLLECTOR_SCHEMA);
  assert.deepEqual(result.errors.map((e) => `${e.kind} ${e.path}`), []);
  assert.equal(result.verdict.flowing, true);
  assert.deepEqual(result.verdict.inactive, [], 'nothing defined is left unused');
  assert.deepEqual(connectorProblems(cfg), []);
  assert.deepEqual(instances(cfg), ['span_metrics'], 'exactly one span_metrics instance: a single writer');
};
// The fix the explain describes: span_metrics gets its own traces pipeline with no sampling, and tail_sampling stays on the pipelines to a backend.
const fixedLines = (spec) => [
  'service: {pipelines: {traces/metrics: {processors: [batch]}}}',
  'service: {pipelines: {traces/metrics: {exporters: [span_metrics]}}}',
  'service: {pipelines: {traces/dash0: {exporters: [otlp_grpc/dash0]}}}',
  ...spec.lines.filter((l) => l.id !== 'traces-exporters').map((l) => l.text),
];

test('spot: the lines together are one config the Collector accepts: every component defined, the connector exported by a traces pipeline and received by a metrics one, one writer', () => {
  const cfg = assembled(spot().lines.map((l) => l.text));
  accepted(cfg);
  assert.deepEqual(cfg.pipelines.map((p) => p.name).sort(), PIPELINES);
});

test('spot: the fix the explain describes is also one valid, single-writer config, and has no sampling before the connector', () => {
  const spec = spot();
  const cfg = assembled(fixedLines(spec));
  accepted(cfg);
  const feeding = cfg.pipelines.filter((p) => p.exporters.includes('span_metrics'));
  assert.deepEqual(feeding.map((p) => [p.name, p.processors.includes('tail_sampling')]), [['traces/metrics', false]]);
  const text = plain(spec.explain);
  assert.equal(text.includes('traces/metrics'), true, 'the explain names the pipeline of the fix');
  assert.equal(text.includes('the fix keeps them apart rather than making either one wrong'), true, 'the explain says why the answer is two lines and what the fix changes');
});

test('spot: the config check has teeth: a second span_metrics instance, a connector nobody receives, or one received but never exported, is refused', () => {
  const lines = spot().lines.map((l) => l.text);
  const second = lines.map((l) => l.replace('otlp_grpc/dash0, span_metrics]', 'otlp_grpc/dash0, span_metrics, span_metrics/2]'));
  assert.deepEqual(instances(assembled(second)), ['span_metrics', 'span_metrics/2']);
  assert.deepEqual(connectorProblems(assembled(second)), ['span_metrics/2 is an exporter of traces/dash0 but no pipeline receives it']);
  const noReceiver = lines.map((l) => l.replace('receivers: [span_metrics, count]', 'receivers: [count]'));
  assert.deepEqual(connectorProblems(assembled(noReceiver)), ['span_metrics is an exporter of traces/dash0 but no pipeline receives it']);
  const noExporter = lines.map((l) => l.replace('otlp_grpc/dash0, span_metrics]', 'otlp_grpc/dash0]'));
  assert.deepEqual(connectorProblems(assembled(noExporter)), ['span_metrics is received but never an exporter']);
  const noCountExporter = spot().lines.filter((l) => l.id !== 'count-exporters').map((l) => l.text);
  assert.deepEqual(connectorProblems(assembled(noCountExporter)), ['count is received but never an exporter'], 'the count connector is checked as well');
  const countFromMetrics = lines.map((l) => l.replace('traces/count: {exporters: [count]}', 'metrics/count: {exporters: [count]}'));
  assert.deepEqual(connectorProblems(assembled(countFromMetrics)), ['count exported by metrics/count, not a traces pipeline']);
});

test('spot: the real grader accepts exactly the two traces lines together; either alone, any decoy, or all lines, fail', () => {
  assert.deepEqual(spotRun(['traces-processors', 'traces-exporters']), { outcome: 'right', extra: [], missing: [] });
  assert.deepEqual(spotRun(['traces-exporters', 'traces-processors']), { outcome: 'right', extra: [], missing: [] }, 'in either order');
  assert.equal(spotRun(spot().lines.map((l) => l.id)).outcome, 'wrong');
  assert.deepEqual(spotRun(['traces-processors']), { outcome: 'wrong', extra: [], missing: ['traces-exporters'] }, 'the sampler on the traces pipeline alone is not the fault');
  assert.deepEqual(spotRun(['traces-exporters']), { outcome: 'wrong', extra: [], missing: ['traces-processors'] }, 'the connector on the traces pipeline alone is not the fault');
  assert.deepEqual(spotRun(['traces-receivers']), { outcome: 'wrong', extra: ['traces-receivers'], missing: ['traces-processors', 'traces-exporters'] }, 'the receiver of the sampled pipeline is no fault');
  assert.deepEqual(spotRun(['count-exporters', 'count-processors']).extra, ['count-processors', 'count-exporters'], 'the count connector without sampling is no fault');
  assert.deepEqual(spotRun(['metrics-receivers', 'traces-exporters']), { outcome: 'wrong', extra: ['metrics-receivers'], missing: ['traces-processors'] });
  assert.deepEqual(spotRun(['traces-processors', 'traces-exporters', 'archive-processors']), { outcome: 'wrong', extra: ['archive-processors'], missing: [] });
  assert.deepEqual(spotRun(['archive-processors', 'traces-exporters']), { outcome: 'wrong', extra: ['archive-processors'], missing: ['traces-processors'] }, 'the other sampled pipeline is no fault');
  assert.deepEqual(spotRun(['traces-processors', 'archive-exporters']), { outcome: 'wrong', extra: ['archive-exporters'], missing: ['traces-exporters'] });
  assert.equal(spotRun([]).outcome, 'empty');
});

test('spot: every decoy says why it is fine, no reason names the traces pipeline, a fault or either of its fields, and the fault is never explained as fine', () => {
  const spec = spot();
  const decoys = spec.lines.filter((l) => !spec.faults.includes(l.id)).map((l) => l.id).sort();
  assert.deepEqual(Object.keys(spec.whyNot).sort(), decoys);
  for (const [id, why] of Object.entries(spec.whyNot)) {
    const t = plain(why);
    assert.equal(/tail_sampling|traces|feed/.test(t.replace(/\bthe pipelines that feed the connector\b/, '').replace(/\bevery traces pipeline can read\b/, '').replace(/\bwaits for whole traces\b/, '')), false, `${id}: names no fault, the traces pipeline, or the sampler on it`);
    for (const fault of spec.lines.filter((l) => spec.faults.includes(l.id))) assert.equal(t.includes(fault.text), false, `${id}: not the full text of ${fault.id}`);
  }
  assert.equal(/receiv/.test(plain(spec.whyNot['metrics-receivers'])), true);
  assert.equal(/the connector/.test(plain(spec.whyNot['metrics-receivers'])) && !/four/.test(plain(spec.whyNot['metrics-receivers'])), true, 'one connector again');
  assert.equal(/archive of its own/.test(plain(spec.whyNot['archive-processors'])) && /archive of its own/.test(plain(spec.whyNot['archive-exporters'])), true);
  assert.equal(/counted/.test(plain(spec.whyNot['metrics-exporters'])), true);
  // probabilistic_sampler is stateless for traces (its README), so the archive reason says it keeps no state between spans.
  assert.equal(plain(spec.whyNot['archive-processors']).includes('each decided on its own, with no state kept between spans, unlike the sampler that waits for whole traces'), true);
  assert.equal(/no processor here drops one/.test(plain(spec.whyNot['count-processors'])), true, 'count sees every span');
  assert.equal(/pipeline lines?\b|that list it/.test(plain(spec.whyNot['metrics-receivers'])), false, 'no reason points at the one line that lists the component');
});

test('spot: the explain teaches the nuance with the recomputed figures: the spans of 39 of 400 traces a second, 8 errors of 39 is 21%, not 2%', () => {
  assert.equal(Math.round((KEPT_ERRORS / KEPT) * 100), 21);
  assert.equal(KEPT_ERRORS / TRACES, 0.02);
  const t = plain(spot().explain);
  for (const w of ['39', '400', '21%', '2%', 'exporter', 'end of', 'before', 'its own', 'span_metrics', 'spanmetrics', 'deprecated']) assert.equal(t.includes(w), true, w);
  for (const w of ['39 of 400', '8 of 39', 'traces/metrics', 'no sampling processor', 'one span_metrics']) assert.equal(t.includes(w), true, w);
  assert.equal(t.includes('take span_metrics out of the exporters of traces/dash0, so traces/metrics is the only pipeline that feeds it'), true, 'the fix removes the connector from traces, or two pipelines feed one instance');
  // The figures come from the policies of the Trade-off answer, derived from that option, so the 39 of 400 holds.
  const policies = ts().knobs.find((k) => k.id === 'policies').options.find((o) => o.id === ts().answer.policies).label;
  assert.deepEqual([...policies.matchAll(/<code>(\w+)<\/code>/g)].map((m) => m[1]), ['probabilistic']);
  assert.equal(policies.includes('8 + 12 + about 19 more = 39 of 400'), true, 'the policies keep the 39 of 400 the explain uses');
  assert.equal(KEPT_ERRORS + KEPT_SLOW + KEPT_BASELINE, 39);
  assert.equal(t.includes('the sampler kept every error and few of the rest'), true);
  assert.equal(t.includes('count sees the spans of all 400 traces a second'), true, 'the count pipeline is the contrast');
  assert.equal(t.includes('gets only the spans of the traces it kept: 39 of 400 traces a second'), true, 'the connector counts spans; the figures are traces');
  assert.equal(/belongs on the pipeline/.test(t), false, 'no uncited placement claim');
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
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.164.0/processor/tailsamplingprocessor/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.164.0/connector/spanmetricsconnector/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector/blob/v0.164.0/connector/README.md',
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

test('head sampling: the lesson is short paragraphs, and it says plainly that no real sampler runs (#321)', () => {
  const intro = LIVE.levels['head-sampling'].play.steps[0].intro;
  const paras = [...intro.matchAll(/<p>(.*?)<\/p>/g)].map((m) => plain(m[1]));
  assert.equal(paras.length, 4);
  for (const p of paras) assert.ok(p.length <= 330, `a short paragraph: ${p.length}`);
  assert.equal(paras.at(-1), 'The numbers below come from this table. The game does not run a real sampler.');
  assert.equal(intro.replace(/<p>.*?<\/p>/g, ''), '', 'nothing outside a paragraph');
});
