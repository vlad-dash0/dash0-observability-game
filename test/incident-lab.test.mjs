// lib/incident-lab.mjs (DASH0-LAB P4): the seeded incident the lab boss asks about.
// Pure: no Math.random, no Date.now; the clock is injected. Answers are read from the spans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  answersFrom, buildIncident, CANDIDATES, FAULT_ALPHABET, FAULT_ATTR, GRADE, gradeAnswer, QUESTION,
} from '../lib/incident-lab.mjs';
import { encodeTraces } from '../lib/otlp/encode.mjs';
import { createTelemetry, PRACTICE_TOKEN } from '../lib/telemetry.mjs';
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

test('one trace: root progress.sync with four children; exactly one of the last three is ERROR', () => {
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

test('every span encodes as OTLP; times nest inside the root', () => {
  const inc = build(11);
  encodeTraces(inc.spans, { sessionId: 'a'.repeat(16) });
  const [root, ...kids] = inc.spans;
  for (const k of kids) {
    assert.ok(k.startMs >= root.startMs && k.endMs <= root.endMs && k.endMs >= k.startMs);
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

test('telemetry.incident() is lazy, cached, seeded from randomBytes, and sends through sendBatch', async () => {
  let k = 3;
  const randomBytes = (n) => Uint8Array.from({ length: n }, () => (k++ * 41) & 0xff);
  const tel = createTelemetry({ randomBytes, now: clock, setTimeout, clearTimeout });
  const first = tel.incident();
  assert.ok(first && first.spans.length === 5);
  assert.equal(tel.incident(), first);
  assert.equal(first.spans[0].startMs, NOW);
  assert.ok(tel.connect({ mode: 'practice', token: PRACTICE_TOKEN, endpoint: `https://${PRACTICE_HOSTS[0]}` }).ok);
  assert.equal((await tel.sendTest()).kind, 'accepted');
  const out = await tel.sendBatch(first.spans);
  assert.equal(out.kind, 'accepted');
  const status = JSON.stringify(tel.status());
  assert.ok(!status.includes(PRACTICE_TOKEN));
  assert.ok(!JSON.stringify(first).includes(PRACTICE_TOKEN));
});
