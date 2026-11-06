// lib/incident-lab.mjs (DASH0-LAB P4): the seeded incident the lab boss asks about.
// Pure: no Math.random, no Date.now; the clock is injected. Answers are read from the spans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  answersFrom, buildIncident, buildTraceList, CANDIDATES, FAULT_ALPHABET, FAULT_ATTR, FILTER_KEY, FILTER_OP, GRADE, gradeAnswer,
  matchTraces, normaliseAnswer, QUESTION, START_MAX_AGO_MS, START_MIN_AGO_MS, startAgoMs, TRACE_LIST_SIZE,
} from '../lib/incident-lab.mjs';
import { encodeTraces, SPAN_KIND, STATUS_CODE } from '../lib/otlp/encode.mjs';
import { createTelemetry, PRACTICE_SCOPE } from '../lib/telemetry.mjs';
import { PRACTICE_HOSTS } from '../lib/dash0/ingress.mjs';

const NOW = 1762300800123;
const clock = () => NOW;
const build = (seed) => buildIncident(seed, { now: clock });
const failed = (inc) => inc.spans.filter((s) => s.status?.code === 'error');
const retries = (span) => span.events.filter((e) => e.name === 'retry');

test('the same seed gives a deep-equal incident; seeds 42 and 43 differ in fault code', () => {
  assert.deepEqual(build(42), build(42));
  assert.notEqual(answersFrom(build(42).spans).faultCode, answersFrom(build(43).spans).faultCode);
});

test('the incident is a function of seed and injected clock only', () => {
  const src = readFileSync(new URL('../lib/incident-lab.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /Math\.random|Date\.now|crypto/);
  const later = buildIncident(42, { now: () => NOW + 5000 });
  assert.equal(later.spans[0].startMs, NOW + 5000);
  assert.deepEqual(later.spans.map((s) => s.spanId), build(42).spans.map((s) => s.spanId));
});

test('one trace: root progress.sync with four children; exactly one of the last three is in Error', () => {
  const inc = build(7);
  const [root, ...kids] = inc.spans;
  assert.equal(root.name, 'progress.sync');
  assert.deepEqual(kids.map((k) => k.name).slice(0, 1), ['progress.serialize']);
  assert.equal(kids.length, 4);
  for (const s of inc.spans) assert.equal(s.traceId, inc.traceId);
  for (const k of kids) assert.equal(k.parentSpanId, root.spanId);
  assert.equal(failed(inc).length, 1);
  assert.ok(CANDIDATES.includes(failed(inc)[0].name));
  const bad = failed(inc)[0];
  assert.match(bad.attributes[FAULT_ATTR], /^.{6}$/);
  const n = retries(bad).length;
  assert.ok(n >= 2 && n <= 4);
  assert.ok(bad.events.some((e) => e.name === 'exception' && e.attributes['exception.type']));
});

test('times nest inside the root and the spans encode', () => {
  const inc = build(11);
  encodeTraces(inc.spans, { sessionId: 'a'.repeat(16) });
  const [root, ...kids] = inc.spans;
  for (const k of kids) {
    assert.ok(k.startMs >= root.startMs && k.endMs <= root.endMs && k.endMs >= k.startMs);
  }
});

test('encoded OTLP: kinds, parents, one Error status, session.id on every span', () => {
  const inc = build(11);
  const sid = 'a'.repeat(16);
  const spans = encodeTraces(inc.spans, { sessionId: sid }).resourceSpans[0].scopeSpans[0].spans;
  const [root, ...kids] = spans;
  assert.equal(root.kind, SPAN_KIND.server);
  assert.equal(root.parentSpanId, undefined);
  for (const k of kids) {
    assert.equal(k.kind, SPAN_KIND.internal);
    assert.equal(k.parentSpanId, root.spanId);
  }
  assert.equal(spans.filter((s) => s.status?.code === STATUS_CODE.error).length, 1);
  for (const s of spans) assert.equal(s.attributes.find((x) => x.key === 'session.id').value.stringValue, sid);
  const bad = kids.find((s) => s.status?.code === STATUS_CODE.error);
  assert.equal(bad.events.length, answersFrom(inc.spans).retryCount + 1);
});

test('every event lies inside its span, retries before the exception (seeds 0..199)', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const bad = failed(build(seed))[0];
    for (const e of bad.events) assert.ok(e.timeMs >= bad.startMs && e.timeMs <= bad.endMs, `seed ${seed} ${e.name}`);
    const exc = bad.events.at(-1);
    assert.equal(exc.name, 'exception');
    for (const e of bad.events.slice(0, -1)) assert.ok(e.timeMs < exc.timeMs, `seed ${seed}`);
  }
});

