// Level 9.8 "Edge of the platform" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs):
// level fields; the Choice (one right answer, labels of one length, whyNots that hold against the numbers, nothing named before Check); the Build it
// board graded through the real checkBuild (every links assignment for the consumer span, and blind rules that must all fail); the message list the
// board needs; the sources and what the copy does not claim. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { checkBuild, newBuildState, toggleLink, validateBuildSpec } from '../lib/widgets/build-it.mjs';
import { validateBuildHelps } from '../lib/widgets/build-it-help.mjs';
import { shortTrace } from '../lib/widgets/build-it-names.mjs';
import { waterfall } from '../lib/widgets/trace.mjs';
import { CONTENT } from '../levels/edge-of-the-platform.mjs';

const ID = 'edge-of-the-platform';
const LIVE = liveRegistry();
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const level = LIVE.levels[ID];
const [FIX_STEP, BATCH_STEP] = level.play.steps;
const choices = FIX_STEP.choice.choices;
const spec = BATCH_STEP.build;
const { P1, P2, P3, P4, REQ_A, PROC } = CONTENT.ids;
const ANSWER = [P1, P2, P3];

test('9.8 fields: in act-9 last, after 9.7, unscored-par, a choice then a build, lights orders, awards no card, hints off on the build', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs, prefix: level.play.prefix },
    { no: '9.8', name: 'Edge of the platform', sub: 'Before the function freezes', rewardTitle: 'Flush keeper', kind: 'level', actId: 'act-9', parMs: null, prefix: 'eop' },
  );
  assert.deepEqual([...level.mechanics], ['build']);
  assert.deepEqual([...level.hintless], ['build']);
  assert.deepEqual(level.play.steps.map((s) => ['choice', 'build'].find((k) => s[k])), ['choice', 'build']);
  assert.deepEqual([...level.lights], ['orders']);
  assert.deepEqual([...level.cards], []);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Flush keeper').length, 1, 'the reward title is unique');
  assert.equal(LIVE.order[LIVE.order.indexOf('two-vendors-one-weekend') + 1], ID, 'plays after 9.7');
  assert.equal(LIVE.order[LIVE.order.indexOf(ID) + 1], 'its-us', 'the boss follows 9.8');
});

// ---- step 1: the Choice ---------------------------------------------------------------------

test('step 1: three choices, exactly one right (ForceFlush), each label naming its own mechanism, in a position that is not first', () => {
  assert.equal(FIX_STEP.choice.id, 'eop-fix');
  assert.deepEqual(choices.map((c) => c.key), ['lower-delay', 'shutdown', 'force-flush']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['force-flush']);
  assert.match(choices[0].label, /OTEL_BSP_SCHEDULE_DELAY/);
  assert.match(choices[1].label, /Shutdown/);
  assert.match(choices[2].label, /ForceFlush/);
  for (const c of choices) assert.equal(/^(It holds|It is wrong|Right|Wrong)/.test(plain(c.label)), false, 'no verdict opener on a label');
});

test('step 1: labels are of one length (within 5 characters), and the right one is neither the longest nor the shortest', () => {
  const len = choices.map((c) => plain(c.label).length);
  assert.equal(Math.max(...len) - Math.min(...len) <= 5, true, len.join(', '));
  const right = len[choices.findIndex((c) => c.right)];
  assert.equal(right < Math.max(...len) && right > Math.min(...len), true, 'the right label is in the middle of the lengths');
});

test('step 1: the intro and the table name neither ForceFlush nor a flush, and no help text before Check', () => {
  const before = plain(`${FIX_STEP.intro} ${FIX_STEP.show} ${FIX_STEP.question}`);
  assert.doesNotMatch(before, /flush|shutdown|OTEL_BSP|link/i);
  assert.match(before, /120 ms/);
  assert.match(before, /5000 ms/);
});

test('step 1 whyNots hold against the numbers: the delay is longer than the 120 ms invocation, Shutdown is once per provider', () => {
  const [delay, shutdown, flush] = choices.map((c) => plain(c.why));
  assert.match(delay, /1000 ms is longer than the whole invocation/);
  assert.match(delay, /reasoning/);
  assert.match(shutdown, /MUST be called only once for each TracerProvider instance/);
  assert.match(shutdown, /subsequent attempts to get a Tracer are not allowed/);
  assert.match(shutdown, /MUST include the effects of ForceFlush/);
  assert.match(flush, /FaaS providers that may suspend the process after an invocation, but before the SpanProcessor exports the completed spans/);
  assert.match(flush, /5000 ms/);
  const lowered = Number(/to (\d+) ms/.exec(plain(choices[0].label))[1]);
  assert.equal(lowered > 120 && lowered < 5000, true, 'the lowered delay is below the default and above the handler time');
});

