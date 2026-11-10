// Leaderboard score: one number a sorted set can rank. Most stars first, then whoever
// reached that total earliest. score = total * 2^31 + (2^31 - 1 - s), where s is whole
// seconds since the epoch at the moment the total was reached (server clock). Exact in a
// double while total * 2^31 stays below 2^53, so the total is capped at MAX_TOTAL.
// Spec: the #273 design, section 2 (Score).
export const EPOCH_MS = Date.UTC(2026, 0, 1);
const SECONDS_SPAN = 2 ** 31; // s fits 0..2^31-1 (about 68 years from the epoch)
export const MAX_TOTAL = 2 ** 21 - 1; // (2^21 - 1) * 2^31 + (2^31 - 1) = 2^52 - 1

// → the score. Throws RangeError on a total that is negative, not an integer or above
// MAX_TOTAL, and on a time before the epoch or beyond its 2^31 second span.
export function encodeScore(total, reachedAtMs) {
  if (!Number.isInteger(total) || total < 0 || total > MAX_TOTAL) {
    throw new RangeError(`encodeScore: total must be an integer 0..${MAX_TOTAL}`);
  }
  const s = Math.floor((reachedAtMs - EPOCH_MS) / 1000);
  if (!Number.isFinite(s) || s < 0 || s >= SECONDS_SPAN) {
    throw new RangeError('encodeScore: reachedAtMs outside the supported time span');
  }
  return total * SECONDS_SPAN + (SECONDS_SPAN - 1 - s);
}

// → {total, reachedAtMs} (reachedAtMs is whole seconds, in ms). Throws RangeError on a
// score that is not a safe non-negative integer.
export function decodeScore(score) {
  if (!Number.isSafeInteger(score) || score < 0) {
    throw new RangeError('decodeScore: score must be a safe non-negative integer');
  }
  const total = Math.floor(score / SECONDS_SPAN);
  const s = SECONDS_SPAN - 1 - (score - total * SECONDS_SPAN);
  return { total, reachedAtMs: EPOCH_MS + s * 1000 };
}
