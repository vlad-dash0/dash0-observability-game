// The game's telemetry session: connect to the player's own Dash0 (or the simulated practice
// ingress), send a test span, then emit spans. Pure: fetch, randomBytes, the clock and timers are
// injected; nothing touches window. Contract: docs/DASH0-LAB.md §Telemetry session, FOUNDATION §2.6.
//
// The token lives only in this closure and in the outgoing Authorization header. It is not in
// status(), an outcome, a span, or anything handed to reportError.
import { checkDataset, checkToken, INGRESS_HOSTS, parseEndpoint, PRACTICE_HOSTS } from './dash0/ingress.mjs';
import { buildIncident } from './incident-lab.mjs';
import { encodeTraces } from './otlp/encode.mjs';
import { createPracticeIngress } from './otlp/practice-ingress.mjs';
import { containsToken, OUTCOME, sendTraces } from './otlp/send.mjs';

export const MODE = Object.freeze({ live: 'live', practice: 'practice' });
export const STATE = Object.freeze({ off: 'off', configured: 'configured', connected: 'connected' });
export const BUFFER_CAP = 200;
// The token the game shows in practice mode, and the one minted with a read-only scope (the
// wrong choice in the planned connect level (DASH0-LAB P3)). Both are public by design: they only open the simulation.
export const PRACTICE_TOKEN = 'auth_practice_ingest_0000';
export const PRACTICE_READ_ONLY_TOKEN = 'auth_practice_readonly_0000';
export const TEST_SPAN_NAME = 'connection.test';
const WITHHELD = 'telemetry error (message withheld)';

const unreachable = (cause) => ({ kind: OUTCOME.unreachable, cause });
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * deps: { fetch? (live only), randomBytes (n -> Uint8Array), now, setTimeout, clearTimeout,
 * reportError?, hosts? (default INGRESS_HOSTS), allowLocal? (debug mode only) }.
 * connect() never sends; sendTest() is what makes the state `connected`.
 */
