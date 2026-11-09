// Signed session cookie: v1.<b64url {pid, gen, exp}>.<b64url HMAC-SHA256>. Pure; the caller passes
// the secret and the clock. Spec: docs/FOUNDATION.md §2.9.

export const SESSION_COOKIE = '__Host-oc-session';
export const SESSION_MAX_AGE = 2592000;
export const SESSION_VERSION = 'v1';
export const MIN_SECRET_BYTES = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

const toB64u = (bytes) => Buffer.from(bytes).toString('base64url');

function fromB64u(s) {
  if (typeof s !== 'string' || s === '' || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

const secretOk = (secret) => typeof secret === 'string' && encoder.encode(secret).length >= MIN_SECRET_BYTES;

const hmacKey = (secret, usages) =>
  globalThis.crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);

/** The configured secret, or null when missing or shorter than 32 bytes. */
export function sessionSecret(env) {
  const s = env && env.SESSION_SECRET;
  return secretOk(s) ? s : null;
}

/** Sign `{pid, gen, exp}` (exp in epoch ms). Throws when the secret is not configured. */
export async function signSession(payload, secret) {
  if (!secretOk(secret)) throw new Error('session secret not configured');
  const body = toB64u(encoder.encode(JSON.stringify({ pid: payload.pid, gen: payload.gen, exp: payload.exp })));
  const head = `${SESSION_VERSION}.${body}`;
  const mac = await globalThis.crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), encoder.encode(head));
  return `${head}.${toB64u(new Uint8Array(mac))}`;
}

/**
 * The payload when the value is well formed, correctly signed and not expired at `now` (epoch ms);
 * null otherwise. Never throws. The caller still has to load the profile and compare `gen`.
 */
export async function verifySession(value, secret, now) {
  try {
    if (!secretOk(secret) || typeof value !== 'string') return null;
    const parts = value.split('.');
    if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;
    const mac = fromB64u(parts[2]);
    const bodyBytes = fromB64u(parts[1]);
    if (!mac || !bodyBytes) return null;
    const ok = await globalThis.crypto.subtle.verify(
      'HMAC', await hmacKey(secret, ['verify']), mac, encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
    const p = JSON.parse(decoder.decode(bodyBytes));
    if (!p || typeof p.pid !== 'string' || p.pid === '' || typeof p.gen !== 'string' || p.gen === '') return null;
    if (typeof p.exp !== 'number' || !(p.exp > now)) return null;
    return { pid: p.pid, gen: p.gen, exp: p.exp };
  } catch {
    return null;
  }
}

/** Set-Cookie value for a signed session. */
export function serializeSessionCookie(value) {
  return `${SESSION_COOKIE}=${value}; ${ATTRIBUTES}; Max-Age=${SESSION_MAX_AGE}`;
}

/** Set-Cookie value that removes the session cookie. */
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;
}

/** The session cookie's value from a Cookie request header, or null. */
export function readSessionCookie(header) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}
