// What the sign-in and account functions share (#273 P3): the env check, the store, and the
// session lookup. Pure over injected `env`, `redis`, `now`, `random` and `registry`; nothing reads
// process.env here. Spec: docs/FOUNDATION.md §2.9.
import { createRedis, redisConfigFromEnv } from '../account/redis.mjs';
import { createStore } from '../account/store.mjs';
import { readCookie } from '../http.mjs';
import { SESSION_COOKIE, sessionSecret, verifySession } from './session.mjs';

export const CALLBACK_PATH = '/api/auth-callback';
export const STUB_SUB = 'stub-dev';
export const STUB_EMAIL = 'dev@dash0.com';

/** AUTH_ORIGIN as `{origin, host, local}`, or null when it is not an https URL or an http localhost one. */
function parseOrigin(raw) {
  try {
    const u = new URL(raw);
    const local = u.protocol === 'http:' && u.hostname === 'localhost';
    if (u.protocol !== 'https:' && !local) return null;
    return { origin: u.origin, host: u.host, local };
  } catch {
    return null;
  }
}

const present = (v) => typeof v === 'string' && v !== '';

/**
 * `{stub, clientId, clientSecret, secret, origin, host}` when sign-in is configured, else null.
 * The stub (AUTH_STUB=1) is honoured only when AUTH_ORIGIN is http://localhost: it never exists in production.
 */
export function authConfig(env) {
  const secret = sessionSecret(env);
  const where = parseOrigin(env?.AUTH_ORIGIN);
  if (secret === null || where === null) return null;
  if (env.AUTH_STUB === '1' && where.local) {
    return { stub: true, clientId: null, clientSecret: null, secret, origin: where.origin, host: where.host };
  }
  if (!present(env.GOOGLE_CLIENT_ID) || !present(env.GOOGLE_CLIENT_SECRET)) return null;
  return { stub: false, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, secret, origin: where.origin, host: where.host };
}

/** The request's own host: the Host header, else the URL's. */
export const requestHost = (request) => request.headers.get('host') ?? new URL(request.url).host;

/**
 * `{config, store(), session(request)}`. `config` is null when anything is missing (env, or no store).
 * `redis` is a ready client (the dev stub passes one); otherwise it is built from the env's store settings.
 */
export function createAuthContext({ env, redis = null, now, random, registry = null }) {
  let client = redis;
  if (client === null) {
    const rc = redisConfigFromEnv(env);
    if (rc !== null) client = createRedis(rc);
  }
  const base = authConfig(env);
  const config = base !== null && client !== null ? base : null;
  let store = null;
  let resolved = registry;
  return {
    config,
    /** The registry: the injected one, else the live one, loaded once. */
    async registry() {
      resolved ??= (await import('../../app.mjs')).liveRegistry();
      return resolved;
    },
    /** The store, built on first use (the live registry is only loaded when none was injected). */
    async store() {
      if (store === null) store = createStore({ redis: client, registry: await this.registry(), now, random });
      return store;
    },
    /**
     * The signed-in profile for a request: `{state:'none'}` (no cookie), `{state:'bad'}` (unverifiable, expired,
     * deleted or a stale `gen`), `{state:'store'}` (the store failed) or `{state:'ok', profile}`.
     */
    async session(request) {
      const raw = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
      if (raw === null) return { state: 'none' };
      const payload = await verifySession(raw, config.secret, now());
      if (payload === null) return { state: 'bad' };
      const loaded = await (await this.store()).loadProfile(payload.pid);
      if (!loaded.ok) return { state: 'store' };
      if (loaded.profile === null || String(loaded.profile.gen) !== payload.gen) return { state: 'bad' };
      return { state: 'ok', profile: loaded.profile };
    },
  };
}
