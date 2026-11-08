// Anonymous save codes (#18): the progress record as a short, versioned, checksummed string a
// player copies to another browser, and the import preview. Pure; nothing here touches
// storage or the DOM. A code looks like `oc1.<base64url payload>.<8 hex checksum>`.
// The checksum catches typos and cut-off copies; it is not a signature, so a code can be
// edited by hand on purpose (progress is local and anonymous, nothing is at stake).
// Decoding refuses anything malformed as a whole, with a reason; it never imports part of a
// code and never throws. Ids the registry does not know are dropped, never invented.
// Import merges with mergeProgress, so best stars win and completion only goes up (F4).
// Spec: docs/FOUNDATION.md §2.5 "Save codes".
import { isId, mergeProgress, registryIds, sanitizeProgress } from './progress.mjs';
import { MAX_STARS } from './scoring.mjs';
import { isCompleted } from './unlock.mjs';

export const SAVE_VERSION = 1;
const PREFIX = 'oc';
const MAX_CODE_LENGTH = 24000;
const MAX_ENTRIES = 500;
const MAX_AT_MS = 253402300799999; // 9999-12-31T23:59:59.999Z, the last year a stored time can name

// Player-facing text for each refusal reason.
export const REFUSALS = Object.freeze({
  empty: 'Paste a code first.',
  format: 'That is not a save code. Check that you copied all of it.',
  version: 'That code is from a different version of the game.',
  checksum: 'That code has a typo or is cut short. Copy it again.',
  shape: 'That code cannot be read. Copy it again.',
});

// FNV-1a, 32 bit, as 8 hex digits.
function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

// Bytes, or null for a character outside the alphabet or an impossible length.
function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const bytes = [];
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    const chunk = text.slice(i, i + 4);
    for (let j = 0; j < 4; j++) n = (n << 6) | (j < chunk.length ? ALPHABET.indexOf(chunk[j]) : 0);
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  return Uint8Array.from(bytes);
}

/**
 * The code for `progress` (only the registry's levels and cards are written). Always
 * succeeds; an empty record still gets a valid code.
 */
export function encodeProgress(progress, registry) {
  const ids = registryIds(registry);
  const p = sanitizeProgress(progress, { ...ids, keep: ids });
  const l = Object.keys(p.levels).sort().map((id) => {
    const { stars, at } = p.levels[id];
    // A time before 1970 has no code form (the decoder reads unsigned base36), so it is left out.
    const ms = at === null ? -1 : Date.parse(at);
    return [id, stars, ms < 0 ? null : ms.toString(36)];
  });
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ l, c: p.cards })));
  const head = `${PREFIX}${SAVE_VERSION}.${payload}`;
  return `${head}.${checksum(head)}`;
}

// Whole-or-nothing shape check of the parsed payload → {levels, cards} or null.
function readPayload(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!Array.isArray(data.l) || !Array.isArray(data.c)) return null;
  if (data.l.length > MAX_ENTRIES || data.c.length > MAX_ENTRIES) return null;
  const levels = Object.create(null);
  for (const row of data.l) {
    if (!Array.isArray(row) || row.length !== 3) return null;
    const [id, stars, at] = row;
    if (!isId(id) || Object.hasOwn(levels, id)) return null;
    if (!Number.isInteger(stars) || stars < 0 || stars > MAX_STARS) return null;
    let iso = null;
    if (at !== null) {
      if (typeof at !== 'string' || !/^[0-9a-z]{1,10}$/.test(at)) return null;
      const ms = parseInt(at, 36);
      if (!Number.isFinite(ms) || ms > MAX_AT_MS) return null;
      iso = new Date(ms).toISOString();
    }
    levels[id] = { stars, at: iso };
  }
  const seen = new Set();
  for (const c of data.c) {
    if (!isId(c) || seen.has(c)) return null;
    seen.add(c);
  }
  return { levels, cards: [...seen] };
}

/**
 * Reads a code. → `{ok: true, progress, dropped}` (progress is the registry view; `dropped`
 * counts entries the registry does not know) or `{ok: false, reason}` with `reason` one of
 * `REFUSALS`' keys. Never throws, never returns part of a code.
 */
export function decodeProgress(code, registry) {
  try {
    if (typeof code !== 'string') return { ok: false, reason: 'format' };
    const text = code.replace(/\s+/g, '');
    if (text === '') return { ok: false, reason: 'empty' };
    if (text.length > MAX_CODE_LENGTH) return { ok: false, reason: 'format' };
    const m = /^oc(\d{1,4})\.([A-Za-z0-9_-]*)\.([0-9a-f]{8})$/.exec(text);
    if (m === null) return { ok: false, reason: 'format' };
    if (Number(m[1]) !== SAVE_VERSION) return { ok: false, reason: 'version' };
    if (checksum(`${PREFIX}${m[1]}.${m[2]}`) !== m[3]) return { ok: false, reason: 'checksum' };
    const bytes = fromBase64Url(m[2]);
    if (bytes === null) return { ok: false, reason: 'shape' };
    let data;
    try {
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return { ok: false, reason: 'shape' };
    }
    const read = readPayload(data);
    if (read === null) return { ok: false, reason: 'shape' };
    const ids = registryIds(registry);
    const progress = sanitizeProgress(read, { ...ids, keep: ids });
    const dropped = Object.keys(read.levels).length + read.cards.length
      - Object.keys(progress.levels).length - progress.cards.length;
    return { ok: true, progress, dropped };
  } catch {
    return { ok: false, reason: 'shape' };
  }
}

/**
 * What importing `incoming` into `local` would do (both registry views), without doing it:
 * `added` (levels local lacks), `improved` (levels where the code has more stars),
 * `kept` (levels where local has more stars, which stay), `newCards` (a count), `merged`
 * (the record to save) and `changed` (false when the merge equals local).
 */
export function previewImport(local, incoming, registry) {
  const keep = registryIds(registry);
  const added = [];
  const improved = [];
  const kept = [];
  for (const id of registry.order) {
    if (!isCompleted(incoming, id)) continue;
    const to = incoming.levels[id].stars;
    if (!isCompleted(local, id)) added.push({ id, stars: to });
    else if (to > local.levels[id].stars) improved.push({ id, from: local.levels[id].stars, to });
    else if (to < local.levels[id].stars) kept.push(id);
  }
  const newCards = incoming.cards.filter((c) => !local.cards.includes(c)).length;
  const merged = mergeProgress(local, incoming, { keep });
  return { added, improved, kept, newCards, merged, changed: added.length + improved.length + newCards > 0 };
}
