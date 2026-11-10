// api/account.mjs (#273 P3): who is signed in, and sign out, nickname, listing and delete.
// Spec: docs/FOUNDATION.md §2.9 and its reason mapping. Over fake Redis; no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccount } from '../api/account.mjs';
import { keys } from '../lib/account/store.mjs';
import { ENV, NOW, ORIGIN, get, post, rig, setCookie } from './helpers/auth-api.mjs';

const URL_ = `${ORIGIN}/api/account`;
const SESSION = '__Host-oc-session';
const CLEARED = `${SESSION}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

async function signedIn(over = {}) {
  const r = rig(over);
  const { profile } = await r.store.signIn('g-1', 'ada.lovelace@dash0.com');
  const cookie = await r.cookieFor(profile.pid);
  return { r, pid: profile.pid, profile, cookie };
}
const json = async (res) => res.json();
const act = (r, cookie, body, headers = {}) => r.account.POST(post(URL_, { v: 1, ...body }, { cookie, ...headers }));

// ---- GET ------------------------------------------------------------------------------

test('GET unconfigured is {v:1, configured:false}, with no store call', async () => {
  const r = rig({ env: {} });
  const res = await r.account.GET(get(URL_));
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { v: 1, configured: false });
  assert.equal(r.fake.calls.length, 0);
  const preview = await rig().account.GET(get('https://preview.vercel.app/api/account'));
  assert.deepEqual(await json(preview), { v: 1, configured: false }, 'a host that cannot sign in looks unconfigured');
});

test('GET without a cookie is signed out and makes ZERO store calls', async () => {
  const r = rig();
  const res = await r.account.GET(get(URL_));
  assert.deepEqual(await json(res), { v: 1, configured: true, signedIn: false });
  assert.equal(r.fake.calls.length, 0);
  assert.equal(res.headers.getSetCookie().length, 0);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('GET signed in gives nick and listed, never a pid or an email', async () => {
  const { r, profile, cookie } = await signedIn();
  const res = await r.account.GET(get(URL_, { cookie }));
  assert.deepEqual(await json(res), { v: 1, configured: true, signedIn: true, nick: profile.nick, listed: true });
  const text = JSON.stringify(await r.account.GET(get(URL_, { cookie })).then(json));
  assert.ok(!text.includes(profile.pid) && !text.includes('@'));
});

test('GET with a bad, expired, stale-gen or deleted-account cookie is signed out and clears the cookie', async () => {
  const { r, pid, cookie } = await signedIn();
  const forged = `${SESSION}=v1.${Buffer.from('{}').toString('base64url')}.AAAA`;
  const expired = await r.cookieFor(pid, { exp: NOW - 1 });
  const stale = await r.cookieFor(pid, { gen: '2' });
  for (const [name, c] of [['forged', forged], ['expired', expired], ['stale gen', stale]]) {
    const res = await r.account.GET(get(URL_, { cookie: c }));
    assert.deepEqual(await json(res), { v: 1, configured: true, signedIn: false }, name);
    assert.equal(setCookie(res, SESSION), CLEARED, name);
  }
  await act(r, cookie, { action: 'delete', confirm: 'delete' });
  const after = await r.account.GET(get(URL_, { cookie }));
  assert.deepEqual(await json(after), { v: 1, configured: true, signedIn: false });
  assert.equal(setCookie(after, SESSION), CLEARED);
});

test('GET with the store down and a valid cookie is 502, not signed out, and keeps the cookie', async () => {
  const { r, cookie } = await signedIn();
  for (const mode of ['throw', 'http500', 'error']) {
    r.fake.fail = mode;
    const res = await r.account.GET(get(URL_, { cookie }));
    assert.equal(res.status, 502, mode);
    assert.deepEqual(await json(res), { error: 'store-unavailable' });
    assert.equal(res.headers.getSetCookie().length, 0, 'the cookie is not cleared on an outage');
  }
});

// ---- POST gates -----------------------------------------------------------------------

test('POST: a missing Origin is 403, a foreign Origin is 403, even with a valid session', async () => {
  const { r, cookie } = await signedIn();
  const noOrigin = new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{"v":1,"action":"signout"}' });
  assert.equal((await r.account.POST(noOrigin)).status, 403);
  assert.equal((await act(r, cookie, { action: 'signout' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await act(r, cookie, { action: 'signout' }, { origin: 'null' })).status, 403);
  assert.equal((await act(r, cookie, { action: 'signout' }, { origin: 'not a url' })).status, 403);
  assert.equal((await act(r, cookie, { action: 'signout' })).status, 200, 'the right Origin passes');
});

test('POST: Origin is checked against AUTH_ORIGIN, not the Host header', async () => {
  const { r, cookie } = await signedIn();
  const res = await r.account.POST(post(`https://evil.test/api/account`, { v: 1, action: 'signout' }, { cookie, origin: 'https://evil.test', host: 'evil.test' }));
  assert.equal(res.status, 403);
});

