// api/progress.mjs (#273 P4): read, write, the server-side total, limits, plausibility logging.
// Spec: docs/FOUNDATION.md §2.9. Over fake Redis; no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProgress } from '../api/progress.mjs';
import { ORIGIN, NOW, get, post, rig } from './helpers/auth-api.mjs';

// Pinned here on purpose: a test that imported these constants would move with a mutation of them.
const MAX_BODY_BYTES = 16 * 1024;
const FAST_MAX_MS = 30 * 60 * 1000;
const URL_ = `${ORIGIN}/api/progress`;
const FOUR = {
  order: ['s1', 's2', 's3', 's4'],
  cardIds: [],
  levels: Object.fromEntries(['s1', 's2', 's3', 's4'].map((id) => [id, { scored: true, cards: [] }])),
};
const prog = (levels) => ({ levels: Object.fromEntries(Object.entries(levels).map(([id, stars]) => [id, { stars, at: '2026-01-01' }])), cards: [] });

async function signedIn(over = {}) {
  const r = rig({ registryOver: FOUR, ...over });
  const { profile } = await r.store.signIn('g-1', 'ada.lovelace@dash0.com');
  const cookie = await r.cookieFor(profile.pid, { exp: NOW + 86_400_000 });
  const api = createProgress(r.deps);
  const put = (body, headers = {}) => api.POST(post(URL_, body, { cookie, ...headers }));
  return { r, api, pid: profile.pid, cookie, put, read: () => api.GET(get(URL_, { cookie })) };
}
const board = (r) => r.logs.filter((l) => l.msg === 'board');

test('GET needs a session: 401 without one, 503 unconfigured, 405 for other methods', async () => {
  const { api } = await signedIn();
  assert.equal((await api.GET(get(URL_))).status, 401);
  assert.equal((await createProgress({ ...rig().deps, env: {} }).GET(get(URL_))).status, 503);
  assert.equal((await api.GET(post(URL_, {}))).status, 405);
  assert.equal((await api.POST(get(URL_))).status, 405);
});

test('GET with no progress yet gives stars null (not 0) and rank null', async () => {
  const { read } = await signedIn();
  const res = await read();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.v, 1);
  assert.equal(body.stars, null);
  assert.equal(body.rank, null);
  assert.deepEqual(body.progress.levels, {});
});

test('POST merges, the response stars come from the server, and GET reads them back', async () => {
  const { put, read } = await signedIn();
  const res = await put({ v: 1, progress: prog({ s1: 3, s2: 2 }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.stars, 5);
  assert.equal(body.rank, 1);
  assert.equal(body.progress.levels.s1.stars, 3);
  const second = await (await put({ v: 1, progress: prog({ s2: 3, s3: 1 }) })).json();
  assert.equal(second.stars, 7, 'best stars per level across both writes');
  assert.deepEqual(await (await read()).json(), second);
});

test('a client-sent stars or total, or any other field, is 400', async () => {
  const { put, r, pid } = await signedIn();
  for (const extra of [{ stars: 999 }, { total: 12 }, { rank: 1 }]) {
    const res = await put({ v: 1, progress: prog({ s1: 1 }), ...extra });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).field, 'body');
  }
  assert.equal((await put({ v: 2, progress: prog({}) })).status, 400);
  assert.equal((await put({ v: 1 })).status, 400);
  assert.equal((await put({ v: 1, progress: [] })).status, 400);
  assert.equal((await put({ v: 1, progress: { cards: [] } })).status, 400);
  assert.equal((await put('not json')).status, 400);
  assert.equal((await put('[]')).status, 400);
  assert.equal((await r.store.getProgress(pid)).stars, null, 'nothing was stored');
});

