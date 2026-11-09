// Shared HTTP helpers for the `api/` functions (Web Request in, Response out): the JSON reply, the
// Origin checks, cookie reading and the redirect. Pure; nothing reads process.env.

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** A JSON response; `headers` may carry an array for a repeated header (`set-cookie`). */
export function reply(status, body, headers = {}) {
  const out = new Headers(JSON_HEADERS);
  appendAll(out, headers);
  return new Response(JSON.stringify(body), { status, headers: out });
}

/** A 302 with a Location and any number of Set-Cookie values. No body, never cached. */
export function redirect(location, cookies = []) {
  const out = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) out.append('set-cookie', c);
  return new Response(null, { status: 302, headers: out });
}

function appendAll(target, headers) {
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach((x) => target.append(k, x));
    else target.set(k, v);
  }
}

/** An `Origin` header, when sent, must name the host the request came to; a request without one (curl) passes. */
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    const host = request.headers.get('host') ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The strict form for state-changing account calls: an Origin is required and its host must equal `expectedHost`. */
export function originMatches(request, expectedHost) {
  const origin = request.headers.get('origin');
  if (origin === null || typeof expectedHost !== 'string' || expectedHost === '') return false;
  try {
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
}

/** True for `Content-Type: application/json` with optional parameters. */
export const isJson = (request) => /^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '');

/** The value of cookie `name` in a Cookie request header, or null. */
export function readCookie(header, name) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** The first hop of `x-forwarded-for`, or 'unknown'. */
export const clientKey = (request) => request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
