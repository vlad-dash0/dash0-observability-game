// The seeded incident the Dash0 lab ("It's us") asks about: one trace of the game's own save path,
// with a fault injected into one operation. Pure and deterministic: the same seed and clock value
// give a deep-equal incident; nothing here reads Math.random, Date.now or crypto (the telemetry
// session draws the seed from its injected randomBytes, lib/telemetry.mjs).
// Contract: docs/DASH0-LAB.md §Incident. Spans are encoder drafts (lib/otlp/encode.mjs) and go out
// through telemetry.sendBatch; `session.id` is stamped by the encoder, never here.
//
// The answer key is answersFrom(spans): it reads the same array that P5 renders and exports, so
// there is no second copy of the facts to drift from the spans.

import { isErrorStatus, SERVICE_NAME } from './otlp/encode.mjs';

export const ROOT = 'progress.sync';
export const FIRST_CHILD = 'progress.serialize';
export const CANDIDATES = Object.freeze(['storage.write', 'cards.award', 'globe.ignite']);
export const FAULT_ATTR = 'game.fault.code';
export const FAULT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0 or 1
export const FAULT_CODE_LENGTH = 6;
export const RETRY_EVENT = 'retry';
export const EXCEPTION_EVENT = 'exception';
export const RETRY_MIN = 2;
export const RETRY_MAX = 4;
export const EXCEPTION_TYPES = Object.freeze(['QuotaExceededError', 'TimeoutError', 'InvalidStateError', 'DataCloneError']);
export const GENERIC_MESSAGE = 'operation failed';

export const QUESTION = Object.freeze({
  operation: 'operation',
  faultCode: 'faultCode',
  retryCount: 'retryCount',
  traceId: 'traceId',
});
export const GRADE = Object.freeze({ pass: 'pass', fail: 'fail', inconclusive: 'inconclusive' });

// The practice Trace Explorer: the player's trace among traces of other sessions, and the filter that finds it.
// Spec: https://opentelemetry.io/docs/specs/semconv/registry/attributes/session/ (session.id)
export const FILTER_KEY = Object.freeze({ sessionId: 'session.id', serviceName: 'service.name', spanName: 'span.name' });
export const FILTER_OP = Object.freeze({ is: 'is', isNot: 'is not' });
export const TRACE_LIST_SIZE = 6;
// Every trace of the list, the player's included, starts in the past, uniformly in [now - 8 min, now - 30 s],
// so a start time says nothing about whose trace it is, and nothing lies in the future.
export const START_MIN_AGO_MS = 30 * 1000;
export const START_MAX_AGO_MS = 8 * 60 * 1000;

const UINT32 = 2 ** 32;
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

// mulberry32: a tiny seeded generator; the only source of "randomness" in this module.
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return { int, pick: (list) => list[int(0, list.length - 1)], bytes: (n) => Array.from({ length: n }, () => int(0, 255)) };
}

/**
 * How long before "now" the trace of `seed` starts: uniform over [START_MIN_AGO_MS, START_MAX_AGO_MS],
 * a pure function of the seed. The session builds the player's incident at now() - startAgoMs(seed);
 * buildTraceList draws each decoy's start from the same function, on the decoy's own seed.
 */
export function startAgoMs(seed) {
  return prng((seed ^ 0x9e3779b9) >>> 0).int(START_MIN_AGO_MS, START_MAX_AGO_MS);
}

/**
 * Build the incident for `seed` (an integer in 0..2^32-1). `now` is the injected clock, read once
 * for the root span's start. Returns {seed, traceId, spans}; spans[0] is the root.
 */
