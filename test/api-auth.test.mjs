// Sign in with Google: api/auth-start.mjs, api/auth-callback.mjs, the auth cookie and the AUTH_STUB guard
// (#273 P3). Spec: docs/FOUNDATION.md §2.9. Everything runs over fakes: no network, no real Redis.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createAuthCallback } from '../api/auth-callback.mjs';
import { createAuthStart } from '../api/auth-start.mjs';
import { authConfig } from '../lib/auth/config.mjs';
import {
  AUTH_COOKIE, clearAuthCookie, serializeAuthCookie, signAuth, verifyAuth,
} from '../lib/auth/auth-cookie.mjs';
import { signSession, verifySession } from '../lib/auth/session.mjs';
import { defaultNickCandidates } from '../lib/account/nickname.mjs';
import { keys } from '../lib/account/store.mjs';
import {
  CLIENT, ENV, HOST, NOW, ORIGIN, SECRET, cookieValue, get, mint, rig, setCookie, signInFlow,
} from './helpers/auth-api.mjs';

const OTHER_SECRET = 'o'.repeat(48);
const AUTH = '__Host-oc-auth';
const SESSION = '__Host-oc-session';

// ---- the auth cookie ------------------------------------------------------------------

test('the auth cookie round-trips, expires, and is refused under another secret or a tampered body', async () => {
  const p = { state: 's', nonce: 'n', verifier: 'v', exp: NOW + 1000 };
  const v = await signAuth(p, SECRET);
  assert.match(v, /^a1\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(await verifyAuth(v, SECRET, NOW), p);
  assert.equal(await verifyAuth(v, OTHER_SECRET, NOW), null);
  assert.equal(await verifyAuth(v, SECRET, NOW + 1000), null, 'exp is exclusive');
  const [tag, , mac] = v.split('.');
  const forged = Buffer.from(JSON.stringify({ ...p, state: 'x' })).toString('base64url');
  assert.equal(await verifyAuth(`${tag}.${forged}.${mac}`, SECRET, NOW), null);
  assert.equal(await verifyAuth(`v1.${v.split('.')[1]}.${mac}`, SECRET, NOW), null, 'tag is part of the format');
});

test('the auth cookie and the session cookie never verify as each other', async () => {
  const auth = await signAuth({ state: 's', nonce: 'n', verifier: 'v', exp: NOW + 1000 }, SECRET);
  const session = await signSession({ pid: 'p', gen: '1', exp: NOW + 1000 }, SECRET);
  assert.equal(await verifySession(auth, SECRET, NOW), null);
  assert.equal(await verifyAuth(session, SECRET, NOW), null);
  // Same shape, other tag: a session body and MAC re-tagged `a1` (the MAC is over the old head) is refused,
  // and so is an `a1` value MACed with the raw secret (the key is derived, not shared).
  const [, sBody, sMac] = session.split('.');
  assert.equal(await verifyAuth(`a1.${sBody}.${sMac}`, SECRET, NOW), null);
  const body = Buffer.from(JSON.stringify({ state: 's', nonce: 'n', verifier: 'v', exp: NOW + 1000 })).toString('base64url');
  const raw = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Buffer.from(await globalThis.crypto.subtle.sign('HMAC', raw, new TextEncoder().encode(`a1.${body}`))).toString('base64url');
  assert.equal(await verifyAuth(`a1.${body}.${mac}`, SECRET, NOW), null, 'a MAC under the raw secret is not valid');
});

test('the auth cookie key is HKDF(SESSION_SECRET, label "oc-auth-cookie-v1"): a value made that way verifies', async () => {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(SECRET), 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('oc-auth-cookie-v1') },
    base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'],
  );
  const p = { state: 's', nonce: 'n', verifier: 'v', exp: NOW + 1000 };
  const head = `a1.${Buffer.from(JSON.stringify(p)).toString('base64url')}`;
  const mac = Buffer.from(await subtle.sign('HMAC', key, new TextEncoder().encode(head))).toString('base64url');
  assert.deepEqual(await verifyAuth(`${head}.${mac}`, SECRET, NOW), p);
  assert.equal(await signAuth(p, SECRET), `${head}.${mac}`, 'signing is deterministic over that key');
});

