// OTLP/HTTP JSON sender and the one response classifier. Pure: fetch, timers and the
// AbortController are injected; nothing touches window. Contract: docs/DASH0-LAB.md §Sender.
//
// Outcome (the only three shapes; absence is never success):
//   {kind:'accepted'}
//   {kind:'rejected', status, auth, message?}   auth: 401/403; message capped, token redacted
//   {kind:'unreachable', cause}                 network | timeout | opaque | aborted
// A 2xx whose partialSuccess.rejectedSpans is not 0 is rejected with auth false.

// VERIFY (#195): the dataset header name; sent only when a dataset is given.
export const DATASET_HEADER = 'Dash0-Dataset';
export const TIMEOUT_MS = 10_000;
export const MESSAGE_CAP = 200;

export const OUTCOME = Object.freeze({
  accepted: 'accepted',
  rejected: 'rejected',
  unreachable: 'unreachable',
});

function redact(text, token) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const clean = token ? flat.split(token).join('[token]') : flat;
  return clean.slice(0, MESSAGE_CAP);
}

async function readBody(res) {
  try {
    if (typeof res.text === 'function') return await res.text();
    if (typeof res.json === 'function') return JSON.stringify(await res.json());
  } catch {
    // an unreadable body is treated as an absent one
  }
  return '';
}

function serverMessage(text, token) {
  if (text === '') return undefined;
  let msg = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === 'string') msg = parsed.message;
  } catch {
    // not JSON: use the text as is
  }
  const out = redact(msg, token);
  return out === '' ? undefined : out;
}

// A fetch Response (or lookalike) -> Outcome. Never contains the token.
export async function classifyResponse(res, { token } = {}) {
  const status = res?.status;
  if (!Number.isInteger(status) || status < 100) {
    return { kind: OUTCOME.unreachable, cause: 'opaque' };
  }
  const text = await readBody(res);
  if (status >= 200 && status < 300) {
    if (text.trim() === '') return { kind: OUTCOME.accepted };
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: OUTCOME.rejected, status, auth: false, message: 'Unreadable response body' };
    }
    const rejected = parsed?.partialSuccess?.rejectedSpans;
    if (rejected === undefined || rejected === null) return { kind: OUTCOME.accepted };
    const n = typeof rejected === 'string' && /^\d+$/.test(rejected) ? Number(rejected) : rejected;
    if (n === 0) return { kind: OUTCOME.accepted };
    const em = parsed.partialSuccess.errorMessage;
    const out = { kind: OUTCOME.rejected, status, auth: false };
    return typeof em === 'string' && em !== '' ? { ...out, message: redact(em, token) } : out;
  }
  const out = { kind: OUTCOME.rejected, status, auth: status === 401 || status === 403 };
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
    return await classifyResponse(res, { token });
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
