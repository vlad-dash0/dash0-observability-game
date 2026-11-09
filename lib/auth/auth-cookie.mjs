// The short-lived sign-in cookie `__Host-oc-auth`: a1.<b64url {state, nonce, verifier, exp}>.<b64url HMAC>.
// It is signed apart from the session cookie: its own tag (`a1`) and a key derived from SESSION_SECRET with
// HKDF and a distinct label, so neither cookie can verify as the other. Spec: docs/FOUNDATION.md §2.9.
import { sessionSecret } from './session.mjs';

export const AUTH_COOKIE = '__Host-oc-auth';
export const AUTH_MAX_AGE = 600;
export const AUTH_VERSION = 'a1';
export const AUTH_KEY_LABEL = 'oc-auth-cookie-v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';
const FIELDS = ['state', 'nonce', 'verifier'];

const toB64u = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64u = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) ? new Uint8Array(Buffer.from(s, 'base64url')) : null);

async function authKey(secret, usages) {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(AUTH_KEY_LABEL) },
    base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, usages,
  );
}

/** Sign `{state, nonce, verifier, exp}` (exp in epoch ms). Throws when the secret is not configured. */
export async function signAuth(payload, secret) {
  if (sessionSecret({ SESSION_SECRET: secret }) === null) throw new Error('session secret not configured');
  const body = toB64u(encoder.encode(JSON.stringify({
    state: payload.state, nonce: payload.nonce, verifier: payload.verifier, exp: payload.exp,
  })));
  const head = `${AUTH_VERSION}.${body}`;
  const mac = await globalThis.crypto.subtle.sign('HMAC', await authKey(secret, ['sign']), encoder.encode(head));
  return `${head}.${toB64u(new Uint8Array(mac))}`;
}

/** The payload when well formed, correctly signed and not expired at `now`; null otherwise. Never throws. */
export async function verifyAuth(value, secret, now) {
  try {
    if (sessionSecret({ SESSION_SECRET: secret }) === null || typeof value !== 'string') return null;
    const parts = value.split('.');
    if (parts.length !== 3 || parts[0] !== AUTH_VERSION) return null;
    const mac = fromB64u(parts[2]);
    const bodyBytes = fromB64u(parts[1]);
    if (!mac || !bodyBytes) return null;
    const ok = await globalThis.crypto.subtle.verify('HMAC', await authKey(secret, ['verify']), mac, encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const p = JSON.parse(decoder.decode(bodyBytes));
    if (!p || FIELDS.some((f) => typeof p[f] !== 'string' || p[f] === '')) return null;
    if (typeof p.exp !== 'number' || !(p.exp > now)) return null;
    return { state: p.state, nonce: p.nonce, verifier: p.verifier, exp: p.exp };
  } catch {
    return null;
  }
}

export const serializeAuthCookie = (value) => `${AUTH_COOKIE}=${value}; ${ATTRIBUTES}; Max-Age=${AUTH_MAX_AGE}`;
export const clearAuthCookie = () => `${AUTH_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;