test('over seeds 0..999 every candidate fails, retries 2..4 all occur, codes use the alphabet', () => {
  const names = new Set();
  const counts = new Set();
  for (let seed = 0; seed < 1000; seed += 1) {
    const inc = build(seed);
    const bad = failed(inc);
    assert.equal(bad.length, 1);
    names.add(bad[0].name);
    counts.add(retries(bad[0]).length);
    const code = bad[0].attributes[FAULT_ATTR];
    assert.equal(code.length, 6);
    for (const ch of code) assert.ok(FAULT_ALPHABET.includes(ch), `${ch} not in alphabet`);
  }
  assert.deepEqual([...names].sort(), [...CANDIDATES].sort());
  assert.deepEqual([...counts].sort(), [2, 3, 4]);
  assert.doesNotMatch(FAULT_ALPHABET, /[IO01]/);
});

test('the fault code appears only in its attribute', () => {
  for (let seed = 0; seed < 50; seed += 1) {
    const inc = build(seed);
    const code = answersFrom(inc.spans).faultCode;
    const copy = JSON.parse(JSON.stringify(inc.spans));
    for (const s of copy) if (s.attributes) delete s.attributes[FAULT_ATTR];
    assert.ok(!JSON.stringify(copy).includes(code), `seed ${seed} leaks ${code}`);
    assert.ok(!JSON.stringify(inc.spans.map((s) => s.name)).includes(code));
  }
});

test('answersFrom reads the spans, not the seed', () => {
  const inc = build(42);
  const before = answersFrom(inc.spans);
  assert.equal(before.traceId, inc.traceId);
  const spans = JSON.parse(JSON.stringify(inc.spans));
  const bad = spans.find((s) => s.status?.code === 'error');
  bad.attributes[FAULT_ATTR] = 'ZZZZZZ';
  bad.events = bad.events.filter((e, i) => e.name !== 'retry' || i % 2 === 0);
  const after = answersFrom(spans);
  assert.equal(after.faultCode, 'ZZZZZZ');
  assert.equal(after.retryCount, bad.events.filter((e) => e.name === 'retry').length);
  assert.notEqual(after.retryCount, before.retryCount);
  bad.status = { code: 'ok' };
  const other = spans.find((s) => s.name !== bad.name && CANDIDATES.includes(s.name));
  other.status = { code: 'error', message: 'x' };
  other.attributes = { [FAULT_ATTR]: 'ABCDEF' };
  other.events = bad.events.filter((e) => e.name === 'retry');
  assert.equal(answersFrom(spans).operation, other.name);
});

test('answersFrom refuses spans that cannot give an answer', () => {
  const inc = build(5);
  assert.equal(answersFrom([]), null);
  assert.equal(answersFrom(null), null);
  assert.equal(answersFrom(inc.spans.map((s) => ({ ...s, status: undefined }))), null);
  const two = JSON.parse(JSON.stringify(inc.spans));
  for (const s of two) if (CANDIDATES.includes(s.name)) s.status = { code: 'error' };
  assert.equal(answersFrom(two), null);
  const noCode = JSON.parse(JSON.stringify(inc.spans));
  delete noCode.find((s) => s.status?.code === 'error').attributes[FAULT_ATTR];
  assert.equal(answersFrom(noCode), null);
});

