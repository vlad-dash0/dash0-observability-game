// Safe localStorage access for progress. Every absence case keeps its own status (fresh,
// ok, corrupt, future, unavailable); nothing is ever coerced into "fresh". Storage comes
// from `storageGetter` (e.g. `() => window.localStorage`), always called inside try/catch.
// Spec: docs/FOUNDATION.md §3 Concurrency and the §4 Absence table.
import {
  CURRENT_VERSION,
  emptyProgress,
  isPlainObject,
  mergeProgress,
  migrate,
  sanitizeProgress,
} from './progress.mjs';

export const STORAGE_KEY = 'oncall.progress';
export const CORRUPT_KEY = 'oncall.progress.corrupt';

// Classifies the stored string. `record` is the parsed (and migrated) object for ok and
// future, null for fresh and corrupt.
function classify(text) {
  if (text === null) return { status: 'fresh', record: null };
  const corrupt = { status: 'corrupt', record: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return corrupt;
  }
  if (!isPlainObject(parsed) || !Number.isInteger(parsed.v)) return corrupt;
  if (parsed.v > CURRENT_VERSION) return { status: 'future', record: parsed };
  const migrated = migrate(parsed);
  if (migrated === null || migrated.v !== CURRENT_VERSION || !isPlainObject(migrated.levels)) return corrupt;
  return { status: 'ok', record: migrated };
}

// → {status, progress}: progress is the in-memory view, filtered to the registry's ids
// (best effort for future, empty for fresh, corrupt and unavailable). Never writes.
export function loadProgress(storageGetter, registry) {
  let text;
  try {
    text = storageGetter().getItem(STORAGE_KEY);
  } catch {
    return { status: 'unavailable', progress: emptyProgress() };
  }
  const { status, record } = classify(text);
  const ids = { levelIds: registry.order, cardIds: registry.cardIds };
  return { status, progress: record === null ? emptyProgress() : sanitizeProgress(record, ids) };
}

// Read, merge, write in one synchronous task, so a completion another tab stored is never
// lost. Stored data is sanitized without id filtering, so ids this build doesn't know
// survive. → {saved:true, progress: what was written} or {saved:false, reason, progress}
// with `progress` returned untouched. Future data is never written over; corrupt data is
// copied to CORRUPT_KEY (once) before it is replaced.
export function saveProgress(storageGetter, progress) {
  const refuse = (reason) => ({ saved: false, reason, progress });
  let storage, text, backup;
  try {
    storage = storageGetter();
    text = storage.getItem(STORAGE_KEY);
    backup = storage.getItem(CORRUPT_KEY);
  } catch {
    return refuse('unavailable');
  }
  const { status, record } = classify(text);
  if (status === 'future') return refuse('future');
  const stored = record === null ? emptyProgress() : sanitizeProgress(record);
  const merged = mergeProgress(stored, sanitizeProgress(progress));
  try {
    if (status === 'corrupt' && backup === null) storage.setItem(CORRUPT_KEY, text);
    storage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    return refuse('unavailable');
  }
  return { saved: true, progress: merged };
}
