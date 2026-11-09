// ID token verification. Spec: docs/FOUNDATION.md §2.9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIdToken, createJwksCache, JWKS_URL } from '../lib/auth/jwt.mjs';

const NOW = 1_800_000_000_000;
const SEC = Math.floor(NOW / 1000);
const CLIENT = 'client-1.apps.googleusercontent.com';
const NONCE = 'nonce-abc';
const subtle = globalThis.crypto.subtle;
const ALGO = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const enc = (obj) => b64u(new TextEncoder().encode(JSON.stringify(obj)));

const good = await subtle.generateKey(ALGO, true, ['sign', 'verify']);
const wrong = await subtle.generateKey(ALGO, true, ['sign', 'verify']);
const goodJwk = { ...(await subtle.exportKey('jwk', good.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

const baseClaims = () => ({
  iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234', nonce: NONCE,
  exp: SEC + 3600, iat: SEC - 10, email: 'Ada@dash0.com', email_verified: true, hd: 'dash0.com',
});

async function mint(claims = {}, { key = good.privateKey, header = {}, drop = [] } = {}) {
  const payload = { ...baseClaims(), ...claims };
  for (const d of drop) delete payload[d];
  const h = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header });
  const p = enc(payload);
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

const fakeFetch = (log, { maxAge = 3600, keys = [goodJwk], fail = false } = {}) => async (url) => {
  log.push(url);
  if (fail) throw new Error('network');
  return { ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'cache-control' ? `public, max-age=${maxAge}` : null) }, json: async () => ({ keys }) };
};

const jwksOf = (opts, state = { now: NOW }) => {
  const log = [];
  return { log, state, jwks: createJwksCache({ fetch: fakeFetch(log, opts), now: () => state.now }) };
};

async function check(token, extra = {}) {
  const { jwks } = jwksOf();
  return verifyIdToken(token, { jwks, clientId: CLIENT, nonce: NONCE, now: NOW, ...extra });
}

test('a valid token verifies and carries the claims', async () => {
  const r = await check(await mint());
  assert.equal(r.ok, true);
  assert.equal(r.claims.sub, '1234');
});

test('refusal reasons', async () => {
  const cases = [
    ['signature', await mint({}, { key: wrong.privateKey })],
    ['alg', await mint({}, { header: { alg: 'none' } })],
    ['alg', await mint({}, { header: { alg: 'HS256' } })],
    ['kid', await mint({}, { header: { kid: 'nope' } })],
    ['iss', await mint({ iss: 'https://evil' })],
    ['aud', await mint({ aud: 'someone-else' })],
    ['aud', await mint({ aud: [CLIENT, 'x'], azp: 'x' })],
    ['expired', await mint({ exp: SEC - 61 })],
    ['domain', await mint({}, { drop: ['hd'] })],
    ['domain', await mint({ hd: 'dash0.com.evil.com' })],
    ['domain', await mint({ hd: 'evildash0.com' })],
    ['domain', await mint({ email: 'ada@gmail.com' })],
    ['email', await mint({ email_verified: false })],
    ['email', await mint({ email_verified: 'true' })],
    ['nonce', await mint({ nonce: 'other' })],
    ['sub', await mint({ sub: '' })],
    ['iat', await mint({ iat: SEC + 120 })],
  ];
  for (const [reason, token] of cases) {
    const r = await check(token);
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason, `expected ${reason}, got ${r.reason}`);
  }
});

test('exp boundary: 59 s past is accepted, 61 s past is refused', async () => {
  assert.equal((await check(await mint({ exp: SEC - 59 }))).ok, true);
  assert.equal((await check(await mint({ exp: SEC - 61 }))).reason, 'expired');
});

test('an aud array is accepted only with a matching azp', async () => {
  assert.equal((await check(await mint({ aud: [CLIENT, 'x'], azp: CLIENT }))).ok, true);
});

test('malformed tokens give format and never throw', async () => {
  for (const t of ['a.b', '', 'a.b.c.d', undefined, null, 42, '!!!.@@@.###']) {
    const r = await check(t);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'format');
  }
});

test('JWKS: two verifies inside max-age make one fetch, one after it make two', async () => {
  const { jwks, log, state } = jwksOf();
  const token = await mint();
  const opts = { jwks, clientId: CLIENT, nonce: NONCE, now: NOW };
  assert.equal((await verifyIdToken(token, opts)).ok, true);
  assert.equal((await verifyIdToken(token, opts)).ok, true);
  assert.equal(log.length, 1);
  assert.equal(log[0], JWKS_URL);
  state.now += 3600 * 1000 + 1;
  assert.equal((await verifyIdToken(token, opts)).ok, true);
  assert.equal(log.length, 2);
});

test('JWKS: an unknown kid refetches once a minute at most', async () => {
  const { jwks, log, state } = jwksOf();
  const bad = await mint({}, { header: { kid: 'nope' } });
  const opts = { jwks, clientId: CLIENT, nonce: NONCE, now: NOW };
  assert.equal((await verifyIdToken(bad, opts)).reason, 'kid');
  assert.equal((await verifyIdToken(bad, opts)).reason, 'kid');
  assert.equal(log.length, 1);
  state.now += 61_000;
  assert.equal((await verifyIdToken(bad, opts)).reason, 'kid');
  assert.equal(log.length, 2);
});

test('JWKS: a fetch that throws, or a bad body, gives jwks', async () => {
  const { jwks } = jwksOf({ fail: true });
  const r = await verifyIdToken(await mint(), { jwks, clientId: CLIENT, nonce: NONCE, now: NOW });
  assert.deepEqual(r, { ok: false, reason: 'jwks' });
  const odd = createJwksCache({ fetch: async () => ({ ok: true, headers: { get: () => null }, json: async () => ({}) }), now: () => NOW });
  assert.equal((await verifyIdToken(await mint(), { jwks: odd, clientId: CLIENT, nonce: NONCE, now: NOW })).reason, 'jwks');
  const down = createJwksCache({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }), now: () => NOW });
  assert.equal((await verifyIdToken(await mint(), { jwks: down, clientId: CLIENT, nonce: NONCE, now: NOW })).reason, 'jwks');
});
