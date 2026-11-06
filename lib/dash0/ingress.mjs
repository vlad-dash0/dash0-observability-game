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

// Dash0 auth tokens start with `auth_`:
// https://www.dash0.com/docs/dash0/miscellaneous/glossary/auth-tokens
export const TOKEN_PREFIX = 'auth_';
// A sanity bound, not a Dash0 fact: shorter is certainly a truncated paste.
export const TOKEN_MIN_LENGTH = 8;
export const TOKEN_MAX_LENGTH = 4096;

// The dataset header (`Dash0-Dataset`) lives in lib/otlp/send.mjs; datasets are described at
// https://www.dash0.com/docs/dash0/miscellaneous/glossary/datasets.
// VERIFY (#195): this regex is the game's own check, not a confirmed Dash0 rule.
const DATASET_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

// reason -> teaching copy. The level feedback reads this table, so validator and copy cannot
// disagree. Keys are the only reasons the checks return.
export const REASONS = Object.freeze({
  empty: 'Nothing entered yet.',
  'grpc-port':
    '4317 is the default OTLP/gRPC port. The game sends from a browser tab, and a browser cannot make gRPC calls, ' +
    'so it needs the OTLP over HTTP endpoint. Copy the other endpoint.',
  'no-scheme': 'That has no https://. Paste the full https:// endpoint.',
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
  length: 'That does not look like a complete token (too short or too long).',
  // The game's own check, not a Dash0 fact.
  format:
    'A dataset identifier uses letters, digits, - and _, starts with a letter or digit, and is at most 63 characters.',
});

// The CSP connect-src origin for a host and port: the default https port is left implicit.
export function cspOrigin(host, port = 443) {
  return Number(port) === 443 ? `https://${host}` : `https://${host}:${port}`;
}

const fail = (reason) => ({ ok: false, reason });

// raw -> {ok:true, base, tracesUrl, host} | {ok:false, reason}. Reasons in check order:
// empty, grpc-port (scheme-less input, or any scheme with port 4317), no-scheme, malformed,
// not-https, credentials, query, fragment, unknown-host, unexpected-port, signal-path,
// unexpected-path. `hosts` is an exact match list (lookalikes fail). `allowLocal` (debug mode only) also accepts http://localhost:<port>.
export function parseEndpoint(
  raw,
  { hosts = INGRESS_HOSTS, ports = INGRESS_PORTS, allowLocal = false } = {},
) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return fail('empty');
  // Spec: https://opentelemetry.io/docs/specs/otlp/ (default ports: 4317 gRPC, 4318 HTTP).
  // A bare host with an optional port and path. A host without a dot needs the port, so a
  // plain word stays malformed.
  const bare = /^([^/\s:@]+)(?::(\d+))?(?:\/.*)?$/.exec(text);
  if (bare && (bare[1].includes('.') || bare[2] !== undefined)) {
    return fail(bare[2] === GRPC_PORT ? 'grpc-port' : 'no-scheme');
  }
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
    const effective = url.port || '443';
    if (!ports.map(String).includes(effective)) return fail('unexpected-port');
  } else if (url.port === '') {
    return fail('unexpected-port');
  }
  const path = url.pathname.replace(/\/+/g, '/').replace(/\/$/, '');
  if (path.toLowerCase() === SIGNAL_PATH) return fail('signal-path');
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
