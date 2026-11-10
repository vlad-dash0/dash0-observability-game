// Sign in with Google, step 1 (#273 P3): a plain OIDC redirect (docs/FOUNDATION.md §2.9). GET makes a state, a
// nonce and a PKCE verifier, keeps them in the signed `__Host-oc-auth` cookie and 302s to Google. Unconfigured, or a
// host that is not AUTH_ORIGIN's (a preview deploy), goes to /?signin=unavailable. A browser navigation, so every
// outcome is a redirect. Logs carry no address, id or value.
import { createHash } from 'node:crypto';
import { AUTH_MAX_AGE, serializeAuthCookie, signAuth } from '../lib/auth/auth-cookie.mjs';
import { CALLBACK_PATH, createAuthContext, requestHost } from '../lib/auth/config.mjs';
import { createLimiter } from '../lib/guide/limit.mjs';
import { clientKey, redirect, reply } from '../lib/http.mjs';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const HOSTED_DOMAIN_HINT = 'dash0.com';
const START_MAX = 100;
const LIMITER_KEYS = 50_000; // many addresses in one window must not evict an over-limit one
const START_WINDOW_MS = 10 * 60 * 1000;
const UNAVAILABLE = '/?signin=unavailable';

/** The handlers over injected `env`, `redis`, `now`, `random`, `registry`, `log` and `limiter`. */
export function createAuthStart({
  env = process.env,
  redis = null,
  now = Date.now,
  random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  registry = null,
  log = (line) => console.log(JSON.stringify(line)),
  limiter = createLimiter({ now, clientMax: START_MAX, clientWindowMs: START_WINDOW_MS, instanceMax: Infinity, maxKeys: LIMITER_KEYS }), // per IP only
} = {}) {
  const auth = createAuthContext({ env, redis, now, random, registry });
  const b64u = (bytes) => Buffer.from(bytes).toString('base64url');

  async function GET(request) {
    const started = now();
    const done = (outcome, response) => {
      log({ msg: 'auth-start', outcome, status: response.status, ms: now() - started });
      return response;
    };
    try {
      if (request.method !== 'GET') return done('method', reply(405, { error: 'method-not-allowed' }, { allow: 'GET' }));
      const cfg = auth.config;
      if (cfg === null) return done('unconfigured', redirect(UNAVAILABLE));
      if (requestHost(request) !== cfg.host) return done('host', redirect(UNAVAILABLE));
      if (!limiter.take(clientKey(request)).ok) return done('rate-limited', redirect(UNAVAILABLE));

      const state = b64u(random(32));
      const nonce = b64u(random(32));
      const verifier = b64u(random(32));
      const cookie = await signAuth({ state, nonce, verifier, exp: now() + AUTH_MAX_AGE * 1000 }, cfg.secret);
      let location;
      if (cfg.stub) {
        location = `${cfg.origin}${CALLBACK_PATH}?${new URLSearchParams({ code: 'stub', state })}`;
      } else {
        const challenge = b64u(createHash('sha256').update(verifier).digest());
        location = `${GOOGLE_AUTH_URL}?${new URLSearchParams({
          client_id: cfg.clientId,
          redirect_uri: `${cfg.origin}${CALLBACK_PATH}`,
          response_type: 'code',
          scope: 'openid email',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          nonce,
          hd: HOSTED_DOMAIN_HINT,
          prompt: 'select_account',
        })}`;
      }
      return done('redirected', redirect(location, [serializeAuthCookie(cookie)]));
    } catch {
      return done('error', redirect(UNAVAILABLE));
    }
  }

  return { GET };
}

const start = createAuthStart();
export const GET = start.GET;
