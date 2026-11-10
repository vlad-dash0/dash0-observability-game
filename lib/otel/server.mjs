// Server telemetry for the api/ functions (epic #18): one trace export per invocation, awaited
// before the response is returned, dormant unless the Dash0 env is fully valid. No dependencies:
// it reuses the browser lab's encoder (lib/otlp/encode.mjs) and sender (lib/otlp/send.mjs).
// Node only (AsyncLocalStorage); nothing reads process.env or the clock directly, all injected.
// Spec: https://opentelemetry.io/docs/specs/semconv/http/http-spans/ (span names, kinds, status),
// https://opentelemetry.io/docs/specs/semconv/resource/ , https://www.w3.org/TR/trace-context/ ,
// https://opentelemetry.io/docs/specs/otel/trace/sdk/ , https://vercel.com/docs/fluid-compute ,
// https://vercel.com/docs/environment-variables/system-environment-variables
//
// Facts used (each read on the page named, 2026-11-10). Trace SDK, SpanProcessor ForceFlush:
// "ForceFlush SHOULD only be called in cases where it is absolutely necessary, such as when using
// some FaaS providers that may suspend the process after an invocation, but before the SpanProcessor
// exports the completed spans" (the same sentence level 9.8, levels/edge-of-the-platform.mjs, teaches).
// Vercel's waitUntil (https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package) "Extends the lifetime of the request handler for the lifetime of the given
// Promise"; this module does not use it (no @vercel package) and awaits the export instead. Trace
// SDK, default sampler: ParentBased with an AlwaysOn root; a remote parent that is not sampled
// defaults to AlwaysOff, so an unsampled traceparent exports nothing. Fluid compute (the default for
// new Vercel projects since 2025-04-23) runs concurrent invocations in one instance, hence the
// per-request recorder in AsyncLocalStorage. System env vars VERCEL, VERCEL_ENV and
// VERCEL_GIT_COMMIT_SHA are exposed by turning on the project's "Enable access to System Environment
// Variables" setting; each is optional here. HTTP semantic conventions: see attributes.mjs.
// VERIFY (#195), stated as reasoning with no source: that Dash0's ingress accepts OTLP/HTTP with a JSON body (the
// browser lab sends JSON and DASH0-LAB marks that "reasoned"); a 415 would show as a dropped line
// with reason rejected and ingressStatus 415.
//
// Two behaviours to know. With an invalid configuration `instrument` returns pass-through wrappers
// (so the reason can be logged once, at the first request, never at import); `log` and `trace` stay
// the identical functions. And `ms` on a telemetry log line is the time spent flushing the export,
// while the handler's own `ms` and the span durations exclude the flush.
import { AsyncLocalStorage } from 'node:async_hooks';
import { encodeResourceSpans, SPAN_KIND } from '../otlp/encode.mjs';
import { sendTraces } from '../otlp/send.mjs';
import { clientSpan, isFunctionName, serverResource, serverSpan, SERVICE_NAME, SDK_VERSION } from './attributes.mjs';
import { serverTelemetryConfig } from './config.mjs';
import { parseTraceparent } from './traceparent.mjs';

export { SERVICE_NAME };
export const EXPORT_TIMEOUT_MS = 450;
export const FLUSH_BUDGET_MS = 500;
export const MAX_SPANS = 16;
export const MAX_EXPORT_BYTES = 64 * 1024;

const TOKEN = /^[a-z0-9-]{1,40}$/;
const ID = /^[a-z0-9-]{1,100}$/;

const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const schemeOf = (url) => {
  try {
    return new URL(url).protocol.slice(0, -1);
  } catch {
    return undefined;
  }
};

/** A span-per-line exporter for local use: returns {kind:'accepted'} after logging each span. */
export function consoleExporter(log) {
  const value = (v) => v.stringValue ?? (v.intValue !== undefined ? Number(v.intValue) : (v.boolValue ?? v.doubleValue));
  return async (body) => {
    for (const rs of body.resourceSpans) {
      for (const ss of rs.scopeSpans) {
        for (const s of ss.spans) {
          const ms = Math.round(Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1e6);
          const attrs = Object.fromEntries(s.attributes.map((a) => [a.key, value(a.value)]));
          log(`span ${s.name} ${s.kind} ${s.status?.code ?? 0} ${ms}ms ${JSON.stringify(attrs)}`);
        }
      }
    }
    return { kind: 'accepted' };
  };
}

