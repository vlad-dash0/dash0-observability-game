// A small Upstash Redis REST client over an injected fetch (#273 P2b): env resolution, one
// command, a pipeline, and the named Lua scripts (EVALSHA first, EVAL when the server does
// not know the script yet). Every failure (network, timeout, non-2xx, an {error} body)
// throws RedisError; the store turns that into {ok:false, reason:'store'}.
// Spec: the #273 design, section 2. The read-only token is never used.
import { createHash } from 'node:crypto';

export const KEY_PREFIX = 'oc:v1:';
export const DEFAULT_TIMEOUT_MS = 3000;

export class RedisError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RedisError';
  }
}

const present = (v) => typeof v === 'string' && v !== '';
const clean = (url) => url.replace(/\/+$/, '');
const isHttp = (url) => /^https?:\/\/[^/\s]+/i.test(url);

// → {url, token} or null (not configured). UPSTASH_REDIS_REST_* wins over KV_REST_API_*;
// once the UPSTASH URL is set that pair is the one used, so a URL without its token is null
// rather than a silent fall back to the other pair.
export function redisConfigFromEnv(env) {
  const pairs = [
    [env?.UPSTASH_REDIS_REST_URL, env?.UPSTASH_REDIS_REST_TOKEN],
    [env?.KV_REST_API_URL, env?.KV_REST_API_TOKEN],
  ];
  const [url, token] = pairs.find(([u]) => present(u)) ?? [];
  return present(url) && present(token) && isHttp(url) ? { url: clean(url), token } : null;
}

// The scripts only compare and write values computed in JS. KEYS and ARGV are noted per script.
// A nil reply is Lua false, so a missing hash field is read as `or`-defaulted before use.
export const SCRIPTS = Object.freeze({
  // KEYS: progress, profile, board. ARGV: expectedRev, json, total, reachedAt, score, pid.
  // → 'gone' | 'conflict' | 'ok'. listed is read here, so a concurrent unlist is honoured.
  'cas-progress': `
if redis.call('EXISTS', KEYS[2]) == 0 then return 'gone' end
local rev = redis.call('HGET', KEYS[1], 'rev') or '0'
if rev ~= ARGV[1] then return 'conflict' end
redis.call('HSET', KEYS[1], 'rev', tostring(tonumber(rev) + 1), 'json', ARGV[2], 'total', ARGV[3], 'reachedAt', ARGV[4], 'score', ARGV[5])
if redis.call('HGET', KEYS[2], 'listed') == '1' then redis.call('ZADD', KEYS[3], ARGV[5], ARGV[6]) end
return 'ok'`,
  // KEYS: profile. ARGV: pid, nick, nickKey, nickKeyPrefix. → 'gone' | 'taken' | 'ok'.
  'claim-nick': `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'gone' end
local new = ARGV[4] .. ARGV[3]
if not redis.call('SET', new, ARGV[1], 'NX') then
  if redis.call('GET', new) ~= ARGV[1] then return 'taken' end
end
local old = redis.call('HGET', KEYS[1], 'nickKey')
redis.call('HSET', KEYS[1], 'nick', ARGV[2], 'nickKey', ARGV[3])
if old and old ~= ARGV[3] and redis.call('GET', ARGV[4] .. old) == ARGV[1] then redis.call('DEL', ARGV[4] .. old) end
return 'ok'`,
  // KEYS: profile, progress, board. ARGV: listed ('1' | '0'), pid. → 'gone' | 'ok'.
  'set-listing': `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'gone' end
redis.call('HSET', KEYS[1], 'listed', ARGV[1])
if ARGV[1] == '1' then
  local score = redis.call('HGET', KEYS[2], 'score')
  if score then redis.call('ZADD', KEYS[3], score, ARGV[2]) end
else
  redis.call('ZREM', KEYS[3], ARGV[2])
end
return 'ok'`,
  // KEYS: profile, progress, board. ARGV: pid, keyPrefix. → 'ok'.
  'delete-account': `
local nickKey = redis.call('HGET', KEYS[1], 'nickKey')
local sub = redis.call('HGET', KEYS[1], 'sub')
if nickKey and redis.call('GET', ARGV[2] .. 'nick:' .. nickKey) == ARGV[1] then redis.call('DEL', ARGV[2] .. 'nick:' .. nickKey) end
if sub and redis.call('GET', ARGV[2] .. 'sub:' .. sub) == ARGV[1] then redis.call('DEL', ARGV[2] .. 'sub:' .. sub) end
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('DEL', KEYS[1], KEYS[2])
return 'ok'`,
});

export const scriptSha = (name) => createHash('sha1').update(SCRIPTS[name]).digest('hex');

/**
 * → {command, pipeline, script} over `fetch`. Each throws RedisError on any failure.
 * `command(['SET', k, v])` → result; `pipeline([[...], ...])` → results in order, all or throw;
 * `script(name, keys, args)` → the script's reply.
 */
export function createRedis({ url, token, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  async function post(path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${clean(url)}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) throw new RedisError(`redis http ${res.status}`);
      return await res.json();
    } catch (err) {
      throw err instanceof RedisError ? err : new RedisError(`redis request failed: ${err?.name ?? 'error'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const unwrap = (item) => {
    if (item === null || typeof item !== 'object' || typeof item.error === 'string' || !('result' in item)) {
      throw new RedisError(`redis error: ${typeof item?.error === 'string' ? item.error : 'bad reply'}`);
    }
    return item.result;
  };

  const command = async (args) => unwrap(await post('', args));

  async function pipeline(commands) {
    const out = await post('/pipeline', commands);
    if (!Array.isArray(out) || out.length !== commands.length) throw new RedisError('redis error: bad pipeline reply');
    return out.map(unwrap);
  }

  async function script(name, keys, args) {
    if (!Object.hasOwn(SCRIPTS, name)) throw new RedisError(`unknown script ${name}`);
    const tail = [String(keys.length), ...keys, ...args.map(String)];
    try {
      return await command(['EVALSHA', scriptSha(name), ...tail]);
    } catch (err) {
      if (!/NOSCRIPT/i.test(err.message)) throw err;
    }
    return command(['EVAL', SCRIPTS[name], ...tail]);
  }

  return { command, pipeline, script };
}
