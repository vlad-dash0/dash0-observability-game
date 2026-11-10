// The leaderboard (#273 P4; docs/FOUNDATION.md §2.9). Anonymous reads are allowed; a signed-in reader also gets their own
// line. Never a pid. A failed store is 502, never 200 with an empty list. Logs carry no id, nickname or cookie.
import { createAuthContext } from '../lib/auth/config.mjs';
import { clientKey, reply } from '../lib/http.mjs';
import { createLimiter } from '../lib/guide/limit.mjs';

export const TOP = 10;
export const READ_MAX = 120;
const LIMITER_KEYS = 50_000; // many addresses in one window must not evict an over-limit one
export const READ_WINDOW_MS = 60 * 1000;

/** The handlers over injected `env`, `redis`, `now`, `random`, `registry`, `log` and `limiter`. */
export function createLeaderboard({
  env = process.env,
  redis = null,
  now = Date.now,
  random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  registry = null,
  log = (line) => console.log(JSON.stringify(line)),
  limiter = createLimiter({ now, clientMax: READ_MAX, clientWindowMs: READ_WINDOW_MS, instanceMax: Infinity, maxKeys: LIMITER_KEYS }), // per IP only
} = {}) {
  const auth = createAuthContext({ env, redis, now, random, registry });

  async function GET(request) {
    const started = now();
    const done = (status, body, outcome, headers) => {
      log({ msg: 'leaderboard', outcome, status, ms: now() - started });
      return reply(status, body, headers);
    };
    try {
      if (request.method !== 'GET') return done(405, { error: 'method-not-allowed' }, 'method', { allow: 'GET' });
      if (auth.config === null) return done(503, { error: 'not-configured' }, 'not-configured');
      const taken = limiter.take(clientKey(request));
      if (!taken.ok) return done(429, { error: 'rate-limited', retryAfterS: taken.retryAfterS }, 'rate-limited', { 'retry-after': String(taken.retryAfterS) });
      const who = await auth.session(request); // no cookie: no store call; a bad cookie reads as anonymous
      if (who.state === 'store') return done(502, { error: 'store-unavailable' }, 'store');
      const pid = who.state === 'ok' ? who.profile.pid : null;
      const board = await (await auth.store()).leaderboard({ pid, top: TOP });
      if (!board.ok) return done(502, { error: 'store-unavailable' }, 'store');
      return done(200, { v: 1, ok: true, size: board.size, top: board.top, me: board.me }, 'read');
    } catch {
      return done(500, { error: 'internal' }, 'error');
    }
  }

  return { GET };
}

const leaderboard = createLeaderboard();
export const GET = leaderboard.GET;
