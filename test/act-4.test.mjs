// Act 4 levels 4.1 Structured logs and 4.2 Correlation beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's place in the
// registry, unlock and map; level fields and lights; card fronts and backs; the facts the copy
// states (docs/OUTLINE.md §4 Act 4), each checked from the level's own data. Level 4.2 uses Spot
// it and Choice, not Build it (issue #91 design note), so a log record stays a record. Asserts
// strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { nodeStates } from '../lib/map.mjs';
import { isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';
import { checkSpot, newSpotState, toggleLine } from '../lib/widgets/spot-it.mjs';

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

test('star totals count all four Act 4 entries: 28 scored levels, max 84', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: 84 });
  assert.deepEqual(starTotals(progressOf(ACT_4), LIVE), { earned: 6, max: 84 });
  assert.deepEqual(starTotals(progressOf([...ACT_4_LEVELS, ACT_4_BOSS]), LIVE), { earned: 12, max: 84 });
});

// ---- level fields and lights --------------------------------------------------------

const FIELDS = {
  'structured-logs': { no: '4.1', name: 'Structured logs', mechanics: ['sort'], cards: ['severity-number-not-text'], lights: ['payments'] },
  correlation: { no: '4.2', name: 'Correlation', mechanics: ['spot'], cards: ['logs-need-an-active-span'], lights: ['checkout'] },
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

test('lights: 4.1 lights Payments and 4.2 Checkout, so their edge lights only when both are done', () => {
  const lit = (done) => {
    const s = nodeStates(LIVE, progressOf(done), NODES, EDGES);
    return {
      nodes: NODES.filter((n) => s.nodes[n.id].lit).map((n) => n.id).sort(),
      edge: s.edges.find((e) => e.from === 'checkout' && e.to === 'payments').lit,
    };
  };
  assert.deepEqual(lit([]), { nodes: [], edge: false });
  assert.deepEqual(lit(['structured-logs']), { nodes: ['payments'], edge: false });
  assert.deepEqual(lit(['correlation']), { nodes: ['checkout'], edge: false });
  assert.deepEqual(lit(ACT_4), { nodes: ['checkout', 'payments'], edge: true });
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

const spot = () => stepOf('correlation', 'spot', 'cor-spot');
const idsOnLine = (l) => {
  const m = /trace_id=(\S*)\s+span_id=(\S*)/.exec(l.text);
  return { trace: m[1], span: m[2] };
};
const linked = (l) => {
  const { trace, span } = idsOnLine(l);
  return /^[0-9a-f]{32}$/.test(trace) && !/^0+$/.test(trace) && /^[0-9a-f]{16}$/.test(span) && !/^0+$/.test(span);
};

test('correlation: the spotted lines are exactly the records with no valid trace link (blank or all-zero ids)', () => {
  assert.equal(spot().target, 'config');
  assert.deepEqual(spot().lines.filter((l) => !linked(l)).map((l) => l.id), spot().faults);
  const kinds = spot().faults.map((id) => {
    const { trace } = idsOnLine(spot().lines.find((l) => l.id === id));
    return trace === '' ? 'blank' : /^0+$/.test(trace) ? 'zero' : 'other';
  });
  assert.deepEqual(kinds.sort(), ['blank', 'blank', 'zero'], 'two blank records and one all-zero record');
});

test('correlation: a trace id written in the message text does not link a record, and linked records say which trace and span they are in', () => {
  const worker = spot().lines.find((l) => l.id === 'payments-worker');
  assert.equal(/trace_id=\s+span_id=\s/.test(worker.text), true, 'the fields are blank');
  assert.equal(/[0-9a-f]{32}/.test(worker.text.replace(/trace_id=\S*/, '')), true, 'but the message mentions a trace id');
  for (const l of spot().lines.filter(linked)) {
    assert.equal(typeof spot().whyNot[l.id], 'string', `${l.id} says why it is linked`);
  }
  for (const id of spot().faults) assert.equal(Object.hasOwn(spot().whyNot, id), false, `${id} is a fault`);
});

test('correlation: lines are plain text of one service each, fictional Kettle & Co, and share trace ids across services', () => {
  const services = new Set(spot().lines.map((l) => l.text.split(/\s+/)[2]));
  assert.equal(services.size >= 5, true, 'several services log');
  const trace = (id) => idsOnLine(spot().lines.find((l) => l.id === id)).trace;
  assert.equal(trace('checkout-cart'), trace('payments-retry'), 'one request, two services, one trace id');
});

test('correlation: Spot it grades the selection: exactly the three unlinked records pass, a linked record costs a mistake', () => {
  const grade = (ids) => {
    let st = newSpotState(spot());
    for (const id of ids) st = toggleLine(spot(), st, id).state;
    return checkSpot(spot(), st).outcome;
  };
  assert.equal(grade(spot().faults), 'right');
  assert.equal(grade([...spot().faults, 'orders-stored']), 'wrong');
  assert.equal(grade(spot().faults.slice(1)), 'wrong', 'missing one is wrong');
  assert.equal(grade([]), 'empty');
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

test('correlation uses no Build it: the level has no build step and no span rows for log records', () => {
  const steps = LIVE.levels.correlation.play.steps;
  assert.equal(steps.some((s) => Object.hasOwn(s, 'build')), false);
  assert.deepEqual([...LIVE.levels.correlation.mechanics], ['spot']);
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
