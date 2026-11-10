// api/leaderboard.mjs (#273 P4): top 10, the reader's own line, three outcomes, no identifiers.
// Spec: docs/FOUNDATION.md §2.9. Over fake Redis; no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLeaderboard } from '../api/leaderboard.mjs';
import { NOW, ORIGIN, get, post, rig } from './helpers/auth-api.mjs';

const READ_MAX = 30;
const URL_ = `${ORIGIN}/api/leaderboard`;
const LONG = NOW + 86_400_000;
const prog = (levels) => ({ levels: Object.fromEntries(Object.entries(levels).map(([id, stars]) => [id, { stars, at: '2026-01-01' }])), cards: [] });

/** A player with a session, who has saved `levels` (stars per level id) when given. */
async function player(r, sub, email, levels = null) {
  const { profile } = await r.store.signIn(sub, email);
  if (levels !== null) assert.equal((await r.store.putProgress(profile.pid, prog(levels))).ok, true);
  return { pid: profile.pid, nick: profile.nick, cookie: await r.cookieFor(profile.pid, { exp: LONG }) };
}
const setup = (over) => {
  const r = rig(over);
  return { r, api: createLeaderboard(r.deps) };
};

test('an empty board is 200 ok with top []; unconfigured is 503; other methods 405', async () => {
  const { api } = setup();
  const res = await api.GET(get(URL_));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { v: 1, ok: true, size: 0, top: [], me: null });
  assert.equal((await createLeaderboard({ ...rig().deps, env: {} }).GET(get(URL_))).status, 503);
  assert.equal((await api.GET(post(URL_, {}))).status, 405);
});

test('anonymous reads the top with ranks, nicks and stars,', async () => {
  const { r, api } = setup();
  await player(r, 'g-1', 'ada@dash0.com', { s1: 5, s2: 4 });
  await player(r, 'g-2', 'bob@dash0.com', { s1: 2 });
  const body = await (await api.GET(get(URL_))).json();
  assert.equal(body.size, 2);
  assert.deepEqual(body.top.map((t) => [t.rank, t.stars]), [[1, 9], [2, 2]]);
  assert.deepEqual(Object.keys(body.top[0]).sort(), ['nick', 'rank', 'stars']);
  assert.equal(body.me, null);
});

test('no pid, sub, email or cookie in the body or the logs', async () => {
  const { r, api } = setup();
  const a = await player(r, 'g-1', 'ada@dash0.com', { s1: 5 });
  const res = await api.GET(get(URL_, { cookie: a.cookie }));
  const text = await res.text();
  for (const secret of [a.pid, 'g-1', '@dash0.com', 'session']) assert.ok(!text.includes(secret), `body leaks ${secret}`);
  const logs = JSON.stringify(r.logs);
  for (const secret of [a.pid, a.nick, 'g-1', '@dash0.com', a.cookie]) assert.ok(!logs.includes(secret), `log leaks ${secret}`);
});

test('me is the reader, and their stars differ from the top player when they are not first', async () => {
  const { r, api } = setup();
  await player(r, 'g-1', 'ada@dash0.com', { s1: 5, s2: 5 });
  const bob = await player(r, 'g-2', 'bob@dash0.com', { s1: 3 });
  const body = await (await api.GET(get(URL_, { cookie: bob.cookie }))).json();
  assert.equal(body.top[0].stars, 10);
  assert.deepEqual(body.me, { stars: 3, rank: 2, listed: true });
});

test('a signed-in reader with no progress has stars null and rank null, never 0', async () => {
  const { r, api } = setup();
  const eve = await player(r, 'g-3', 'eve@dash0.com');
  const body = await (await api.GET(get(URL_, { cookie: eve.cookie }))).json();
  assert.deepEqual(body.me, { stars: null, rank: null, listed: true });
});

test('an unlisted reader is absent from top, with rank null and their stars reported', async () => {
  const { r, api } = setup();
  const ada = await player(r, 'g-1', 'ada@dash0.com', { s1: 5, s2: 5 });
  await player(r, 'g-2', 'bob@dash0.com', { s1: 1 });
  assert.equal((await r.store.setListing(ada.pid, false)).ok, true);
  const body = await (await api.GET(get(URL_, { cookie: ada.cookie }))).json();
  assert.equal(body.size, 1);
  assert.equal(body.top.length, 1);
  assert.deepEqual(body.me, { stars: 10, rank: null, listed: false });
});

test('top is capped at ten while size counts everyone listed', async () => {
  const { r, api } = setup();
  for (let i = 0; i < 12; i++) await player(r, `g-${i}`, `p${i}@dash0.com`, { s1: 1 + (i % 5) });
  const body = await (await api.GET(get(URL_))).json();
  assert.equal(body.top.length, 10);
  assert.equal(body.size, 12);
  assert.deepEqual(body.top.map((t) => t.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('a store that is down is 502, never 200 with top []', async () => {
  const { r, api } = setup();
  await player(r, 'g-1', 'ada@dash0.com', { s1: 5 });
  r.fake.fail = 'throw';
  for (const fail of ['throw', 'http500', 'error']) {
    r.fake.fail = fail;
    const res = await api.GET(get(URL_));
    assert.equal(res.status, 502, fail);
    assert.deepEqual(await res.json(), { error: 'store-unavailable' });
  }
});

test('a signed-in read whose session lookup fails is 502 too', async () => {
  const { r, api } = setup();
  const ada = await player(r, 'g-1', 'ada@dash0.com', { s1: 5 });
  r.fake.fail = 'throw';
  assert.equal((await api.GET(get(URL_, { cookie: ada.cookie }))).status, 502);
});

test('only the session lookup failing: anonymous is 200, a cookie is 502 (never anonymous by accident)', async () => {
  const { r, api } = setup();
  const ada = await player(r, 'g-1', 'ada@dash0.com', { s1: 5 });
  r.fake.beforeCommand = (args) => {
    if (String(args[0]).toUpperCase() === 'HGETALL') throw new Error('boom'); // the profile read of the session lookup
  };
  assert.equal((await api.GET(get(URL_))).status, 200);
  assert.equal((await api.GET(get(URL_, { cookie: ada.cookie }))).status, 502);
});

test('a bad cookie reads as anonymous', async () => {
  const { r, api } = setup();
  const ada = await player(r, 'g-1', 'ada@dash0.com', { s1: 5 });
  const stale = await r.cookieFor(ada.pid, { gen: '9', exp: LONG });
  const body = await (await api.GET(get(URL_, { cookie: stale }))).json();
  assert.equal(body.me, null);
  assert.equal(body.top.length, 1);
});

test('the per-IP limiter answers 429 with retry-after, per address', async () => {
  const { api } = setup();
  const from = (ip) => get(URL_, { 'x-forwarded-for': ip });
  for (let i = 0; i < READ_MAX; i++) assert.equal((await api.GET(from('1.1.1.1'))).status, 200);
  const res = await api.GET(from('1.1.1.1'));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) >= 1);
  assert.equal((await api.GET(from('2.2.2.2'))).status, 200);
});

test('a 0-star player is not on the board', async () => {
  const { r, api } = setup();
  await player(r, 'g-1', 'ada@dash0.com', {});
  assert.equal((await (await api.GET(get(URL_))).json()).size, 0);
});

test('responses are no-store', async () => {
  const { api } = setup();
  assert.equal((await api.GET(get(URL_))).headers.get('cache-control'), 'no-store');
});
