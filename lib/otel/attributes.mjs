// What a server span may say, and nothing else: the single privacy choke point of the api/
// telemetry (epic #18). Pure. Every attribute key is on one of three allowlists below; a value
// that fails its check is dropped, never truncated or repaired.
// Spec: https://opentelemetry.io/docs/specs/semconv/http/http-spans/ and
// https://opentelemetry.io/docs/specs/semconv/resource/ (faas, deployment, service pages).
//
// Facts used (each read on the page named, 2026-11-10). HTTP semantic conventions are stable
// (https://opentelemetry.io/blog/2023/http-conventions-declared-stable/, v1.23.0). SERVER span name
// is `{method} {http.route}`, and `HTTP {http.route}` when the method is `_OTHER`; a CLIENT span is
// named `{method}`. A method not in the known list is recorded as `_OTHER`; the list includes QUERY
// (Development). `error.type` is the status code as a string for an HTTP error, or the exception
// class name. The spec prefers the fully-qualified name where applicable; this module keeps the short
// class name on purpose (a package path is noise and a cardinality risk) and never a message. Span status: for a SERVER span "4xx MUST be left unset", Error for 5xx is a SHOULD; a
// CLIENT span SHOULD be Error for >= 400; "Don't set the span status description if the reason can
// be inferred from http.response.status_code", so no status message is ever set (an exception
// message can carry user data). `url.full` MUST NOT contain credentials: userinfo, query and
// fragment are all removed. `service.instance.id` is a random UUID v4 (v1 or v4 are recommended).
// `deployment.environment.name` and `telemetry.sdk.language` (`nodejs`) are Stable; `faas.name` is
// Development; no cloud.provider value exists for Vercel, so none is sent.
// Left out on purpose: url.query, client.address, user_agent.original, server.address of the
// request, every header, exception messages.

export const SERVICE_NAME = 'oncall-game-api';
export const SDK_NAME = 'oncall-game-otlp';
export const SDK_LANGUAGE = 'nodejs';
export const SDK_VERSION = '0.1.0';

export const RESOURCE_KEYS = Object.freeze([
  'service.name',
  'service.version',
  'service.instance.id',
  'deployment.environment.name',
  'faas.name',
  'telemetry.sdk.name',
  'telemetry.sdk.language',
  'telemetry.sdk.version',
]);
export const SERVER_SPAN_KEYS = Object.freeze([
  'http.request.method',
  'http.route',
  'url.path',
  'url.scheme',
  'http.response.status_code',
  'error.type',
  'game.api.outcome',
  'game.level.id',
  'game.step.id',
]);
export const CLIENT_SPAN_KEYS = Object.freeze([
  'http.request.method',
  'server.address',
  'server.port',
  'url.full',
  'http.response.status_code',
  'error.type',
]);
export const KNOWN_METHODS = Object.freeze([
  'CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE', 'QUERY',
]);

const OTHER = '_OTHER';
const ERROR = Object.freeze({ code: 2 });
const OUTCOME = /^[a-z0-9-]{1,40}$/;
// The guide's own limit for level and step ids is 100 characters (api/guide.mjs MAX_STEP_ID).
const ID = /^[a-z0-9-]{1,100}$/;
const ERROR_NAME = /^[A-Za-z]{1,40}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const ENVIRONMENTS = ['production', 'preview', 'development'];
const FUNCTION_NAME = /^[a-z0-9-]{1,40}$/;
const SCHEMES = ['http', 'https'];
const DEFAULT_PORT = { 'https:': 443, 'http:': 80 };

const pick = (allowed, attrs) =>
  Object.fromEntries(Object.entries(attrs).filter(([k, v]) => allowed.includes(k) && v !== undefined));
const method = (m) => (KNOWN_METHODS.includes(m) ? m : OTHER);
const okString = (re, v) => (typeof v === 'string' && re.test(v) ? v : undefined);
const isStatus = (s) => (Number.isInteger(s) && s >= 100 && s <= 599 ? s : undefined);

/** An exception class name when it is a short plain word, else `_OTHER`. */
export const errorType = (thrown) => okString(ERROR_NAME, thrown?.name) ?? OTHER;

/** The function name check: a code constant, still validated because it reaches the resource. */
export const isFunctionName = (name) => typeof name === 'string' && FUNCTION_NAME.test(name);

/** The resource of one function instance. Draws a random UUID v4 for service.instance.id. */
export function serverResource({ name, env, random }) {
  const raw = random(16);
  if (!(raw instanceof Uint8Array) || raw.length !== 16) throw new TypeError('random(16) must give 16 bytes');
  const b = Uint8Array.from(raw);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return pick(RESOURCE_KEYS, {
    'service.name': SERVICE_NAME,
    'service.version': okString(COMMIT, env?.VERCEL_GIT_COMMIT_SHA),
    'service.instance.id': uuid,
    'deployment.environment.name': ENVIRONMENTS.includes(env?.VERCEL_ENV) ? env.VERCEL_ENV : undefined,
    'faas.name': isFunctionName(name) ? name : undefined,
    'telemetry.sdk.name': SDK_NAME,
    'telemetry.sdk.language': SDK_LANGUAGE,
    'telemetry.sdk.version': SDK_VERSION,
  });
}

/**
 * The SERVER span of one invocation -> {name, attributes, status}. `status` is the Response's
 * (authoritative); `threw` says the handler threw `thrown` (any value, even undefined; then there is no status).
 */
export function serverSpan({ method: m, route, scheme, status, outcome, levelId, stepId, threw = false, thrown }) {
  const verb = method(m);
  const code = isStatus(status);
  const failed = threw || (code !== undefined && code >= 500);
  let errType;
  if (threw) errType = errorType(thrown);
  else if (failed) errType = String(code);
  return {
    name: verb === OTHER ? `HTTP ${route}` : `${verb} ${route}`,
    attributes: pick(SERVER_SPAN_KEYS, {
      'http.request.method': verb,
      'http.route': route,
      'url.path': route,
      'url.scheme': SCHEMES.includes(scheme) ? scheme : undefined,
      'http.response.status_code': code,
      'error.type': errType,
      'game.api.outcome': okString(OUTCOME, outcome),
      'game.level.id': okString(ID, levelId),
      'game.step.id': okString(ID, stepId),
    }),
    status: failed ? ERROR : undefined,
  };
}

/**
 * The CLIENT span of one outgoing fetch -> {name, attributes, status}, or null when the url cannot
 * be read or is not http(s). `url` is a string or URL; only origin and path are kept. `threw` as for serverSpan.
 */
export function clientSpan({ method: m, url, status, threw = false, thrown }) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  // Only http(s): for any other scheme (data:, mailto:) the path is the payload, which could be user text.
  if (!DEFAULT_PORT[u.protocol]) return null;
  const verb = method(typeof m === 'string' ? m.toUpperCase() : 'GET');
  const code = isStatus(status);
  const failed = threw || (code !== undefined && code >= 400);
  let errType;
  if (threw) errType = errorType(thrown);
  else if (failed) errType = String(code);
  const port = u.port !== '' ? Number(u.port) : DEFAULT_PORT[u.protocol];
  return {
    name: verb,
    attributes: pick(CLIENT_SPAN_KEYS, {
      'http.request.method': verb,
      'server.address': u.hostname.replace(/^\[|\]$/g, ''),
      'server.port': port,
      'url.full': `${u.protocol}//${u.host}${u.pathname}`,
      'http.response.status_code': code,
      'error.type': errType,
    }),
    status: failed ? ERROR : undefined,
  };
}