test('answersFrom refuses a retry count outside 2..4', () => {
  const inc = build(42);
  for (const n of [0, 1, 5]) {
    const spans = JSON.parse(JSON.stringify(inc.spans));
    const bad = spans.find((s) => s.status);
    bad.events = Array.from({ length: n }, (_, i) => ({ name: 'retry', timeMs: bad.startMs, attributes: { 'retry.attempt': i + 1 } }));
    assert.equal(answersFrom(spans), null, `n=${n}`);
  }
});

test('answersFrom: one rule for "in error", across all spans and one trace', () => {
  const inc = build(42);
  const fresh = () => JSON.parse(JSON.stringify(inc.spans));
  const bad = (spans) => spans.find((s) => s.status);
  const key = answersFrom(inc.spans);
  // the encoder's spellings of Error still name the same operation
  for (const code of [2, 'ERROR', 'Error']) {
    const spans = fresh();
    bad(spans).status = { code };
    assert.equal(answersFrom(spans)?.operation, key.operation, String(code));
  }
  // a second span in error anywhere (root, serialize, other candidate) is ambiguous
  const other = inc.spans.findIndex((s) => CANDIDATES.includes(s.name) && !s.status);
  assert.ok(other > 1, 'a non-failing candidate exists');
  for (const i of [0, 1, other]) {
    for (const code of ['error', 2, 'ERROR']) {
      const spans = fresh();
      spans[i].status = { code };
      assert.equal(answersFrom(spans), null, `span ${i} ${code}`);
    }
  }
  // a foreign trace id on any span
  for (let i = 0; i < inc.spans.length; i += 1) {
    const spans = fresh();
    spans[i].traceId = 'f'.repeat(32);
    assert.equal(answersFrom(spans), null, `foreign trace on span ${i}`);
  }
  // a status the encoder would refuse is not a readable key
  const odd = fresh();
  odd[1].status = { code: 'bogus' };
  assert.equal(answersFrom(odd), null);
  // the only error is not a candidate
  const moved = fresh();
  const failing = bad(moved);
  const serialize = moved.find((s) => s.name === 'progress.serialize');
  Object.assign(serialize, { attributes: failing.attributes, events: failing.events, status: failing.status });
  delete failing.status;
  assert.equal(answersFrom(moved), null);
});

test('gradeAnswer: the code is trimmed and case-insensitive; short or wrong fails', () => {
  const inc = build(42);
  const a = answersFrom(inc.spans);
  const g = (q, v, spans = inc.spans) => gradeAnswer(spans, q, v);
  assert.equal(g(QUESTION.faultCode, a.faultCode), GRADE.pass);
  assert.equal(g(QUESTION.faultCode, `  ${a.faultCode.toLowerCase()} `), GRADE.pass);
  assert.equal(g(QUESTION.faultCode, a.faultCode.slice(0, 5)), GRADE.fail);
  assert.equal(g(QUESTION.faultCode, 'AAAAAA'), GRADE.fail);
  assert.equal(g(QUESTION.operation, a.operation), GRADE.pass);
  assert.equal(g(QUESTION.operation, 'progress.sync'), GRADE.fail);
  assert.equal(g(QUESTION.operation, `  ${a.operation.toUpperCase()} `), GRADE.pass, 'operation: trimmed, case-insensitive');
  assert.equal(g(QUESTION.retryCount, a.retryCount), GRADE.pass);
  assert.equal(g(QUESTION.retryCount, String(a.retryCount)), GRADE.pass);
  assert.equal(g(QUESTION.retryCount, a.retryCount === 2 ? 3 : 2), GRADE.fail);
  assert.equal(g(QUESTION.traceId, ` ${inc.traceId.toUpperCase()} `), GRADE.pass);
  assert.equal(g(QUESTION.traceId, 'f'.repeat(32)), GRADE.fail);
});

