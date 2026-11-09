// A rig for the sign-in and account function tests (#273 P3): fake Redis, a fake Google (token and JWKS), a
// signed-in cookie maker and a Request builder. No network, no real clock.
import { createRedis } from '../../lib/account/redis.mjs';
import { createStore } from '../../lib/account/store.mjs';
import { JWKS_URL } from '../../lib/auth/jwt.mjs';
import { signSession } from '../../lib/auth/session.mjs';
import { createFakeRedis } from '../../tools/fake-redis.mjs';
import { createAccount } from '../../api/account.mjs';
import { createAuthCallback, TOKEN_URL } from '../../api/auth-callback.mjs';
import { createAuthStart } from '../../api/auth-start.mjs';

export const NOW = 1_800_000_000_000;
export const SEC = Math.floor(NOW / 1000);
export const ORIGIN = 'https://oncall.example.test';
export const HOST = 'oncall.example.test';
export const CLIENT = 'client-1.apps.googleusercontent.com';
export const SECRET = 's'.repeat(48);
export const ENV = Object.freeze({
  GOOGLE_CLIENT_ID: CLIENT,
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: SECRET,
  AUTH_ORIGIN: ORIGIN,
});
export const registry = {
  order: ['s1', 's2'],
  cardIds: [],
  levels: { s1: { scored: true, cards: [] }, s2: { scored: true, cards: [] } },
};

const subtle = globalThis.crypto.subtle;
const ALGO = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const enc = (obj) => b64u(new TextEncoder().encode(JSON.stringify(obj)));
const pair = await subtle.generateKey(ALGO, true, ['sign', 'verify']);
const jwk = { ...(await subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

/** A Google ID token for `claims` (over the base claims), signed with the key the fake JWKS serves. */
export async function mint(claims = {}, nonce = 'n') {
  const payload = {
    iss: 'https://accounts.google.com', aud: CLIENT, sub: 'g-1', nonce, exp: SEC + 3600, iat: SEC - 10,
    email: 'ada.lovelace@dash0.com', email_verified: true, hd: 'dash0.com', ...claims,
  };
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = enc(payload);
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(new Uint8Array(sig))}`;
}

/** Everything a test needs. `google.claims` and `google.token` steer the fake Google; `google.calls` records its URLs. */
export function rig({ env = ENV, registryOver = registry } = {}) {
  const fake = createFakeRedis();
  const clock = { t: NOW };
  const logs = [];
  let n = 0;
  const random = (len) => new Uint8Array(len).fill(++n % 250);
  const redis = createRedis({ url: fake.url, token: fake.token, fetch: fake.fetch });
  const google = { calls: [], claims: {}, token: null, tokenStatus: 200, tokenThrows: false, jwksThrows: false, tokenHangs: false, nonce: null, bodies: [] };
  async function fetch(url, init = {}) {
    google.calls.push(String(url));
    if (String(url) === JWKS_URL) {
      if (google.jwksThrows) throw new Error('network');
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'cache-control': 'max-age=3600' } });
    }
    if (String(url) === TOKEN_URL) {
      google.bodies.push(String(init.body));
      if (google.tokenThrows) throw new Error('network');
      if (google.tokenHangs) {
        // A stalled Google: it answers only when the request is aborted. Without a signal it would answer after 300 ms (a success).
        // The timer is ref'd and outlives the 20 ms timeout, so the event loop stays alive while we wait (AbortSignal.timeout's own timer is unref'd, which ends the process early on Node 22).
        await new Promise((resolve, reject) => {
          const hold = setTimeout(resolve, 300);
          if (init.signal) {
            init.signal.addEventListener('abort', () => {
              clearTimeout(hold);
              reject(new DOMException('aborted', 'TimeoutError'));
            });
          }
        });
      }
      if (google.tokenStatus !== 200) return new Response('{}', { status: google.tokenStatus });
      const nonce = google.nonce ?? 'n';
      return Response.json({ id_token: google.token ?? (await mint(google.claims, nonce)) });
    }
    throw new Error(`unexpected fetch ${url}`);
  }
  const deps = { env, fetch, redis, now: () => clock.t, random, registry: registryOver, log: (l) => logs.push(l), tokenTimeoutMs: 20 };
  const store = createStore({ redis, registry: registryOver, now: deps.now, random });
  return {
    fake, clock, logs, google, store, deps,
    start: createAuthStart(deps),
    callback: createAuthCallback(deps),
    account: createAccount(deps),
    storeCalls: () => fake.calls.length,
    /** A session cookie header for `pid` (gen defaults to the profile's). */
    async cookieFor(pid, { gen = '1', exp = NOW + 60_000 } = {}) {
      return `__Host-oc-session=${await signSession({ pid, gen, exp }, SECRET)}`;
    },
  };
}

export const get = (url, headers = {}) => new Request(url, { method: 'GET', headers });
export const post = (url, body, headers = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** `name=value` of the Set-Cookie called `name`, or null. */
export const setCookie = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;
export const cookieValue = (res, name) => setCookie(res, name)?.split(';')[0].slice(name.length + 1);

/**
 * Runs auth-start, then the callback with the query overrides (a null value omits the parameter);
 * the fake Google signs the nonce start made. → {startRes, res, authCookie, params}.
 */
export async function signInFlow(r, { cookie, query = {} } = {}) {
  const startRes = await r.start.GET(get(`${ORIGIN}/api/auth-start`));
  const authCookie = cookie ?? `__Host-oc-auth=${cookieValue(startRes, '__Host-oc-auth')}`;
  const params = Object.fromEntries(new URL(startRes.headers.get('location')).searchParams);
  r.google.nonce ??= params.nonce;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ code: 'the-code', state: params.state, ...query })) if (v !== null) q.set(k, v);
  const res = await r.callback.GET(get(`${ORIGIN}/api/auth-callback?${q}`, { cookie: authCookie }));
  return { startRes, res, authCookie, params };
}
