// Sort it widget core (docs/M1-DESIGN.md §4.1): validate a SortSpec, place items into
// buckets, track progress. Pure and DOM-free; state is never mutated, `place` returns a
// new one. The view and its penalties live in `sort-it-view.mjs` (`mountSort`, I1).
//
// SortSpec = { id, buckets: [{id, label}], items: [{id, label, bucket, why, whyNot?}] }
// SortState = { right: {[itemId]: true}, tried: {[itemId]: bucketId[]} }

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/; // kebab-case, as lib/registry.mjs
const BUCKETS = { min: 2, max: 5 };
const ITEMS = { min: 2, max: 12 };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && ID.test(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const show = (v) => (typeof v === 'string' ? `"${v}"` : String(v));

/** Check a list of `{id}` entries: kebab-case and unique. Returns the set of valid ids. */
function checkIds(list, kind, problems) {
  const seen = new Set();
  list.forEach((entry, i) => {
    if (!isObject(entry)) {
      problems.push(`${kind} ${i}: not an object`);
      return;
    }
    if (!isId(entry.id)) problems.push(`${kind} id ${show(entry.id)} is not kebab-case`);
    else if (seen.has(entry.id)) problems.push(`duplicate ${kind} id ${show(entry.id)}`);
    seen.add(entry.id);
  });
  return seen;
}

function checkCount(list, kind, { min, max }, problems) {
  if (!Array.isArray(list)) {
    problems.push(`${kind}: not a list`);
    return [];
  }
  if (list.length < min || list.length > max) {
    problems.push(`${kind}: ${list.length}, expected ${min}..${max}`);
  }
  return list;
}

/** Every problem with `spec` (empty when valid). Never throws, never stops at the first. */
export function validateSortSpec(spec) {
  const problems = [];
  if (!isObject(spec)) return ['spec: not an object'];
  if (!isId(spec.id)) problems.push(`spec id ${show(spec.id)} is not kebab-case`);
  const buckets = checkCount(spec.buckets, 'buckets', BUCKETS, problems);
  const items = checkCount(spec.items, 'items', ITEMS, problems);
  const bucketIds = checkIds(buckets, 'bucket', problems);
  checkIds(items, 'item', problems);
  for (const item of items) {
    if (!isObject(item)) continue;
    const name = `item ${show(item.id)}`;
    if (!bucketIds.has(item.bucket)) problems.push(`${name}: unknown bucket ${show(item.bucket)}`);
    if (!isText(item.why)) problems.push(`${name}: empty why`);
    if (item.whyNot !== undefined) {
      if (!isObject(item.whyNot)) problems.push(`${name}: whyNot is not an object`);
      else {
        for (const key of Object.keys(item.whyNot)) {
          if (!bucketIds.has(key)) problems.push(`${name}: whyNot has unknown bucket ${show(key)}`);
        }
      }
    }
  }
  return problems;
}

/** A fresh state: nothing right, nothing tried. */
export function newSortState(_spec) {
  return { right: {}, tried: {} };
}

const findItem = (spec, itemId) => spec.items.find((it) => it.id === itemId);
const hasBucket = (spec, bucketId) => spec.buckets.some((b) => b.id === bucketId);
const isRight = (state, itemId) => Object.hasOwn(state.right, itemId);
const triedFor = (state, itemId) => (Object.hasOwn(state.tried, itemId) ? state.tried[itemId] : []);

/**
 * Put `itemId` in `bucketId`: `{state, outcome}`. Outcome: 'unknown' (no such item or
 * bucket), 'placed' (item already right), 'repeat' (bucket already tried for this item),
 * 'right' or 'wrong'. Never mutates `state`; unknown/placed/repeat return it unchanged.
 */
export function place(spec, state, itemId, bucketId) {
  const item = findItem(spec, itemId);
  if (!item || !hasBucket(spec, bucketId)) return { state, outcome: 'unknown' };
  if (isRight(state, itemId)) return { state, outcome: 'placed' };
  const tried = triedFor(state, itemId);
  if (tried.includes(bucketId)) return { state, outcome: 'repeat' };
  const ok = item.bucket === bucketId;
  const next = {
    right: ok ? { ...state.right, [itemId]: true } : state.right,
    tried: { ...state.tried, [itemId]: [...tried, bucketId] },
  };
  return { state: next, outcome: ok ? 'right' : 'wrong' };
}

/** Item ids not yet right, in spec order. */
export function remaining(spec, state) {
  return spec.items.filter((it) => !isRight(state, it.id)).map((it) => it.id);
}

/** Bucket ids not yet tried for `itemId`, in spec order; none for an unknown item. */
export function untried(spec, state, itemId) {
  if (!findItem(spec, itemId)) return [];
  const tried = triedFor(state, itemId);
  return spec.buckets.filter((b) => !tried.includes(b.id)).map((b) => b.id);
}

/** True once every item is right. */
export function isComplete(spec, state) {
  return remaining(spec, state).length === 0;
}
