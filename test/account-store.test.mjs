// The account store over tools/fake-redis.mjs (#273 P2b): totals, ties, CAS, unlisted players,
// delete, store failures and env resolution. Spec: the #273 design, "P2b store".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redisConfigFromEnv, createRedis, RedisError } from '../lib/account/redis.mjs';
import { createStore, keys } from '../lib/account/store.mjs';
import { decodeScore } from '../lib/account/score.mjs';
import { createFakeRedis } from '../tools/fake-redis.mjs';

const T0 = Date.UTC(2026, 5, 1);
const registry = {
  order: ['s1', 's2', 's3', 'u'],
  cardIds: [],
  levels: {
    s1: { scored: true, cards: [] },
    s2: { scored: true, cards: [] },
    s3: { scored: true, cards: [] },
    u: { scored: false, cards: [] },
  },
};
const prog = (levels) => ({
  v: 1,
  cards: [],
  levels: Object.fromEntries(Object.entries(levels).map(([id, stars]) => [id, { stars, at: '2026-06-01T00:00:00.000Z' }])),
});

function setup() {
  const fake = createFakeRedis();
  const clock = { t: T0 };
  let n = 0;
  const random = (len) => new Uint8Array(len).fill(++n);
  const redis = createRedis({ url: fake.url, token: fake.token, fetch: fake.fetch });
  const store = createStore({ redis, registry, now: () => clock.t, random });
  return { fake, clock, store, redis };
}
const join = async (store, sub, email) => (await store.signIn(sub, email)).profile.pid;

test('the total counts scored registered levels only, and a sent total is ignored', async () => {
  const { store } = setup();
  const pid = await join(store, 'g1', 'ada.lovelace@dash0.com');
  const res = await store.putProgress(pid, { ...prog({ u: 5, s1: 3 }), total: 99 });
  assert.equal(res.ok, true);
  assert.equal(res.stars, 3);
  assert.equal((await store.getProgress(pid)).stars, 3);
});

test('ties go to whoever reached the total first, and a same-progress write keeps the score', async () => {
  const { store, clock, fake } = setup();
  const a = await join(store, 'a', 'aaa@dash0.com');
  const b = await join(store, 'b', 'bbb@dash0.com');
  await store.setNickname(a, 'Alpha');
  await store.setNickname(b, 'Bravo');
  await store.putProgress(a, prog({ s1: 3, s2: 3, s3: 3 }));
  clock.t += 60_000;
  await store.putProgress(b, prog({ s1: 3, s2: 3, s3: 3 }));
  const names = async () => (await store.leaderboard()).top.map((r) => r.nick);
  assert.deepEqual(await names(), ['Alpha', 'Bravo']);
  clock.t += 60_000;
  await store.putProgress(b, prog({ s1: 3, s2: 3, s3: 3, u: 3 }));
  assert.deepEqual(await names(), ['Alpha', 'Bravo']); // unscored does not move B
  const before = fake.db.get(keys.progress(a)).get('score');
  clock.t += 3_600_000;
  await store.putProgress(a, prog({ s1: 3, s2: 3, s3: 3 }));
  assert.equal(fake.db.get(keys.progress(a)).get('score'), before);
  assert.equal(decodeScore(Number(before)).total, 9);
});

test('a higher total outranks an earlier lower one', async () => {
  const { store, clock } = setup();
  const a = await join(store, 'a', 'aaa@dash0.com');
  const b = await join(store, 'b', 'bbb@dash0.com');
  await store.setNickname(a, 'Alpha');
  await store.setNickname(b, 'Bravo');
  await store.putProgress(a, prog({ s1: 3, s2: 3 }));
  clock.t += 60_000;
  await store.putProgress(b, prog({ s1: 3, s2: 3, s3: 1 }));
  const top = (await store.leaderboard()).top;
  assert.deepEqual(top.map((r) => [r.rank, r.nick, r.stars]), [[1, 'Bravo', 7], [2, 'Alpha', 6]]);
});

