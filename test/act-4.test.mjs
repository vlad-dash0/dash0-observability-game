// Act 4 levels 4.1 Structured logs and 4.2 Correlation beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's place in the
// registry, unlock and map; level fields and lights; card fronts and backs; the facts the copy
// states (docs/OUTLINE.md §4 Act 4), each checked from the level's own data. Level 4.2 attaches
// log records to spans with Build it in logs mode (issue #114), then Choice; a log record stays a
// standalone record that carries ids. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { liveRegistry } from '../app.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { litIds } from './helpers/lights.mjs';
import { isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';
import { attachLog, checkBuild, newBuildState, validateBuildSpec } from '../lib/widgets/build-it.mjs';

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

const ACT_4 = ['structured-logs', 'correlation'];
const ACT_4_LEVELS = [...ACT_4, 'collecting-logs'];
const ACT_4_BOSS = 'the-3am-errors';
const BEFORE_4 = ['act-0', 'act-1', 'act-2', 'act-3'];

// ---- the act and the players already in the others ----------------------------------

test('act-4 "Logs" holds 4.1, 4.2 and 4.3 in that order and the boss "The 3 a.m. errors", and is ordered by no', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-4');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 4, name: 'Logs', sub: 'What did it say?', levelIds: ACT_4_LEVELS, bossId: ACT_4_BOSS },
  );
  assert.deepEqual(ACT_4_LEVELS.map((id) => LIVE.levels[id].no), ['4.1', '4.2', '4.3']);
  const nos = LIVE.acts.map((a) => a.no);
  assert.deepEqual(nos, [...nos].sort((a, b) => a - b), 'acts are listed in order of no');
  assert.equal(LIVE.acts.findIndex((a) => a.id === 'act-4') > LIVE.acts.findIndex((a) => a.id === 'act-3'), true);
});

test('act-4 levels are scored with no par time, and belong to act-4', () => {
  for (const id of ACT_4) {
    const level = LIVE.levels[id];
    assert.equal(level.actId, 'act-4', id);
    assert.equal(level.kind, 'level', id);
    assert.equal(level.scored, true, id);
    assert.equal(level.scoring.parMs, null, id);
  }
});

test('act-4 unlocks like the acts before it: every earlier act complete, or entered', () => {
  const index = LIVE.acts.findIndex((a) => a.id === 'act-4');
  const allButThree = progressOf(['act-0', 'act-1', 'act-2'].flatMap(idsOf));
  assert.equal(isActUnlocked(index, allButThree, LIVE), false, 'act-3 not complete');
  assert.deepEqual(lockReason('structured-logs', allButThree, LIVE), { kind: 'act', actId: 'act-3' });
  assert.equal(levelState('structured-logs', emptyProgress(), LIVE), 'locked');

  const all = progressOf(BEFORE_4.flatMap(idsOf));
  assert.equal(isActUnlocked(index, all, LIVE), true);
  assert.equal(levelState('structured-logs', all, LIVE), 'open');
  assert.equal(levelState('correlation', all, LIVE), 'open', 'levels open in any order');

  // Entered: one completed level opens the act, even when earlier acts are not done.
  assert.equal(levelState('correlation', progressOf(['structured-logs']), LIVE), 'open');
  assert.equal(levelState('structured-logs', progressOf(['correlation']), LIVE), 'open');
});

test('existing players: adding Act 4 changes no earlier act or level state', () => {
  // Act 4 comes after every act a player can already have entered, so nothing before it waits on it.
  const done = progressOf(BEFORE_4.flatMap(idsOf));
  for (const id of BEFORE_4.flatMap(idsOf)) assert.equal(levelState(id, done, LIVE), 'done', id);
  for (let i = 0; i < LIVE.acts.findIndex((a) => a.id === 'act-4'); i++) {
    assert.equal(isActUnlocked(i, emptyProgress(), LIVE), i === 0, `act index ${i} unlocks as before`);
  }
  // A player with a partly finished Act 3 does not reach Act 4, and keeps what they have.
  const partway = progressOf([...['act-0', 'act-1', 'act-2'].flatMap(idsOf), 'instruments']);
  assert.equal(levelState('instruments', partway, LIVE), 'done');
  assert.equal(levelState('structured-logs', partway, LIVE), 'locked');
});

