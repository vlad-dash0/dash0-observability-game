// Sign in with Google, step 2 (#273 P3; docs/FOUNDATION.md §2.9). GET checks the `__Host-oc-auth` cookie and the
// state, trades the code for an ID token (8 s timeout), verifies it, creates or loads the profile, sets the session
// cookie and clears the auth cookie. Every outcome is a 302 to /?signin=ok|new|domain|cancelled|failed|unavailable.
// The email is read once, by store.signIn, to make the default nickname; it is never stored or logged.
// With AUTH_STUB (localhost only) the token step is skipped and the user is dev@dash0.com.
import { createHash, timingSafeEqual } from 'node:crypto';
import { AUTH_COOKIE, clearAuthCookie, verifyAuth } from '../lib/auth/auth-cookie.mjs';
import { CALLBACK_PATH, STUB_EMAIL, STUB_SUB, createAuthContext, requestHost } from '../lib/auth/config.mjs';
import { createJwksCache, verifyIdToken } from '../lib/auth/jwt.mjs';
import { SESSION_MAX_AGE, serializeSessionCookie, signSession } from '../lib/auth/session.mjs';
import { readCookie, redirect, reply } from '../lib/http.mjs';
import { createServerTelemetry } from '../lib/otel/server.mjs';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_TIMEOUT_MS = 8000;
const MAX_CODE = 2048;

const to = (outcome) => `/?signin=${outcome}`;
/** Constant-time equality of two strings (both hashed first, so the lengths match). */
const sameSecret = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** The handlers over injected `env`, `fetch`, `redis`, `now`, `random`, `registry` and `log`. */
export function createAuthCallback({
  env = process.env,
  fetch = globalThis.fetch,
  redis = null,
  now = Date.now,
  random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  registry = null,
  log = (line) => console.log(JSON.stringify(line)),
  tokenTimeoutMs = TOKEN_TIMEOUT_MS,
} = {}) {
  const auth = createAuthContext({ env, redis, now, random, registry });
  const jwks = createJwksCache({ fetch, now });

  /** → `{ok:true, token}` or `{ok:false, outcome}`: a refusal from Google is `failed`, no answer is `unavailable`. */
  async function exchange(cfg, code, verifier) {
    let res;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
          redirect_uri: `${cfg.origin}${CALLBACK_PATH}`, grant_type: 'authorization_code', code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(tokenTimeoutMs),
      });
    } catch {
      return { ok: false, outcome: 'unavailable' };
    }
    if (!res.ok) return { ok: false, outcome: res.status >= 500 ? 'unavailable' : 'failed' };
    try {
      const body = await res.json();
      return typeof body?.id_token === 'string' ? { ok: true, token: body.id_token } : { ok: false, outcome: 'failed' };
    } catch {
      return { ok: false, outcome: 'failed' };
    }
  }

  async function GET(request) {
    const started = now();
    const done = (outcome, response) => {
      log({ msg: 'auth-callback', outcome, status: response.status, ms: now() - started });
      return response;
    };
    const stop = (outcome, signin) => done(outcome, redirect(to(signin), [clearAuthCookie()]));
    try {
      if (request.method !== 'GET') {
        return done('method', reply(405, { error: 'method-not-allowed' }, { allow: 'GET', 'set-cookie': [clearAuthCookie()] }));
      }
      const cfg = auth.config;
      if (cfg === null) return done('unconfigured', redirect(to('unavailable'), [clearAuthCookie()]));
      if (requestHost(request) !== cfg.host) return done('host', redirect(to('unavailable'), [clearAuthCookie()]));

      const params = new URL(request.url).searchParams;
      const saved = await verifyAuth(readCookie(request.headers.get('cookie'), AUTH_COOKIE), cfg.secret, now());
      const state = params.get('state');
      if (saved === null || state === null || !sameSecret(saved.state, state)) return stop('state', 'failed');
      if (params.get('error') !== null) {
        return params.get('error') === 'access_denied' ? stop('cancelled', 'cancelled') : stop('denied', 'failed');
      }
      const code = params.get('code');
      if (code === null || code === '' || code.length > MAX_CODE) return stop('no-code', 'failed');

      let claims;
      if (cfg.stub) {
        if (code !== 'stub') return stop('no-code', 'failed');
        claims = { sub: STUB_SUB, email: STUB_EMAIL };
      } else {
        const got = await exchange(cfg, code, saved.verifier);
        if (!got.ok) return stop(`token-${got.outcome}`, got.outcome);
        const verdict = await verifyIdToken(got.token, { jwks, clientId: cfg.clientId, nonce: saved.nonce, now: now() });
        if (!verdict.ok) {
          if (verdict.reason === 'jwks') return stop('jwks', 'unavailable');
          return verdict.reason === 'domain' ? stop('domain', 'domain') : stop(`id-token-${verdict.reason}`, 'failed');
        }
        claims = verdict.claims;
      }

      const signed = await (await auth.store()).signIn(claims.sub, claims.email);
      if (!signed.ok) return stop('store', 'unavailable');
      const session = await signSession(
        { pid: signed.profile.pid, gen: String(signed.profile.gen), exp: now() + SESSION_MAX_AGE * 1000 }, cfg.secret,
      );
      return done(signed.created ? 'created' : 'signed-in', redirect(to(signed.created ? 'new' : 'ok'), [serializeSessionCookie(session), clearAuthCookie()]));
    } catch {
      return done('error', redirect(to('failed'), [clearAuthCookie()])); // never the error: it could carry the code
    }
  }

  return { GET };
}

const telemetry = createServerTelemetry({ name: 'auth-callback', env: process.env });
const callback = createAuthCallback({ log: telemetry.log, fetch: telemetry.trace(globalThis.fetch) });
export const { GET } = telemetry.instrument(callback);