test('POST: no CORS headers are ever sent', async () => {
  const { r, cookie } = await signedIn();
  for (const res of [await act(r, cookie, { action: 'signout' }), await act(r, cookie, { action: 'signout' }, { origin: 'https://evil.test' })]) {
    assert.ok([...res.headers.keys()].every((k) => !k.startsWith('access-control-')));
  }
});

test('POST: text/plain and form types are 415; a missing type is 415', async () => {
  const { r, cookie } = await signedIn();
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    const res = await r.account.POST(post(URL_, '{"v":1,"action":"signout"}', { cookie, 'content-type': type }));
    assert.equal(res.status, 415, type);
  }
  const none = await r.account.POST(new Request(URL_, { method: 'POST', headers: { origin: ORIGIN, cookie }, body: '{}' }));
  assert.equal(none.status, 415);
  assert.equal((await r.account.POST(post(URL_, '{"v":1,"action":"signout"}', { cookie, 'content-type': 'application/json; charset=utf-8' }))).status, 200);
});

test('POST: bodies that are too big, not JSON, or the wrong shape are refused with the field', async () => {
  const { r, cookie } = await signedIn();
  const send = (body) => r.account.POST(post(URL_, body, { cookie }));
  assert.equal((await send('x'.repeat(2000))).status, 413);
  const bad = async (body, field) => {
    const res = await send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await json(res), { ok: false, error: 'bad-request', field });
  };
  await bad('not json', 'body');
  await bad('[]', 'body');
  await bad({ action: 'signout' }, 'v');
  await bad({ v: 2, action: 'signout' }, 'v');
  await bad({ v: 1, action: 'explode' }, 'action');
  await bad({ v: 1, action: 'toString' }, 'action');
  await bad({ v: 1, action: 'signout', extra: 1 }, 'body');
  await bad({ v: 1, action: 'nickname', nick: 5 }, 'nick');
  await bad({ v: 1, action: 'nickname', nick: 'abc', pid: 'x' }, 'body');
  await bad({ v: 1, action: 'listing', listed: 'yes' }, 'listed');
  await bad({ v: 1, action: 'delete', confirm: 'yes' }, 'confirm');
  await bad({ v: 1, action: 'delete' }, 'confirm');
});

test('POST: GET-only and POST-only methods answer 405 with Allow; unconfigured POST is 503', async () => {
  const { r } = await signedIn();
  assert.equal((await r.account.POST(get(URL_))).status, 405);
  assert.equal((await r.account.GET(new Request(URL_, { method: 'POST' }))).headers.get('allow'), 'GET');
  const off = createAccount({ env: {}, now: () => NOW, log: () => {} });
  assert.equal((await off.POST(post(URL_, { v: 1, action: 'signout' }))).status, 503);
});

// ---- POST actions ---------------------------------------------------------------------

test('signout clears the cookie, needs no store, and works even for a dead cookie', async () => {
  const r = rig();
  const res = await act(r, 'x=1', { action: 'signout' });
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { v: 1, ok: true });
  assert.equal(setCookie(res, SESSION), CLEARED);
  assert.equal(r.fake.calls.length, 0);
});