test('star totals count all four Act 4 entries against the derived scored-level max', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  assert.deepEqual(starTotals(progressOf(ACT_4), LIVE), { earned: 6, max: MAX_STARS });
  assert.deepEqual(starTotals(progressOf([...ACT_4_LEVELS, ACT_4_BOSS]), LIVE), { earned: 12, max: MAX_STARS });
});

// ---- level fields and lights --------------------------------------------------------

const FIELDS = {
  'structured-logs': { no: '4.1', name: 'Structured logs', mechanics: ['sort'], cards: ['severity-number-not-text'], lights: ['payments'] },
  correlation: { no: '4.2', name: 'Correlation', mechanics: ['build'], cards: ['logs-need-an-active-span'], lights: ['checkout'] },
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

test('lights: 4.1 lights Payments and 4.2 Checkout', () => {
  const lit = (done) => litIds(LIVE, progressOf(done)).sort();
  assert.deepEqual(lit([]), []);
  assert.deepEqual(lit(['structured-logs']), ['payments']);
  assert.deepEqual(lit(['correlation']), ['checkout']);
  assert.deepEqual(lit(ACT_4), ['checkout', 'payments']);
});

// ---- cards --------------------------------------------------------------------------

const CARDS = {
  'severity-number-not-text': {
    front: 'Filter logs on SeverityNumber, not SeverityText: the text is whatever the source printed, the number is normalised.',
    back:
      'A log record keeps the message in the Body, facts about this one event in Attributes, and the source that emitted it in ' +
      'the Resource. Severity comes twice: SeverityText is the original string from the source (WARN, warning, Warn) and ' +
      'SeverityNumber is an integer from 1 to 24 in six ranges: TRACE 1-4, DEBUG 5-8, INFO 9-12, WARN 13-16, ERROR 17-20, ' +
      'FATAL 21-24. Compare and filter on the number, because one library\'s "warning" is another\'s "WARN". Keep your own ' +
      'logging library: the Logs Bridge API is for logging library authors, who build the appenders that bridge into ' +
      'OpenTelemetry.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/logs/data-model/',
    dash0Angle: null,
  },
  'logs-need-an-active-span': {
    front: 'A log record gets TraceId and SpanId only if the log call ran inside an active span, through a bridged logger.',
    back:
      'TraceId and SpanId are fields of the log record, not attributes. They are set when the record is emitted with a context ' +
      'that holds a span: the Logs API uses the current context when none is passed, and the appender or bridge for your ' +
      'logging library passes it. A call outside any span, such as startup code or a background worker whose context was not ' +
      'carried over, leaves them empty. An all-zero trace id or span id is invalid under W3C Trace Context, so a record with ' +
      'zeros is not linked either, and a trace id written into the message text is not a link at all.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-traceid',
    dash0Angle:
      'Dash0 shows the span a log was created in from the log, and the logs of a span from the span. The span view lists the ' +
      'logs of the same trace by default and can switch to the same resource, which finds logs outside the trace, such as ' +
      'background jobs.',
  },
};

test('Act 4 cards: front, back, spec URL and Dash0 angle are pinned; fronts fit a card (<=140)', () => {
  for (const [id, want] of Object.entries(CARDS)) {
    const card = DECK.find((c) => c.id === id);
    assert.deepEqual(card, { id, ...want });
    assert.equal(want.front.length <= 140, true, `${id} front is ${want.front.length} characters`);
  }
});

// ---- 4.1 Structured logs ------------------------------------------------------------

const sortSpec = () => stepOf('structured-logs', 'sort', 'sl-sort');
const inBucket = (id) => sortSpec().items.filter((it) => it.bucket === id).map((it) => it.id).sort();

test('structured logs: the five buckets are the log record fields, 12 items split 2/3/2/2/3', () => {
  assert.deepEqual(sortSpec().buckets.map((b) => `${b.id}=${b.label}`), [
    'body=Body',
    'attributes=Attributes',
    'severity=Severity',
    'resource=Resource',
    'trace=Trace context',
  ]);
  assert.equal(sortSpec().items.length, 12);
  assert.deepEqual(
    ['body', 'attributes', 'severity', 'resource', 'trace'].map((b) => inBucket(b).length),
    [2, 3, 2, 2, 3],
  );
});

test('structured logs: the sort puts messages in the body, per-event facts in attributes, the source in the resource, ids in trace context', () => {
  assert.deepEqual(inBucket('body'), ['msg-declined', 'msg-retry']);
  assert.deepEqual(inBucket('attributes'), ['order-id', 'payment-method', 'retry-attempt']);
  assert.deepEqual(inBucket('severity'), ['severity-number', 'severity-text']);
  assert.deepEqual(inBucket('resource'), ['pod-name', 'service-name']);
  assert.deepEqual(inBucket('trace'), ['span-id', 'trace-flags', 'trace-id']);
});

test('structured logs: the severity items agree with the data model (WARN is 13 to 16), and the trace ids have the W3C lengths', () => {
  const label = (id) => sortSpec().items.find((it) => it.id === id).label;
  assert.equal(label('severity-text').endsWith(': WARN'), true);
  const n = Number(label('severity-number').split(': ')[1]);
  assert.equal(n >= 13 && n <= 16, true, `SeverityNumber ${n} is in the WARN range`);
  assert.equal(/: [0-9a-f]{32}$/.test(label('trace-id')), true, 'a 16-byte trace id is 32 lowercase hex characters');
  assert.equal(/: [0-9a-f]{16}$/.test(label('span-id')), true, 'an 8-byte span id is 16 lowercase hex characters');
  assert.equal(/: 01$/.test(label('trace-flags')), true);
  assert.equal(/^[0]+$/.test(label('trace-id').split(': ')[1]), false, 'the example ids are valid, not all-zero');
});

test('structured logs: every item says why it is not in each bucket it is likely confused with, never its own', () => {
  for (const it of sortSpec().items) {
    assert.equal(Object.keys(it.whyNot ?? {}).length > 0, true, `${it.id} has at least one whyNot`);
    assert.equal(Object.hasOwn(it.whyNot, it.bucket), false, `${it.id} whyNot never names its own bucket`);
  }
  const pod = sortSpec().items.find((it) => it.id === 'pod-name');
  assert.equal(/producer|source|emit/.test(pod.whyNot.attributes), true);
  const order = sortSpec().items.find((it) => it.id === 'order-id');
  assert.equal(/Resource/.test(order.whyNot.resource) && /one event|each|differ/.test(order.whyNot.resource), true);
});

test('structured logs: body vs attributes is graded: a short message with the facts as attributes', () => {
  const right = rightOf('structured-logs', 'sl-attrs');
  assert.equal(right.key, 'short-message');
  const text = plain(right.label + right.why);
  for (const w of ['Attributes', 'order.id', 'payment.method', 'Body']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(choiceOf('structured-logs', 'sl-attrs').map((c) => c.key).sort(), ['all-in-body', 'on-resource', 'short-message']);
  const resource = choiceOf('structured-logs', 'sl-attrs').find((c) => c.key === 'on-resource');
  assert.equal(/fixed|same/.test(resource.why), true, 'a Resource is the same for every record from a source');
});

test('structured logs: severity is graded: filter on SeverityNumber, because SeverityText is the source\'s own string', () => {
  const right = rightOf('structured-logs', 'sl-severity');
  assert.equal(right.key, 'number');
  const text = plain(right.label + right.why);
  for (const w of ['SeverityNumber', '13', 'WARN', 'original']) assert.equal(text.includes(w), true, w);
  const byText = choiceOf('structured-logs', 'sl-severity').find((c) => c.key === 'text');
  assert.equal(/original string/.test(byText.why), true, 'the text depends on the source');
});

test('structured logs: the Logs Bridge API is for appender authors; the answer is to keep your logger and add an appender', () => {
  const right = rightOf('structured-logs', 'sl-bridge');
  assert.equal(right.key, 'keep-logger');
  const text = plain(right.label + right.why);
  for (const w of ['appender', 'logging library authors', 'Logs Bridge API']) assert.equal(text.includes(w), true, w);
  assert.equal(/can also be used directly|directly by applications/.test(right.why), true, 'the nuance is not overclaimed into a ban');
  const wrong = choiceOf('structured-logs', 'sl-bridge').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['call-bridge', 'collector-only']);
});

// ---- 4.2 Correlation ----------------------------------------------------------------

const build = () => stepOf('correlation', 'build', 'cor-build');
const BUILD_ANSWER = {
  startup: null,
  cart: '00f067aa0ba902b7',
  'other-order': 'b7ad6b7169203331',
  'provider-slow': '3ee05e5bb0f1ae0c',
  'retry-worker': null,
  email: null,
};
const SPAN = { checkout: 'b1a2c3d4e5f60718', cart: '00f067aa0ba902b7', charge: '3ee05e5bb0f1ae0c', other: 'b7ad6b7169203331' };
// A fresh state with the reference answer applied, then `changes` on top, graded by the real grader.
const graded = (changes = {}) => {
  const spec = build();
  const st = newBuildState(spec);
  for (const [id, at] of Object.entries({ ...spec.answer, ...changes })) attachLog(spec, st, id, at);
  return checkBuild(spec, st);
};
const codes = (r) => r.issues.map((i) => `${i.logId}:${i.code}`);
// What the data says: a record belongs to the deepest span of its own service that covers its time and
// whose order.id and thread.name, where both carry one, agree; none if there is no such span.
const oracle = (spec, l) => {
  const depth = (s) => (s.parentId === null ? 0 : 1 + depth(spec.spans.find((p) => p.spanId === s.parentId)));
  const fits = spec.spans.filter(
    (s) =>
      s.service === l.service &&
      l.timeMs >= s.startMs &&
      l.timeMs <= s.endMs &&
      ['order.id', 'thread.name'].every((k) => !(k in s.attributes && k in l.attributes) || s.attributes[k] === l.attributes[k]),
  );
  fits.sort((a, b) => depth(b) - depth(a));
  return fits.length ? fits[0].spanId : null;
};

test('correlation: the first step is a logs-mode Build it of six records of order 8841 and its neighbour, then the three choices', () => {
  const steps = LIVE.levels.correlation.play.steps;
  assert.deepEqual(
    steps.map((s) => (s.build ? `build ${s.build.id}` : `choice ${s.choice.id}`)),
    ['build cor-build', 'choice cor-why', 'choice cor-fix', 'choice cor-dash0'],
  );
  assert.deepEqual(build().edit, ['logs']);
  assert.deepEqual(build().logs.map((l) => l.id), Object.keys(BUILD_ANSWER));
  assert.deepEqual(build().answer, BUILD_ANSWER);
  assert.equal(typeof build().explain, 'string');
  assert.equal(build().logs.every((l) => l.traceId === null && l.spanId === null), true, 'every record starts without span context');
  assert.equal(build().spans.every((s) => s.parentId === null || build().spans.some((p) => p.spanId === s.parentId)), true);
  assert.deepEqual([...LIVE.levels.correlation.mechanics], ['build']);
});

test('correlation: every record\'s answer follows from its own data (service, time, order.id, thread.name), deepest span first', () => {
  for (const l of build().logs) assert.equal(oracle(build(), l), build().answer[l.id], l.id);
});

test('correlation: exactly three records stay unlinked, from three services, and each carries a clue in its own data', () => {
  const spec = build();
  const unlinked = spec.logs.filter((l) => spec.answer[l.id] === null);
  assert.deepEqual(unlinked.map((l) => l.id), ['startup', 'retry-worker', 'email']);
  assert.equal(new Set(unlinked.map((l) => l.service)).size >= 2, true);
  const covering = (l) => spec.spans.filter((s) => s.service === l.service && l.timeMs >= s.startMs && l.timeMs <= s.endMs);
  assert.deepEqual(covering(unlinked[0]).map((s) => s.name), [], 'startup runs before any request: no span covers it');
  assert.deepEqual(covering(unlinked[2]).map((s) => s.name), [], 'no notifications span is on the board');
  const w = unlinked[1];
  assert.equal(covering(w).length, 1, 'the worker record falls inside a span of its own service');
  assert.equal(covering(w)[0].attributes['thread.name'] === w.attributes['thread.name'], false, 'but another thread wrote it');
  assert.equal(spec.logs.length - unlinked.length, 3);
});

test('correlation: the retry-worker record stays UNLINKED in the reference answer; linking it to the span it overlaps is graded wrong', () => {
  const spec = build();
  assert.equal(spec.answer['retry-worker'], null);
  assert.deepEqual(graded().issues, [], 'the reference answer passes');
  assert.deepEqual(codes(graded({ 'retry-worker': SPAN.charge })), ['retry-worker:log-no-active-span']);
  assert.equal(graded({ 'retry-worker': SPAN.charge }).ok, false);
  // The rule-only I7 validator cannot see this: with the trap record linked in the answer, the spec still validates.
  assert.deepEqual(validateBuildSpec({ ...spec, answer: { ...spec.answer, 'retry-worker': SPAN.charge } }), []);
});

test('correlation: shortcuts fail the real grader: link all by service and time, link to the outer span, link the neighbour order, link a span of another service', () => {
  const spec = build();
  const byTime = {};
  for (const l of spec.logs) byTime[l.id] = spec.spans.find((s) => s.service === l.service && l.timeMs >= s.startMs && l.timeMs <= s.endMs)?.spanId ?? null;
  assert.deepEqual(codes(graded(byTime)), ['cart:log-wrong-span', 'other-order:log-wrong-trace', 'retry-worker:log-no-active-span']);
  assert.deepEqual(codes(graded({ cart: SPAN.checkout })), ['cart:log-wrong-span'], 'the outer span is not the one the call ran in');
  assert.deepEqual(codes(graded({ cart: SPAN.other })), ['cart:log-wrong-trace'], 'the neighbour order has the same service and time');
  assert.deepEqual(codes(graded({ 'other-order': SPAN.checkout })), ['other-order:log-wrong-trace']);
  assert.deepEqual(codes(graded({ email: SPAN.charge })), ['email:log-other-service']);
  assert.deepEqual(codes(graded({ startup: SPAN.checkout })), ['startup:log-outside-span']);
  assert.equal(graded(Object.fromEntries(spec.logs.map((l) => [l.id, null]))).ok, false, 'leaving every record unlinked fails');
});

test('correlation: the records of the two orders are told apart by order.id, and the nested span is the one the call was started in', () => {
  const spec = build();
  const at = (id) => spec.spans.find((s) => s.spanId === spec.answer[id]);
  const rec = (id) => spec.logs.find((l) => l.id === id);
  const root = (s) => (s.parentId === null ? s : root(spec.spans.find((p) => p.spanId === s.parentId)));
  for (const id of ['cart', 'other-order']) {
    assert.equal(root(at(id)).attributes['order.id'], rec(id).attributes['order.id'], `${id} is in the trace of its own order`);
    const decoys = spec.spans.filter((s) => s.service === rec(id).service && s.traceId !== at(id).traceId && rec(id).timeMs >= s.startMs && rec(id).timeMs <= s.endMs);
    assert.equal(decoys.length >= 1, true, `${id} has a same-service span of the other order covering its time`);
    assert.equal(decoys.every((s) => s.attributes['order.id'] !== rec(id).attributes['order.id']), true);
  }
  assert.equal(at('cart').name, 'validate cart');
  assert.equal(at('cart').parentId, SPAN.checkout, 'nested inside the request span, same service, same trace');
  assert.equal(/current span/.test(LIVE.levels.correlation.play.steps[0].intro), true, 'the copy says the span was started as the current one');
  assert.equal(/innermost span that was current/.test(LIVE.levels.correlation.play.steps[0].intro), true, 'innermost holds only for spans made current');
  const fixIntro = LIVE.levels.correlation.play.steps[2].intro;
  assert.equal(/Its record is one of the unlinked ones\./.test(fixIntro) && !/blank ones/.test(fixIntro), true, 'one worker record, not all the unlinked ones');
  const inMessage = choiceOf('correlation', 'cor-fix').find((c) => c.key === 'in-message').why;
  assert.equal(/record shows/.test(inMessage), false, 'no pointer at evidence the player never sees');
});


test('correlation: why the ids are missing is graded: no active span or an unbridged logger, not a deleted id', () => {
  const right = rightOf('correlation', 'cor-why');
  assert.equal(right.key, 'no-active-span');
  const text = plain(right.label + right.why);
  for (const w of ['active span', 'bridged', 'current context']) assert.equal(text.includes(w), true, w);
  const wrong = choiceOf('correlation', 'cor-why').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['errors-only', 'stripped']);
  assert.equal(/severity/i.test(wrong.find((c) => c.key === 'errors-only').why), true, 'severity does not decide');
});

