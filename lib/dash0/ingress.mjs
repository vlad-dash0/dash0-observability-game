// Dash0 ingress validators, pure. The one authority for which hosts the game may send to:
// the validator's allowlist, and (test-enforced) the vercel.json connect-src origins.
// Spec: docs/DASH0-LAB.md. Inputs are never echoed in a result (the token especially).

// VERIFY (#195): the real per-region ingress hosts, exact, cited on www.dash0.com. Empty
// until the live phase; an empty list means live mode is "not open yet" and the CSP is
// unchanged.
export const INGRESS_HOSTS = Object.freeze([]);

// The simulated ingress of practice mode (see lib/otlp/practice-ingress.mjs). `.invalid` is
// reserved (RFC 2606), so it can never resolve to a real server.
export const PRACTICE_HOSTS = Object.freeze(['ingress.practice.dash0.invalid']);

// VERIFY (#195): the OTLP/HTTP port on the ingress (443 assumed; 4318 is the OTLP default).
export const INGRESS_PORTS = Object.freeze([443]);

const GRPC_PORT = '4317';
const SIGNAL_PATH = '/v1/traces';

// VERIFY (#195): the token prefix (`auth_` assumed). null skips the `prefix` check.
export const TOKEN_PREFIX = null;
// A sanity bound, not a Dash0 fact: shorter is certainly a truncated paste.
export const TOKEN_MIN_LENGTH = 8;
export const TOKEN_MAX_LENGTH = 4096;

// VERIFY (#195): the dataset header name (`Dash0-Dataset` assumed) lives in lib/otlp/send.mjs.
const DATASET_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

// reason -> teaching copy. The level feedback reads this table, so validator and copy cannot
// disagree. Keys are the only reasons the checks return.
export const REASONS = Object.freeze({
  empty: 'Nothing entered yet.',
  'grpc-port':
    'That is the gRPC shape (host:port, or port 4317). The game sends OTLP over HTTP; use the HTTP endpoint.',
  malformed: 'That is not a URL. Paste the full https:// endpoint.',
  'not-https': 'The endpoint must be https://. Telemetry and a token never travel in clear text.',
  credentials: 'Do not put a user name or password in the URL. The token goes in a header.',
  query: 'Leave the query string off; the endpoint is only scheme and host.',
  fragment: 'Leave the # fragment off; the endpoint is only scheme and host.',
  'unknown-host': 'That host is not a known Dash0 ingress. Check the region in your endpoint.',
  'unexpected-port': 'That port is not the OTLP/HTTP port of the ingress.',
  'signal-path':
    'That already ends in /v1/traces. Enter the base endpoint; the game appends the signal path.',
  'unexpected-path': 'The endpoint is only scheme and host, with no path.',
  'bearer-prefix': 'Paste only the token. The game adds "Bearer " itself.',
  whitespace: 'The token has a space or a line break in it. Copy it again without any.',
  characters: 'The token has characters that cannot go in an HTTP header.',
  prefix: 'That does not look like a Dash0 token.',
  length: 'That token is the wrong length.',
  format: 'Use letters, digits, - and _ only (a dataset slug), or leave it empty for the default.',
});

const fail = (reason) => ({ ok: false, reason });

// raw -> {ok:true, base, tracesUrl, host} | {ok:false, reason}. Reasons in check order:
// empty, grpc-port, malformed, not-https, credentials, query, fragment, unknown-host,
// unexpected-port, signal-path, unexpected-path. `hosts` is an exact match list (lookalikes
// fail). `allowLocal` (debug mode only) also accepts http://localhost:<port>.
export function parseEndpoint(
  raw,
  { hosts = INGRESS_HOSTS, ports = INGRESS_PORTS, allowLocal = false } = {},
) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return fail('empty');
  if (/^[^/\s:@]+:\d+(\/.*)?$/.test(text)) return fail('grpc-port');
  let url;
  try {
    url = new URL(text);
  } catch {
    return fail('malformed');
  }
  if (url.port === GRPC_PORT) return fail('grpc-port');
  const local = allowLocal && url.protocol === 'http:' && url.hostname === 'localhost';
  if (!local && url.protocol !== 'https:') {
    return fail(url.protocol === 'http:' ? 'not-https' : 'malformed');
  }
  if (url.username !== '' || url.password !== '') return fail('credentials');
  if (url.search !== '') return fail('query');
  if (url.hash !== '') return fail('fragment');
  if (!local) {
    if (!hosts.includes(url.hostname)) return fail('unknown-host');
    if (url.port !== '' && !ports.map(String).includes(url.port)) return fail('unexpected-port');
  } else if (url.port === '') {
    return fail('unexpected-port');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path === SIGNAL_PATH) return fail('signal-path');
  if (path !== '') return fail('unexpected-path');
  const base = `${url.protocol}//${url.host}`;
  return { ok: true, base, tracesUrl: base + SIGNAL_PATH, host: url.hostname };
}

// raw -> {ok:true} | {ok:false, reason}. Never contains the input. Reasons: empty,
// bearer-prefix, whitespace, characters, prefix (skipped while `prefix` is null), length.
export function checkToken(
  raw,
  { prefix = TOKEN_PREFIX, minLength = TOKEN_MIN_LENGTH, maxLength = TOKEN_MAX_LENGTH } = {},
) {
  if (typeof raw !== 'string' || raw === '') return fail('empty');
  if (/^\s*bearer\s/i.test(raw)) return fail('bearer-prefix');
  if (/\s/.test(raw)) return fail('whitespace');
  if (!/^[\x21-\x7e]+$/.test(raw)) return fail('characters');
  if (prefix != null && !raw.startsWith(prefix)) return fail('prefix');
  if (raw.length < minLength || raw.length > maxLength) return fail('length');
  return { ok: true };
}

// raw -> {ok:true, dataset: string|null} | {ok:false, reason}. Empty means the default
// dataset: dataset is null and the header is omitted by the sender.
export function checkDataset(raw) {
  if (raw == null || raw === '') return { ok: true, dataset: null };
  if (typeof raw !== 'string' || !DATASET_SLUG.test(raw)) return fail('format');
  return { ok: true, dataset: raw };
}
