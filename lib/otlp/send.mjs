// OTLP/HTTP JSON sender and the one response classifier. Pure: fetch, timers and the
// AbortController are injected; nothing touches window. Contract: docs/DASH0-LAB.md §Sender.
//
// Outcome (the only three shapes; absence is never success):
//   {kind:'accepted'}
//   {kind:'rejected', status, auth, message?}   auth: 401/403 (never a message); message capped,
//                                               dropped whole if it echoes the token
//   {kind:'unreachable', cause}                 network | timeout | opaque | aborted
//                                               (also: a body that could not be read)
// A 2xx whose partialSuccess.rejectedSpans is not 0 is rejected with auth false.

// Dash0 dataset header (https://www.dash0.com/docs/dash0/miscellaneous/glossary/datasets);
// sent only when a dataset is given.
export const DATASET_HEADER = 'Dash0-Dataset';
export const TIMEOUT_MS = 10_000;
export const MESSAGE_CAP = 200;

export const OUTCOME = Object.freeze({
  accepted: 'accepted',
  rejected: 'rejected',
  unreachable: 'unreachable',
});

const RUN = 8;

// Every form the token can take inside a server message: raw, URL-encoded, JSON-escaped.
function tokenForms(token) {
  if (typeof token !== 'string' || token === '') return [];
  return [...new Set([token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)])];
}

// True when `text` holds the token or any 8+ character run of it, in any form.
function echoesToken(text, token) {
  for (const form of tokenForms(token)) {
    const n = Math.min(RUN, form.length);
    for (let i = 0; i + n <= form.length; i += 1) {
      if (text.includes(form.slice(i, i + n))) return true;
    }
  }
  return false;
}

// Server text -> a short message, or undefined when it echoes the token (dropped whole).
// The `[token]` replace stays as defence in depth.
function redact(text, token) {
  const raw = String(text);
  if (echoesToken(raw, token)) return undefined;
  const flat = raw.replace(/\s+/g, ' ').trim();
  const clean = token ? flat.split(token).join('[token]') : flat;
  const out = clean.slice(0, MESSAGE_CAP);
  return out === '' ? undefined : out;
}

// The body text, or null when reading it failed (never an empty stand-in).
async function readBody(res) {
  try {
    if (typeof res.text === 'function') return await res.text();
    if (typeof res.json === 'function') return JSON.stringify(await res.json());
  } catch {
    return null;
  }
  return '';
}

function serverMessage(text, token) {
  if (text === '') return undefined;
  if (echoesToken(text, token)) return undefined;
  let msg = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === 'string') msg = parsed.message;
  } catch {
    // not JSON: use the text as is
  }
  return redact(msg, token);
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A fetch Response (or lookalike) -> Outcome. Never contains the token. `readFailureCause`
// (optional) returns 'timeout' | 'aborted' | undefined for a body that could not be read.
export async function classifyResponse(res, { token, readFailureCause } = {}) {
  const status = res?.status;
  if (!Number.isInteger(status) || status < 100) {
    return { kind: OUTCOME.unreachable, cause: 'opaque' };
  }
  if (status === 401 || status === 403) {
    // Server text is never surfaced on an auth failure: it is the likeliest place to echo the token.
    return { kind: OUTCOME.rejected, status, auth: true };
  }
  const text = await readBody(res);
  if (text === null) {
    return { kind: OUTCOME.unreachable, cause: readFailureCause?.() ?? 'network' };
  }
  if (status >= 200 && status < 300) {
    if (text.trim() === '') return { kind: OUTCOME.accepted };
    const unreadable = {
      kind: OUTCOME.rejected,
      status,
      auth: false,
      message: 'Unreadable response body',
    };
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return unreadable;
    }
    if (!isPlainObject(parsed)) return unreadable;
    const rejected = parsed.partialSuccess?.rejectedSpans;
    if (rejected === undefined || rejected === null) return { kind: OUTCOME.accepted };
    const n = typeof rejected === 'string' && /^\d+$/.test(rejected) ? Number(rejected) : rejected;
    if (n === 0) return { kind: OUTCOME.accepted };
    const em = parsed.partialSuccess.errorMessage;
    const out = { kind: OUTCOME.rejected, status, auth: false };
    const message = typeof em === 'string' ? redact(em, token) : undefined;
    return message ? { ...out, message } : out;
  }
  const out = { kind: OUTCOME.rejected, status, auth: false };
  const message = serverMessage(text, token);
  return message ? { ...out, message } : out;
}

// POST an encoded request to `tracesUrl`. `body` is an object (JSON-encoded here) or a string.
// `signal` (optional) is the caller's abort (a level closing); the timeout is combined in.
export async function sendTraces({
  fetch,
  tracesUrl,
  token,
  dataset = null,
  body,
  signal,
  setTimeout,
  clearTimeout,
  timeoutMs = TIMEOUT_MS,
  AbortController: AC = globalThis.AbortController,
}) {
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
    throw new TypeError('sendTraces needs injected setTimeout and clearTimeout');
  }
  const controller = new AC();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal?.aborted) return { kind: OUTCOME.unreachable, cause: 'aborted' };
  signal?.addEventListener?.('abort', onAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (dataset) headers[DATASET_HEADER] = dataset;
  try {
    const res = await fetch(tracesUrl, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    return await classifyResponse(res, {
      token,
      readFailureCause: () => (timedOut ? 'timeout' : signal?.aborted ? 'aborted' : undefined),
    });
  } catch {
    // The error text is dropped on purpose: it can echo the URL or headers.
    if (timedOut) return { kind: OUTCOME.unreachable, cause: 'timeout' };
    if (signal?.aborted) return { kind: OUTCOME.unreachable, cause: 'aborted' };
    return { kind: OUTCOME.unreachable, cause: 'network' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
