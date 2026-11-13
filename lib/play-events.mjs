// The wire contract of the game's play events (epic #18 P1; docs/GAME-EVENTS.md). Pure: text in, a
// checked batch out. Every object is closed (an unknown key rejects the whole batch, never picked), every
// number is an integer in a range, every level is an own key of the registry. A failure names only the
// field, never the value. The client sends no act, nickname, text, URL, user agent or timestamp: the
// act comes from the registry and times are relative (`agoMs`, `durationMs`).
import { MAX_STARS } from './scoring.mjs';
import { errorType } from './otel/attributes.mjs';

export const VERSION = 1;
export const MAX_EVENTS = 20;
export const MAX_BODY_BYTES = 8192;
export const MAX_MS = 86_400_000;
export const MAX_COUNT = 10_000;
export const MAX_ERRORS_PER_PAGE = 10; // the client's cap; stated here so the contract has one home
export const OUTCOMES = Object.freeze(['complete', 'abandon']);

const SID = /^[0-9a-f]{16}$/;
const KIND = /^(?:[A-Za-z]{1,40}|_OTHER)$/;
const BODY_KEYS = ['v', 'sid', 'events'];
const PLAY_KEYS = ['t', 'level', 'outcome', 'durationMs', 'agoMs'];
const SCORE_KEYS = ['stars', 'mistakes', 'hints'];
const ERROR_KEYS = ['t', 'kind', 'agoMs', 'level'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const closed = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));
const known = (registry, id) => typeof id === 'string' && Object.hasOwn(registry.levels, id);

/** The exception class name an error event carries: a short plain word or `_OTHER`; the one rule of lib/otel/attributes.mjs. */
export const errorKind = (thrown) => errorType(thrown);

/** One event -> the field that is wrong, or null. */
function badField(e, registry) {
  if (!isObject(e)) return 'events';
  if (e.t === 'play') {
    const complete = e.outcome === 'complete';
    if (!closed(e, complete ? [...PLAY_KEYS, ...SCORE_KEYS] : PLAY_KEYS)) return 'events';
    if (!known(registry, e.level)) return 'level';
    if (!OUTCOMES.includes(e.outcome)) return 'outcome';
    if (!int(e.durationMs, MAX_MS)) return 'durationMs';
    if (!int(e.agoMs, MAX_MS)) return 'agoMs';
    if (!complete) return null;
    const scored = registry.levels[e.level].scored;
    if (!(scored ? int(e.stars, MAX_STARS) && e.stars >= 1 : e.stars === 0)) return 'stars';
    if (!int(e.mistakes, MAX_COUNT)) return 'mistakes';
    if (!int(e.hints, MAX_COUNT)) return 'hints';
    return null;
  }
  if (e.t === 'error') {
    if (!closed(e, ERROR_KEYS)) return 'events';
    if (typeof e.kind !== 'string' || !KIND.test(e.kind)) return 'kind';
    if (!int(e.agoMs, MAX_MS)) return 'agoMs';
    if (e.level !== undefined && !known(registry, e.level)) return 'level';
    return null;
  }
  return 't';
}

/**
 * The request text -> `{ok: true, sid, events}` (the events exactly as sent) or `{ok: false, field}`.
 * `registry` is a built registry; only `registry.levels` is read.
 */
export function parseBatch(text, registry) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, field: 'body' };
  }
  if (!isObject(body) || !closed(body, BODY_KEYS)) return { ok: false, field: 'body' };
  if (body.v !== VERSION) return { ok: false, field: 'v' };
  if (typeof body.sid !== 'string' || !SID.test(body.sid)) return { ok: false, field: 'sid' };
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > MAX_EVENTS) return { ok: false, field: 'events' };
  for (const e of body.events) {
    const field = badField(e, registry);
    if (field !== null) return { ok: false, field };
  }
  return { ok: true, sid: body.sid, events: body.events };
}
