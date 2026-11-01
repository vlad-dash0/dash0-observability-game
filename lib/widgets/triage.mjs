// Triage helper (docs/M1-DESIGN.md §6 Boss checkout-is-slow): for one attribute, how big a
// share of the slow requests and of the baseline requests carries each value. The value
// that is far more common among the slow ones is the lead. Pure and DOM-free.
// Spec: https://opentelemetry.io/docs/concepts/signals/traces/#attributes

const isBag = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Whole-number percent of `n` in `total`; null when the set is empty (never 0%). */
const share = (n, total) => (total === 0 ? null : Math.round((n / total) * 100));

function count(set, attr) {
  const counts = new Map();
  for (const item of set) {
    if (!isBag(item) || !(attr in item)) continue;
    const v = String(item[attr]);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

/**
 * Compare attribute `attr` between `slow` and `baseline` (arrays of attribute objects):
 * `[{value, slowPct, baselinePct}]` sorted by value. A share is a whole-number percent of
 * the whole set (requests lacking `attr` count in the total, in no row); it is `null` when
 * that set is empty, and 0 when the set has requests but none with the value. Throws
 * TypeError for non-array sets or an empty `attr`. Never mutates its input.
 */
export function compareAttribute(slow, baseline, attr) {
  if (!Array.isArray(slow) || !Array.isArray(baseline)) throw new TypeError('compareAttribute: slow and baseline must be arrays');
  if (typeof attr !== 'string' || attr === '') throw new TypeError('compareAttribute: attr must be a non-empty string');
  const s = count(slow, attr);
  const b = count(baseline, attr);
  return [...new Set([...s.keys(), ...b.keys()])].sort().map((value) => ({
    value,
    slowPct: share(s.get(value) ?? 0, slow.length),
    baselinePct: share(b.get(value) ?? 0, baseline.length),
  }));
}