test('correlation: the fix runs the log call inside a span (or carries the context over), not zeros or text', () => {
  const right = rightOf('correlation', 'cor-fix');
  assert.equal(right.key, 'run-in-span');
  const text = plain(right.label + right.why);
  for (const w of ['span', 'context']) assert.equal(text.includes(w), true, w);
  const wrong = choiceOf('correlation', 'cor-fix').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['in-message', 'zeros']);
  assert.equal(/invalid/.test(wrong.find((c) => c.key === 'zeros').why), true, 'W3C: all-zero is invalid');
  assert.equal(/TraceId and SpanId fields/.test(wrong.find((c) => c.key === 'in-message').why), true);
});

test('correlation: the Dash0 tie-in is bounded to what the docs say: default trace mode misses an unlinked log, resource mode can find it', () => {
  const right = rightOf('correlation', 'cor-dash0');
  assert.equal(right.key, 'resource-mode');
  for (const w of ['Related Logs', 'same trace', 'Resource', '30 minutes']) assert.equal(plain(right.why).includes(w), true, w);
  assert.equal(/default/.test(right.why) && /background jobs/.test(right.why), true, 'the default and what the Resource mode is for');
  const wrong = choiceOf('correlation', 'cor-dash0').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['by-text', 'by-time']);
});

