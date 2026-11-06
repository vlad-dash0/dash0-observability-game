// A fetch-compatible fake Dash0 ingress for practice mode. It is reached through the same
// sendTraces and classifyResponse as live, so the two cannot diverge. It never touches the
// network. Contract: docs/DASH0-LAB.md §Practice ingress.
//
// Rules, in order: foreign host -> throws TypeError (as a real unreachable host does); not
// POST -> 405; path other than /v1/traces -> 404; content type other than JSON -> 415;
// body not an OTLP traces request -> 400; missing or wrong token -> 401; the read-only token
// -> 403; else 200 {}.

import { PRACTICE_HOSTS } from '../dash0/ingress.mjs';

const respond = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

function header(headers, name) {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === want) return String(v);
  }
  return null;
}

// `token` (one string, or an array) is what the game shows for practice and the fake accepts;
// `readOnlyToken` is the one minted with a read-only scope (the wrong choice in the connect level).
export function createPracticeIngress({ token, readOnlyToken = null, hosts = PRACTICE_HOSTS }) {
  const accepted = new Set([token].flat());
  if (accepted.size === 0 || [...accepted].some((t) => typeof t !== 'string' || t === '')) {
    throw new TypeError('practice token required');
  }
  return async function practiceFetch(url, init = {}) {
    const u = new URL(url);
    if (!hosts.includes(u.hostname)) throw new TypeError('Failed to fetch');
    if (init.signal?.aborted) throw new TypeError('Failed to fetch');
    if (init.method !== 'POST') return respond(405, { message: 'Method not allowed' });
    if (u.pathname !== '/v1/traces') return respond(404, { message: 'Not found' });
    const type = header(init.headers, 'content-type') ?? '';
    if (type.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return respond(415, { message: 'Unsupported media type; send application/json' });
    }
    let parsed;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      return respond(400, { message: 'Body is not valid JSON' });
    }
    if (!Array.isArray(parsed?.resourceSpans)) {
      return respond(400, { message: 'Body is not an OTLP traces request' });
    }
    const auth = header(init.headers, 'authorization') ?? '';
    const sent = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (sent === '') return respond(401, { message: 'Missing or malformed Authorization' });
    if (readOnlyToken !== null && sent === readOnlyToken) {
      return respond(403, { message: 'This token cannot ingest' });
    }
    if (!accepted.has(sent)) return respond(401, { message: 'Unknown token' });
    return respond(200, {});
  };
}