test('gradeAnswer: missing or malformed is inconclusive, never pass or fail', () => {
  const inc = build(42);
  const g = (q, v, spans = inc.spans) => gradeAnswer(spans, q, v);
  for (const v of [undefined, null, '', '   ', {}, [], NaN]) {
    for (const q of Object.values(QUESTION)) {
      assert.equal(g(q, v), GRADE.inconclusive, `${q} ${String(v)}`);
    }
  }
  assert.equal(g(QUESTION.retryCount, 'three'), GRADE.inconclusive);
  assert.equal(g(QUESTION.retryCount, 2.5), GRADE.inconclusive);
  assert.equal(g(QUESTION.traceId, 'abc'), GRADE.inconclusive);
  assert.equal(g('nope', 'x'), GRADE.inconclusive);
  // No readable answer key: inconclusive even for a right-looking answer.
  assert.equal(g(QUESTION.faultCode, answersFrom(inc.spans).faultCode, []), GRADE.inconclusive);
});

test('buildIncident refuses a bad seed or clock', () => {
  for (const s of [undefined, -1, 1.5, 2 ** 32, '7', NaN]) {
    assert.throws(() => buildIncident(s, { now: clock }), TypeError);
  }
  assert.throws(() => buildIncident(1, {}), TypeError);
  assert.throws(() => buildIncident(1, { now: () => 'x' }), TypeError);
});

test('telemetry.incident() is lazy, seeded by the big-endian uint32 of randomBytes(4), cached, and sends nothing', () => {
  const asked = [];
  const randomBytes = (n) => {
    asked.push(n);
    return n === 4 ? Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) : new Uint8Array(n).fill(7);
  };
  let reads = 0;
  const tel = createTelemetry({ randomBytes, now: () => { reads += 1; return NOW; }, setTimeout, clearTimeout });
  const before = asked.length;
  assert.equal(reads, 0);
  const inc = tel.incident();
  assert.deepEqual(asked.slice(before), [4]);
  assert.equal(reads, 1);
  assert.equal(inc.seed, 0xdeadbeef);
  assert.deepEqual(inc, buildIncident(0xdeadbeef, { now: () => NOW - startAgoMs(0xdeadbeef) }), 'built in the past, by the seed-derived offset');
  assert.equal(tel.incident(), inc);
  tel.disconnect();
  assert.equal(tel.incident(), inc);
  assert.deepEqual(asked.slice(before), [4]);
  assert.equal(reads, 1);
  assert.ok(!JSON.stringify(inc).includes(tel.practiceCredential(PRACTICE_SCOPE.ingest)));
});

test('telemetry.incident() seed reads the bytes, not the buffer: subarray and plain array', () => {
  const seedOf = (randomBytes) => createTelemetry({ randomBytes, now: clock, setTimeout, clearTimeout }).incident().seed;
  const sub = (n) => (n === 4 ? new Uint8Array([1, 2, 0xde, 0xad, 0xbe, 0xef, 9]).subarray(2, 6) : new Uint8Array(n));
  assert.equal(seedOf(sub), 0xdeadbeef);
  assert.equal(seedOf((n) => (n === 4 ? [0xde, 0xad, 0xbe, 0xef] : new Array(n).fill(0))), 0xdeadbeef);
});

test('telemetry.incident() spans go out through sendBatch', async () => {
  let k = 3;
  const randomBytes = (n) => Uint8Array.from({ length: n }, () => (k++ * 41) & 0xff);
  const tel = createTelemetry({ randomBytes, now: clock, setTimeout, clearTimeout });
  const first = tel.incident();
  assert.equal(first.spans.length, 5);
  assert.equal(first.spans[0].startMs, NOW - startAgoMs(first.seed));
  assert.ok(tel.connect({ mode: 'practice', token: tel.practiceCredential(PRACTICE_SCOPE.ingest), endpoint: `https://${PRACTICE_HOSTS[0]}` }).ok);
  assert.equal((await tel.sendTest()).kind, 'accepted');
  assert.equal((await tel.sendBatch(first.spans)).kind, 'accepted');
  assert.ok(!JSON.stringify(tel.status()).includes(tel.practiceCredential(PRACTICE_SCOPE.ingest)));
});