test('correlation uses Build it for its log records: one build step, in logs mode, and no span row for a record', () => {
  const steps = LIVE.levels.correlation.play.steps;
  assert.equal(steps.filter((s) => Object.hasOwn(s, 'build')).length, 1);
  assert.equal(steps.some((s) => Object.hasOwn(s, 'spot')), false, 'the Spot it step is replaced by the Build it step');
  const spec = build();
  assert.equal(spec.logs.some((l) => spec.spans.some((s) => s.spanId === l.id)), false, 'a record is never a span');
  assert.equal(spec.logs.some((l) => Object.hasOwn(l, 'parentId')), false, 'and never a child');
});

// ---- both levels --------------------------------------------------------------------

test('the Act 4 level files cite the pages their facts come from', () => {
  const urls = (f) =>
    read(`levels/${f}.mjs`).split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  const sl = urls('structured-logs');
  for (const u of [
    'https://opentelemetry.io/docs/specs/otel/logs/data-model/',
    'https://opentelemetry.io/docs/specs/otel/logs/api/',
    'https://opentelemetry.io/docs/specs/otel/logs/',
    'https://opentelemetry.io/docs/concepts/signals/logs/',
  ]) assert.equal(sl.includes(u), true, u);
  const cor = urls('correlation');
  for (const u of [
    'https://opentelemetry.io/docs/specs/otel/logs/data-model/',
    'https://opentelemetry.io/docs/specs/otel/logs/api/',
    'https://www.w3.org/TR/trace-context/#trace-id',
    'https://www.w3.org/TR/trace-context/#parent-id',
  ]) assert.equal(cor.includes(u), true, u);
  const dash0 = read('levels/correlation.mjs');
  for (const u of ['telemetry/logging/log-sidebar', 'telemetry/logging/related-logs', 'telemetry/tracing/span-sidebar']) {
    assert.equal(dash0.includes(`https://www.dash0.com/docs/dash0/${u}`), true, u);
  }
  for (const f of ACT_4) assert.equal(/\bthe spec says\b/i.test(read(`levels/${f}.mjs`)), false, f);
});