// ---- step 2: the Build it board -------------------------------------------------------------

const byId = (id) => spec.spans.find((s) => s.spanId === id);
const others = spec.spans.filter((s) => s.spanId !== PROC);

/** Grade the board with the consumer span linking exactly `ids`: whether it passes, and the issue codes. */
function gradeLinks(ids) {
  const st = newBuildState(spec);
  for (const id of ids) assert.equal(toggleLink(spec, st, PROC, id), 'linked');
  const { ok, issues } = checkBuild(spec, st);
  return { ok, codes: issues.map((i) => i.code) };
}

test('step 2: a valid links-only build, no helps, the reference answer passes checkBuild (I7), the question is the batch', () => {
  assert.equal(BATCH_STEP.qid, 'eop-q-batch');
  assert.equal(spec.id, 'eop-batch');
  assert.deepEqual(validateBuildSpec(spec), []);
  assert.deepEqual(validateBuildHelps(spec), []);
  assert.deepEqual(spec.edit, ['links']);
  assert.deepEqual(spec.helps, {});
  assert.equal(Object.hasOwn(spec, 'hint'), false);
  assert.equal(plain(BATCH_STEP.question), 'Connect orders process to the messages of this batch, and only those.');
  assert.deepEqual(gradeLinks(ANSWER), { ok: true, codes: [] });
});

test('step 2 board: three publish spans of the batch in three traces, a fourth in a fourth, the request that parents the first, and a consumer root in its own trace', () => {
  assert.equal(spec.spans.length, 6);
  const publish = spec.spans.filter((s) => s.name === 'orders publish');
  assert.deepEqual(publish.map((s) => s.kind), ['PRODUCER', 'PRODUCER', 'PRODUCER', 'PRODUCER']);
  assert.equal(new Set(publish.map((s) => s.traceId)).size, 4, 'four publish spans, four traces');
  assert.equal(new Set(spec.spans.map((s) => s.traceId)).size, 5, 'five traces on the board');
  assert.deepEqual([byId(PROC).kind, byId(PROC).parentId, byId(PROC).name], ['CONSUMER', null, 'orders process']);
  assert.equal(byId(REQ_A).kind, 'SERVER');
  assert.equal(byId(P1).parentId, REQ_A, 'the request span is the first publish span\'s parent');
  assert.equal(byId(P1).traceId, byId(REQ_A).traceId);
  for (const id of [P2, P3, P4]) assert.equal(byId(id).parentId, null);
  assert.equal(shortTrace(byId(PROC).traceId) !== shortTrace(byId(P1).traceId), true);
  assert.equal(new Set(spec.spans.map((s) => shortTrace(s.traceId))).size, 5, 'the board names five traces by five different codes');
  assert.deepEqual(Object.keys(spec.answer), [PROC]);
  assert.equal(byId(PROC).endMs - byId(PROC).startMs, 120, 'the worker\'s invocation is the 120 ms handler of step 1');
});

test('step 2: every links assignment for the consumer span over the other five spans: exactly {P1, P2, P3} passes', () => {
  const ids = others.map((s) => s.spanId);
  const passing = [];
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const pick = ids.filter((_, i) => mask & (1 << i));
    if (gradeLinks(pick).ok) passing.push(pick.sort());
  }
  assert.deepEqual(passing, [[...ANSWER].sort()]);
});

test('step 2: each need is required on its own, and each decoy fails', () => {
  for (const drop of ANSWER) assert.equal(gradeLinks(ANSWER.filter((id) => id !== drop)).ok, false, `without ${drop}`);
  assert.equal(gradeLinks([...ANSWER, P4]).ok, false, 'the next batch\'s message');
  assert.equal(gradeLinks([...ANSWER, REQ_A]).ok, false, 'the request span that parents the first publish span');
  assert.equal(gradeLinks([REQ_A, P2, P3]).ok, false, 'the request instead of the first publish span');
  assert.equal(gradeLinks([P1, P2, P4]).ok, false, 'the fourth message in place of the third');
  assert.equal(gradeLinks([]).ok, false, 'no links');
  assert.equal(gradeLinks(ANSWER).ok, true);
});

