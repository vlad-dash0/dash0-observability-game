// Dash0 ingress validators (lib/dash0/ingress.mjs). Spec: docs/DASH0-LAB.md. Hosts are
// injected: the module ships INGRESS_HOSTS empty until the live phase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INGRESS_HOSTS,
  INGRESS_PORTS,
  PRACTICE_HOSTS,
  REASONS,
  TOKEN_PREFIX,
  checkDataset,
  cspOrigin,
  checkToken,
  parseEndpoint,
} from '../lib/dash0/ingress.mjs';

const HOST = 'ingress.eu-west-1.aws.dash0.com';
const opts = { hosts: [HOST] };

test('a base endpoint gives tracesUrl with /v1/traces appended once', () => {
  const want = { ok: true, base: `https://${HOST}`, tracesUrl: `https://${HOST}/v1/traces`, host: HOST };
  for (const raw of [`https://${HOST}`, `https://${HOST}/`, `https://${HOST}//`, `  https://${HOST}/ `, `https://${HOST}:443`]) {
    assert.deepEqual(parseEndpoint(raw, opts), want, JSON.stringify(raw));
  }
});

test('each wrong shape names its reason', () => {
  const rows = [
    ['', 'empty'],
    ['   ', 'empty'],
    [`${HOST}:4317`, 'grpc-port'],
    // Scheme-less with any other port: the mistake is the missing https://, not gRPC.
    [`${HOST}:4318`, 'no-scheme'],
    [`${HOST}:443`, 'no-scheme'],
    [`${HOST}:4318/v1/traces`, 'no-scheme'],
    [`https://${HOST}:4317`, 'grpc-port'],
    [`http://${HOST}`, 'not-https'],
    [`https://u:p@${HOST}`, 'credentials'],
    [`https://${HOST}?a=1`, 'query'],
    [`https://${HOST}#x`, 'fragment'],
    ['https://evil.example', 'unknown-host'],
    [`https://${HOST}.evil.example`, 'unknown-host'],
    [`https://eu-west-1.aws.dash0.com`, 'unknown-host'],
    [`https://${HOST}:8443`, 'unexpected-port'],
    [`https://${HOST}/v1/traces`, 'signal-path'],
    [`https://${HOST}/v1/traces/`, 'signal-path'],
    // Case and doubled slashes do not hide the signal path.
    [`https://${HOST}/V1/Traces`, 'signal-path'],
    [`https://${HOST}//v1/traces`, 'signal-path'],
    [`https://${HOST}/v1//traces//`, 'signal-path'],
    [`https://${HOST}/v1/tracesx`, 'unexpected-path'],
    [`https://${HOST}/v1/metrics`, 'unexpected-path'],
    [`https://${HOST}/otlp`, 'unexpected-path'],
    ['not a url', 'malformed'],
    // Check order: the first failing check names the reason.
    ['http://u:p@evil.example/v1/traces?a=1', 'not-https'],
    ['https://u:p@evil.example/v1/traces?a=1', 'credentials'],
    ['https://evil.example:8443/v1/traces', 'unknown-host'],
  ];
  for (const [raw, reason] of rows) {
    assert.deepEqual(parseEndpoint(raw, opts), { ok: false, reason }, JSON.stringify(raw));
  }
  // Every reason the validators return has teaching copy.
  for (const [, reason] of rows) assert.equal(typeof REASONS[reason], 'string', reason);
  // The no-scheme copy names https://, and the gRPC copy is not reused for it.
  assert.match(REASONS['no-scheme'], /https:\/\//);
  assert.notEqual(REASONS['no-scheme'], REASONS['grpc-port']);
});

test('the port check uses the effective port: no port is 443', () => {
  const p4318 = { hosts: [HOST], ports: [4318] };
  assert.deepEqual(parseEndpoint(`https://${HOST}`, p4318), { ok: false, reason: 'unexpected-port' });
  assert.deepEqual(parseEndpoint(`https://${HOST}:443`, p4318), { ok: false, reason: 'unexpected-port' });
  assert.deepEqual(parseEndpoint(`https://${HOST}:4318/`, p4318), {
    ok: true, base: `https://${HOST}:4318`, tracesUrl: `https://${HOST}:4318/v1/traces`, host: HOST,
  });
  // The default list is 443: a no-port URL and an explicit :443 both pass, and both normalise.
  assert.deepEqual(INGRESS_PORTS, [443]);
  assert.equal(parseEndpoint(`https://${HOST}`, opts).ok, true);
  assert.equal(parseEndpoint(`https://${HOST}:443`, opts).base, `https://${HOST}`);
  assert.deepEqual(parseEndpoint(`https://${HOST}:4318`, opts), { ok: false, reason: 'unexpected-port' });
});

test('cspOrigin renders the CSP origin, with the port only when it is not 443', () => {
  assert.equal(cspOrigin(HOST), `https://${HOST}`);
  assert.equal(cspOrigin(HOST, 443), `https://${HOST}`);
  assert.equal(cspOrigin(HOST, 4318), `https://${HOST}:4318`);
  // It matches what parseEndpoint calls the base, so the CSP and the request agree.
  assert.equal(cspOrigin(HOST, 4318), parseEndpoint(`https://${HOST}:4318`, { hosts: [HOST], ports: [4318] }).base);
  assert.equal(cspOrigin(HOST, 443), parseEndpoint(`https://${HOST}:443`, opts).base);
});

test('the shipped allowlist is empty and frozen, so no live host validates yet; practice hosts never resolve', () => {
  assert.deepEqual(INGRESS_HOSTS, []);
  assert.ok(Object.isFrozen(INGRESS_HOSTS));
  assert.deepEqual(parseEndpoint(`https://${HOST}`), { ok: false, reason: 'unknown-host' });
  for (const h of PRACTICE_HOSTS) {
    assert.match(h, /\.invalid$/, 'practice hosts are RFC 2606 reserved');
    assert.ok(!INGRESS_HOSTS.includes(h));
  }
});

test('localhost passes only with allowLocal', () => {
  assert.deepEqual(parseEndpoint('http://localhost:4318', opts), { ok: false, reason: 'not-https' });
  assert.deepEqual(parseEndpoint('http://localhost:4318/', { ...opts, allowLocal: true }), {
    ok: true,
    base: 'http://localhost:4318',
    tracesUrl: 'http://localhost:4318/v1/traces',
    host: 'localhost',
  });
  // allowLocal opens plain http for localhost only, and only with a port.
  assert.deepEqual(parseEndpoint('http://evil.example:4318', { ...opts, allowLocal: true }), { ok: false, reason: 'not-https' });
  assert.deepEqual(parseEndpoint('http://localhost', { ...opts, allowLocal: true }), { ok: false, reason: 'unexpected-port' });
  assert.deepEqual(parseEndpoint(`https://${HOST}`, { ...opts, allowLocal: true }).ok, true);
});

test('checkToken reasons, and no result ever contains the input', () => {
  const SECRET = 'Zq9secretXy7Kp';
  const rows = [
    [`auth_${SECRET}`, { ok: true }],
    [`Bearer auth_${SECRET}`, { ok: false, reason: 'bearer-prefix' }],
    [`bearer auth_${SECRET}`, { ok: false, reason: 'bearer-prefix' }],
    [` auth_${SECRET}`, { ok: false, reason: 'whitespace' }],
    [`auth_${SECRET}\n`, { ok: false, reason: 'whitespace' }],
    [`auth_${SECRET.slice(0, 5)} ${SECRET.slice(5)}`, { ok: false, reason: 'whitespace' }],
    [`auth_${SECRET}é`, { ok: false, reason: 'characters' }],
    ['', { ok: false, reason: 'empty' }],
    [undefined, { ok: false, reason: 'empty' }],
    ['auth_Z', { ok: false, reason: 'length' }],
    // The shipped prefix is auth_: a token without it is not a Dash0 token.
    [SECRET, { ok: false, reason: 'prefix' }],
    [`Auth_${SECRET}`, { ok: false, reason: 'prefix' }],
    [`xauth_${SECRET}`, { ok: false, reason: 'prefix' }],
  ];
  for (const [raw, want] of rows) {
    const r = checkToken(raw);
    assert.deepEqual(r, want, JSON.stringify(raw));
    const text = JSON.stringify(r);
    assert.ok(!text.includes('Zq9s'), `result for ${JSON.stringify(raw)} echoes the token`);
    if (raw) assert.ok(!text.includes(JSON.stringify(raw).slice(1, -1)));
  }
  assert.equal(TOKEN_PREFIX, 'auth_');
  // The prefix check runs only when a prefix is set.
  assert.deepEqual(checkToken(SECRET, { prefix: null }), { ok: true });
  assert.deepEqual(checkToken(SECRET, { prefix: 'auth_' }), { ok: false, reason: 'prefix' });
  assert.deepEqual(checkToken(`auth_${SECRET}`, { prefix: 'auth_' }), { ok: true });
});

test('checkDataset: empty is the default dataset (null), a slug passes, anything else is format', () => {
  assert.deepEqual(checkDataset(''), { ok: true, dataset: null });
  assert.deepEqual(checkDataset(undefined), { ok: true, dataset: null });
  assert.deepEqual(checkDataset('prod-eu_1'), { ok: true, dataset: 'prod-eu_1' });
  for (const bad of ['has space', 'a/b', '-lead', 'x'.repeat(64), 'é']) {
    assert.deepEqual(checkDataset(bad), { ok: false, reason: 'format' }, bad);
  }
});