test('a write landing between read and EVAL is kept after the retry', async () => {
  const { store, fake } = setup();
  const pid = await join(store, 'g1', 'ada@dash0.com');
  let injected = false;
  fake.beforeScript = (name) => {
    if (name !== 'cas-progress' || injected) return;
    injected = true;
    const h = fake.db.get(keys.progress(pid)) ?? new Map();
    fake.db.set(keys.progress(pid), h);
    h.set('json', JSON.stringify(prog({ s2: 2 })));
    h.set('total', '2');
    h.set('reachedAt', String(T0));
    h.set('rev', '1');
  };
  const res = await store.putProgress(pid, prog({ s1: 3 }));
  assert.equal(res.ok, true);
  assert.deepEqual(Object.keys(res.progress.levels).sort(), ['s1', 's2']);
  assert.equal(res.stars, 5);
  assert.equal((await store.getProgress(pid)).stars, 5);
});

test('three lost CAS attempts report a conflict, not success', async () => {
  const { store, fake } = setup();
  const pid = await join(store, 'g1', 'ada@dash0.com');
  fake.beforeScript = (name) => {
    if (name === 'cas-progress') {
      const h = fake.db.get(keys.progress(pid)) ?? new Map();
      fake.db.set(keys.progress(pid), h);
      h.set('rev', String(Number(h.get('rev') ?? 0) + 1));
    }
  };
  assert.deepEqual(await store.putProgress(pid, prog({ s1: 1 })), { ok: false, reason: 'conflict' });
});

test('an unlisted player is off the board, with no rank and their stars reported', async () => {
  const { store } = setup();
  const top = await join(store, 'a', 'aaa@dash0.com');
  const hidden = await join(store, 'h', 'hid@dash0.com');
  await store.setNickname(hidden, 'Hidden');
  assert.deepEqual(await store.setListing(hidden, false), { ok: true, listed: false });
  await store.putProgress(hidden, prog({ s1: 3, s2: 3, s3: 3 }));
  await store.putProgress(top, prog({ s1: 1 }));
  const board = await store.leaderboard({ pid: hidden });
  assert.equal(board.size, 1);
  assert.deepEqual(board.top.map((r) => r.stars), [1]);
  assert.deepEqual(board.me, { stars: 9, rank: null, listed: false });
  const own = await store.getProgress(hidden);
  assert.equal(own.rank, null);
  assert.equal(own.stars, 9);
});

test('listing again joins with the stored score; with none stored only the flag is set', async () => {
  const { store, fake } = setup();
  const pid = await join(store, 'a', 'aaa@dash0.com');
  await store.setListing(pid, false);
  assert.equal(await store.setListing(pid, true).then((r) => r.ok), true);
  assert.equal((await store.leaderboard()).size, 0); // nothing stored yet, so nothing added
  await store.putProgress(pid, prog({ s1: 2 }));
  assert.equal((await store.leaderboard()).size, 1); // listed, so the first write adds it
  await store.setListing(pid, false);
  assert.equal((await store.leaderboard()).size, 0);
  await store.setListing(pid, true);
  assert.equal((await store.leaderboard()).top[0].stars, 2);
  assert.equal(fake.db.get(keys.profile(pid)).get('listed'), '1');
});

test('a new profile is listed, has a fun nick and stores no email or name', async () => {
  const { store, fake } = setup();
  const res = await store.signIn('g-1', 'vlad.k@dash0.com');
  assert.equal(res.created, true);
  assert.equal(res.profile.nick, 'vladster');
  assert.equal(res.profile.listed, true);
  assert.doesNotMatch(fake.dump(), /@|dash0\.com|vlad\.k/);
  const again = await store.signIn('g-1', 'vlad.k@dash0.com');
  assert.equal(again.created, false);
  assert.equal(again.profile.pid, res.profile.pid);
});

