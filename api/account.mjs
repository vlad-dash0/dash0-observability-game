// The account (#273 P3; docs/FOUNDATION.md §2.9). GET says who is signed in; POST `{v:1, action}` signs out,
// changes the nickname, shows or hides the player on the leaderboard, or deletes the account. Every POST needs an
// Origin on AUTH_ORIGIN's host and JSON (no CORS headers are ever sent). Logs carry no id, nickname or cookie.
import { clearSessionCookie } from '../lib/auth/session.mjs';
import { createAuthContext, requestHost } from '../lib/auth/config.mjs';
import { validateNick } from '../lib/account/nickname.mjs';
import { isJson, originMatches, reply } from '../lib/http.mjs';
import { createServerTelemetry } from '../lib/otel/server.mjs';

const MAX_BODY_BYTES = 1024;
const NICK_LIMIT = { max: 10, windowS: 3600 };
const ACTIONS = {
  signout: [],
  nickname: ['nick'],
  listing: ['listed'],
  delete: ['confirm'],
};
const CONFIRM = 'delete';

const SIGNED_OUT = Object.freeze({ v: 1, configured: true, signedIn: false });

/** The response for a refused store call: store, conflict -> 502; gone -> 401; limited -> 429; nickname reasons -> 400/409. */
function refusal(result, cookies = {}) {
  switch (result.reason) {
    case 'gone': return [401, { error: 'unauthenticated' }, { 'set-cookie': [clearSessionCookie()] }, 'gone'];
    case 'limited': return [429, { error: 'rate-limited', retryAfterS: result.retryAfterS }, { 'retry-after': String(result.retryAfterS) }, 'rate-limited'];
    case 'taken': return [409, { ok: false, error: 'nick-taken' }, cookies, 'nick-taken'];
    case 'format':
    case 'reserved':
    case 'blocked': return [400, { ok: false, error: 'bad-request', field: 'nick', reason: result.reason }, cookies, 'bad-nick'];
    default: return [502, { error: 'store-unavailable' }, cookies, 'store']; // store, conflict, anything unknown
  }
}

/** The handlers over injected `env`, `redis`, `now`, `random`, `registry` and `log`. */
export function createAccount({
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
      log({ msg: 'account', outcome, status, ms: now() - started });
      return reply(status, body, headers);
    };
    try {
      return await handler(request, done);
    } catch {
      return done(500, { error: 'internal' }, 'error');
    }
  };

  const GET = wrap(async (request, done) => {
    if (request.method !== 'GET') return done(405, { error: 'method-not-allowed' }, 'method', { allow: 'GET' });
    const cfg = auth.config;
    // A host that is not AUTH_ORIGIN's (a preview deploy) cannot sign in, so it looks unconfigured.
    if (cfg === null || requestHost(request) !== cfg.host) return done(200, { v: 1, configured: false }, 'unconfigured');
    const who = await auth.session(request);
    if (who.state === 'none') return done(200, SIGNED_OUT, 'signed-out'); // no cookie: no store call
    if (who.state === 'bad') return done(200, SIGNED_OUT, 'stale', { 'set-cookie': [clearSessionCookie()] });
    if (who.state === 'store') return done(502, { error: 'store-unavailable' }, 'store');
    const { nick, listed } = who.profile;
    return done(200, { v: 1, configured: true, signedIn: true, nick, listed }, 'signed-in');
  });

  const POST = wrap(async (request, done) => {
    if (request.method !== 'POST') return done(405, { error: 'method-not-allowed' }, 'method', { allow: 'POST' });
    const cfg = auth.config;
    if (cfg === null) return done(503, { error: 'not-configured' }, 'not-configured');
    if (!originMatches(request, cfg.origin)) return done(403, { error: 'forbidden' }, 'forbidden');
    if (!isJson(request)) return done(415, { error: 'unsupported-media-type' }, 'media-type');
    const declared = Number(request.headers.get('content-length'));
    if (declared > MAX_BODY_BYTES) return done(413, { error: 'too-large' }, 'too-large');
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return done(413, { error: 'too-large' }, 'too-large');
    const body = parse(text);
    if (body.field) return done(400, { ok: false, error: 'bad-request', field: body.field }, 'bad-request');

    if (body.action === 'signout') return done(200, { v: 1, ok: true }, 'signout', { 'set-cookie': [clearSessionCookie()] });

    const who = await auth.session(request);
    if (who.state === 'store') return done(502, { error: 'store-unavailable' }, 'store');
    if (who.state !== 'ok') return done(401, { error: 'unauthenticated' }, 'unauthenticated', { 'set-cookie': [clearSessionCookie()] });
    const { pid } = who.profile;
    const store = await auth.store();
    const fail = (result) => {
      const [status, out, headers, outcome] = refusal(result);
      return done(status, out, outcome, headers);
    };

    if (body.action === 'nickname') {
      // A name that cannot be claimed (format, reserved, blocked) is refused before the quota: it takes no quota.
      // A taken name does use the quota, so probing for taken names is bounded at NICK_LIMIT an hour.
      const valid = validateNick(body.nick);
      if (!valid.ok) return fail(valid);
      const limited = await store.rateLimit(pid, 'nick', NICK_LIMIT);
      if (!limited.ok) return fail(limited);
      const set = await store.setNickname(pid, body.nick);
      return set.ok ? done(200, { v: 1, ok: true, nick: set.nick }, 'nickname') : fail(set);
    }
    if (body.action === 'listing') {
      const set = await store.setListing(pid, body.listed);
      return set.ok ? done(200, { v: 1, ok: true, listed: set.listed }, 'listing') : fail(set);
    }
    const gone = await store.deleteAccount(pid);
    return gone.ok ? done(200, { v: 1, ok: true }, 'delete', { 'set-cookie': [clearSessionCookie()] }) : fail(gone);
  });

  return { GET, POST };
}

/** `{action, ...fields}` from the body text, or `{field}` naming what is wrong. Fields are listed, never bound blindly. */
function parse(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { field: 'body' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { field: 'body' };
  if (body.v !== 1) return { field: 'v' };
  if (typeof body.action !== 'string' || !Object.hasOwn(ACTIONS, body.action)) return { field: 'action' };
  const allowed = ['v', 'action', ...ACTIONS[body.action]];
  if (Object.keys(body).some((k) => !allowed.includes(k))) return { field: 'body' };
  if (body.action === 'nickname' && typeof body.nick !== 'string') return { field: 'nick' };
  if (body.action === 'listing' && typeof body.listed !== 'boolean') return { field: 'listed' };
  if (body.action === 'delete' && body.confirm !== CONFIRM) return { field: 'confirm' };
  return body;
}

const telemetry = createServerTelemetry({ name: 'account', env: process.env });
const account = createAccount({ log: telemetry.log });
export const { GET, POST } = telemetry.instrument(account);
