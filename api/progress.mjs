// Saved progress (#273 P4; docs/FOUNDATION.md §2.9). GET returns the signed-in player's progress, stars and rank.
// POST `{v:1, progress}` merges it into the stored record on the server, which computes the total itself: a client-sent
// total or any other field is a 400. Plausibility is logged, never blocked. Logs carry no id, nickname or cookie.
import { clearSessionCookie } from '../lib/auth/session.mjs';
import { createAuthContext } from '../lib/auth/config.mjs';
import { isJson, originMatches, reply } from '../lib/http.mjs';
import { starTotals } from '../lib/progress.mjs';

export const MAX_BODY_BYTES = 16 * 1024;
export const WRITE_LIMIT = { max: 30, windowS: 600 };
export const JUMP_SHARE = 0.5;
export const FAST_MAX_MS = 30 * 60 * 1000;
const BODY_KEYS = ['v', 'progress'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The refusal for a failed store call: gone -> 401 (cookie cleared); limited -> 429; anything else 502. */
function refusal(result) {
  switch (result.reason) {
    case 'gone': return [401, { error: 'unauthenticated' }, { 'set-cookie': [clearSessionCookie()] }, 'gone'];
    case 'limited': return [429, { error: 'rate-limited', retryAfterS: result.retryAfterS }, { 'retry-after': String(result.retryAfterS) }, 'rate-limited'];
    default: return [502, { error: 'store-unavailable' }, {}, 'store']; // store, conflict, anything unknown
  }
}

/** The handlers over injected `env`, `redis`, `now`, `random`, `registry` and `log`. */
export function createProgress({
  env = process.env,
  redis = null,
  now = Date.now,
  random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  registry = null,
  log = (line) => console.log(JSON.stringify(line)),
} = {}) {
  const auth = createAuthContext({ env, redis, now, random, registry });

  const wrap = (handler) => async (request) => {
    const started = now();
    const done = (status, body, outcome, headers) => {
      log({ msg: 'progress', outcome, status, ms: now() - started });
      return reply(status, body, headers);
    };
    try {
      return await handler(request, done);
    } catch {
      return done(500, { error: 'internal' }, 'error');
    }
  };

  /** The signed-in profile, or a ready response (503, 502 or 401). */
  async function signedIn(request, done) {
    if (auth.config === null) return { res: done(503, { error: 'not-configured' }, 'not-configured') };
    const who = await auth.session(request);
    if (who.state === 'store') return { res: done(502, { error: 'store-unavailable' }, 'store') };
    if (who.state !== 'ok') return { res: done(401, { error: 'unauthenticated' }, 'unauthenticated', who.state === 'bad' ? { 'set-cookie': [clearSessionCookie()] } : {}) };
    return { profile: who.profile };
  }

  const GET = wrap(async (request, done) => {
    if (request.method !== 'GET') return done(405, { error: 'method-not-allowed' }, 'method', { allow: 'GET' });
    const { res, profile } = await signedIn(request, done);
    if (res) return res;
    const got = await (await auth.store()).getProgress(profile.pid);
    if (!got.ok) {
      const [status, out, headers, outcome] = refusal(got);
      return done(status, out, outcome, headers);
    }
    return done(200, { v: 1, progress: got.progress, stars: got.stars, rank: got.rank }, 'read');
  });

  const POST = wrap(async (request, done) => {
    if (request.method !== 'POST') return done(405, { error: 'method-not-allowed' }, 'method', { allow: 'POST' });
    const cfg = auth.config;
    if (cfg === null) return done(503, { error: 'not-configured' }, 'not-configured');
    if (!originMatches(request, cfg.host)) return done(403, { error: 'forbidden' }, 'forbidden');
    if (!isJson(request)) return done(415, { error: 'unsupported-media-type' }, 'media-type');
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return done(413, { error: 'too-large' }, 'too-large');
    const { res, profile } = await signedIn(request, done);
    if (res) return res;
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return done(413, { error: 'too-large' }, 'too-large');
    const body = parse(text);
    if (body.field) return done(400, { ok: false, error: 'bad-request', field: body.field }, 'bad-request');

    const store = await auth.store();
    const limited = await store.rateLimit(profile.pid, 'progress', WRITE_LIMIT);
    if (!limited.ok) {
      const [status, out, headers, outcome] = refusal(limited);
      return done(status, out, outcome, headers);
    }
    const before = await store.getProgress(profile.pid); // a failed read only skips the plausibility check
    const put = await store.putProgress(profile.pid, body.progress);
    if (!put.ok) {
      const [status, out, headers, outcome] = refusal(put);
      return done(status, out, outcome, headers);
    }
    const reg = registry ?? (await import('../app.mjs')).liveRegistry();
    const why = implausible({ before: before.ok ? (before.stars ?? 0) : null, after: put.stars, max: starTotals(put.progress, reg).max, created: profile.created, at: now() });
    if (why !== null) log({ msg: 'board', outcome: 'implausible', why });
    return done(200, { v: 1, progress: put.progress, stars: put.stars, rank: put.rank }, 'write');
  });

  return { GET, POST };
}

/** 'jump' (one write raised the total by more than half the maximum), 'fast' (the maximum within 30 minutes of the account), else null. */
export function implausible({ before, after, max, created, at }) {
  if (before === null || !(max > 0)) return null;
  if (after - before > JUMP_SHARE * max) return 'jump';
  if (before < max && after === max && Number.isFinite(created) && at - created <= FAST_MAX_MS) return 'fast';
  return null;
}

/** `{progress}` from the body text, or `{field}` naming what is wrong. Only `v` and `progress` are accepted. */
function parse(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { field: 'body' };
  }
  if (!isObject(body)) return { field: 'body' };
  if (body.v !== 1) return { field: 'v' };
  const extra = Object.keys(body).find((k) => !BODY_KEYS.includes(k));
  if (extra !== undefined) return { field: 'body' };
  if (!isObject(body.progress) || !isObject(body.progress.levels)) return { field: 'progress' };
  return body;
}

const progress = createProgress();
export const GET = progress.GET;
export const POST = progress.POST;