test('a second player with the same default gets the next candidate; a half-made profile is repaired', async () => {
  const { store, fake } = setup();
  const one = await store.signIn('s1', 'vlad@dash0.com');
  const two = await store.signIn('s2', 'vlad@dash0.com');
  assert.notEqual(one.profile.nick, two.profile.nick);
  fake.db.delete(keys.profile(two.profile.pid)); // crash after the sub claim
  const fixed = await store.signIn('s2', 'vlad@dash0.com');
  assert.equal(fixed.profile.pid, two.profile.pid);
  assert.equal(fixed.profile.nick, two.profile.nick);
});

test('typed nicknames are unique on nickKey, validated, and the old claim is released', async () => {
  const { store, fake } = setup();
  const a = await join(store, 'a', 'aaa@dash0.com');
  const b = await join(store, 'b', 'bbb@dash0.com');
  assert.deepEqual(await store.setNickname(a, 'Ada'), { ok: true, nick: 'Ada' });
  assert.deepEqual(await store.setNickname(b, 'ADA'), { ok: false, reason: 'taken' });
  assert.deepEqual(await store.setNickname(b, 'ab'), { ok: false, reason: 'format' });
  assert.deepEqual(await store.setNickname(b, 'admin'), { ok: false, reason: 'reserved' });
  assert.deepEqual(await store.setNickname(a, 'ada'), { ok: true, nick: 'ada' }); // own key, new case
  assert.deepEqual(await store.setNickname(a, 'Grace'), { ok: true, nick: 'Grace' });
  assert.equal(fake.db.has(keys.nick('ada')), false);
  assert.deepEqual(await store.setNickname(b, 'ada'), { ok: true, nick: 'ada' });
});

test('delete leaves no pid or sub, frees the nick, and spares a nick key another pid owns', async () => {
  const { store, fake } = setup();
  const a = await join(store, 'google-sub-a', 'aaa@dash0.com');
  const b = await join(store, 'b', 'bbb@dash0.com');
  await store.setNickname(a, 'Ada');
  await store.putProgress(a, prog({ s1: 2 }));
  fake.db.set(keys.nick('ada'), b); // the key is now held by another pid
  assert.deepEqual(await store.deleteAccount(a), { ok: true });
  const dump = fake.dump();
  assert.equal(dump.includes(a), false);
  assert.equal(dump.includes('google-sub-a'), false);
  assert.equal(fake.db.get(keys.nick('ada')), b);
  assert.equal((await store.leaderboard()).size, 0);
  assert.deepEqual(await store.loadProfile(a), { ok: true, profile: null });
});

test('after delete another player can claim the nick', async () => {
  const { store } = setup();
  const a = await join(store, 'a', 'aaa@dash0.com');
  const b = await join(store, 'b', 'bbb@dash0.com');
  await store.setNickname(a, 'Ada');
  await store.deleteAccount(a);
  assert.deepEqual(await store.setNickname(b, 'Ada'), { ok: true, nick: 'Ada' });
});

test('writes for a deleted profile say gone and write nothing', async () => {
  const { store, fake } = setup();
  const a = await join(store, 'a', 'aaa@dash0.com');
  await store.deleteAccount(a);
  assert.deepEqual(await store.putProgress(a, prog({ s1: 1 })), { ok: false, reason: 'gone' });
  assert.deepEqual(await store.setNickname(a, 'Ghost'), { ok: false, reason: 'gone' });
  assert.deepEqual(fake.keys(), []);
});

test('the leaderboard never carries a pid and an empty board is ok', async () => {
  const { store } = setup();
  assert.deepEqual(await store.leaderboard(), { ok: true, size: 0, top: [], me: null });
  const pid = await join(store, 'a', 'aaa@dash0.com');
  await store.putProgress(pid, prog({ s1: 2 }));
  const board = await store.leaderboard({ pid });
  assert.equal(JSON.stringify(board).includes(pid), false);
  assert.deepEqual(board.me, { stars: 2, rank: 1, listed: true });
  const fresh = await join(store, 'f', 'fff@dash0.com');
  assert.equal((await store.leaderboard({ pid: fresh })).me.stars, null);
});

