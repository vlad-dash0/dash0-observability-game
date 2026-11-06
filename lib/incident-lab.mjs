// The seeded incident the Dash0 lab ("It's us") asks about: one trace of the game's own save path,
// with a fault injected into one operation. Pure and deterministic: the same seed and clock value
// give a deep-equal incident; nothing here reads Math.random, Date.now or crypto (the telemetry
// session draws the seed from its injected randomBytes, lib/telemetry.mjs).
// Contract: docs/DASH0-LAB.md §Incident. Spans are encoder drafts (lib/otlp/encode.mjs) and go out
// through telemetry.sendBatch; `session.id` is stamped by the encoder, never here.
//
// The answer key is answersFrom(spans): it reads the same array that P5 renders and exports, so
// there is no second copy of the facts to drift from the spans.

import { isErrorStatus } from './otlp/encode.mjs';

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
 */
export function gradeAnswer(spans, question, value) {
  const key = answersFrom(spans);
  if (key === null) return GRADE.inconclusive;
  const verdict = (ok) => (ok ? GRADE.pass : GRADE.fail);
  switch (question) {
    case QUESTION.operation: {
      const v = text(value);
      return v === null ? GRADE.inconclusive : verdict(v === key.operation);
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
