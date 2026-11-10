// Opt-in check of the four Lua scripts against a real Upstash Redis (#297). With REDIS_IT=1 and
// the store env (UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN) the same scenarios run
// over the real REST endpoint and over tools/fake-redis.mjs (the JS twins), and the observable
// results must be identical. Without them the live test is skipped. Use a dev database only: every
// key goes under a random per-run prefix and is deleted afterwards. Never prints the token.
// The comparison itself is checked on every run, with two fakes (one of them made to disagree).
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createRedis, KEY_PREFIX, redisConfigFromEnv, RedisError, SCRIPTS, scriptSha } from '../lib/account/redis.mjs';
import { createStore, keys } from '../lib/account/store.mjs';
import { nickKey } from '../lib/account/nickname.mjs';
import { createFakeRedis } from '../tools/fake-redis.mjs';

const T0 = Date.UTC(2026, 5, 1);
const TTL_S = 3600;
const registry = {
  order: ['s1', 's2', 'u'],
  cardIds: [],
  levels: { s1: { scored: true, cards: [] }, s2: { scored: true, cards: [] }, u: { scored: false, cards: [] } },
};
const prog = (levels) => ({
  v: 1,
  cards: [],
  levels: Object.fromEntries(Object.entries(levels).map(([id, stars]) => [id, { stars, at: '2026-06-01T00:00:00.000Z' }])),
});

// The store's key prefix is a constant, so the run prefix is injected here: every string that
// starts with KEY_PREFIX (a key, as keys never appear as values) moves under `oc:v1:it<id>:`.
// Every key rewritten is recorded, for the cleanup and the "nothing left" check.
function isolate(raw, runId) {
  const touched = new Set();
  const own = `${KEY_PREFIX}it${runId}:`;
  // A killed run must not leave keys behind for good: the keys one call touched get a TTL after it.
  const through = async (call, build) => {
    const bag = new Set();
    const mv = (v) => {
      if (typeof v !== 'string' || !v.startsWith(KEY_PREFIX)) return v;
      const k = own + v.slice(KEY_PREFIX.length);
      bag.add(k);
      touched.add(k);
      return k;
    };
    try {
      return await call(build(mv));
    } finally {
      if (bag.size) await raw.pipeline([...bag].map((k) => ['EXPIRE', k, TTL_S]));
    }
  };
  return {
    touched,
    command: (args) => through(raw.command, (mv) => args.map(mv)),
    pipeline: (cmds) => through(raw.pipeline, (mv) => cmds.map((c) => c.map(mv))),
    script: (name, ks, args) => through((built) => raw.script(name, ...built), (mv) => [ks.map(mv), args.map(mv)]),
  };
}

// One side of the comparison: a client over `fetch`, with the commands it sent recorded.
function side({ url, token, fetch }, runId) {
  const sent = [];
  const recording = async (u, init) => {
    const body = JSON.parse(init.body);
    if (typeof body[0] === 'string') sent.push(body[0]); // single commands only, not pipelines
    return fetch(u, init);
  };
  const raw = createRedis({ url, token, fetch: recording });
  return { raw, sent, redis: isolate(raw, runId) };
}