/** The telemetry of one api/ function; see the module header. Dormant ('off', 'invalid') changes no player-visible behaviour. */
export function createServerTelemetry({
  name,
  env,
  fetch = globalThis.fetch,
  now = () => performance.timeOrigin + performance.now(),
  random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  log = (line) => console.log(JSON.stringify(line)),
  exporter = null,
  onExport = null,
  maxExportBytes = MAX_EXPORT_BYTES, // test-only
}) {
  if (!isFunctionName(name)) throw new TypeError('createServerTelemetry needs a function name');
  if (env === null || typeof env !== 'object') throw new TypeError('createServerTelemetry needs env');
  const config = serverTelemetryConfig(env);
  if (config.state === 'off') return { state: 'off', log, trace: (f) => f, instrument: (h) => h };
  const mapHandlers = (handlers, wrap) =>
    typeof handlers === 'function'
      ? wrap(handlers)
      : Object.fromEntries(Object.entries(handlers).map(([k, v]) => [k, typeof v === 'function' ? wrap(v) : v]));

  if (config.state === 'invalid') {
    let told = false;
    const tellOnce = () => {
      if (told) return;
      told = true;
      try {
        log({ msg: 'telemetry', outcome: 'not-configured', reason: `${config.field}:${config.reason}` });
      } catch {
        // a failing log must not fail the request
      }
    };
    const wrap = (fn) => (...args) => {
      tellOnce();
      return fn(...args);
    };
    return { state: 'invalid', log, trace: (f) => f, instrument: (handlers) => mapHandlers(handlers, wrap) };
  }

  const route = `/api/${name}`;
  const als = new AsyncLocalStorage();
  const send =
    exporter ??
    ((body) =>
      sendTraces({
        fetch,
        tracesUrl: config.tracesUrl,
        token: config.token,
        dataset: config.dataset,
        body,
        setTimeout,
        clearTimeout,
        timeoutMs: EXPORT_TIMEOUT_MS,
      }));
  let resource = null;

  // Hex id of `bytes` bytes, redrawn once when it comes out all zero (the spec forbids it).
  function drawId(bytes) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = random(bytes);
      if (!(raw instanceof Uint8Array) || raw.length !== bytes) throw new TypeError('bad random bytes');
      const hex = toHex(raw);
      if (/[1-9a-f]/.test(hex)) return hex;
    }
    throw new RangeError('random gave an all-zero id twice');
  }

  const safeLog = (line) => {
    try {
      log(line);
    } catch {
      // telemetry reporting never fails a request
    }
  };
  function report(outcome, ms) {
    try {
      // an async observer that rejects must not become an unhandled rejection either
      Promise.resolve(onExport?.(outcome)).catch(() => {});
    } catch {
      // the observer is not the handler's concern
    }
    if (outcome.kind !== 'dropped' || outcome.reason === 'not-sampled') return;
    const line = { msg: 'telemetry', outcome: 'dropped', reason: outcome.reason, spans: outcome.spans };
    if (ms !== undefined) line.ms = ms;
    if (outcome.ingressStatus !== undefined) line.ingressStatus = outcome.ingressStatus;
    safeLog(line);
  }

  function open(request) {
    const parent = parseTraceparent(request.headers.get('traceparent'));
    if (parent !== null && !parent.sampled) return { skip: true };
    const traceId = parent?.traceId ?? drawId(16);
    const spanId = drawId(8);
    return {
      traceId,
      spanId,
      parentSpanId: parent?.parentId,
      startMs: now(),
      method: request.method,
      scheme: schemeOf(request.url),
      clients: [],
      cut: 0,
      sealed: false,
      outcome: undefined,
      levelId: undefined,
      stepId: undefined,
    };
  }

  const tee = (line) => {
    const rec = als.getStore();
    if (rec && !rec.sealed && line !== null && typeof line === 'object') {
      if (typeof line.outcome === 'string' && TOKEN.test(line.outcome)) rec.outcome = line.outcome;
      if (typeof line.levelId === 'string' && ID.test(line.levelId)) rec.levelId = line.levelId;
      if (typeof line.stepId === 'string' && ID.test(line.stepId)) rec.stepId = line.stepId;
    }
    return log(line);
  };

  function trace(inner) {
    return (...args) => {
      const rec = als.getStore();
      if (!rec || rec.sealed) return inner(...args);
      let startMs;
      let spanId;
      try {
        startMs = now();
        spanId = drawId(8);
      } catch {
        return inner(...args);
      }
      const [input, init] = args;
      const finish = (status, threw = false, thrown) => {
        try {
          if (rec.sealed) return;
          if (rec.clients.length >= MAX_SPANS - 1) {
            rec.cut += 1;
            return;
          }
          const method = init?.method ?? (typeof input === 'object' && input !== null ? input.method : undefined);
          const url = typeof input === 'object' && input !== null && 'url' in input ? input.url : input;
          const span = clientSpan({ method, url, status, threw, thrown });
          if (span === null) return;
          rec.clients.push({
            traceId: rec.traceId,
            spanId,
            parentSpanId: rec.spanId,
            kind: SPAN_KIND.client,
            startMs,
            endMs: now(),
            ...span,
          });
        } catch {
          // a span that cannot be built is skipped; the call it describes is untouched
        }
      };
      let result;
      try {
        result = inner(...args);
      } catch (err) {
        finish(undefined, true, err);
        throw err;
      }
      if (typeof result?.then !== 'function') return result;
      return result.then(
        (res) => {
          finish(res?.status);
          return res;
        },
        (err) => {
          finish(undefined, true, err);
          throw err;
        },
      );
    };
  }

  // Encode, size-check, export under the flush budget -> an ExportOutcome. Throws only for internal faults.
  async function exportSpans(rec, { status, threw, thrown }) {
    const server = serverSpan({
      method: rec.method,
      route,
      scheme: rec.scheme,
      status,
      outcome: rec.outcome,
      levelId: rec.levelId,
      stepId: rec.stepId,
      threw,
      thrown,
    });
    const drafts = [
      {
        traceId: rec.traceId,
        spanId: rec.spanId,
        parentSpanId: rec.parentSpanId,
        kind: SPAN_KIND.server,
        startMs: rec.startMs,
        endMs: rec.endMs,
        ...server,
      },
      ...rec.clients,
    ];
    resource ??= serverResource({ name, env, random });
    const body = encodeResourceSpans(drafts, {
      resource,
      scope: { name: SERVICE_NAME, version: SDK_VERSION },
    });
    const spans = drafts.length;
    if (Buffer.byteLength(JSON.stringify(body)) > maxExportBytes) {
      return { kind: 'dropped', reason: 'too-large', spans };
    }
    let timer;
    const budget = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'dropped', reason: 'budget', spans }), FLUSH_BUDGET_MS);
    });
    const exporting = (async () => classify(await send(body), spans))().catch(() => internalDrop(spans));
    try {
      return await Promise.race([exporting, budget]);
    } finally {
      clearTimeout(timer);
    }
  }

  function classify(sent, spans) {
    switch (sent?.kind) {
      case 'accepted':
        return { kind: 'exported', spans };
      case 'rejected':
        return sent.auth
          ? { kind: 'dropped', reason: 'auth', spans }
          : { kind: 'dropped', reason: 'rejected', spans, ingressStatus: sent.status };
      case 'unreachable':
        return { kind: 'dropped', reason: sent.cause, spans };
      default:
        return internalDrop(spans);
    }
  }

  // A telemetry fault: the one dropped/internal outcome.
  const internalDrop = (spans) => ({ kind: 'dropped', reason: 'internal', spans });

  // Never throws. Seals the recorder, exports once, reports.
  async function conclude(rec, { response, threw = false, thrown }) {
    if (rec.skip) return report({ kind: 'dropped', reason: 'not-sampled', spans: 1 });
    rec.sealed = true;
    let outcome;
    let ms;
    let t0;
    try {
      rec.endMs = now();
      t0 = rec.endMs;
      outcome = await exportSpans(rec, { status: response?.status, threw, thrown });
    } catch {
      outcome = internalDrop(rec.clients.length + 1);
    }
    try {
      if (t0 !== undefined) ms = Math.round(now() - t0);
    } catch {
      ms = undefined;
    }
    report(outcome, ms);
    if (rec.cut > 0) report({ kind: 'dropped', reason: 'overflow', spans: rec.cut }, ms);
  }

  const wrap = (handler) => async (request, ...rest) => {
    let rec = null;
    let lost = false;
    try {
      rec = open(request);
    } catch {
      lost = true;
    }
    let response;
    try {
      response = rec === null || rec.skip ? await handler(request, ...rest) : await als.run(rec, () => handler(request, ...rest));
    } catch (err) {
      if (rec !== null) await conclude(rec, { threw: true, thrown: err });
      else report(internalDrop(1));
      throw err;
    }
    if (rec !== null) await conclude(rec, { response });
    else if (lost) report(internalDrop(1));
    return response;
  };

  return { state: 'on', log: tee, trace, instrument: (handlers) => mapHandlers(handlers, wrap) };
}