test('POST demands the AUTH_ORIGIN Origin and JSON, then a session', async () => {
  const { api, cookie } = await signedIn();
  const body = { v: 1, progress: prog({ s1: 1 }) };
  assert.equal((await api.POST(post(URL_, body, { cookie, origin: 'https://evil.example' }))).status, 403);
  const noOrigin = new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  assert.equal((await api.POST(noOrigin)).status, 403);
  assert.equal((await api.POST(post(URL_, body, { cookie, 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await api.POST(post(URL_, body))).status, 401);
  assert.equal((await createProgress({ ...rig().deps, env: {} }).POST(post(URL_, body))).status, 503);
});

test('a bad or stale cookie is 401 and clears the session cookie', async () => {
  const { r, api, pid } = await signedIn();
  const stale = await r.cookieFor(pid, { gen: '9' });
  const res = await api.POST(post(URL_, { v: 1, progress: prog({}) }, { cookie: stale }));
  assert.equal(res.status, 401);
  assert.match(res.headers.getSetCookie()[0], /^__Host-oc-session=; .*Max-Age=0$/);
});

test('a body over 16 KB is 413, by content-length and by size', async () => {
  const { put, api, cookie } = await signedIn();
  const big = { v: 1, progress: { levels: {}, cards: [], pad: 'x'.repeat(MAX_BODY_BYTES) } };
  assert.equal((await put(big)).status, 413);
  const declared = await api.POST(post(URL_, { v: 1, progress: prog({}) }, { cookie, 'content-length': String(MAX_BODY_BYTES + 1) }));
  assert.equal(declared.status, 413);
  assert.equal((await put({ v: 1, progress: { levels: {}, cards: [], pad: 'x'.repeat(MAX_BODY_BYTES - 100) } })).status, 200, 'just under the limit is fine');
});

test('the 31st write in 10 minutes is 429 with retry-after; a new window frees it; bad bodies do not count', async () => {
  const { put, r } = await signedIn();
  for (let i = 0; i < 5; i++) assert.equal((await put({ v: 1, progress: [] })).status, 400);
  for (let i = 0; i < 30; i++) assert.equal((await put({ v: 1, progress: prog({ s1: 1 }) })).status, 200, `write ${i + 1}`);
  const res = await put({ v: 1, progress: prog({ s1: 1 }) });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) >= 1);
  assert.equal((await res.json()).error, 'rate-limited');
  r.clock.t += 300_000;
  assert.equal((await put({ v: 1, progress: prog({ s1: 1 }) })).status, 429, 'still inside the 10 minute window');
  r.clock.t += 301_000;
  assert.equal((await put({ v: 1, progress: prog({ s1: 1 }) })).status, 200);
});

test('the limit is per player: another pid is not limited', async () => {
  const { put, r } = await signedIn();
  for (let i = 0; i < 31; i++) await put({ v: 1, progress: prog({ s1: 1 }) });
  const other = (await r.store.signIn('g-2', 'bob@dash0.com')).profile;
  const res = await createProgress(r.deps).POST(post(URL_, { v: 1, progress: prog({ s1: 1 }) }, { cookie: await r.cookieFor(other.pid) }));
  assert.equal(res.status, 200);
});

test('a store that is down is 502 on read and write, never a 200', async () => {
  const { put, read, r } = await signedIn();
  r.fake.fail = 'throw';
  for (const res of [await put({ v: 1, progress: prog({ s1: 1 }) }), await read()]) {
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'store-unavailable');
  }
});

test('plausibility: exactly half the maximum in one write is quiet', async () => {
  const { put, r } = await signedIn();
  await put({ v: 1, progress: prog({ s1: 1 }) });
  const res = await put({ v: 1, progress: prog({ s1: 5, s2: 5, s3: 1 }) }); // 1 -> 11 of 20: +10, exactly half
  assert.equal((await res.json()).stars, 11);
  assert.equal(board(r).length, 0);
});