test('step 2: blind rules fail through checkBuild (same name, same kind, all producers, row order, start order, id order, time window, same trace)', () => {
  const rows = waterfall(spec.spans).rows.map((r) => byId(r.spanId));
  const publish = (list) => list.filter((s) => s.name === 'orders publish');
  const tried = new Map(); // label -> ids
  const rule = (label, list) => tried.set(label, list.filter((s) => s.spanId !== PROC).map((s) => s.spanId));
  rule('the spans named like the answer', publish(spec.spans));
  rule('every PRODUCER span', spec.spans.filter((s) => s.kind === 'PRODUCER'));
  rule('every span of the consumer\'s trace', spec.spans.filter((s) => s.traceId === byId(PROC).traceId));
  rule('every other span', spec.spans);
  rule('every span that starts inside the batch time window', spec.spans.filter((s) => s.startMs < byId(PROC).startMs));
  rule('every span that ends inside the batch time window', spec.spans.filter((s) => s.endMs <= byId(PROC).startMs + 120));
  rule('every span not in the first publish span\'s trace', spec.spans.filter((s) => s.traceId !== byId(P1).traceId));
  rule('the parents of the publish spans', spec.spans.filter((s) => publish(spec.spans).some((p) => p.parentId === s.spanId)));
  const scopes = { 'all spans': (l) => l, 'publish spans': publish, 'PRODUCER spans': (l) => l.filter((s) => s.kind === 'PRODUCER') };
  const orders = {
    'board row': rows,
    'start time': [...spec.spans].sort((a, b) => a.startMs - b.startMs),
    'end time': [...spec.spans].sort((a, b) => a.endMs - b.endMs),
    'span id': [...spec.spans].sort((a, b) => (a.spanId < b.spanId ? -1 : 1)),
    'trace id': [...spec.spans].sort((a, b) => (a.traceId < b.traceId ? -1 : 1)),
    'span list': spec.spans,
  };
  for (const [oname, ordered] of Object.entries(orders)) {
    for (const [sname, scope] of Object.entries(scopes)) {
      const list = scope(ordered).filter((s) => s.spanId !== PROC);
      for (let k = 1; k <= list.length; k++) {
        rule(`the first ${k} by ${oname} among ${sname}`, list.slice(0, k));
        rule(`the last ${k} by ${oname} among ${sname}`, list.slice(list.length - k));
      }
      if (list.length > 2) rule(`the middle row by ${oname} among ${sname}`, [list[Math.floor(list.length / 2)]]);
      for (let from = 0; from + 3 <= list.length; from++) rule(`three in a row from ${from} by ${oname} among ${sname}`, list.slice(from, from + 3));
    }
  }
  const passed = [...tried].filter(([, ids]) => gradeLinks(ids).ok).map(([label]) => label);
  assert.deepEqual(passed, [], `blind rules that passed: ${passed.join('; ')}`);
  assert.equal(tried.size > 100, true, 'a wide sweep of rules');
  // and the ones the design names: all PRODUCER spans fails because of the fourth publish span, which is in the batch time window
  assert.deepEqual(tried.get('every PRODUCER span').sort(), [P1, P2, P3, P4].sort());
  assert.equal(byId(P4).startMs > byId(P1).startMs && byId(P4).startMs < byId(P3).startMs, true, 'published between the second and the third');
});

test('step 2: the span id of the fourth message sits between two of the batch\'s, so no id order picks the three', () => {
  const ids = [P1, P2, P3, P4].sort();
  assert.equal(ids[0] !== P4 && ids[3] !== P4, true);
});

// ---- the message list the step needs ---------------------------------------------------------

