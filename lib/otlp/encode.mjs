// OTLP/HTTP JSON encoder for traces, pure, no dependencies.
// Spec: https://opentelemetry.io/docs/specs/otlp/ (OTLP/HTTP, "JSON Protobuf Encoding"):
//   - traceId / spanId are lowercase hex strings (not base64, unlike the protobuf mapping);
//   - *TimeUnixNano are decimal strings (a uint64 does not fit a double);
//   - int64 attribute values are decimal strings (`intValue`), bools `boolValue`,
//     doubles `doubleValue`, strings `stringValue`;
//   - enums (span kind, status code) are integers.
// Contract: docs/DASH0-LAB.md §Encoder. Bad input throws; nothing is silently dropped.

export const SERVICE_NAME = 'oncall-game';
export const SERVICE_VERSION = '0.1.0';
export const SDK_NAME = 'oncall-game-otlp';
export const SDK_LANGUAGE = 'webjs';
export const SESSION_ATTR = 'session.id';

export const SPAN_KIND = Object.freeze({
  unspecified: 0,
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
});
export const STATUS_CODE = Object.freeze({ unset: 0, ok: 1, error: 2 });

const NANOS_PER_MS = 1_000_000n;
const HEX = { trace: /^[0-9a-f]{32}$/, span: /^[0-9a-f]{16}$/ };

// Epoch milliseconds (fractions allowed) -> decimal-string nanoseconds, exact in BigInt.
export function msToUnixNano(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`bad timestamp: ${ms}`);
  }
  const whole = Math.floor(ms);
  const frac = Math.round((ms - whole) * 1e6);
  return String(BigInt(whole) * NANOS_PER_MS + BigInt(frac));
}

function anyValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'bigint') return { intValue: String(v) };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RangeError('non-finite attribute value');
    if (!Number.isInteger(v)) return { doubleValue: v };
    // An integer beyond 2^53 has already lost precision: refuse rather than send a wrong int64.
    if (!Number.isSafeInteger(v)) throw new RangeError('integer attribute is not a safe integer');
    return { intValue: String(v) };
  }
  throw new TypeError(`unsupported attribute value type: ${v === null ? 'null' : typeof v}`);
}

function attributes(obj) {
  return Object.entries(obj ?? {}).map(([key, value]) => ({ key, value: anyValue(value) }));
}

function enumOf(table, v, what, fallback) {
  if (v === undefined) return fallback;
  if (Number.isInteger(v) && Object.values(table).includes(v)) return v;
  const key = typeof v === 'string' ? v.toLowerCase() : v;
  if (Object.hasOwn(table, key)) return table[key];
  throw new RangeError(`unknown ${what}: ${String(v)}`);
}

// The one rule for "this span is in error": code 2, or the string 'error' in any case. Throws
// RangeError on a code the encoder would refuse, so callers decide what an unreadable status means.
export function isErrorStatus(status) {
  return enumOf(STATUS_CODE, status?.code, 'status code', STATUS_CODE.unset) === STATUS_CODE.error;
}

function hexId(v, kind) {
  if (typeof v !== 'string' || !HEX[kind].test(v)) throw new TypeError(`bad ${kind}Id`);
  return v;
}

function encodeSpan(d, sessionId) {
  const span = {
    traceId: hexId(d.traceId, 'trace'),
    spanId: hexId(d.spanId, 'span'),
    name: d.name,
    kind: enumOf(SPAN_KIND, d.kind, 'span kind', SPAN_KIND.internal),
    startTimeUnixNano: msToUnixNano(d.startMs),
    endTimeUnixNano: msToUnixNano(d.endMs),
    // The session stamp is added here, once; a draft cannot override it.
    attributes: [...attributes({ ...d.attributes, [SESSION_ATTR]: sessionId })],
  };
  if (typeof d.name !== 'string' || d.name === '') throw new TypeError('span needs a name');
  if (d.parentSpanId != null) span.parentSpanId = hexId(d.parentSpanId, 'span');
  if (d.events?.length) {
    span.events = d.events.map((e) => ({
      timeUnixNano: msToUnixNano(e.timeMs),
      name: e.name,
      attributes: attributes(e.attributes),
    }));
  }
  const code = enumOf(STATUS_CODE, d.status?.code, 'status code', STATUS_CODE.unset);
  if (code !== STATUS_CODE.unset) {
    span.status = { code };
    if (d.status.message != null) span.status.message = d.status.message;
  }
  return span;
}

// drafts: [{traceId, spanId, parentSpanId?, name, kind?, startMs, endMs, attributes?,
//   events?: [{name, timeMs, attributes?}], status?: {code: 'ok'|'error'|n, message?}}]
// -> an ExportTraceServiceRequest object (JSON-ready). One resource, one scope.
export function encodeTraces(drafts, { sessionId }) {
  if (typeof sessionId !== 'string' || sessionId === '') throw new TypeError('sessionId required');
  if (!Array.isArray(drafts) || drafts.length === 0) throw new RangeError('no spans to encode');
  return {
    resourceSpans: [
      {
        resource: {
          attributes: attributes({
            'service.name': SERVICE_NAME,
            'service.version': SERVICE_VERSION,
            'telemetry.sdk.name': SDK_NAME,
            'telemetry.sdk.language': SDK_LANGUAGE,
            'telemetry.sdk.version': SERVICE_VERSION,
          }),
        },
        scopeSpans: [
          {
            scope: { name: SERVICE_NAME, version: SERVICE_VERSION },
            spans: drafts.map((d) => encodeSpan(d, sessionId)),
          },
        ],
      },
    ],
  };
}
