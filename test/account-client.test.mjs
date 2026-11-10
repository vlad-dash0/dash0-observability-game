// lib/account/client.mjs: the three outcomes. A 502, a 503, a network error or an odd body is
// unavailable, never an empty board, no account or 0 stars. Contract: docs/FOUNDATION.md §2.9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountClient } from '../lib/account/client.mjs';

const res = (status, body, { json = true } = {}) => ({ status, ok: status < 300, json: async () => (json ? body : Promise.reject(new SyntaxError('bad json'))) });
const clientFor = (answer) => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const out = typeof answer === 'function' ? answer(url, init) : answer;
    if (out instanceof Error) throw out;
    return out;
  };
  return { client: createAccountClient({ fetch }), calls };
};
const UNAVAILABLE = { state: 'unavailable' };
const PROGRESS = { v: 1, levels: { a: { stars: 2, at: null } }, cards: [] };

test('account: the four answers', async () => {
  assert.deepEqual(await clientFor(res(200, { v: 1, configured: false })).client.account(), { state: 'unconfigured' });
  assert.deepEqual(await clientFor(res(200, { v: 1, configured: true, signedIn: false })).client.account(), { state: 'signedOut' });
  assert.deepEqual(await clientFor(res(200, { v: 1, configured: true, signedIn: true, nick: 'vladster', listed: true })).client.account(), {
    state: 'signedIn', nick: 'vladster', listed: true,
  });
  const { client, calls } = clientFor(res(200, { v: 1, configured: false }));
  await client.account();
  assert.deepEqual([calls[0].url, calls[0].method], ['/api/account', 'GET']);
});

test('account: 502, 503, a network error and odd bodies are unavailable', async () => {
  const odd = [
    res(502, { error: 'store-unavailable' }),
    res(503, { error: 'not-configured' }),
    res(500, {}),
    res(200, null, { json: false }),
    res(200, 'text'),
    res(200, { v: 2, configured: false }),
    res(200, { v: 1, configured: 'yes' }),
    res(200, { v: 1, configured: true, signedIn: true }),
    res(200, { v: 1, configured: true, signedIn: true, nick: '', listed: true }),
    res(200, { v: 1, configured: true, signedIn: true, nick: 'a', listed: 'yes' }),
    new TypeError('network'),
  ];
  for (const answer of odd) assert.deepEqual(await clientFor(answer).client.account(), UNAVAILABLE, JSON.stringify(answer));
});

test('syncProgress POSTs exactly {v:1, progress} with a JSON content type', async () => {
  const { client, calls } = clientFor(res(200, { v: 1, progress: PROGRESS, stars: 2, rank: 4 }));
  const out = await client.syncProgress(PROGRESS);
  assert.deepEqual(out, { state: 'ok', progress: PROGRESS, stars: 2, rank: 4 });
  assert.equal(calls[0].url, '/api/progress');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body), { v: 1, progress: PROGRESS });
});

test('syncProgress: stars and rank may be null (no write yet); other answers', async () => {
  const out = await clientFor(res(200, { v: 1, progress: PROGRESS, stars: null, rank: null })).client.syncProgress(PROGRESS);
  assert.deepEqual([out.state, out.stars, out.rank], ['ok', null, null]);
  assert.deepEqual(await clientFor(res(401, { error: 'unauthenticated' })).client.syncProgress(PROGRESS), { state: 'signedOut' });
  assert.deepEqual(await clientFor(res(429, { error: 'rate-limited', retryAfterS: 30 })).client.syncProgress(PROGRESS), { state: 'limited', retryAfterS: 30 });
});