test('step 2 shows the batch\'s message list by trace only: three messages with their traces, no span ids, and not the fourth', () => {
  assert.deepEqual(CONTENT.messages.map((m) => [m.message, m.spanId]), [['m-1', P1], ['m-2', P2], ['m-3', P3]]);
  const shown = plain(BATCH_STEP.show);
  for (const m of CONTENT.messages) {
    assert.equal(shown.includes(m.trace), true, `${m.message} trace ${m.trace}`);
    assert.equal(m.trace, shortTrace(byId(m.spanId).traceId));
  }
  for (const s of spec.spans) assert.equal(shown.includes(s.spanId), false, `no span id on the table: ${s.spanId}`);
  assert.doesNotMatch(shown, /Created by|span/i);
  assert.match(shown, /Messages in this batch.*Message.*In trace/);
  assert.equal(shown.includes(shortTrace(byId(P4).traceId)), false, 'the next batch\'s message is not listed');
  assert.equal(shown.includes(shortTrace(byId(PROC).traceId)), false);
  // the trace of the first message also holds the request span, so the trace code alone does not separate the publish span from its parent
  assert.equal(byId(REQ_A).traceId, byId(P1).traceId);
  assert.equal(spec.spans.filter((s) => s.traceId === byId(P1).traceId).length, 2, 'trace 1 holds REQ_A and P1');
  assert.equal(FIX_STEP.show.includes(shortTrace(byId(P1).traceId)), false, 'step 1 carries no message list: the list is on the step that needs it');
});

test('step 1 labels are parallel: no purpose clause, and the same shape', () => {
  for (const c of choices) assert.doesNotMatch(plain(c.label), /\bso\b/, 'no purpose clause');
  assert.deepEqual(choices.map((c) => /^(Set|Call) \S+ (to|on) /.test(plain(c.label))), [true, true, true]);
});

test('step 1: reasoning in a why is labelled as reasoning (the delay and the Shutdown whys)', () => {
  assert.match(plain(choices[0].why), /reasoning from the numbers, not a quote/);
  assert.match(plain(choices[1].why), /reasoning from the scenario, not a quote/);
});

test('the copy says "a batch span processor", not a default one; one format for 5000 ms; the semconv version is named', () => {
  assert.doesNotMatch(SRC, /default batch span processor/);
  assert.match(plain(FIX_STEP.intro), /a batch span processor/);
  assert.equal(/5,000/.test(plain(JSON.stringify(level.play))), false);
  assert.match(SRC, /semantic conventions 1\.45\.0/);
});

test('step 2 copy: the intro does not name a link, a flush or the answer', () => {
  const intro = plain(BATCH_STEP.intro);
  assert.doesNotMatch(intro, /link|flush|shutdown|only one parent|P1|m-4/i);
  assert.match(intro, /batch of three messages/);
  assert.match(intro, /trace of its own/);
});

// ---- sources ---------------------------------------------------------------------------------

test('sources: the three Spec pages, only allowed hosts, the quotes in the file, the reasoning labelled, no Dash0 or pricing claim, no em dash', () => {
  for (const url of [
    'https://opentelemetry.io/docs/specs/otel/trace/sdk/#forceflush-1',
    'https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/',
    'https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/',
  ]) assert.equal(SRC.includes(url), true, url);
  assert.match(SRC, /^\/\/ Spec: https:/m);
  const hosts = ['opentelemetry.io', 'www.w3.org', 'prometheus.io', 'perses.dev', 'developer.mozilla.org', 'www.dash0.com'];
  for (const url of SRC.match(/https:\/\/[^\s,)]+/g)) assert.equal(hosts.includes(new URL(url).host), true, url);
  assert.match(SRC.split('\n').slice(0, 12).join('\n'), /docs\/LIVE-DEMO\.md/);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Stated as reasoning/);
  assert.match(SRC, /Invented for the game/);
  const header = SRC.split('\n').filter((l) => l.startsWith('//')).join(' ').replace(/\s*\/\/\s*/g, ' ');
  for (const quote of [
    'ForceFlush SHOULD only be called in cases where it is absolutely necessary, such as when using some FaaS providers that may suspend the process after an invocation, but before the SpanProcessor exports the completed spans.',
    'Delay interval (in milliseconds) between two consecutive exports',
    'Shutdown MUST be called only once for each TracerProvider instance. After the call to Shutdown, subsequent attempts to get a Tracer are not allowed.',
    'Shutdown MUST include the effects of ForceFlush',
    'For each message it accounts for, the "Process" or "Receive" span SHOULD link to the message\'s creation context',
  ]) assert.equal(header.includes(quote), true, quote);
  const copy = plain(JSON.stringify(level.play));
  assert.equal(/dash0|pric|\$|dollar|per GB|invoice|bill|https?:|\.com|\.net/i.test(copy), false, 'no Dash0, pricing or hostname claim');
  assert.equal(SRC.includes('\u2014'), false, 'no em dash');
});