test('rate limit: max per window, retry-after, a new window resets', async () => {
  const { store, clock } = setup();
  const limit = { max: 2, windowS: 600 };
  assert.equal((await store.rateLimit('p', 'progress', limit)).ok, true);
  assert.equal((await store.rateLimit('p', 'progress', limit)).ok, true);
  const third = await store.rateLimit('p', 'progress', limit);
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'limited');
  assert.equal(third.retryAfterS, 600 - ((T0 / 1000) % 600));
  assert.equal((await store.rateLimit('p', 'nick', limit)).ok, true);
  clock.t += 600_000;
  assert.equal((await store.rateLimit('p', 'progress', limit)).ok, true);
});

for (const mode of ['throw', 'http500', 'error']) {
  test(`a store failure (${mode}) is reason store, never an empty answer`, async () => {
    const { store, fake } = setup();
    const pid = await join(store, 'a', 'aaa@dash0.com');
    fake.fail = mode;
    const expected = { ok: false, reason: 'store' };
    assert.deepEqual(await store.leaderboard(), expected);
    assert.deepEqual(await store.leaderboard({ pid }), expected);
    assert.deepEqual(await store.getProgress(pid), expected);
    assert.deepEqual(await store.putProgress(pid, prog({ s1: 1 })), expected);
    assert.deepEqual(await store.setNickname(pid, 'Newname'), expected);
    assert.deepEqual(await store.setListing(pid, false), expected);
    assert.deepEqual(await store.deleteAccount(pid), expected);
    assert.deepEqual(await store.loadProfile(pid), expected);
    assert.deepEqual(await store.signIn('z', 'zzz@dash0.com'), expected);
    assert.deepEqual(await store.rateLimit(pid, 'progress', { max: 5, windowS: 60 }), expected);
  });
}

test('a listed player whose profile vanished refuses the read instead of dropping a row', async () => {
  const { store, fake } = setup();
  const pid = await join(store, 'a', 'aaa@dash0.com');
  await store.putProgress(pid, prog({ s1: 1 }));
  fake.db.delete(keys.profile(pid));
  assert.deepEqual(await store.leaderboard(), { ok: false, reason: 'store' });
});

