// A best-effort rate limiter for the guide function (#17). Memory only: a cold start empties it and
// parallel instances each keep their own, so it slows a runaway client and a flood, it is not a quota.
// Per client a fixed window; per instance a second, shorter window across all clients; the key map is
// capped and drops the oldest key first. Synchronous throughout, so a handler's check is one step.

export const CLIENT_MAX = 6;
export const CLIENT_WINDOW_MS = 10 * 60 * 1000;
export const INSTANCE_MAX = 60;
export const INSTANCE_WINDOW_MS = 60 * 1000;
export const MAX_KEYS = 2000;

/**
 * `instanceMax: Infinity` turns the per-instance window off (the account routes promise per-IP limits only).
 * `take(key)` counts one request and answers `{ok: true}`, or `{ok: false, retryAfterS}` (whole seconds, at
 * least 1) when the client or the instance is over its window. A refused request is not counted.
 */
export function createLimiter({
  now = Date.now,
  clientMax = CLIENT_MAX,
  clientWindowMs = CLIENT_WINDOW_MS,
  instanceMax = INSTANCE_MAX,
  instanceWindowMs = INSTANCE_WINDOW_MS,
  maxKeys = MAX_KEYS,
} = {}) {
  /** @type {Map<string, {start: number, count: number}>} insertion order is age order */
  const clients = new Map();
  let instance = { start: -Infinity, count: 0 };
  const wait = (ms) => Math.max(1, Math.ceil(ms / 1000));

  return {
    take(key) {
      const t = now();
      if (t - instance.start >= instanceWindowMs) instance = { start: t, count: 0 };
      const entry = clients.get(key);
      const live = entry !== undefined && t - entry.start < clientWindowMs;
      if (live && entry.count >= clientMax) return { ok: false, retryAfterS: wait(entry.start + clientWindowMs - t) };
      if (instance.count >= instanceMax) return { ok: false, retryAfterS: wait(instance.start + instanceWindowMs - t) };
      instance.count += 1;
      if (live) {
        entry.count += 1;
      } else {
        clients.delete(key); // a re-opened window goes to the back: the map stays oldest first
        clients.set(key, { start: t, count: 1 });
        if (clients.size > maxKeys) clients.delete(clients.keys().next().value);
      }
      return { ok: true };
    },
  };
}