export function buildIncident(seed, { now } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32) throw new TypeError('seed must be an integer in 0..2^32-1');
  if (typeof now !== 'function') throw new TypeError('now is required');
  const start = now();
  if (typeof start !== 'number' || !Number.isFinite(start)) throw new TypeError('now() must return a number');
  const rnd = prng(seed);
  const traceId = hex(rnd.bytes(16));
  const rootId = hex(rnd.bytes(8));
  const failing = rnd.pick(CANDIDATES);
  const code = Array.from({ length: FAULT_CODE_LENGTH }, () => rnd.pick([...FAULT_ALPHABET])).join('');
  const retryCount = rnd.int(RETRY_MIN, RETRY_MAX);
  const exceptionType = rnd.pick(EXCEPTION_TYPES);

  let cursor = start + 1;
  const kids = [FIRST_CHILD, ...CANDIDATES].map((name) => {
    const startMs = cursor;
    const failed = name === failing;
    const endMs = startMs + rnd.int(8, 40) + (failed ? retryCount * 10 : 0);
    cursor = endMs + 1;
    const span = { traceId, spanId: hex(rnd.bytes(8)), parentSpanId: rootId, name, kind: 'internal', startMs, endMs };
    if (failed) {
      span.attributes = { [FAULT_ATTR]: code };
      span.status = { code: 'error', message: GENERIC_MESSAGE };
      span.events = [
        ...Array.from({ length: retryCount }, (_, i) => ({
          name: RETRY_EVENT, timeMs: startMs + (i + 1) * 10 - 5, attributes: { 'retry.attempt': i + 1 },
        })),
        { name: EXCEPTION_EVENT, timeMs: endMs, attributes: { 'exception.type': exceptionType, 'exception.message': GENERIC_MESSAGE } },
      ];
    }
    return span;
  });
  const root = {
    traceId, spanId: rootId, name: ROOT, kind: 'server', startMs: start, endMs: cursor,
  };
  // Exactly one span is in error: the injected fault. The root carries no status of its own.
  return { seed, traceId, spans: [root, ...kids] };
}

const isCandidate = (s) => CANDIDATES.includes(s?.name);

/**
 * The expected answers, read from the spans themselves: {operation, faultCode, retryCount,
 * traceId}, or null when the spans do not hold exactly one span in error (across all of them, one
 * trace), that span a candidate with a fault code and a retry count in range (an unreadable key is
 * null, never a guess). "In error" is the encoder's rule (isErrorStatus).
 */
export function answersFrom(spans) {
  if (!Array.isArray(spans) || spans.length === 0) return null;
  let bad;
  try {
    bad = spans.filter((s) => isErrorStatus(s?.status));
  } catch {
    return null; // a status the encoder would refuse is not a readable key
  }
  if (bad.length !== 1 || !isCandidate(bad[0])) return null;
  const [span] = bad;
  const { traceId } = span;
  if (typeof traceId !== 'string' || traceId === '' || spans.some((s) => s?.traceId !== traceId)) return null;
  const code = span.attributes?.[FAULT_ATTR];
  if (typeof code !== 'string' || code === '') return null;
  const retryCount = Array.isArray(span.events) ? span.events.filter((e) => e?.name === RETRY_EVENT).length : 0;
  if (retryCount < RETRY_MIN || retryCount > RETRY_MAX) return null;
  return { operation: span.name, faultCode: code, retryCount, traceId };
}

const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * Grade one answer: GRADE.pass, GRADE.fail or GRADE.inconclusive. Missing or malformed input
 * (not a string/number, empty, a retry count that is not a whole number, a trace id that is not 32
 * hex characters) and an unreadable answer key are inconclusive; a well-formed wrong answer fails.
 * The operation, the code and the trace id are trimmed and case-insensitive; a retry count is a number.
 */
export function gradeAnswer(spans, question, value) {
  const key = answersFrom(spans);
  if (key === null) return GRADE.inconclusive;
  const verdict = (ok) => (ok ? GRADE.pass : GRADE.fail);
  switch (question) {
    case QUESTION.operation: {
      const v = text(value);
      return v === null ? GRADE.inconclusive : verdict(v.toLowerCase() === key.operation.toLowerCase());
    }
    case QUESTION.faultCode: {
      const v = text(value);
      return v === null ? GRADE.inconclusive : verdict(v.toLowerCase() === key.faultCode.toLowerCase());
    }
    case QUESTION.retryCount: {
      const v = typeof value === 'number' ? String(value) : text(value);
      if (v === null || !/^\d+$/.test(v)) return GRADE.inconclusive;
      return verdict(Number(v) === key.retryCount);
    }
    case QUESTION.traceId: {
      const v = text(value)?.toLowerCase() ?? null;
      if (v === null || !/^[0-9a-f]{32}$/.test(v)) return GRADE.inconclusive;
      return verdict(v === key.traceId);
    }
    default:
      return GRADE.inconclusive;
  }
}

