// Play events (#18 P1): a Vercel Node function (Web Request in, Response out, one named export per HTTP
// method; docs/FOUNDATION.md §2.8). The page posts small anonymous batches (lib/play-events.mjs); this
// function turns each event into a span and exports them to the owner's Dash0 with the owner's token,
// which never reaches the browser. Dormant: unless the DASH0_* variables are valid and DASH0_GAME_EVENTS
// is unset or `on`, a POST is a 204 that reads nothing and sends no play event. Nothing about the player leaves
// this file: no session id, level, address or cookie in a response or a log line.
import { liveRegistry } from '../app.mjs';
import { clientKey, reply } from '../lib/http.mjs';
import { createLimiter } from '../lib/guide/limit.mjs';
import { gameSpan, SDK_VERSION, webResource, WEB_SERVICE_NAME } from '../lib/otel/attributes.mjs';
import { gameEventsEnabled, serverTelemetryConfig } from '../lib/otel/config.mjs';
import { drawHexId, EXPORT_TIMEOUT_MS, exportWithinBudget } from '../lib/otel/export.mjs';
import { createServerTelemetry } from '../lib/otel/server.mjs';
import { encodeResourceSpans, SPAN_KIND } from '../lib/otlp/encode.mjs';
import { sendTraces } from '../lib/otlp/send.mjs';
import { MAX_BODY_BYTES, parseBatch, VERSION } from '../lib/play-events.mjs';

const TEXT_TYPE = /^(?:text\/plain|application\/json)\s*(;|$)/i;

/**
 * The handlers over injected `env`, `fetch`, `now`, `random`, `log`, `limiter`, `registry` and timers, so a
 * test drives them with fakes. `send(body)` replaces the OTLP sender (the dev server's console exporter).
 * Defaults are the real ones; the registry is built on first use.
 */
export function createEvents({
  env = process.env,
  fetch = globalThis.fetch,
  now = Date.now,
  random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  log = (line) => console.log(JSON.stringify(line)),
  limiter = createLimiter({ now, clientMax: 60, clientWindowMs: 10 * 60 * 1000, instanceMax: 300, instanceWindowMs: 60 * 1000 }),
  registry = null,
  send = null,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
} = {}) {
  let built = registry;

  async function GET(request) {
    if (request.method !== 'GET') return reply(405, { error: 'method-not-allowed' }, { allow: 'GET' });
    return reply(200, { v: VERSION, on: gameEventsEnabled(env) });
  }

  async function POST(request) {
    const started = now();
    const done = (status, body, outcome, extra = {}, headers) => {
      log({ msg: 'events', outcome, status, ...extra, ms: now() - started });
      return status === 204 ? new Response(null, { status, headers: { 'cache-control': 'no-store' } }) : reply(status, body, headers);
    };
    try {
      if (request.method !== 'POST') return done(405, { error: 'method-not-allowed' }, 'method', {}, { allow: 'POST' });
      if (!gameEventsEnabled(env)) return done(204, null, 'off');
      if (!originAllowed(request)) return done(403, { error: 'forbidden' }, 'forbidden');
      if (!TEXT_TYPE.test(request.headers.get('content-type') ?? '')) return done(415, { error: 'unsupported-media-type' }, 'media-type');
      const declared = Number(request.headers.get('content-length'));
      if (declared > MAX_BODY_BYTES) return done(413, { error: 'too-large' }, 'too-large');
      const taken = limiter.take(clientKey(request));
      if (!taken.ok) {
        return done(429, { error: 'rate-limited', retryAfterS: taken.retryAfterS }, 'rate-limited', {}, { 'retry-after': String(taken.retryAfterS) });
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return done(413, { error: 'too-large' }, 'too-large');

      built ??= liveRegistry();
      const parsed = parseBatch(text, built);
      if (!parsed.ok) return done(400, { error: 'bad-request', field: parsed.field }, 'bad-request');

      const outcome = await exportWithinBudget({
        body: encodeBatch(parsed, built, started),
        spans: parsed.events.length,
        send: send ?? sender(),
        setTimeout,
        clearTimeout,
      });
      if (outcome.kind === 'exported') return done(204, null, 'accepted', { events: parsed.events.length });
      return done(502, { error: 'upstream' }, 'upstream', { reason: outcome.reason });
    } catch {
      return done(500, { error: 'internal' }, 'error'); // never the error: it could carry the token
    }
  }

  /**
   * An Origin, when sent, must name this host. `null` is allowed: a text/plain beacon is a no-cors request
   * (https://www.w3.org/TR/beacon/) and under Referrer-Policy no-referrer it sends `Origin: null`
   * (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).
   */
  function originAllowed(request) {
    const origin = request.headers.get('origin');
    if (origin === null || origin === 'null') return true;
    try {
      const host = request.headers.get('host') ?? new URL(request.url).host;
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  /** The real sender, over the configured endpoint, with the plain `fetch` (no CLIENT span of its own). */
  function sender() {
    const config = serverTelemetryConfig(env);
    return (body) =>
      sendTraces({ fetch, tracesUrl: config.tracesUrl, token: config.token, dataset: config.dataset, body, setTimeout, clearTimeout, timeoutMs: EXPORT_TIMEOUT_MS });
  }

  /** One span per event, each its own trace; `agoMs` is turned into a time against when the request arrived. */
  function encodeBatch({ sid, events }, registryBuilt, receivedMs) {
    const drafts = events.map((e) => {
      const endMs = receivedMs - e.agoMs;
      const level = e.level === undefined ? undefined : registryBuilt.levels[e.level];
      const ids = { traceId: drawHexId(random, 16), spanId: drawHexId(random, 8), kind: SPAN_KIND.internal };
      if (e.t === 'error') {
        const span = gameSpan({ name: 'client.error', sid, levelId: e.level, actId: level?.actId, errorKind: e.kind });
        return { ...ids, ...span, startMs: endMs, endMs };
      }
      const complete = e.outcome === 'complete';
      const span = gameSpan({
        name: 'level.play',
        sid,
        levelId: e.level,
        actId: level.actId,
        outcome: e.outcome,
        stars: complete ? e.stars : undefined,
        mistakes: complete ? e.mistakes : undefined,
        hints: complete ? e.hints : undefined,
      });
      return { ...ids, ...span, startMs: endMs - e.durationMs, endMs };
    });
    return encodeResourceSpans(drafts, { resource: webResource({ env }), scope: { name: WEB_SERVICE_NAME, version: SDK_VERSION } });
  }

  return { GET, POST };
}

const telemetry = createServerTelemetry({ name: 'events', env: process.env });
const events = createEvents({ log: telemetry.log });
export const { GET, POST } = telemetry.instrument(events);