test('syncProgress: 502, 503, 400, a network error and odd bodies are unavailable', async () => {
  const odd = [
    res(502, { error: 'store-unavailable' }),
    res(503, {}),
    res(400, {}),
    res(413, {}),
    res(200, null, { json: false }),
    res(200, { v: 1, progress: 'x', stars: 1, rank: 1 }),
    res(200, { v: 1, progress: PROGRESS, stars: 'many', rank: 1 }),
    res(200, { v: 1, progress: PROGRESS, stars: 1, rank: 0 }),
    res(200, { v: 1, progress: PROGRESS, stars: -1, rank: null }),
    res(200, { progress: PROGRESS, stars: 1, rank: 1 }),
    new TypeError('network'),
  ];
  for (const answer of odd) assert.deepEqual(await clientFor(answer).client.syncProgress(PROGRESS), UNAVAILABLE, JSON.stringify(answer));
});

test('leaderboard: ok with a top, ok with an empty top, and me', async () => {
  const top = [{ rank: 1, nick: 'grace', stars: 12 }, { rank: 2, nick: 'ada', stars: null }];
  const body = { v: 1, ok: true, size: 2, top, me: { stars: 3, rank: null, listed: false } };
  const out = await clientFor(res(200, body)).client.leaderboard();
  assert.deepEqual(out, { state: 'ok', size: 2, top, me: { stars: 3, rank: null, listed: false } });
  const empty = await clientFor(res(200, { v: 1, ok: true, size: 0, top: [], me: null })).client.leaderboard();
  assert.deepEqual(empty, { state: 'ok', size: 0, top: [], me: null });
  const { client, calls } = clientFor(res(200, { v: 1, ok: true, size: 0, top: [], me: null }));
  await client.leaderboard();
  assert.deepEqual([calls[0].url, calls[0].method], ['/api/leaderboard', 'GET']);
});

test('leaderboard: 502, 503, 429, a network error and odd bodies are unavailable, never an empty board', async () => {
  const odd = [
    res(502, { error: 'store-unavailable' }),
    res(503, { error: 'not-configured' }),
    res(429, { error: 'rate-limited' }),
    res(200, null, { json: false }),
    res(200, { v: 1, ok: false, size: 0, top: [] }),
    res(200, { v: 1, ok: true, size: 0 }),
    res(200, { v: 1, ok: true, size: 'n', top: [] }),
    res(200, { v: 1, ok: true, size: 1, top: [{ rank: 1, nick: '', stars: 1 }] }),
    res(200, { v: 1, ok: true, size: 1, top: [{ rank: 1, nick: 'a', stars: 'x' }] }),
    res(200, { v: 1, ok: true, size: 1, top: [], me: { stars: 1, rank: 1 } }),
    new TypeError('network'),
  ];
  for (const answer of odd) assert.deepEqual(await clientFor(answer).client.leaderboard(), UNAVAILABLE, JSON.stringify(answer));
});

test('account actions: bodies and outcomes', async () => {
  const bodies = [];
  const { client } = clientFor((url, init) => {
    bodies.push(JSON.parse(init.body));
    return res(200, { v: 1, ok: true, nick: 'neo', listed: false });
  });
  assert.deepEqual(await client.setNickname('neo'), { state: 'ok', nick: 'neo', listed: false });
  await client.setListing(false);
  await client.signOut();
  await client.deleteAccount();
  assert.deepEqual(bodies, [
    { v: 1, action: 'nickname', nick: 'neo' },
    { v: 1, action: 'listing', listed: false },
    { v: 1, action: 'signout' },
    { v: 1, action: 'delete', confirm: 'delete' },
  ]);
  assert.deepEqual(await clientFor(res(409, { error: 'nick-taken' })).client.setNickname('x'), { state: 'taken' });
  assert.deepEqual(await clientFor(res(400, { ok: false, field: 'nick', reason: 'blocked' })).client.setNickname('x'), { state: 'invalid', reason: 'blocked' });
  assert.deepEqual(await clientFor(res(401, {})).client.signOut(), { state: 'signedOut' });
  assert.deepEqual(await clientFor(res(502, {})).client.setListing(true), UNAVAILABLE);
  assert.deepEqual(await clientFor(res(200, { ok: true })).client.setListing(true), UNAVAILABLE, 'an odd body is not ok');
  assert.deepEqual(await clientFor(new TypeError('network')).client.deleteAccount(), UNAVAILABLE);
});