/**
 * One canonical spelling of an answer, for counting a distinct wrong value once: trimmed and
 * lower-cased, and a retry count as its number ("02" and "2" are the same answer).
 */
export function normaliseAnswer(question, value) {
  const t = String(value ?? '').trim().toLowerCase();
  return question === QUESTION.retryCount && /^\d+$/.test(t) ? String(Number(t)) : t;
}

/**
 * The traces a Trace Explorer lists for the practice boss: `count` traces, exactly one of them the
 * player's (`own`, the incident that is sent and graded, `sessionId` its session). The others are
 * traces of other sessions, built by buildIncident from seeds derived from `own.seed`: each has its
 * own session id, trace id, failing span, fault code, retries and durations, drawn exactly as the player's
 * are (no re-timing), and a start drawn from the same past window (startAgoMs), so no property of a trace
 * singles it out. The order is a deterministic shuffle.
 * Pure: the same incident and session give the same list. Entries: {sessionId, traceId, spans, own}.
 */
export function buildTraceList(own, { sessionId, count = TRACE_LIST_SIZE } = {}) {
  const key = answersFrom(own?.spans);
  if (key === null || !Number.isInteger(own.seed)) throw new TypeError('own must be a readable incident');
  if (typeof sessionId !== 'string' || sessionId === '') throw new TypeError('sessionId is required');
  if (!Number.isInteger(count) || count < 2 || count > 12) throw new TypeError('count must be 2..12');
  const rnd = prng((own.seed ^ 0x5bd1e995) >>> 0);
  const seeds = new Set([own.seed]);
  const sessions = new Set([sessionId]);
  const faults = new Set([key.faultCode.toLowerCase()]);
  const traces = new Set([own.traceId]);
  const nowMs = own.spans[0].startMs + startAgoMs(own.seed); // the clock the player's incident was built against
  const entries = [{ sessionId, traceId: own.traceId, spans: own.spans, own: true }];
  for (let tries = 0; entries.length < count; tries++) {
    if (tries > 1000) throw new RangeError('could not derive distinct decoy traces');
    const seed = rnd.int(0, UINT32 - 1);
    const sid = hex(rnd.bytes(8));
    if (seeds.has(seed) || sessions.has(sid)) continue;
    const inc = buildIncident(seed, { now: () => nowMs - startAgoMs(seed) });
    const k = answersFrom(inc.spans);
    if (k === null || traces.has(inc.traceId) || faults.has(k.faultCode.toLowerCase())) continue;
    seeds.add(seed);
    sessions.add(sid);
    traces.add(inc.traceId);
    faults.add(k.faultCode.toLowerCase());
    entries.push({ sessionId: sid, traceId: inc.traceId, spans: inc.spans, own: false });
  }
  const order = prng((own.seed ^ 0x2545f491) >>> 0);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = order.int(0, i);
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return entries;
}

const filterValues = (entry, key) => {
  if (key === FILTER_KEY.sessionId) return [entry.sessionId];
  if (key === FILTER_KEY.serviceName) return [SERVICE_NAME];
  return entry.spans.map((s) => s.name);
};

/**
 * The entries a filter keeps. `filter` is {key, op, value}: `key` in FILTER_KEY, `op` in FILTER_OP,
 * `value` a non-empty string (trimmed, matched exactly). `is` keeps a trace with that value, `is not`
 * one without it. A bad filter throws; a filter that matches nothing returns [] (that is an answer).
 */
export function matchTraces(entries, filter) {
  const { key, op, value } = filter ?? {};
  if (!Object.values(FILTER_KEY).includes(key)) throw new TypeError('unknown filter key');
  if (!Object.values(FILTER_OP).includes(op)) throw new TypeError('unknown filter operator');
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('a filter value is required');
  const v = value.trim();
  return entries.filter((e) => filterValues(e, key).includes(v) === (op === FILTER_OP.is));
}