test('normaliseAnswer: one spelling per answer, so "02" and "2" are the same retry count', () => {
  assert.equal(normaliseAnswer(QUESTION.retryCount, '02'), normaliseAnswer(QUESTION.retryCount, ' 2 '));
  assert.notEqual(normaliseAnswer(QUESTION.retryCount, '3'), normaliseAnswer(QUESTION.retryCount, '2'));
  assert.equal(normaliseAnswer(QUESTION.faultCode, ' AbC '), 'abc');
  assert.equal(normaliseAnswer(QUESTION.operation, ' Storage.Write'), 'storage.write');
  assert.equal(normaliseAnswer(QUESTION.retryCount, 'two'), 'two');
  assert.equal(normaliseAnswer(QUESTION.faultCode, undefined), '');
});

// ---- the practice trace list ----

const SID = '0123456789abcdef';
const list = (seed, sessionId = SID) => buildTraceList(build(seed), { sessionId });
const kidsOf = (e) => e.spans.slice(1);
const dur = (s) => s.endMs - s.startMs;

test('buildTraceList: deterministic, and the own entry holds the very spans that are graded', () => {
  assert.deepEqual(list(42), list(42));
  const inc = build(42);
  const own = buildTraceList(inc, { sessionId: SID }).filter((e) => e.own);
  assert.equal(own.length, 1);
  assert.equal(own[0].spans, inc.spans, 'the same array, not a copy');
  assert.equal(own[0].sessionId, SID);
});

test('buildTraceList: exactly one own trace and distinct sessions, traces, fault codes and seeds', () => {
  for (const seed of [0, 1, 42, 99999, 2 ** 32 - 1, 0x80000000]) {
    const l = list(seed);
    assert.equal(l.length, TRACE_LIST_SIZE);
    assert.equal(l.filter((e) => e.own).length, 1);
    assert.equal(new Set(l.map((e) => e.sessionId)).size, l.length, 'one session each');
    assert.equal(new Set(l.map((e) => e.traceId)).size, l.length, 'one trace id each');
    const keys = l.map((e) => answersFrom(e.spans));
    assert.ok(keys.every((k) => k !== null), 'every trace has a readable key');
    assert.equal(new Set(keys.map((k) => k.faultCode.toLowerCase())).size, l.length, 'one fault code each');
    for (const e of l) assert.ok(e.spans.every((s) => s.traceId === e.traceId));
  }
});

test('buildTraceList: a decoy has its own error span, events inside their spans, and the own trace is untouched', () => {
  const inc = build(42);
  const before = JSON.stringify(inc.spans);
  const l = buildTraceList(inc, { sessionId: SID });
  assert.equal(JSON.stringify(inc.spans), before, 'the own spans are not changed');
  for (const e of l.filter((x) => !x.own)) {
    const k = answersFrom(e.spans);
    const failing = e.spans.find((s) => s.name === k.operation);
    assert.equal(failing.events.filter((ev) => ev.name === 'retry').length, k.retryCount);
    for (const s of kidsOf(e)) assert.ok(s.startMs >= e.spans[0].startMs && s.endMs <= e.spans[0].endMs, 'inside the root');
    for (const ev of failing.events) assert.ok(ev.timeMs >= failing.startMs && ev.timeMs <= failing.endMs, 'events stay in their span');
  }
});

// Every trace starts in the past, in one window; a start time is no clue.
const sweepLists = (n) => Array.from({ length: n }, (_, i) => {
  const seed = (Math.imul(i + 1, 2654435761) >>> 0);
  const inc = buildIncident(seed, { now: () => NOW - startAgoMs(seed) }); // as telemetry.incident() builds it
  const nowMs = NOW;
  return { nowMs, entries: buildTraceList(inc, { sessionId: SID }) };
});

test('buildTraceList: every trace starts in the past, inside [now - 8 min, now - 30 s], the player\'s included', () => {
  for (const { nowMs, entries } of sweepLists(300)) {
    for (const e of entries) {
      const ago = nowMs - e.spans[0].startMs;
      assert.ok(ago >= START_MIN_AGO_MS && ago <= START_MAX_AGO_MS, `started ${ago} ms ago`);
      assert.ok(e.spans.every((s) => s.endMs < nowMs), 'nothing in the future');
    }
  }
});

