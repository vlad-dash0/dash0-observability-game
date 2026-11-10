// The "Don't show again" choice for the how-to-play cards (#199): its own localStorage key,
// never oncall.progress. Value: {"v":1,"hidden":["build","sort"]} (sorted,
// unique widget keys). It is a preference, not progress: a corrupt value is overwritten
// without a backup, and an unreadable one means "show the card" (the safe direction).
// Storage comes in as a getter (`() => window.localStorage`), always called inside try/catch.
import { isId } from './registry.mjs';

export const HELP_KEY = 'oncall.help';
const VERSION = 1;
const MAX_HIDDEN = 100;

// → {status: 'fresh'|'ok'|'corrupt'|'future', hidden: string[]}, or null when storage throws.
function load(getStorage) {
  let text;
  try {
    text = getStorage().getItem(HELP_KEY);
  } catch {
    return null;
  }
  if (text === null || text === undefined) return { status: 'fresh', hidden: [] };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'corrupt', hidden: [] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'corrupt', hidden: [] };
  if (!Number.isInteger(parsed.v) || !Array.isArray(parsed.hidden)) return { status: 'corrupt', hidden: [] };
  const hidden = [...new Set(parsed.hidden.filter(isId))].sort().slice(0, MAX_HIDDEN);
  return { status: parsed.v > VERSION ? 'future' : 'ok', hidden };
}

/** The hidden widget keys: `{status: 'fresh'|'ok'|'corrupt'|'future'|'unavailable', hidden: Set}`. Never writes. */
export function readHiddenHelp(getStorage) {
  const r = load(getStorage);
  return r === null ? { status: 'unavailable', hidden: new Set() } : { status: r.status, hidden: new Set(r.hidden) };
}

/**
 * Add `keys` to the stored hidden list: read, union and write in one synchronous task (the
 * saveProgress model). → `{saved: true}` or `{saved: false, reason: 'future'|'unavailable'|'full'}`.
 * A newer version is left untouched; unknown well-formed keys already stored are kept. When the union would pass 100 keys
 * nothing is written (`full`): the store is left as it was.
 */
export function hideHelp(getStorage, keys) {
  const r = load(getStorage);
  if (r === null) return { saved: false, reason: 'unavailable' };
  if (r.status === 'future') return { saved: false, reason: 'future' };
  const hidden = [...new Set([...r.hidden, ...keys.filter(isId)])].sort();
  if (hidden.length > MAX_HIDDEN) return { saved: false, reason: 'full' };
  try {
    getStorage().setItem(HELP_KEY, JSON.stringify({ v: VERSION, hidden }));
  } catch {
    return { saved: false, reason: 'unavailable' };
  }
  return { saved: true };
}