test('the other actions need a live session: none, forged and deleted all get 401 and a cleared cookie', async () => {
  const { r, pid, cookie } = await signedIn();
  const body = { action: 'listing', listed: false };
  for (const c of ['', `${SESSION}=v1.e30.AAAA`, await r.cookieFor(pid, { gen: '9' })]) {
    const res = await act(r, c, body);
    assert.equal(res.status, 401);
    assert.deepEqual(await json(res), { error: 'unauthenticated' });
    assert.equal(setCookie(res, SESSION), CLEARED);
  }
  assert.equal((await r.store.loadProfile(pid)).profile.listed, true, 'nothing changed');
  r.fake.fail = 'throw';
  assert.equal((await act(r, cookie, body)).status, 502, 'store down with a valid cookie is 502, not 401');
});

test('nickname: changes it, frees the old one, 409 when taken, 400 with field nick for format, reserved and blocked', async () => {
  const { r, pid, cookie } = await signedIn();
  const set = async (nick) => act(r, cookie, { action: 'nickname', nick });
  const ok = await set('Grace-Hop');
  assert.equal(ok.status, 200);
  assert.deepEqual(await json(ok), { v: 1, ok: true, nick: 'Grace-Hop' });
  assert.equal((await r.store.loadProfile(pid)).profile.nick, 'Grace-Hop');
  const { profile: other } = await r.store.signIn('g-2', 'bob@dash0.com');
  const otherCookie = await r.cookieFor(other.pid);
  const taken = await act(r, otherCookie, { action: 'nickname', nick: 'grace-hop' });
  assert.equal(taken.status, 409, 'compared on the lowercase key');
  assert.deepEqual(await json(taken), { ok: false, error: 'nick-taken' });
  for (const [nick, reason] of [['ab', 'format'], ['has space', 'format'], ['admin', 'reserved'], ['o11y-king', 'reserved']]) {
    const res = await set(nick);
    assert.equal(res.status, 400, nick);
    const out = await json(res);
    assert.equal(out.field, 'nick');
    assert.equal(out.reason, reason);
  }
  assert.equal((await r.store.loadProfile(pid)).profile.nick, 'Grace-Hop', 'refusals change nothing');
});

test('nickname: 10 changes an hour, the 11th is 429 with retry-after; the next hour starts over', async () => {
  const { r, pid } = await signedIn();
  const cookie = await r.cookieFor(pid, { exp: NOW + 10_000_000 });
  for (let i = 0; i < 10; i++) assert.equal((await act(r, cookie, { action: 'nickname', nick: `nick-${i}x` })).status, 200, `change ${i}`);
  const limited = await act(r, cookie, { action: 'nickname', nick: 'nick-over' });
  assert.equal(limited.status, 429);
  const wait = Number(limited.headers.get('retry-after'));
  assert.ok(wait >= 1 && wait <= 3600);
  assert.equal((await json(limited)).retryAfterS, wait);
  r.clock.t += 3600_000;
  assert.equal((await act(r, cookie, { action: 'nickname', nick: 'nick-later' })).status, 200);
});

test('nickname: the rate limiter failing closed is 502', async () => {
  const { r, cookie } = await signedIn();
  r.fake.fail = 'throw';
  assert.equal((await act(r, cookie, { action: 'nickname', nick: 'whoever' })).status, 502);
});

test('listing: hides and shows the player on the board', async () => {
  const { r, pid, cookie } = await signedIn();
  await r.store.putProgress(pid, { v: 1, cards: [], levels: { s1: { stars: 3, at: '2026-06-01T00:00:00.000Z' } } });
  assert.equal((await r.store.leaderboard({})).size, 1);
  const hide = await act(r, cookie, { action: 'listing', listed: false });
  assert.deepEqual(await json(hide), { v: 1, ok: true, listed: false });
  assert.equal((await r.store.leaderboard({})).size, 0);
  assert.equal((await r.account.GET(get(URL_, { cookie })).then(json)).listed, false);
  await act(r, cookie, { action: 'listing', listed: true });
  assert.equal((await r.store.leaderboard({})).size, 1);
});