test('buildTraceList: no blind rule finds the player\'s trace more than 25% of the time (chance is 1/6)', () => {
  const N = 1000;
  const lists = sweepLists(N);
  const total = (e) => e.spans[0].endMs - e.spans[0].startMs;
  const failingIsLongest = (e) => {
    const kids = kidsOf(e);
    const worst = kids.reduce((a, b) => (dur(b) > dur(a) ? b : a));
    return worst.status?.code === 'error';
  };
  const rules = {
    shortest: (l) => l.entries.reduce((a, b) => (total(b) < total(a) ? b : a)),
    longest: (l) => l.entries.reduce((a, b) => (total(b) > total(a) ? b : a)),
    latest: (l) => l.entries.reduce((a, b) => (b.spans[0].startMs > a.spans[0].startMs ? b : a)),
    earliest: (l) => l.entries.reduce((a, b) => (b.spans[0].startMs < a.spans[0].startMs ? b : a)),
    closestToNow: (l) => l.entries.reduce((a, b) => (l.nowMs - b.spans[0].startMs < l.nowMs - a.spans[0].startMs ? b : a)),
    failingIsLongest: (l) => l.entries.find(failingIsLongest) ?? l.entries[0],
    firstInList: (l) => l.entries[0],
    lastInList: (l) => l.entries[l.entries.length - 1],
  };
  for (const [name, pick] of Object.entries(rules)) {
    const hits = lists.filter((l) => pick(l).own).length / N;
    assert.ok(hits <= 0.25, `${name} finds the player's trace ${(hits * 100).toFixed(1)}% of the time`);
  }
});

test('buildTraceList: the own trace sits in different places and starts at different ranks across seeds', () => {
  const positions = new Set();
  const ranks = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const l = list(seed * 7919);
    positions.add(l.findIndex((e) => e.own));
    ranks.add([...l].sort((a, b) => a.spans[0].startMs - b.spans[0].startMs).findIndex((e) => e.own));
  }
  assert.ok(positions.size >= 5, `positions: ${[...positions]}`);
  assert.ok(ranks.size >= 5, `start-time ranks: ${[...ranks]}`);
});

test('buildTraceList: refuses an unreadable incident, no session id and a silly count', () => {
  assert.throws(() => buildTraceList({ seed: 1, spans: [] }, { sessionId: SID }), TypeError);
  assert.throws(() => buildTraceList(build(1), { sessionId: '' }), TypeError);
  assert.throws(() => buildTraceList(build(1), {}), TypeError);
  assert.throws(() => buildTraceList(build(1), { sessionId: SID, count: 1 }), TypeError);
});

test('matchTraces: session.id is X keeps exactly the own trace; is not drops it; a wrong value matches nothing', () => {
  const l = list(42);
  const f = (key, op, value) => matchTraces(l, { key, op, value });
  const mine = f(FILTER_KEY.sessionId, FILTER_OP.is, SID);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].own, true);
  assert.equal(f(FILTER_KEY.sessionId, FILTER_OP.isNot, ` ${SID} `).length, l.length - 1, 'the value is trimmed');
  assert.deepEqual(f(FILTER_KEY.sessionId, FILTER_OP.is, SID.toUpperCase()), [], 'matched exactly');
  assert.deepEqual(f(FILTER_KEY.sessionId, FILTER_OP.is, 'nope'), []);
  assert.equal(f(FILTER_KEY.serviceName, FILTER_OP.is, 'oncall-game').length, l.length, 'every trace is the same service');
  assert.equal(f(FILTER_KEY.spanName, FILTER_OP.is, 'progress.sync').length, l.length);
  assert.throws(() => f('nope', FILTER_OP.is, 'x'), TypeError);
  assert.throws(() => f(FILTER_KEY.sessionId, 'like', 'x'), TypeError);
  assert.throws(() => f(FILTER_KEY.sessionId, FILTER_OP.is, '  '), TypeError);
});
