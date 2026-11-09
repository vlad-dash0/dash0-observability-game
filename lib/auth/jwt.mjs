// Google ID token verification with WebCrypto only. Pure: fetch and the clock are injected.
// Spec: docs/FOUNDATION.md §2.9.

export const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const ALLOWED_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const HOSTED_DOMAIN = 'dash0.com';
export const CLOCK_SKEW_MS = 60_000;
export const KID_REFETCH_MS = 60_000;

const ALG = 'RS256';
const encoder = new TextEncoder();

const fail = (reason) => ({ ok: false, reason });

function decodeSegment(segment) {
  if (typeof segment !== 'string' || segment === '' || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  const pad = '='.repeat((4 - (segment.length % 4)) % 4);
  const bin = atob(segment.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson(segment) {
  const bytes = decodeSegment(segment);
  if (!bytes) return null;
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function maxAgeMs(headers) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('cache-control') : null;
  const m = typeof raw === 'string' ? /max-age=(\d+)/i.exec(raw) : null;
  return m ? Number(m[1]) * 1000 : 0;
}

/**
 * An in-memory JWKS cache. `get(kid)` resolves `{ok:true, jwk}` or `{ok:false, reason}` with reason
 * `jwks` (fetch failed or odd body) or `kid` (not in the set, even after the throttled refetch).
 * The set is cached for the response's Cache-Control max-age; an unknown kid refetches at most
 * once a minute.
 */
export function createJwksCache({ fetch: doFetch, now }) {
  let keys = null;
  let expiresAt = 0;
  let fetchedAt = null;

  async function refresh() {
    fetchedAt = now();
    let res;
    let body;
    try {
      res = await doFetch(JWKS_URL);
      if (!res || !res.ok) return false;
      body = await res.json();
    } catch {
      return false;
    }
    if (!body || !Array.isArray(body.keys)) return false;
    keys = new Map(body.keys.filter((k) => k && typeof k.kid === 'string').map((k) => [k.kid, k]));
    expiresAt = fetchedAt + maxAgeMs(res.headers);
    return true;
  }

  return {
    async get(kid) {
      if (keys === null || now() >= expiresAt) {
        if (!(await refresh())) return fail('jwks');
      }
      if (keys.has(kid)) return { ok: true, jwk: keys.get(kid) };
      if (now() - fetchedAt >= KID_REFETCH_MS) {
        if (!(await refresh())) return fail('jwks');
        if (keys.has(kid)) return { ok: true, jwk: keys.get(kid) };
      }
      return fail('kid');
    },
  };
}

/**
 * Verify a Google ID token. Resolves `{ok:true, claims}` or `{ok:false, reason}`; never throws.
 * `jwks` is a `createJwksCache` result, `now` is epoch ms.
 */
export async function verifyIdToken(token, { jwks, clientId, nonce, now }) {
  try {
    return await verify(token, { jwks, clientId, nonce, now });
  } catch {
    return fail('format');
  }
}

async function verify(token, { jwks, clientId, nonce, now }) {
  if (typeof token !== 'string') return fail('format');
  const parts = token.split('.');
  if (parts.length !== 3) return fail('format');
  let header;
  let claims;
  let sig;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
    sig = decodeSegment(parts[2]);
  } catch {
    return fail('format');
  }
  if (!header || !claims || !sig) return fail('format');
  if (header.alg !== ALG) return fail('alg');
  if (typeof header.kid !== 'string') return fail('kid');

  const found = await jwks.get(header.kid);
  if (!found.ok) return fail(found.reason);

  const subtle = globalThis.crypto.subtle;
  let valid = false;
  try {
    const key = await subtle.importKey(
      'jwk', { kty: found.jwk.kty, n: found.jwk.n, e: found.jwk.e, alg: ALG, ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    valid = await subtle.verify('RSASSA-PKCS1-v1_5', key, sig, encoder.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    valid = false;
  }
  if (!valid) return fail('signature');

  if (!ALLOWED_ISSUERS.includes(claims.iss)) return fail('iss');
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(clientId) && claims.azp === clientId : aud === clientId;
  if (!audOk) return fail('aud');
  if (typeof claims.exp !== 'number' || !(claims.exp * 1000 > now - CLOCK_SKEW_MS)) return fail('expired');
  if (typeof claims.iat !== 'number' || !(claims.iat * 1000 <= now + CLOCK_SKEW_MS)) return fail('iat');
  if (typeof nonce !== 'string' || nonce === '' || claims.nonce !== nonce) return fail('nonce');
  if (claims.email_verified !== true) return fail('email');
  if (claims.hd !== HOSTED_DOMAIN) return fail('domain');
  if (typeof claims.email !== 'string' || !claims.email.toLowerCase().endsWith(`@${HOSTED_DOMAIN}`)) return fail('domain');
  if (typeof claims.sub !== 'string' || claims.sub === '') return fail('sub');
  return { ok: true, claims };
}
