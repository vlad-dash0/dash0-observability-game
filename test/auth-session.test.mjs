// Signed session cookie. Spec: docs/FOUNDATION.md §2.9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_COOKIE, SESSION_MAX_AGE, sessionSecret, signSession, verifySession,
  serializeSessionCookie, clearSessionCookie, readSessionCookie,
} from '../lib/auth/session.mjs';

const NOW = 1_800_000_000_000;
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const payload = { pid: 'pid-1', gen: 'g1', exp: NOW + 1000 };

test('sign with A and verify with A gives the payload; with B gives null', async () => {
  const v = await signSession(payload, A);
  assert.match(v, /^v1\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(await verifySession(v, A, NOW), payload);
  assert.equal(await verifySession(v, B, NOW), null);
});

test('a tampered byte gives null', async () => {
  const v = await signSession(payload, A);
  const [p0, body, sig] = v.split('.');
  const forged = Buffer.from(JSON.stringify({ ...payload, pid: 'pid-2' })).toString('base64url');
  assert.equal(await verifySession(`${p0}.${forged}.${sig}`, A, NOW), null);
  const flip = sig[0] === 'A' ? 'B' : 'A';
  assert.equal(await verifySession(`${p0}.${body}.${flip}${sig.slice(1)}`, A, NOW), null);
  assert.equal(await verifySession(`v2.${body}.${sig}`, A, NOW), null);
});

test('malformed input gives null and never throws', async () => {
  for (const v of ['', 'v1', 'v1.a', 'v1.a.b.c', undefined, null, 7, 'v1.!!.!!']) {
    assert.equal(await verifySession(v, A, NOW), null);
  }
});

test('exp boundary: valid before exp, null at exp', async () => {
  const v = await signSession(payload, A);
  assert.notEqual(await verifySession(v, A, payload.exp - 1), null);
  assert.equal(await verifySession(v, A, payload.exp), null);
});

test('a validly signed payload of the wrong shape gives null', async () => {
  for (const bad of [{ pid: '', gen: 'g', exp: NOW + 5 }, { pid: 'p', gen: 'g' }, { pid: 'p', gen: 'g', exp: 'x' }]) {
    assert.equal(await verifySession(await signSession(bad, A), A, NOW), null);
  }
});

test('the cookie carries exactly the pinned attributes', () => {
  const c = serializeSessionCookie('v1.x.y');
  assert.equal(SESSION_COOKIE, '__Host-oc-session');
  assert.equal(SESSION_MAX_AGE, 2592000);
  assert.equal(c, '__Host-oc-session=v1.x.y; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000');
});

test('clearing sets Max-Age=0', () => {
  const c = clearSessionCookie();
  assert.match(c, /^__Host-oc-session=; /);
  assert.match(c, /HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=0$/);
});

test('a secret under 32 bytes is not configured', () => {
  assert.equal(sessionSecret({ SESSION_SECRET: 'a'.repeat(31) }), null);
  assert.equal(sessionSecret({}), null);
  assert.equal(sessionSecret({ SESSION_SECRET: 'a'.repeat(32) }), 'a'.repeat(32));
  assert.equal(sessionSecret({ SESSION_SECRET: 'é'.repeat(16) }), 'é'.repeat(16));
  assert.equal(sessionSecret({ SESSION_SECRET: 'é'.repeat(15) }), null);
});

test('signing refuses an unconfigured secret rather than signing with it', async () => {
  await assert.rejects(() => signSession(payload, 'short'));
  assert.equal(await verifySession('v1.a.b', 'short', NOW), null);
});

test('readSessionCookie picks the session cookie out of a header', () => {
  assert.equal(readSessionCookie('a=1; __Host-oc-session=v1.x.y; b=2'), 'v1.x.y');
  assert.equal(readSessionCookie('a=1'), null);
  assert.equal(readSessionCookie(undefined), null);
});
