// Key paths for Configure it (docs/M1-DESIGN.md §4.8): rendering one as a string, and
// patterns that find every value a path describes. Pure, no DOM.

const PLAIN_KEY = /^[A-Za-z0-9_\-/]+$/;

/** `base` plus one key: `a.b`, `a[0]`, or `a["odd key"]` when the key is not plain. */
export function joinPath(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (!PLAIN_KEY.test(key)) return `${base}[${JSON.stringify(key)}]`;
  return base === '' ? key : `${base}.${key}`;
}

const SEGMENT = /^(?:(\*)|([A-Za-z0-9_\-/]+)(\[\])?)$/;

/**
 * `a.b.*.c[]` into segments `{key, each}`: `*` is every key of a mapping, and a `[]`
 * after the LAST segment is every item of the list there. Anything else throws.
 */
export function parsePattern(pattern) {
  const parts = String(pattern).split('.');
  const bad = () => new Error(`bad path pattern ${JSON.stringify(pattern)}`);
  return parts.map((part, i) => {
    const m = SEGMENT.exec(part);
    if (!m || (m[3] && i !== parts.length - 1)) throw bad();
    return { key: m[1] ?? m[2], each: m[3] === '[]' };
  });
}

const isMapping = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Every `{path, value}` the pattern matches in `doc`, in document order. A branch that is
 * missing or has the wrong shape is skipped: the schema pass reports that, not this one.
 * Only own properties are followed.
 */
export function resolvePattern(doc, pattern) {
  const segments = parsePattern(pattern);
  let level = [{ path: '', value: doc }];
  for (const { key, each } of segments) {
    const next = [];
    for (const { path, value } of level) {
      if (!isMapping(value)) continue;
      const keys = key === '*' ? Object.keys(value) : Object.hasOwn(value, key) ? [key] : [];
      for (const k of keys) {
        const child = value[k];
        const childPath = joinPath(path, k);
        if (!each) next.push({ path: childPath, value: child });
        else if (Array.isArray(child)) child.forEach((item, i) => next.push({ path: joinPath(childPath, i), value: item }));
      }
    }
    level = next;
  }
  return level;
}