test('the client times out a hung request', async () => {
  const hang = (_url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const redis = createRedis({ url: 'https://x.test', token: 't', fetch: hang, timeoutMs: 20 });
  await assert.rejects(redis.command(['GET', 'k']), RedisError);
});

test('EVALSHA falls back to EVAL once, then runs by sha', async () => {
  const { redis, fake } = setup();
  fake.db.set('x', 'y');
  await redis.script('set-listing', ['p', 'q', 'b'], ['1', 'pid']);
  await redis.script('set-listing', ['p', 'q', 'b'], ['1', 'pid']);
  assert.deepEqual(fake.calls.map((c) => c[0]), ['EVALSHA', 'EVAL', 'EVALSHA']);
});

test('env: UPSTASH alone, KV alone, a URL without a token, and UPSTASH wins', () => {
  const up = { UPSTASH_REDIS_REST_URL: 'https://up.test/', UPSTASH_REDIS_REST_TOKEN: 'ut' };
  const kv = { KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'kt' };
  assert.deepEqual(redisConfigFromEnv(up), { url: 'https://up.test', token: 'ut' });
  assert.deepEqual(redisConfigFromEnv(kv), { url: 'https://kv.test', token: 'kt' });
  assert.equal(redisConfigFromEnv({ UPSTASH_REDIS_REST_URL: 'https://up.test' }), null);
  assert.equal(redisConfigFromEnv({ KV_REST_API_URL: 'https://kv.test' }), null);
  assert.equal(redisConfigFromEnv({ KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'k', UPSTASH_REDIS_REST_URL: 'https://up.test' }), null);
  assert.deepEqual(redisConfigFromEnv({ ...kv, ...up }), { url: 'https://up.test', token: 'ut' });
  assert.equal(redisConfigFromEnv({}), null);
});

test('a listed player joins the board only from one star, and leaves it at zero', async () => {
  const { store, fake } = setup();
  const pid = await join(store, 'a', 'aaa@dash0.com');
  await store.putProgress(pid, prog({ s1: 0 }));
  assert.equal(fake.db.get(keys.progress(pid)).get('total'), '0');
  assert.equal((await store.leaderboard()).size, 0); // total 0 is not on the board
  await store.setListing(pid, false);
  await store.setListing(pid, true);
  assert.equal((await store.leaderboard()).size, 0); // listing does not add a zero either
  await store.putProgress(pid, prog({ s1: 1 }));
  assert.equal((await store.leaderboard()).size, 1);
  fake.db.get(keys.progress(pid)).set('total', '0'); // the total can drop (a level became unscored)
  await store.setListing(pid, true);
  assert.equal((await store.leaderboard()).size, 0);
  fake.db.get(keys.progress(pid)).set('total', '1');
  await store.setListing(pid, true);
  assert.equal((await store.leaderboard()).size, 1);
  fake.db.get(keys.progress(pid)).set('rev', '0');
  fake.db.get(keys.progress(pid)).set('json', JSON.stringify(prog({})));
  fake.db.get(keys.progress(pid)).set('total', '1');
  await store.putProgress(pid, prog({})); // recomputed total 0 removes the entry
  assert.equal((await store.leaderboard()).size, 0);
});

test('the rate-limit window key is created with its TTL in the same pipeline, then incremented', async () => {
  const { store, fake } = setup();
  await store.rateLimit('p', 'progress', { max: 5, windowS: 600 });
  const [first, second] = fake.calls.slice(-2);
  assert.deepEqual(first.slice(0, 1).concat(first.slice(2)), ['SET', 0, 'EX', 600, 'NX']);
  assert.equal(second[0], 'INCR');
  const key = first[1];
  assert.equal(fake.ttl.get(key), 600);
  await store.rateLimit('p', 'progress', { max: 5, windowS: 600 });
  assert.equal(fake.db.get(key), '2');
  assert.equal(fake.ttl.get(key), 600);
  assert.equal(fake.calls.some((c) => c[0] === 'EXPIRE'), false);
});

test('a failed command is HTTP 400 with the error text, and NOSCRIPT over 400 falls back to EVAL', async () => {
  const seen = [];
  const answer = (command) => {
    seen.push(command[0]);
    if (command[0] === 'EVALSHA') return new Response(JSON.stringify({ error: 'NOSCRIPT No matching script' }), { status: 400 });
    if (command[0] === 'EVAL') return new Response(JSON.stringify({ result: 'ok' }));
    return new Response(JSON.stringify({ error: 'ERR syntax' }), { status: 400 });
  };
  const redis = createRedis({ url: 'https://x.test', token: 't', fetch: async (_u, init) => answer(JSON.parse(init.body)) });
  assert.equal(await redis.script('set-listing', ['p', 'q', 'b'], ['1', 'pid']), 'ok');
  assert.deepEqual(seen, ['EVALSHA', 'EVAL']);
  await assert.rejects(redis.command(['BOGUS']), /ERR syntax/);
  const other = createRedis({
    url: 'https://x.test',
    token: 't',
    fetch: async () => new Response(JSON.stringify({ error: 'ERR boom' }), { status: 400 }),
  });
  await assert.rejects(other.script('set-listing', ['p', 'q', 'b'], ['1', 'pid']), /ERR boom/); // no fallback
});

test('a pipeline with one failing entry fails as a whole', async () => {
  const { redis } = setup();
  await assert.rejects(redis.pipeline([['GET', 'k'], ['BOGUS']]), RedisError);
});

test('the second of two listed players is rank 2 in getProgress, putProgress and leaderboard().me', async () => {
  const { store, clock } = setup();
  const a = await join(store, 'a', 'aaa@dash0.com');
  const b = await join(store, 'b', 'bbb@dash0.com');
  await store.putProgress(a, prog({ s1: 3, s2: 3 }));
  clock.t += 1000;
  const put = await store.putProgress(b, prog({ s1: 1 }));
  assert.equal(put.rank, 2);
  assert.equal((await store.getProgress(b)).rank, 2);
  assert.equal((await store.leaderboard({ pid: b })).me.rank, 2);
  assert.equal((await store.getProgress(a)).rank, 1);
});

test('signIn with an empty or non-string sub is a format refusal, not a rejection', async () => {
  const { store } = setup();
  assert.deepEqual(await store.signIn('', 'a@dash0.com'), { ok: false, reason: 'format' });
  assert.deepEqual(await store.signIn(null, 'a@dash0.com'), { ok: false, reason: 'format' });
});

test('top is clamped to 1..10: 11 listed players give 10 rows and size 11', async () => {
  const { store } = setup();
  for (let i = 0; i < 11; i++) {
    const pid = await join(store, `s${i}`, `person${i}@dash0.com`);
    await store.putProgress(pid, prog({ s1: 1 }));
  }
  for (const top of [100, Infinity, NaN, undefined]) {
    const board = await store.leaderboard({ top });
    assert.equal(board.top.length, 10);
    assert.equal(board.size, 11);
  }
  assert.equal((await store.leaderboard({ top: 0 })).top.length, 1);
  assert.equal((await store.leaderboard({ top: -5 })).top.length, 1);
  assert.equal((await store.leaderboard({ top: 3.9 })).top.length, 3);
});

test('claim-nick and delete-account get their nick and sub keys as KEYS, not ARGV', async () => {
  const { store, fake } = setup();
  const pid = await join(store, 'sub-x', 'aaa@dash0.com');
  await store.setNickname(pid, 'Ada');
  await store.deleteAccount(pid);
  const evals = fake.calls.filter((c) => c[0] === 'EVALSHA' || c[0] === 'EVAL');
  const keysOf = (c) => c.slice(3, 3 + Number(c[2]));
  const claim = keysOf(evals[0]);
  assert.ok(claim.includes(keys.nick('ada')) && claim.length === 3);
  const del = keysOf(evals.at(-1));
  assert.ok(del.includes(keys.sub('sub-x')) && del.includes(keys.nick('ada')) && del.length === 5);
});

test('a nickname change racing another one re-reads the old key and releases the right claim', async () => {
  const { store, fake } = setup();
  const pid = await join(store, 'a', 'aaa@dash0.com');
  await store.setNickname(pid, 'Ada');
  let raced = false;
  fake.beforeScript = (name) => {
    if (name !== 'claim-nick' || raced) return;
    raced = true; // another tab moved the nick to Bea between our read and the script
    fake.db.delete(keys.nick('ada'));
    fake.db.set(keys.nick('bea'), pid);
    fake.db.get(keys.profile(pid)).set('nickKey', 'bea');
    fake.db.get(keys.profile(pid)).set('nick', 'Bea');
  };
  assert.deepEqual(await store.setNickname(pid, 'Cleo'), { ok: true, nick: 'Cleo' });
  assert.equal(fake.db.has(keys.nick('bea')), false);
  assert.equal(fake.db.get(keys.nick('cleo')), pid);
});

test('a delete between the sub read and the profile write leaves nothing behind', async () => {
  const { store, fake } = setup();
  const first = await store.signIn('s', 'vlad@dash0.com');
  fake.db.delete(keys.profile(first.profile.pid)); // crash: sub without profile
  fake.beforeCommand = (args) => {
    if (args[0] === 'HSET' && String(args[1]).includes(':profile:')) fake.db.delete(keys.sub('s'));
  };
  assert.deepEqual(await store.signIn('s', 'vlad@dash0.com'), { ok: false, reason: 'store' });
  assert.deepEqual(fake.keys(), []);
});

test('setListing and getProgress on a deleted profile say gone', async () => {
  const { store } = setup();
  const pid = await join(store, 'a', 'aaa@dash0.com');
  await store.deleteAccount(pid);
  assert.deepEqual(await store.setListing(pid, true), { ok: false, reason: 'gone' });
  assert.deepEqual(await store.getProgress(pid), { ok: false, reason: 'gone' });
});