export function createTelemetry({
  fetch: realFetch = null,
  randomBytes,
  now = Date.now,
  setTimeout: later = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout,
  reportError = () => {},
  hosts = INGRESS_HOSTS,
  allowLocal = false,
} = {}) {
  if (typeof randomBytes !== 'function') throw new TypeError('randomBytes is required');
  const bytes = (n) => randomBytes(n);
  const sessionId = hex(bytes(8));
  const practiceFetch = createPracticeIngress({
    token: PRACTICE_TOKEN,
    readOnlyToken: PRACTICE_READ_ONLY_TOKEN,
  });

  // The frozen config snapshot (with the token) and the state machine.
  let config = null;
  let state = STATE.off;
  let generation = 0;
  let inflight = null; // {generation, promise}: sendTest is single-flight per config
  let buffer = [];
  let dropped = 0;
  let incidentCache = null;

  // Every token this session has used, kept so a late error from a replaced or dropped config is
  // still redacted. Closure-private; never exposed.
  const tokens = new Set();

  // A fresh Error is forwarded, never the original value, its stack or its cause; a thrown string
  // or object is handled like an Error. A message holding any session token in any shape (encoded,
  // re-cased, base64) is withheld whole; otherwise the plain token is rewritten to [token].
  const report = (e) => {
    try {
      let text = typeof e?.message === 'string' ? e.message : String(e);
      const all = [...tokens].sort((x, y) => y.length - x.length);
      if (all.some((t) => containsToken(text, t))) {
        reportError(new Error(WITHHELD));
        return;
      }
      for (const t of all) text = text.split(t).join('[token]');
      reportError(new Error(text));
    } catch {
      // nothing left to tell
    }
  };

  // Await a send; a throw is reported (redacted) and becomes an unreachable outcome.
  async function attempt(send) {
    try {
      return await send();
    } catch (e) {
      report(e);
      return unreachable('network');
    }
  }

  const liveAvailable = () => hosts.length > 0 && typeof realFetch === 'function';

  // Copies the draft's mutable parts so a later change by the caller cannot alter a buffered span.
  const withIds = (d) => ({
    ...d,
    attributes: d.attributes == null ? d.attributes : { ...d.attributes },
    events: Array.isArray(d.events) ? d.events.map((e) => ({ ...e, attributes: e.attributes == null ? e.attributes : { ...e.attributes } })) : d.events,
    status: d.status == null ? d.status : { ...d.status },
    traceId: d.traceId ?? hex(bytes(16)),
    spanId: d.spanId ?? hex(bytes(8)),
    startMs: d.startMs ?? now(),
    endMs: d.endMs ?? d.startMs ?? now(),
  });

  // One send of `drafts` under the config snapshot `cfg`. Practice goes to the fake, live to the
  // injected fetch; the two never mix.
  function post(cfg, drafts, signal) {
    return sendTraces({
      fetch: cfg.mode === MODE.practice ? practiceFetch : realFetch,
      tracesUrl: cfg.tracesUrl,
      token: cfg.token,
      dataset: cfg.dataset,
      body: encodeTraces(drafts, { sessionId }),
      signal,
      setTimeout: later,
      clearTimeout: cancel,
    });
  }

  const reset = () => {
    generation += 1;
    inflight = null;
    buffer = [];
    dropped = 0;
  };

  function connect({ mode, endpoint, token, dataset } = {}) {
    if (mode !== MODE.live && mode !== MODE.practice) {
      return { ok: false, field: 'mode', reason: 'mode' };
    }
    const practice = mode === MODE.practice;
    if (!practice && !liveAvailable()) return { ok: false, field: 'mode', reason: 'unavailable' };
    const raw = practice && (endpoint == null || endpoint === '') ? `https://${PRACTICE_HOSTS[0]}` : endpoint;
    const ep = parseEndpoint(raw, {
      hosts: practice ? PRACTICE_HOSTS : hosts,
      allowLocal: allowLocal && !practice,
    });
    if (!ep.ok) return { ok: false, field: 'endpoint', reason: ep.reason };
    const tk = checkToken(token);
    if (!tk.ok) return { ok: false, field: 'token', reason: tk.reason };
    const ds = checkDataset(dataset);
    if (!ds.ok) return { ok: false, field: 'dataset', reason: ds.reason };
    reset();
    tokens.add(token);
    config = Object.freeze({
      mode,
      base: ep.base,
      tracesUrl: ep.tracesUrl,
      host: ep.host,
      token,
      dataset: ds.dataset,
      generation,
    });
    state = STATE.configured;
    return { ok: true };
  }

  function sendTest({ signal } = {}) {
    if (config === null) return Promise.resolve(unreachable('not-configured'));
    if (inflight && inflight.generation === generation) return inflight.promise;
    const cfg = config;
    const run = async () => {
      const outcome = await attempt(() =>
        post(cfg, [withIds({ name: TEST_SPAN_NAME, attributes: {} })], signal));
      // A late outcome for a replaced or dropped config changes nothing (docs/DASH0-LAB.md, Telemetry session).
      if (cfg.generation !== generation) return unreachable('aborted');
      const was = state;
      state = outcome.kind === OUTCOME.accepted ? STATE.connected : STATE.configured;
      if (was === STATE.connected && state !== STATE.connected) {
        dropped += buffer.length; // spans kept for a connection that is gone are lost, and counted
        buffer = [];
      }
      return outcome;
    };
    const entry = { generation, promise: null };
    entry.promise = run().finally(() => {
      if (inflight === entry) inflight = null;
    });
    inflight = entry;
    return entry.promise;
  }

  // Never throws: a bad draft is reported and dropped (counted), play goes on.
  function emit(draft) {
    try {
      if (state !== STATE.connected) return;
      if (buffer.length >= BUFFER_CAP) {
        dropped += 1;
        return;
      }
      const d = withIds(draft);
      encodeTraces([d], { sessionId }); // validate now so one bad span cannot poison a batch
      buffer.push(d);
    } catch (e) {
      dropped += 1;
      report(e);
    }
  }

  async function flush({ signal } = {}) {
    if (state !== STATE.connected || buffer.length === 0) return null;
    // Take the buffer synchronously: spans emitted while this is in flight go into the next batch.
    const snapshot = buffer;
    buffer = [];
    const cfg = config;
    const outcome = await attempt(() => post(cfg, snapshot, signal));
    if (cfg.generation !== generation) return unreachable('aborted'); // a replaced config owns the counters
    if (outcome.kind !== OUTCOME.accepted) dropped += snapshot.length; // a failed flush drops its snapshot; it is not retried
    return outcome;
  }

  // Send drafts as one batch, now, bypassing the buffer. Rejects on an invalid draft.
  async function sendBatch(drafts, { signal } = {}) {
    if (state !== STATE.connected) return unreachable('not-connected');
    const cfg = config;
    const sending = post(cfg, drafts.map(withIds), signal); // an invalid draft rejects here, as documented
    const outcome = await attempt(() => sending);
    return cfg.generation === generation ? outcome : unreachable('aborted');
  }

  function disconnect() {
    reset();
    config = null;
    state = STATE.off;
  }

  return {
    sessionId,
    status: () => Object.freeze({
      state,
      mode: config?.mode ?? null,
      host: config?.host ?? null,
    }),
    // {buffered, dropped}: spans waiting for a flush, and spans lost to the cap or a failed flush.
    stats: () => Object.freeze({ buffered: buffer.length, dropped }),
    liveAvailable,
    connect,
    sendTest,
    emit,
    flush,
    sendBatch,
    // The session's seeded lab incident (lib/incident-lab.mjs): built lazily, once, so every caller
    // in the session gets the same incident. The seed is 4 bytes from the injected randomBytes,
    // read big-endian from the values themselves (a subarray or a plain array works too).
    incident: () => {
      if (incidentCache === null) {
        const b = bytes(4);
        incidentCache = buildIncident(((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0, { now });
      }
      return incidentCache;
    },
    disconnect,
  };
}
