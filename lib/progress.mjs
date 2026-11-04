// The progress record (§2.5): sanitize untrusted input, migrate old versions, record a
// completion, merge two records, and count totals. Pure; nothing here touches storage.
// Progress only goes up: best stars, earliest non-null `at`, union of cards.
// Spec: docs/FOUNDATION.md §2.5, §3 Progress and §4.
import { MAX_STARS } from './scoring.mjs';
import { isCompleted } from './unlock.mjs';

export const CURRENT_VERSION = 1;
// MIGRATIONS[n] maps a v n record to v n+1.
export const MIGRATIONS = Object.freeze({});

const MAX_ENTRIES = 500;
const ID_RE = /^[a-z0-9-]{1,64}$/;
// ISO-8601 date-time with a Z or an offset; anything looser is not a timestamp.
const AT_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

export function emptyProgress() {
  return { v: CURRENT_VERSION, levels: Object.create(null), cards: [] };
}

// A JSON-style object: not null, not an array, not a class instance.
export function isPlainObject(x) {
  if (x === null || typeof x !== 'object') return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

const isId = (id) => typeof id === 'string' && ID_RE.test(id) && !RESERVED.has(id);
const clampStars = (s) => Math.min(MAX_STARS, Math.max(0, Math.floor(s)));
const isStars = (s) => typeof s === 'number' && Number.isFinite(s);
const sortedUnique = (xs) => [...new Set(xs)].sort();

// An ISO-8601 date-time as ISO UTC, else null. The written date and time must exist as
// written: Date.parse rolls Feb 30 or T24:00 over into the next day, so the wall-clock
// part must survive a round trip unchanged. The UTC result must match AT_RE too (an
// offset can push it outside years 0000..9999), so sanitizing twice keeps `at`.
function normalizeAt(at) {
  const m = typeof at === 'string' ? AT_RE.exec(at) : null;
  if (m === null) return null;
  const wall = `${m[1]}:${m[2] ?? '00'}`;
  const w = Date.parse(`${wall}Z`);
  if (!Number.isFinite(w) || new Date(w).toISOString().slice(0, 19) !== wall) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const s = new Date(t).toISOString();
  return AT_RE.test(s) ? s : null;
}

// The ids a registry never lets the cap evict, as the `keep` option takes them.
export function registryIds(registry) {
  return { levelIds: registry.order, cardIds: registry.cardIds };
}

// Never throws, never mutates, never awards. Malformed ids are dropped, never cleaned.
// With levelIds/cardIds only those ids survive (the in-memory view); without, every
// well-formed id is kept (what gets persisted). `keep` as in `capped`.
export function sanitizeProgress(raw, opts) {
  try {
    const { levelIds, cardIds, keep } = opts ?? {};
    const levelSet = levelIds ? new Set(levelIds) : null;
    const cardSet = cardIds ? new Set(cardIds) : null;
    if (!isPlainObject(raw) || !isPlainObject(raw.levels)) return emptyProgress();
    const out = emptyProgress();
    for (const key of Object.keys(raw.levels).sort()) {
      const id = key; // used as stored: a malformed id is dropped below, never cleaned
      if (!isId(id) || (levelSet && !levelSet.has(id))) continue;
      const entry = raw.levels[key];
      if (!isPlainObject(entry) || !isStars(entry.stars)) continue;
      out.levels[id] = { stars: clampStars(entry.stars), at: normalizeAt(entry.at) };
    }
    if (Array.isArray(raw.cards)) {
      out.cards = sortedUnique(raw.cards.filter((c) => isId(c) && (!cardSet || cardSet.has(c))));
    }
    return capped(out, keep);
  } catch {
    return emptyProgress();
  }
}

// Steps `raw` from its `v` up to `current`. Returns the migrated record, `raw` itself when
// already at (or past) `current`, or null when it can't be migrated: `v` missing or not an
// integer, a missing step, a step that throws or doesn't land on v+1. Callers check
// `v > current` (future) before migrating.
export function migrate(raw, { current = CURRENT_VERSION, migrations = MIGRATIONS } = {}) {
  if (!isPlainObject(raw) || !Number.isInteger(raw.v)) return null;
  let out = raw;
  try {
    while (out.v < current) {
      const step = Object.hasOwn(migrations, out.v) ? migrations[out.v] : null;
      if (typeof step !== 'function') return null;
      const next = step(out);
      if (!isPlainObject(next) || next.v !== out.v + 1) return null;
      out = next;
    }
  } catch {
    return null;
  }
  return out;
}

// The only cap: level entries and cards each at most max(500, registered ids present); the
// cap bounds unknown data only. Ids in `keep` ({levelIds, cardIds}, normally the
// registry's) are never evicted; unknown ids fill the remaining room in sorted order.
// Applied by sanitizeProgress and mergeProgress, so no record that leaves this module is
// over it (a save can't write more than the next load keeps).
function capped(record, keep) {
  const out = emptyProgress();
  for (const id of fit(Object.keys(record.levels).sort(), keep?.levelIds)) out.levels[id] = record.levels[id];
  out.cards = fit(record.cards, keep?.cardIds);
  return out;
}

// Sorted `ids` → every kept id, plus the first unknown ids that fit in MAX_ENTRIES.
function fit(ids, keepIds) {
  const kept = new Set(keepIds ?? []);
  let room = MAX_ENTRIES - ids.filter((id) => kept.has(id)).length;
  return ids.filter((id) => kept.has(id) || room-- > 0);
}

// Earliest non-null ISO time; null never beats a date.
function earliest(p, q) {
  if (p === null) return q;
  if (q === null) return p;
  return Date.parse(p) <= Date.parse(q) ? p : q;
}

// Union of two sanitized records: per level best stars and earliest `at`, union of cards.
// Capped (see `capped`, `opts.keep`). Commutative, associative, idempotent for a fixed
// `keep`; never mutates either side.
export function mergeProgress(a, b, opts) {
  const out = emptyProgress();
  for (const id of sortedUnique([...Object.keys(a.levels), ...Object.keys(b.levels)])) {
    const x = isCompleted(a, id) ? a.levels[id] : null;
    const y = isCompleted(b, id) ? b.levels[id] : null;
    out.levels[id] =
      x && y
        ? { stars: Math.max(x.stars, y.stars), at: earliest(x.at, y.at) }
        : { stars: (x || y).stars, at: (x || y).at };
  }
  out.cards = sortedUnique([...a.cards, ...b.cards]);
  return capped(out, opts?.keep);
}

// Records a finished run of `levelId`. The only place cards are filtered (to the level's
// own cards). An unknown level or non-finite stars returns `progress` unchanged, flags false.
export function recordCompletion(progress, levelId, { stars, cards, at } = {}, registry) {
  if (!Object.hasOwn(registry.levels, levelId) || !isStars(stars)) {
    return { progress, firstCompletion: false, newBest: false, newCards: [] };
  }
  const level = registry.levels[levelId];
  const best = clampStars(stars);
  const prev = isCompleted(progress, levelId) ? progress.levels[levelId] : null;
  const earned = sortedUnique(Array.isArray(cards) ? cards.filter((c) => level.cards.includes(c)) : []);
  const run = emptyProgress();
  run.levels[levelId] = { stars: best, at: normalizeAt(at) };
  run.cards = earned;
  return {
    progress: mergeProgress(progress, run, { keep: registryIds(registry) }),
    firstCompletion: prev === null,
    newBest: prev === null || best > prev.stars,
    newCards: earned.filter((c) => !progress.cards.includes(c)),
  };
}

// Stars over scored registered levels: max MAX_STARS each, earned = best stars recorded.
export function starTotals(progress, registry) {
  const scored = registry.order.filter((id) => registry.levels[id].scored);
  const earned = scored
    .filter((id) => isCompleted(progress, id))
    .reduce((sum, id) => sum + progress.levels[id].stars, 0);
  return { earned, max: MAX_STARS * scored.length };
}

// Cards over the union of registered levels' cards.
export function cardTotals(progress, registry) {
  const union = new Set(registry.order.flatMap((id) => registry.levels[id].cards));
  return { earned: progress.cards.filter((c) => union.has(c)).length, max: union.size };
}
