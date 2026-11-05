// OTLP/HTTP JSON sender and the one response classifier. Pure: fetch, timers and the
// AbortController are injected; nothing touches window. Contract: docs/DASH0-LAB.md §Sender.
//
// Outcome (the only three shapes; absence is never success):
//   {kind:'accepted'}
//   {kind:'rejected', status, auth, message?}   auth: 401/403 (never a message); message capped,
//                                               dropped whole if the response echoes the token
//   {kind:'unreachable', cause}                 network | timeout | opaque | aborted
//                                               (also: a body that could not be read)
// A 2xx whose partialSuccess.rejectedSpans is not 0 is rejected with auth false.
//
// Echo check, once per response: the haystack is the raw body plus, if it parses as JSON, its
// re-serialised form (\u escapes resolved); numeric and named (&amp; &lt; &gt; &quot;) HTML
// entities decoded, all whitespace stripped, lower-cased. Needles are the token and
// "Bearer <token>" raw, URL-encoded and JSON-escaped, plus base64 (standard and URL-safe) at the
// three byte alignments. Any 8+ character run of a needle (the whole needle if shorter) in the
// haystack drops every message of the response.

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

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"' };

function decodeEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot));/gi, (whole, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()];
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  });
}

// Entities decoded, all whitespace stripped (also the JSON escapes \n \r \t, even nested, which are
// whitespace once parsed), lower-cased: the one form both sides are compared in.
const normalise = (text) =>
  decodeEntities(text)
    .replace(/\\+[nrt]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Base64 of `text` as it can appear inside a longer base64 string: the three byte alignments,
// with the characters that depend on neighbouring bytes cut off. Standard and URL-safe alphabets.
function base64Forms(text) {
  const bytes = new TextEncoder().encode(text);
  const forms = [];
  for (const pad of [0, 1, 2]) {
    const all = [...new Uint8Array(pad), ...bytes];
    let out = '';
    for (let i = 0; i < all.length; i += 3) {
      const n = (all[i] << 16) | ((all[i + 1] ?? 0) << 8) | (all[i + 2] ?? 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    const full = Math.floor(all.length / 3) * 4;
    // keep only the whole groups, minus the leading chars that include the pad bytes
    const lead = [0, 2, 3][pad];
    const core = out.slice(lead, full);
    if (core !== '') forms.push(core, core.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return forms;
}

// Every shape the token can take in a server message, normalised, deduplicated.
function needlesFor(token) {
  if (typeof token !== 'string' || token === '') return [];
  const plain = [token, `Bearer ${token}`];
  const forms = [];
  for (const p of plain) forms.push(p, encodeURIComponent(p), JSON.stringify(p).slice(1, -1));
  const out = new Set(forms.map(normalise));
  for (const p of plain) for (const b of base64Forms(p)) out.add(b.toLowerCase());
  out.delete('');
  return [...out];
}

// True when the normalised text holds a needle, or any 8+ character run of one.
function echoes(haystack, needles) {
  for (const needle of needles) {
    const n = Math.min(RUN, needle.length);
    for (let i = 0; i + n <= needle.length; i += 1) {
      if (haystack.includes(needle.slice(i, i + n))) return true;
    }
  }
  return false;
}

// The raw text plus, when it parses as JSON, its re-serialised form (which resolves \u escapes),
// normalised. Built once per response, before any message is surfaced.
function haystackOf(text) {
  let hay = normalise(text);
  try {
    hay += '|' + normalise(JSON.stringify(JSON.parse(text)));
  } catch {
    // not JSON: the raw text is all there is
  }
  return hay;
}

// Server text -> a short message, or undefined when empty. Echo checking already happened.
function shorten(text) {
  const out = String(text).replace(/\s+/g, ' ').trim().slice(0, MESSAGE_CAP);
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

function serverMessage(text) {
  if (text === '') return undefined;
  let msg = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === 'string') msg = parsed.message;
  } catch {
    // not JSON: use the text as is
  }
  return shorten(msg);
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
  // One search per response, before any message is surfaced: a hit drops every message.
  const leaked = echoes(haystackOf(text), needlesFor(token));
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
    const message = typeof em === 'string' && !leaked ? shorten(em) : undefined;
    return message ? { ...out, message } : out;
  }
  const out = { kind: OUTCOME.rejected, status, auth: false };
  const message = leaked ? undefined : serverMessage(text);
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