const normalize = (flat) => {
  const o = {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return Object.fromEntries(Object.entries(o).sort());
};

// Runs the scenarios on one side → [[label, value], ...]. Same pids and clock on every side.
async function scenarios({ redis, raw, sent }) {
  const out = [];
  const note = (label, value) => out.push([label, value]);
  let n = 0;
  const store = createStore({ redis, registry, now: () => T0, random: (len) => new Uint8Array(len).fill(++n) });
  const nicks = new Set(['ada', 'grace', 'zed']);
  const pids = [];
  const subs = [];
  const snap = async (label) => {
    const cmds = [
      ...subs.map((s) => ['GET', keys.sub(s)]),
      ...pids.flatMap((p) => [['HGETALL', keys.profile(p)], ['HGETALL', keys.progress(p)]]),
      ...[...nicks].map((k) => ['GET', keys.nick(k)]),
      ['ZREVRANGE', keys.board, 0, -1, 'WITHSCORES'],
    ];
    const res = await redis.pipeline(cmds);
    let i = 0;
    const view = {
      subs: subs.map(() => res[i++]),
      hashes: pids.flatMap(() => [normalize(res[i++]), normalize(res[i++])]),
      nicks: [...nicks].map(() => res[i++]),
      board: res[i++].map((v, j) => (j % 2 ? Number(v) : v)),
    };
    note(`state ${label}`, view);
  };
  const join = async (sub, email) => {
    const r = await store.signIn(sub, email);
    pids.push(r.profile.pid);
    subs.push(sub);
    nicks.add(nickKey(r.profile.nick));
    return r.profile.pid;
  };
  const row = (r) => ({ ...r, progress: undefined });

  const a = await join('sub-a', 'aaa@dash0.com');
  const b = await join('sub-b', 'bbb@dash0.com');
  const ghost = 'no-such-pid';
  await snap('signed in');

  // cas-progress: ok, same-progress rewrite, zero total, stale rev, gone.
  note('put a', row(await store.putProgress(a, prog({ s1: 3, u: 5 }))));
  note('put a again', row(await store.putProgress(a, prog({ s1: 3 }))));
  note('put b zero', row(await store.putProgress(b, prog({ u: 2 }))));
  await snap('after puts');
  const casKeys = [keys.progress(a), keys.profile(a), keys.board];
  note('cas stale rev', await redis.script('cas-progress', casKeys, ['0', '{}', 1, T0, 5, a]));
  note('cas missing profile', await redis.script('cas-progress', [keys.progress(ghost), keys.profile(ghost), keys.board], ['0', '{}', 1, T0, 5, ghost]));
  note('put ghost', await store.putProgress(ghost, prog({ s1: 1 })));

  // claim-nick: win, case collision, own re-claim, releases the old claim, conflict, gone.
  note('nick Ada', await store.setNickname(a, 'Ada'));
  note('nick ADA by b', await store.setNickname(b, 'ADA'));
  note('nick 4da by b', await store.setNickname(b, '4da')); // a separate claim: nickKey does not fold leet
  note('nick ada own case', await store.setNickname(a, 'ada'));
  note('nick Grace', await store.setNickname(a, 'Grace'));
  note('nick ada by b', await store.setNickname(b, 'ada'));
  await snap('after nicks');
  // claim-nick: the old key is held by another pid, so a rename takes the new key and spares the old one.
  await redis.command(['SET', keys.nick('ada'), 'other-pid']);
  note('rename b, old key held by another', await store.setNickname(b, 'Zed'));
  await snap('old nick key spared');
  await redis.command(['DEL', keys.nick('ada')]); // the test's own key
  note('claim wrong old', await redis.script('claim-nick', [keys.profile(a), keys.nick('zed'), keys.nick('grace')], [a, 'Zed', 'zed', 'not-grace']));
  note('claim gone', await redis.script('claim-nick', [keys.profile(ghost), keys.nick('zed'), keys.nick('zed')], [ghost, 'Zed', 'zed', '']));
  note('nick ghost', await store.setNickname(ghost, 'Ghost'));

  // set-listing: off, on with a stored score, on with none, gone.
  note('unlist a', await store.setListing(a, false));
  await snap('unlisted');
  note('put a while unlisted', row(await store.putProgress(a, prog({ s1: 3, s2: 2 }))));
  note('list a', await store.setListing(a, true));
  const c = await join('sub-c', 'ccc@dash0.com'); // never saved: no progress hash at all
  note('list c (no progress)', await store.setListing(c, true));
  note('list b (no total)', await store.setListing(b, true));
  note('list ghost', await store.setListing(ghost, true));
  await snap('listed');
  note('board', await store.leaderboard({ pid: a }));

  // delete-account: conflict, then a nick key held by another pid is spared, then all of it goes.
  const delKeys = (p, sub, nk) => [keys.profile(p), keys.progress(p), keys.board, keys.sub(sub), keys.nick(nk)];
  note('delete wrong sub', await redis.script('delete-account', delKeys(a, 'sub-a', 'grace'), [a, 'other-sub', 'grace']));
  note('delete wrong nickKey', await redis.script('delete-account', delKeys(a, 'sub-a', 'grace'), [a, 'sub-a', 'other']));
  await redis.command(['SET', keys.nick('grace'), b]); // grace is now held by another pid
  note('delete a', await store.deleteAccount(a));
  await snap('a deleted');
  await redis.command(['DEL', keys.nick('grace')]); // the spared key is the test's own, not b's claim
  note('load a', await store.loadProfile(a));
  note('delete a twice', await store.deleteAccount(a));
  await redis.command(['SET', keys.sub('sub-b'), 'other-pid']); // the sub key now belongs to another pid
  note('delete b, sub key held by another', await store.deleteAccount(b));
  await snap('b deleted, sub key spared');
  await redis.command(['DEL', keys.sub('sub-b')]); // the test's own key
  note('delete c', await store.deleteAccount(c));
  await snap('all deleted');
  note('board after', await store.leaderboard());

  // errors: a failed command rejects with RedisError, an unknown script is refused client side.
  await assert.rejects(redis.command(['NOSUCHCOMMAND']), RedisError);
  await assert.rejects(redis.script('nope', [], []), RedisError);

  // NOSCRIPT: an unloaded sha is refused with text the client's fallback matches, and a script
  // still runs from this client, by EVALSHA alone or by EVALSHA then EVAL.
  await assert.rejects(raw.command(['EVALSHA', 'f'.repeat(40), '0']), /NOSCRIPT/i);
  const before = sent.length;
  note('script after noscript', await redis.script('set-listing', [keys.profile(ghost), keys.progress(ghost), keys.board], ['1', ghost]));
  const used = sent.slice(before);
  assert.ok(used[0] === 'EVALSHA' && (used.length === 1 || (used.length === 2 && used[1] === 'EVAL')), `scripts sent ${used}`);
  assert.equal(scriptSha('set-listing').length, 40);
  return out;
}

async function compare(left, right) {
  const [x, y] = [await scenarios(left), await scenarios(right)];
  assert.deepEqual(x.map(([l]) => l), y.map(([l]) => l));
  x.forEach(([label, value], i) => assert.deepEqual(value, y[i][1], `differs at: ${label}`));
  // Every store key is gone once both accounts are deleted (the board key, an emptied set, too).
  for (const s of [left, right]) {
    const all = [...s.redis.touched];
    assert.ok(all.length > 0);
    const present = (await s.raw.pipeline(all.map((k) => ['EXISTS', k]))).map((c, i) => (c ? all[i] : null)).filter(Boolean);
    assert.deepEqual(present, [], 'leftover keys');
  }
  return x.length;
}

const runId = () => randomBytes(6).toString('hex');
const fakeSide = (wrap = (f) => f) => {
  const fake = createFakeRedis();
  return side({ url: fake.url, token: fake.token, fetch: wrap(fake.fetch) }, runId());
};

describe('the comparison harness', () => {
  test('the fake ranks a sorted set with negative indexes as Redis does', async () => {
    const fake = createFakeRedis();
    const redis = createRedis({ url: fake.url, token: fake.token, fetch: fake.fetch });
    await redis.pipeline([['ZADD', 'z', 1, 'a'], ['ZADD', 'z', 3, 'c'], ['ZADD', 'z', 2, 'b']]);
    const range = (a, b) => redis.command(['ZREVRANGE', 'z', a, b]);
    assert.deepEqual(await range(0, -1), ['c', 'b', 'a']);
    assert.deepEqual(await range(0, 1), ['c', 'b']);
    assert.deepEqual(await range(-2, -1), ['b', 'a']);
    assert.deepEqual(await range(-10, 0), ['c']);
    assert.deepEqual(await range(1, -2), ['b']);
    assert.deepEqual(await range(2, 1), []);
    assert.deepEqual(await redis.command(['ZREVRANGE', 'none', 0, -1]), []);
  });

  test('the board snapshot sees the listed players', async () => {
    const out = await scenarios(fakeSide());
    const board = out.find(([label]) => label === 'state after puts')[1].board;
    assert.equal(board.length, 2); // one listed player with a total: [pid, score]
  });

  test('two fakes agree on every scenario', async () => {
    assert.ok((await compare(fakeSide(), fakeSide())) > 30);
  });

  test('it fails when one side answers a script differently (taken becomes ok)', async () => {
    const lie = (fetch) => async (u, init) => {
      const res = await fetch(u, init);
      const body = await res.clone().json();
      if (body?.result !== 'taken') return res;
      return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
    };
    await assert.rejects(compare(fakeSide(lie), fakeSide()), /differs at: nick ADA by b/);
  });

  test('it fails when one side leaves state behind (a successful delete that leaves its sub key)', async () => {
    const forgets = (fetch) => async (u, init) => {
      const res = await fetch(u, init);
      const cmd = JSON.parse(init.body);
      const isDelete = cmd[1] === scriptSha('delete-account') || cmd[1] === SCRIPTS['delete-account'];
      if (isDelete && (await res.clone().json()).result === 'ok') {
        const put = { ...init, body: JSON.stringify(['SET', cmd[6], 'left behind']) }; // KEYS[4], the sub key
        await fetch(u, put);
      }
      return res;
    };
    await assert.rejects(compare(fakeSide(forgets), fakeSide()), /differs at: state a deleted/);
  });
});

const ENV_HINT =
  'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN)';
const optedIn = process.env.REDIS_IT === '1';
const config = optedIn ? redisConfigFromEnv(process.env) : null;
const skipReason = optedIn
  ? false
  : `set REDIS_IT=1 plus ${ENV_HINT} (a dev database only) to run the Lua scripts against real Redis`;

describe('the Lua scripts on a real Redis', { skip: skipReason }, () => {
  test('REDIS_IT=1 comes with a store config', () => {
    // An explicit opt-in without a usable config is a failure, not a quiet skip.
    assert.notEqual(config, null, `REDIS_IT=1 needs a complete store config: ${ENV_HINT}`);
  });

  if (config === null) return;
  const live = side({ ...config, fetch: globalThis.fetch }, runId());
  after(async () => {
    // Keep deleting after a failed batch, then report it; the keys also carry a TTL.
    const mine = [...live.redis.touched];
    const failures = [];
    for (let i = 0; i < mine.length; i += 100) {
      try {
        await live.raw.command(['DEL', ...mine.slice(i, i + 100)]);
      } catch (err) {
        failures.push(err.message);
      }
    }
    assert.deepEqual(failures, [], 'cleanup: some keys were not deleted (they expire after an hour)');
  });

  test('every scenario gives the same results and state as the fake', async () => {
    const fake = createFakeRedis();
    await compare(live, side({ url: fake.url, token: fake.token, fetch: fake.fetch }, runId()));
  });
});
