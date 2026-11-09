// An in-memory Upstash Redis for tests and local dev (#273): speaks the REST protocol (one
// command per POST, `/pipeline` for many) over a fetch-shaped function, and runs each named
// Lua script from lib/account/redis.mjs as a JS twin. The twins mirror the Lua line by line;
// the Lua itself is only exercised against a real database. Test hooks:
//   fake.beforeScript = (name, keys, args) => {}   runs right before a script executes, so a
//                                                  test can inject a write between read and EVAL
//   fake.fail = 'throw' | 'http500' | 'error' | null   what every request does instead
//   fake.calls                                      every command received, in order
import { SCRIPTS, scriptSha } from '../lib/account/redis.mjs';

export function createFakeRedis({ token = 'fake-token', url = 'https://fake-redis.test' } = {}) {
  const db = new Map(); // key -> string | Map (hash) | {z: Map} (sorted set)
  const known = new Set(); // shas loaded by EVAL, as on a real server
  const calls = [];
  const state = { beforeScript: null, fail: null };

  const str = (k) => (typeof db.get(k) === 'string' ? db.get(k) : null);
  const hash = (k, make) => {
    const v = db.get(k);
    if (v instanceof Map) return v;
    if (!make) return null;
    const h = new Map();
    db.set(k, h);
    return h;
  };
  const zset = (k, make) => {
    const v = db.get(k);
    if (v && v.z) return v.z;
    if (!make) return null;
    const z = new Map();
    db.set(k, { z });
    return z;
  };
  const tidy = (k) => {
    const v = db.get(k);
    if ((v instanceof Map && v.size === 0) || (v && v.z && v.z.size === 0)) db.delete(k);
  };
  const ranked = (z) => [...z.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));

  const commands = {
    GET: ([k]) => str(k),
    SET: ([k, v, ...opts]) => {
      if (opts.includes('NX') && db.has(k)) return null;
      db.set(k, String(v));
      return 'OK';
    },
    DEL: (ks) => ks.filter((k) => db.delete(k)).length,
    EXISTS: (ks) => ks.filter((k) => db.has(k)).length,
    INCR: ([k]) => {
      const n = Number(str(k) ?? 0) + 1;
      db.set(k, String(n));
      return n;
    },
    EXPIRE: ([k]) => (db.has(k) ? 1 : 0),
    HGET: ([k, f]) => hash(k)?.get(f) ?? null,
    HGETALL: ([k]) => [...(hash(k)?.entries() ?? [])].flat(),
    HSET: ([k, ...kv]) => {
      const h = hash(k, true);
      let added = 0;
      for (let i = 0; i < kv.length; i += 2) {
        added += h.has(kv[i]) ? 0 : 1;
        h.set(kv[i], String(kv[i + 1]));
      }
      return added;
    },
    ZADD: ([k, score, member]) => {
      const z = zset(k, true);
      const had = z.has(member);
      z.set(member, Number(score));
      return had ? 0 : 1;
    },
    ZREM: ([k, member]) => {
      const z = zset(k);
      const had = z?.delete(member) ?? false;
      tidy(k);
      return had ? 1 : 0;
    },
    ZSCORE: ([k, m]) => {
      const s = zset(k)?.get(m);
      return s === undefined ? null : String(s);
    },
    ZCARD: ([k]) => zset(k)?.size ?? 0,
    ZREVRANK: ([k, m]) => {
      const i = ranked(zset(k) ?? new Map()).findIndex(([id]) => id === m);
      return i < 0 ? null : i;
    },
    ZREVRANGE: ([k, a, b, withScores]) => {
      const rows = ranked(zset(k) ?? new Map()).slice(Number(a), Number(b) + 1);
      return rows.flatMap(([m, s]) => (withScores === 'WITHSCORES' ? [m, String(s)] : [m]));
    },
  };

  // JS twins of SCRIPTS, same order of reads and writes.
  const twins = {
    'cas-progress': ([progress, profile, board], [expected, json, total, reachedAt, score, pid]) => {
      if (!db.has(profile)) return 'gone';
      const rev = hash(progress)?.get('rev') ?? '0';
      if (rev !== expected) return 'conflict';
      commands.HSET([progress, 'rev', String(Number(rev) + 1), 'json', json, 'total', total, 'reachedAt', reachedAt, 'score', score]);
      if (hash(profile)?.get('listed') === '1') commands.ZADD([board, score, pid]);
      return 'ok';
    },
    'claim-nick': ([profile], [pid, nick, nickKey, prefix]) => {
      if (!db.has(profile)) return 'gone';
      const next = prefix + nickKey;
      if (commands.SET([next, pid, 'NX']) === null && str(next) !== pid) return 'taken';
      const old = hash(profile)?.get('nickKey') ?? null;
      commands.HSET([profile, 'nick', nick, 'nickKey', nickKey]);
      if (old !== null && old !== nickKey && str(prefix + old) === pid) db.delete(prefix + old);
      return 'ok';
    },
    'set-listing': ([profile, progress, board], [listed, pid]) => {
      if (!db.has(profile)) return 'gone';
      commands.HSET([profile, 'listed', listed]);
      if (listed === '1') {
        const score = hash(progress)?.get('score');
        if (score !== undefined) commands.ZADD([board, score, pid]);
      } else {
        commands.ZREM([board, pid]);
      }
      return 'ok';
    },
    'delete-account': ([profile, progress, board], [pid, prefix]) => {
      const nickKey = hash(profile)?.get('nickKey');
      const sub = hash(profile)?.get('sub');
      if (nickKey && str(`${prefix}nick:${nickKey}`) === pid) db.delete(`${prefix}nick:${nickKey}`);
      if (sub && str(`${prefix}sub:${sub}`) === pid) db.delete(`${prefix}sub:${sub}`);
      commands.ZREM([board, pid]);
      db.delete(profile);
      db.delete(progress);
      return 'ok';
    },
  };
  const byText = new Map(Object.entries(SCRIPTS).map(([name, text]) => [text, name]));
  const byShaName = new Map(Object.keys(SCRIPTS).map((name) => [scriptSha(name), name]));

  function runScript(name, rest) {
    const n = Number(rest[0]);
    const keys = rest.slice(1, 1 + n);
    const args = rest.slice(1 + n).map(String);
    state.beforeScript?.(name, keys, args);
    return twins[name](keys, args);
  }

  function run(args) {
    const [name, ...rest] = args;
    const cmd = String(name).toUpperCase();
    calls.push(args);
    if (cmd === 'EVALSHA') {
      const script = byShaName.get(rest[0]);
      if (!script || !known.has(rest[0])) throw new Error('NOSCRIPT No matching script. Please use EVAL.');
      return runScript(script, rest.slice(1));
    }
    if (cmd === 'EVAL') {
      const script = byText.get(rest[0]);
      if (!script) throw new Error('ERR unknown script');
      known.add(scriptSha(script));
      return runScript(script, rest.slice(1));
    }
    if (!Object.hasOwn(commands, cmd)) throw new Error(`ERR unknown command '${cmd}'`);
    return commands[cmd](rest);
  }

  const answer = (command) => {
    try {
      return { result: run(command) };
    } catch (err) {
      return { error: err.message };
    }
  };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async function fetch(input, init = {}) {
    const target = String(input);
    if (state.fail === 'throw') throw new TypeError('fetch failed');
    if (state.fail === 'http500') return json({ error: 'boom' }, 500);
    if (state.fail === 'error') return json({ error: 'ERR fake failure' });
    if (!target.startsWith(url)) throw new TypeError('unknown host');
    if (init.headers?.authorization !== `Bearer ${token}`) return json({ error: 'Unauthorized' }, 401);
    const body = JSON.parse(init.body);
    const path = target.slice(url.length);
    if (path === '/pipeline') return json(body.map(answer));
    if (path === '' || path === '/') return json(answer(body));
    return json({ error: 'not found' }, 404);
  }

  return {
    url,
    token,
    fetch,
    db,
    calls,
    get beforeScript() {
      return state.beforeScript;
    },
    set beforeScript(fn) {
      state.beforeScript = fn;
    },
    get fail() {
      return state.fail;
    },
    set fail(mode) {
      state.fail = mode;
    },
    keys: () => [...db.keys()],
    // every string stored anywhere (keys, values, hash fields, members), for "nothing leaks" checks
    dump: () =>
      JSON.stringify(
        [...db.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v instanceof Map ? [...v] : [...v.z]]),
      ),
  };
}