test('plausibility: more than half in one write logs {msg:board, outcome:implausible} and still returns 200', async () => {
  const { put, r } = await signedIn();
  await put({ v: 1, progress: prog({ s1: 1 }) });
  const res = await put({ v: 1, progress: prog({ s1: 5, s2: 5, s3: 2 }) }); // 1 -> 12 of 20: +11
  assert.equal(res.status, 200);
  assert.equal((await res.json()).stars, 12);
  assert.equal(board(r).length, 1);
  assert.equal(board(r)[0].outcome, 'implausible');
  assert.equal(board(r)[0].why, 'jump');
});

test('plausibility: a first sync is never implausible, even the whole maximum within minutes of sign-in', async () => {
  const { put, r } = await signedIn();
  const res = await put({ v: 1, progress: prog({ s1: 5, s2: 5, s3: 5, s4: 5 }) }); // nothing saved before
  assert.equal((await res.json()).stars, 20);
  assert.equal(board(r).length, 0);
});

test('plausibility: a failed pre-write read skips the check; the write still lands with 200', async () => {
  const { put, r } = await signedIn();
  let armed = true;
  r.fake.beforeCommand = (args) => {
    if (armed && String(args[0]).toUpperCase() === 'ZREVRANK') {
      armed = false; // one shot: only getProgress's read fails, not the rank read after the write
      throw new Error('boom');
    }
  };
  const res = await put({ v: 1, progress: prog({ s1: 5, s2: 5, s3: 1 }) });
  assert.equal(armed, false, 'the pre-write read was the one that failed');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).stars, 11);
  assert.equal(board(r).length, 0);
});

test('plausibility: the jump counts from the stored total, not from zero', async () => {
  const { put, r } = await signedIn();
  await put({ v: 1, progress: prog({ s1: 5, s2: 5 }) });
  await put({ v: 1, progress: prog({ s1: 5, s2: 5, s3: 5 }) }); // +5 only
  assert.equal(board(r).length, 0);
});

test('plausibility: the maximum within 30 minutes of account creation is logged, later is not', async () => {
  const { put, r } = await signedIn();
  await put({ v: 1, progress: prog({ s1: 5, s2: 5 }) }); // 10 of 20: quiet
  r.clock.t = NOW + FAST_MAX_MS;
  await put({ v: 1, progress: prog({ s3: 5, s4: 5 }) }); // reaches 20 at exactly 30 minutes
  assert.equal(board(r).length, 1);
  assert.equal(board(r)[0].why, 'fast');
  const slow = await signedIn();
  await slow.put({ v: 1, progress: prog({ s1: 5, s2: 5 }) });
  slow.r.clock.t = NOW + FAST_MAX_MS + 1;
  await slow.put({ v: 1, progress: prog({ s3: 5, s4: 5 }) });
  assert.equal(board(slow.r).length, 0, 'past 30 minutes');
});

test('plausibility: re-sending a maxed record does not log again', async () => {
  const { put, r } = await signedIn();
  await put({ v: 1, progress: prog({ s1: 5, s2: 5 }) });
  await put({ v: 1, progress: prog({ s3: 5, s4: 5 }) });
  const before = board(r).length;
  await put({ v: 1, progress: prog({ s3: 5, s4: 5 }) });
  assert.equal(board(r).length, before);
});

test('logs never carry a pid, nick, email or cookie', async () => {
  const { put, read, r, pid, cookie } = await signedIn();
  await put({ v: 1, progress: prog({ s1: 5, s2: 5, s3: 5 }) });
  await read();
  await put({ v: 1, progress: prog({ s1: 3 }), stars: 1 });
  const text = JSON.stringify(r.logs);
  const profile = (await r.store.loadProfile(pid)).profile;
  for (const secret of [pid, profile.nick, 'ada', '@dash0.com', cookie, 'g-1']) assert.ok(!text.includes(secret), `log leaks ${secret}`);
  assert.ok(r.logs.every((l) => typeof l.msg === 'string' && typeof l.outcome === 'string'));
});

test('responses are no-store and carry no pid', async () => {
  const { put, pid } = await signedIn();
  const res = await put({ v: 1, progress: prog({ s1: 1 }) });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(!(await res.text()).includes(pid));
});
