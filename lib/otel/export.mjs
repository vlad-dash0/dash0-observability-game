// The time-limited export of one encoded trace batch, shared by lib/otel/server.mjs (the api/ spans) and
// api/events.mjs (the game's play events): check the byte cap, send under the 500 ms flush limit, map the
// sender's answer to one outcome. Pure over injected `send`, `setTimeout` and `clearTimeout`.
// Why a limit: Vercel may freeze the function once the response is returned, so the export is awaited
// first (the ForceFlush rule level 9.8 teaches), but a slow ingress must not hold the player.
export const EXPORT_TIMEOUT_MS = 450;
export const FLUSH_BUDGET_MS = 500;
export const MAX_EXPORT_BYTES = 64 * 1024;

const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** A lowercase hex id of `bytes` random bytes, redrawn once when it comes out all zero (the spec forbids it). */
export function drawHexId(random, bytes) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = random(bytes);
    if (!(raw instanceof Uint8Array) || raw.length !== bytes) throw new TypeError('bad random bytes');
    const hex = toHex(raw);
    if (/[1-9a-f]/.test(hex)) return hex;
  }
  throw new RangeError('random gave an all-zero id twice');
}

// A telemetry fault: the one dropped/internal outcome.
const internalDrop = (spans) => ({ kind: 'dropped', reason: 'internal', spans });

function classify(sent, spans) {
  switch (sent?.kind) {
    case 'accepted':
      return { kind: 'exported', spans };
    case 'rejected':
      return sent.auth
        ? { kind: 'dropped', reason: 'auth', spans }
        : { kind: 'dropped', reason: 'rejected', spans, ingressStatus: sent.status };
    case 'unreachable':
      return { kind: 'dropped', reason: sent.cause, spans };
    default:
      return internalDrop(spans);
  }
}

/**
 * Size-check `body`, send it under the flush budget -> `{kind:'exported', spans}` or
 * `{kind:'dropped', reason, spans, ingressStatus?}`. Never rejects for a failing `send`; it can throw
 * only when `body` cannot be serialised or a timer function throws.
 */
export async function exportWithinBudget({ body, spans, send, setTimeout, clearTimeout, maxBytes = MAX_EXPORT_BYTES }) {
  if (Buffer.byteLength(JSON.stringify(body)) > maxBytes) return { kind: 'dropped', reason: 'too-large', spans };
  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'dropped', reason: 'budget', spans }), FLUSH_BUDGET_MS);
  });
  const exporting = (async () => classify(await send(body), spans))().catch(() => internalDrop(spans));
  try {
    return await Promise.race([exporting, budget]);
  } finally {
    clearTimeout(timer);
  }
}