test('the auth cookie attributes', () => {
  assert.equal(serializeAuthCookie('x'), `${AUTH_COOKIE}=x; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  assert.equal(clearAuthCookie(), `${AUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
});

// ---- auth-start -----------------------------------------------------------------------

test('start: 302 to Google with every parameter, and the challenge is sha256 of the verifier in the cookie', async () => {
  const r = rig();
  const res = await r.start.GET(get(`${ORIGIN}/api/auth-start`));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(`${loc.origin}${loc.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(loc.searchParams);
  assert.deepEqual(Object.keys(q).sort(), [
    'client_id', 'code_challenge', 'code_challenge_method', 'hd', 'nonce', 'prompt', 'redirect_uri', 'response_type', 'scope', 'state',
  ]);
  assert.equal(q.client_id, CLIENT);
  assert.equal(q.redirect_uri, `${ORIGIN}/api/auth-callback`);
  assert.equal(q.response_type, 'code');
  assert.equal(q.scope, 'openid email');
  assert.equal(q.code_challenge_method, 'S256');
  assert.equal(q.hd, 'dash0.com');
  assert.equal(q.prompt, 'select_account');
  const cookie = setCookie(res, AUTH);
  assert.ok(cookie.endsWith('; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600'), cookie);
  const saved = await verifyAuth(cookieValue(res, AUTH), SECRET, NOW);
  assert.equal(saved.state, q.state);
  assert.equal(saved.nonce, q.nonce);
  assert.equal(q.code_challenge, createHash('sha256').update(saved.verifier).digest('base64url'));
  assert.equal(saved.exp, NOW + 600_000);
  assert.equal(r.fake.calls.length, 0, 'no store call');
  assert.equal(r.google.calls.length, 0, 'no Google call');
});

test('start: two starts make different state, nonce and verifier', async () => {
  const r = rig();
  const a = await verifyAuth(cookieValue(await r.start.GET(get(`${ORIGIN}/api/auth-start`)), AUTH), SECRET, NOW);
  const b = await verifyAuth(cookieValue(await r.start.GET(get(`${ORIGIN}/api/auth-start`)), AUTH), SECRET, NOW);
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.verifier, b.verifier);
});

test('start: unconfigured, a missing piece, a foreign host or no store all go to /?signin=unavailable with no cookie', async () => {
  const cases = [
    ['no env', rig({ env: {} })],
    ['no client id', rig({ env: { ...ENV, GOOGLE_CLIENT_ID: '' } })],
    ['no client secret', rig({ env: { ...ENV, GOOGLE_CLIENT_SECRET: undefined } })],
    ['short session secret', rig({ env: { ...ENV, SESSION_SECRET: 'x'.repeat(31) } })],
    ['http production origin', rig({ env: { ...ENV, AUTH_ORIGIN: 'http://oncall.example.test' } })],
  ];
  for (const [name, r] of cases) {
    const res = await r.start.GET(get(`${ORIGIN}/api/auth-start`));
    assert.equal(res.status, 302, name);
    assert.equal(res.headers.get('location'), '/?signin=unavailable', name);
    assert.equal(res.headers.getSetCookie().length, 0, name);
  }
  const r = rig();
  const preview = await r.start.GET(get('https://preview-abc.vercel.app/api/auth-start'));
  assert.equal(preview.headers.get('location'), '/?signin=unavailable', 'a host that is not AUTH_ORIGIN');
  assert.equal(preview.headers.getSetCookie().length, 0);
  const noStore = createAuthStart({ env: ENV, now: () => NOW, log: () => {} }); // no redis client, no store env
  assert.equal((await noStore.GET(get(`${ORIGIN}/api/auth-start`))).headers.get('location'), '/?signin=unavailable');
});

test('start: a store env alone is enough for the store (UPSTASH_* or KV_*), and POST is 405', async () => {
  const withUrl = createAuthStart({ env: { ...ENV, KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 't' }, now: () => NOW, log: () => {} });
  assert.equal((await withUrl.GET(get(`${ORIGIN}/api/auth-start`))).headers.get('location').startsWith('https://accounts.google.com/'), true);
  const res = await rig().start.GET(new Request(`${ORIGIN}/api/auth-start`, { method: 'POST' }));
  assert.equal(res.status, 405);
});

test('start: per-client rate limit sends the 101st request in 10 minutes to unavailable', async () => {
  const r = rig();
  const hit = () => r.start.GET(get(`${ORIGIN}/api/auth-start`, { 'x-forwarded-for': '1.2.3.4' }));
  for (let i = 0; i < 100; i++) assert.ok((await hit()).headers.get('location').startsWith('https://accounts.google.com/'));
  assert.equal((await hit()).headers.get('location'), '/?signin=unavailable');
});

test('start: only the per-IP limit applies: 100 distinct addresses all get Google, one address still stops at 100', async () => {
  const r = rig();
  const from = (ip) => r.start.GET(get(`${ORIGIN}/api/auth-start`, { 'x-forwarded-for': ip }));
  for (let i = 0; i < 100; i++) {
    assert.ok((await from(`10.1.0.${i}`)).headers.get('location').startsWith('https://accounts.google.com/'), `address ${i}`);
  }
  for (let i = 0; i < 99; i++) await from('10.1.0.0');
  assert.equal((await from('10.1.0.0')).headers.get('location'), '/?signin=unavailable');
});

test('start: an address over its limit stays refused after 2000+ other addresses in the window', async () => {
  const r = rig();
  const from = (ip) => r.start.GET(get(`${ORIGIN}/api/auth-start`, { 'x-forwarded-for': ip }));
  for (let i = 0; i < 100; i++) await from('9.9.9.9');
  assert.equal((await from('9.9.9.9')).headers.get('location'), '/?signin=unavailable');
  for (let i = 0; i < 2100; i++) await from(`10.${i >> 8}.${i & 255}.1`);
  assert.equal((await from('9.9.9.9')).headers.get('location'), '/?signin=unavailable', 'not evicted, not reset');
});

// ---- auth-callback --------------------------------------------------------------------

test('callback success: 302 to /?signin=ok with the session cookie and the auth cookie cleared', async () => {
  const r = rig();
  const { res } = await signInFlow(r);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/?signin=ok');
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(setCookie(res, SESSION).endsWith('; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000'));
  assert.ok(setCookie(res, AUTH).endsWith('Max-Age=0'));
  const session = await verifySession(cookieValue(res, SESSION), SECRET, NOW);
  const loaded = await r.store.loadProfile(session.pid);
  assert.equal(loaded.profile.nick, defaultNickCandidates('ada.lovelace@dash0.com')[0]);
  assert.equal(loaded.profile.listed, true, 'listed by default');
  assert.equal(session.gen, String(loaded.profile.gen));
});

test('callback success: the token request carries the code, the verifier, the secret and the redirect uri', async () => {
  const r = rig();
  const { startRes } = await signInFlow(r);
  const saved = await verifyAuth(cookieValue(startRes, AUTH), SECRET, NOW);
  const sent = new URLSearchParams(r.google.bodies[0]);
  assert.equal(sent.get('code'), 'the-code');
  assert.equal(sent.get('code_verifier'), saved.verifier);
  assert.equal(sent.get('client_secret'), 'client-secret');
  assert.equal(sent.get('client_id'), CLIENT);
  assert.equal(sent.get('redirect_uri'), `${ORIGIN}/api/auth-callback`);
  assert.equal(sent.get('grant_type'), 'authorization_code');
});

test('callback success: nothing stored holds the email, the local part or the name', async () => {
  const r = rig();
  await signInFlow(r);
  const dump = r.fake.dump();
  assert.ok(!dump.includes('@'), 'no @');
  assert.ok(!dump.includes('lovelace') && !dump.includes('ada.lovelace') && !dump.includes('dash0.com'), 'no part of the email');
  assert.ok(dump.includes('g-1'), 'the Google account id is kept (FOUNDATION §2.9)');
});

test('callback: a second sign-in returns the same account', async () => {
  const r = rig();
  const a = await verifySession(cookieValue((await signInFlow(r)).res, SESSION), SECRET, NOW);
  r.google.nonce = null;
  const b = await verifySession(cookieValue((await signInFlow(r)).res, SESSION), SECRET, NOW);
  assert.equal(a.pid, b.pid);
  assert.equal(r.fake.keys().filter((k) => k.startsWith(keys.profile(''))).length, 1);
});

test('callback: a state mismatch is failed and Google is never called', async () => {
  const r = rig();
  const { res } = await signInFlow(r, { query: { state: 'not-the-state' } });
  assert.equal(res.headers.get('location'), '/?signin=failed');
  assert.ok(setCookie(res, AUTH).endsWith('Max-Age=0'));
  assert.equal(setCookie(res, SESSION), null);
  assert.equal(r.google.calls.length, 0);
  assert.equal(r.fake.keys().length, 0);
});

test('callback: no state, no auth cookie, a session cookie in its place, or an expired auth cookie are all failed', async () => {
  const r = rig();
  const loc = async (opts) => (await signInFlow(r, opts)).res.headers.get('location');
  assert.equal(await loc({ query: { state: null } }), '/?signin=failed');
  assert.equal(await loc({ cookie: '' }), '/?signin=failed');
  const session = await signSession({ pid: 'p', gen: '1', exp: NOW + 1000 }, SECRET);
  assert.equal(await loc({ cookie: `${AUTH}=${session}` }), '/?signin=failed');
  const old = await signAuth({ state: 'st', nonce: 'n', verifier: 'v', exp: NOW - 1 }, SECRET);
  assert.equal(await loc({ cookie: `${AUTH}=${old}`, query: { state: 'st' } }), '/?signin=failed');
  assert.equal(r.google.calls.length, 0);
});

test('callback: a gmail account is domain and nothing is stored', async () => {
  const r = rig();
  r.google.claims = { email: 'ada@gmail.com', hd: undefined };
  const { res } = await signInFlow(r);
  assert.equal(res.headers.get('location'), '/?signin=domain');
  assert.equal(setCookie(res, SESSION), null);
  assert.equal(r.fake.keys().length, 0);
});

test('callback: Google access_denied is cancelled, any other error is failed, a missing code is failed', async () => {
  const r = rig();
  const loc = async (query) => (await signInFlow(r, { query })).res.headers.get('location');
  assert.equal(await loc({ error: 'access_denied', code: null }), '/?signin=cancelled');
  assert.equal(await loc({ error: 'server_error', code: null }), '/?signin=failed');
  assert.equal(await loc({ code: null }), '/?signin=failed');
  assert.equal(await loc({ code: 'x'.repeat(2049) }), '/?signin=failed');
  assert.equal(r.google.calls.length, 0);
  const forged = await signInFlow(r, { query: { error: 'access_denied', code: null, state: 'wrong' } });
  assert.equal(forged.res.headers.get('location'), '/?signin=failed', 'cancelled needs the state too');
});

test('callback: the token endpoint refusing is failed; unreachable, timing out or a 5xx is unavailable', async () => {
  const run = async (set) => {
    const r = rig();
    set(r.google);
    return (await signInFlow(r)).res.headers.get('location');
  };
  assert.equal(await run((g) => { g.tokenStatus = 400; }), '/?signin=failed');
  assert.equal(await run((g) => { g.tokenStatus = 500; }), '/?signin=unavailable', 'exactly 500');
  assert.equal(await run((g) => { g.tokenStatus = 499; }), '/?signin=failed');
  assert.equal(await run((g) => { g.tokenStatus = 503; }), '/?signin=unavailable');
  assert.equal(await run((g) => { g.tokenThrows = true; }), '/?signin=unavailable');
  assert.equal(await run((g) => { g.token = 'not-a-jwt'; }), '/?signin=failed');
});

test('callback: a token request that stalls is aborted at the timeout and is unavailable', async () => {
  const r = rig();
  r.google.tokenHangs = true;
  const started = Date.now();
  const { res } = await signInFlow(r);
  assert.equal(res.headers.get('location'), '/?signin=unavailable');
  assert.ok(Date.now() - started < 2000, 'it did not wait for Google');
  assert.equal(setCookie(res, SESSION), null);
});

test('callback: the unconfigured, foreign-host and 405 exits clear the auth cookie too', async () => {
  const off = createAuthCallback({ env: {}, now: () => NOW, log: () => {} });
  const r = rig();
  const exits = [
    await off.GET(get(`${ORIGIN}/api/auth-callback?code=c&state=s`)),
    await r.callback.GET(get('https://preview.vercel.app/api/auth-callback?code=c&state=s')),
    await r.callback.GET(new Request(`${ORIGIN}/api/auth-callback`, { method: 'POST' })),
  ];
  for (const res of exits) assert.ok(setCookie(res, AUTH).endsWith('Max-Age=0'), String(res.status));
});

test('callback: the stub code is "stub" only; another code with the stub env is failed', async () => {
  const r = rig({ env: STUB_ENV });
  const startRes = await r.start.GET(get(`${LOCAL}/api/auth-start`));
  const state = new URL(startRes.headers.get('location')).searchParams.get('state');
  const cookie = `${AUTH}=${cookieValue(startRes, AUTH)}`;
  const res = await r.callback.GET(get(`${LOCAL}/api/auth-callback?code=other&state=${state}`, { cookie }));
  assert.equal(res.headers.get('location'), '/?signin=failed');
  assert.equal(setCookie(res, SESSION), null);
  assert.equal(r.fake.keys().length, 0);
});

test('callback: an ID token the verifier refuses is failed (wrong nonce, wrong audience, unverified email); no keys is unavailable', async () => {
  const run = async (set) => {
    const r = rig();
    set(r.google);
    const out = await signInFlow(r);
    assert.equal(setCookie(out.res, SESSION), null);
    assert.equal(r.fake.keys().length, 0);
    return out.res.headers.get('location');
  };
  assert.equal(await run((g) => { g.nonce = 'someone-elses'; }), '/?signin=failed', 'nonce');
  assert.equal(await run((g) => { g.claims = { aud: 'other-client' }; }), '/?signin=failed', 'aud');
  assert.equal(await run((g) => { g.claims = { email_verified: false }; }), '/?signin=failed', 'email');
  assert.equal(await run((g) => { g.jwksThrows = true; }), '/?signin=unavailable', 'jwks');
});

test('callback: the store down is unavailable and sets no session', async () => {
  const r = rig();
  r.fake.fail = 'throw';
  const { res } = await signInFlow(r);
  assert.equal(res.headers.get('location'), '/?signin=unavailable');
  assert.equal(setCookie(res, SESSION), null);
  assert.ok(setCookie(res, AUTH).endsWith('Max-Age=0'));
});

test('callback: unconfigured or a foreign host is unavailable; POST is 405', async () => {
  const off = createAuthCallback({ env: {}, now: () => NOW, log: () => {} });
  assert.equal((await off.GET(get(`${ORIGIN}/api/auth-callback?code=c&state=s`))).headers.get('location'), '/?signin=unavailable');
  const r = rig();
  assert.equal((await r.callback.GET(get('https://preview.vercel.app/api/auth-callback?code=c&state=s'))).headers.get('location'), '/?signin=unavailable');
  assert.equal((await r.callback.GET(new Request(`${ORIGIN}/api/auth-callback`, { method: 'POST' }))).status, 405);
});

test('logs are one line per request and never hold an address, id, nickname, code or cookie', async () => {
  const r = rig();
  const { res } = await signInFlow(r);
  const session = await verifySession(cookieValue(res, SESSION), SECRET, NOW);
  const profile = (await r.store.loadProfile(session.pid)).profile;
  assert.equal(r.logs.length, 2);
  for (const line of r.logs) {
    assert.deepEqual(Object.keys(line).sort(), ['ms', 'msg', 'outcome', 'status']);
    const text = JSON.stringify(line);
    for (const secret of [session.pid, 'g-1', profile.nick, 'lovelace', 'dash0.com', 'the-code', 'oc-']) assert.ok(!text.includes(secret), `${text} holds ${secret}`);
  }
  assert.deepEqual(r.logs.map((l) => l.outcome), ['redirected', 'created']);
});

// ---- AUTH_STUB ------------------------------------------------------------------------

const LOCAL = 'http://localhost:3000';
const STUB_ENV = { AUTH_STUB: '1', AUTH_ORIGIN: LOCAL, SESSION_SECRET: SECRET };

test('stub: start goes straight to the callback and sign-in makes dev@dash0.com, with no Google call', async () => {
  const r = rig({ env: STUB_ENV });
  const startRes = await r.start.GET(get(`${LOCAL}/api/auth-start`));
  const loc = new URL(startRes.headers.get('location'));
  assert.equal(`${loc.origin}${loc.pathname}`, `${LOCAL}/api/auth-callback`);
  assert.equal(loc.searchParams.get('code'), 'stub');
  const cookie = `${AUTH}=${cookieValue(startRes, AUTH)}`;
  const res = await r.callback.GET(get(`${LOCAL}/api/auth-callback?${loc.searchParams}`, { cookie }));
  assert.equal(res.headers.get('location'), '/?signin=ok');
  const session = await verifySession(cookieValue(res, SESSION), SECRET, NOW);
  assert.equal((await r.store.loadProfile(session.pid)).profile.nick, defaultNickCandidates('dev@dash0.com')[0]);
  assert.ok(r.fake.dump().includes('stub-dev'));
  assert.equal(r.google.calls.length, 0);
  // the state is still checked in the stub
  const bad = await r.callback.GET(get(`${LOCAL}/api/auth-callback?code=stub&state=nope`, { cookie }));
  assert.equal(bad.headers.get('location'), '/?signin=failed');
});

test('stub: honoured only when AUTH_STUB is exactly 1 and AUTH_ORIGIN is http://localhost', () => {
  assert.equal(authConfig(STUB_ENV).stub, true);
  assert.equal(authConfig({ ...STUB_ENV, AUTH_ORIGIN: 'http://localhost' }).stub, true, 'any port');
  assert.equal(authConfig({ ...STUB_ENV, AUTH_STUB: 'true' }), null, 'only "1"; and no Google settings');
  assert.equal(authConfig({ ...STUB_ENV, AUTH_STUB: undefined }), null);
  for (const origin of [ORIGIN, 'https://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost.evil.test', 'http://evil.test']) {
    assert.equal(authConfig({ ...STUB_ENV, AUTH_ORIGIN: origin }), null, origin);
    // with the real Google settings, a non-local origin gets the real flow, never the stub
    const real = authConfig({ ...ENV, AUTH_STUB: '1', AUTH_ORIGIN: origin });
    assert.ok(real === null || real.stub === false, origin);
  }
  assert.equal(authConfig({ ...ENV, AUTH_STUB: '1' }).stub, false, 'production origin plus AUTH_STUB=1 is the real flow');
});

test('stub: a production-looking env with AUTH_STUB=1 still sends the browser to Google', async () => {
  const r = rig({ env: { ...ENV, AUTH_STUB: '1' } });
  const res = await r.start.GET(get(`${ORIGIN}/api/auth-start`));
  assert.ok(res.headers.get('location').startsWith('https://accounts.google.com/'));
  const { res: cb } = await signInFlow(r, { query: { code: 'stub' } });
  assert.equal(r.google.bodies.length, 1, 'the code goes to Google, not the stub');
  assert.equal(cb.status, 302);
});

test('the dev server under AUTH_STUB signs in end to end over HTTP, and refuses without it', async () => {
  const { once } = await import('node:events');
  const { request } = await import('node:http');
  const { startServer } = await import('../tools/serve.mjs');
  const call = (port, path, headers = {}, method = 'GET', body) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error(`no response for ${path}`)));
    req.end(body);
  });
  const jar = (res) => (res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');
  const on = startServer({ port: 0, log: () => {}, authStub: true });
  const off = startServer({ port: 0, log: () => {}, authStub: false, env: {} }); // the real functions over an empty env
  let customPort = 0;
  const custom = startServer({ // the real functions over a chosen env: only an honoured `env` option can make this configured
    port: 0, log: () => {}, authStub: false,
    env: { ...ENV, KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 't', get AUTH_ORIGIN() { return `http://localhost:${customPort}`; } },
  });
  await Promise.all([once(on, 'listening'), once(off, 'listening'), once(custom, 'listening')]);
  customPort = custom.address().port;
  try {
    const port = on.address().port;
    assert.deepEqual(JSON.parse((await call(port, '/api/account')).body), { v: 1, configured: true, signedIn: false });
    const start = await call(port, '/api/auth-start');
    assert.equal(start.status, 302);
    const next = new URL(start.headers.location);
    assert.equal(next.origin, `http://localhost:${port}`);
    const back = await call(port, `${next.pathname}${next.search}`, { cookie: jar(start) });
    assert.equal(back.headers.location, '/?signin=ok');
    assert.equal(back.headers['set-cookie'].length, 2, 'both cookies arrive');
    const me = JSON.parse((await call(port, '/api/account', { cookie: jar(back) })).body);
    assert.equal(me.signedIn, true);
    assert.match(me.nick, /^[A-Za-z0-9][\w-]{2,19}$/);
    // nothing is configured without the stub
    const dead = await call(off.address().port, '/api/account');
    assert.deepEqual(JSON.parse(dead.body), { v: 1, configured: false });
    assert.equal((await call(off.address().port, '/api/auth-start')).headers.location, '/?signin=unavailable');
    assert.deepEqual(JSON.parse((await call(customPort, '/api/account')).body), { v: 1, configured: true, signedIn: false });
  } finally {
    on.close();
    off.close();
    custom.close();
  }
});