test('delete removes every key for the player, the board entry and the old cookie; the nickname is free again', async () => {
  const { r, pid, profile, cookie } = await signedIn();
  await r.store.putProgress(pid, { v: 1, cards: [], levels: { s1: { stars: 3, at: '2026-06-01T00:00:00.000Z' } } });
  assert.equal((await r.store.leaderboard({})).size, 1);
  const res = await act(r, cookie, { action: 'delete', confirm: 'delete' });
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { v: 1, ok: true });
  assert.equal(setCookie(res, SESSION), CLEARED);
  const dump = r.fake.dump();
  assert.ok(!dump.includes(pid) && !dump.includes('g-1'), 'no key or value holds the pid or the sub');
  assert.equal((await r.store.leaderboard({})).size, 0, 'removed from the board');
  const again = await r.account.GET(get(URL_, { cookie }));
  assert.equal((await json(again)).signedIn, false);
  assert.equal((await act(r, cookie, { action: 'delete', confirm: 'delete' })).status, 401);
  const { profile: next } = await r.store.signIn('g-3', 'ada.other@dash0.com');
  assert.equal(next.nick, profile.nick, 'the freed nickname can be claimed');
  assert.equal(r.fake.keys().includes(keys.nick(profile.nick.toLowerCase())), true);
});

test('delete with the store down is 502 and keeps the cookie', async () => {
  const { r, cookie } = await signedIn();
  r.fake.fail = 'throw';
  const res = await act(r, cookie, { action: 'delete', confirm: 'delete' });
  assert.equal(res.status, 502);
  assert.equal(res.headers.getSetCookie().length, 0);
});

test('logs: one line per request with msg, outcome, status, ms and nothing about the player', async () => {
  const { r, profile, cookie } = await signedIn();
  await act(r, cookie, { action: 'nickname', nick: 'Secret-Nick' });
  await r.account.GET(get(URL_, { cookie }));
  await act(r, cookie, { action: 'delete', confirm: 'delete' });
  assert.equal(r.logs.length, 3);
  for (const line of r.logs) {
    assert.deepEqual(Object.keys(line).sort(), ['ms', 'msg', 'outcome', 'status']);
    const text = JSON.stringify(line);
    for (const leak of [profile.pid, 'g-1', 'Secret-Nick', profile.nick, 'lovelace', cookie.split('=')[1]]) assert.ok(!text.includes(leak), `${text} holds ${leak}`);
  }
});

test('POST: a lookalike, other-port or other-scheme Origin is 403; the exact origin passes', async () => {
  const { r, cookie } = await signedIn();
  for (const origin of [
    'https://oncall.example.test.evil.test', 'https://evil-oncall.example.test',
    'https://oncall.example.test:444', 'http://oncall.example.test',
  ]) {
    assert.equal((await act(r, cookie, { action: 'signout' }, { origin })).status, 403, origin);
  }
  assert.equal((await act(r, cookie, { action: 'signout' }, { origin: 'https://oncall.example.test' })).status, 200);
});

test('POST: a body of exactly 1024 bytes is read, 1025 is 413, and a declared length over 1024 is 413 before reading', async () => {
  const { r, cookie } = await signedIn();
  const base = '{"v":1,"action":"signout"}';
  const send = (text, headers = {}) => r.account.POST(post(URL_, text, { cookie, ...headers }));
  assert.equal((await send(base + ' '.repeat(1024 - base.length))).status, 200);
  assert.equal((await send(base + ' '.repeat(1025 - base.length))).status, 413);
  assert.equal((await send(base, { 'content-length': '1025' })).status, 413);
});

test('a store `gone` on an action is 401 unauthenticated with the cookie cleared; the session lookup already passed', async () => {
  const { r, pid, cookie } = await signedIn();
  r.fake.beforeScript = () => r.fake.db.delete(keys.profile(pid)); // the profile vanishes between lookup and write
  for (const body of [{ action: 'listing', listed: false }, { action: 'nickname', nick: 'someone' }]) {
    const res = await act(r, cookie, body);
    assert.equal(res.status, 401, body.action);
    assert.deepEqual(await json(res), { error: 'unauthenticated' });
    assert.equal(setCookie(res, SESSION), CLEARED);
  }
});
