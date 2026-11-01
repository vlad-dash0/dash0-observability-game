// Parse untrusted YAML text for Configure it (docs/M1-DESIGN.md §4.8). Safe load only:
// js-yaml's CORE schema (no custom or language tags), a size cap, duplicate keys refused,
// a mapping at the top level, and no alias of a collection (the "billion laughs" shape).

import { load, CORE_SCHEMA, YAMLException } from '../../vendor/js-yaml-4.3.2.mjs';
import { joinPath } from './paths.mjs';

/** Longest text accepted, in characters; a config for a game fits in a fraction of this. */
export const MAX_CHARS = 32768;

const DUPLICATE_REASON = 'duplicated mapping key';

const failure = (kind, message, extra = {}) => ({
  ok: false,
  error: { kind, path: '', message, line: null, column: null, ...extra },
});

const BLANK_LINE = /^\s*(#.*)?$/;

/** What the loaded value is, for messages: `a list`, `a string`, `null`, ... */
function describe(value, text) {
  // js-yaml gives undefined for no text and null for a comment-only text: both are "nothing written".
  if (value === undefined || (value === null && text.split('\n').every((l) => BLANK_LINE.test(l)))) return 'an empty document';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return { object: 'a mapping', string: 'a string', number: 'a number', boolean: 'a boolean' }[typeof value] ?? 'something else';
}

/**
 * The path of the first collection that appears twice in `root` (an alias), or null.
 * Each collection is entered once, so an alias bomb is refused without being expanded.
 * Recursion depth is bounded by js-yaml's own nesting limit (100).
 */
function findAlias(root) {
  const seen = new Set();
  const visit = (value, path) => {
    if (typeof value !== 'object' || value === null) return null;
    if (seen.has(value)) return path;
    seen.add(value);
    const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
    for (const [key, child] of entries) {
      const hit = visit(child, joinPath(path, key));
      if (hit !== null) return hit;
    }
    return null;
  };
  return visit(root, '');
}

/**
 * `{ok: true, doc}` for a mapping, or `{ok: false, error}` with `error = {kind, path,
 * message, line, column}`; kind is `too-large`, `parse`, `duplicate-key`, `root` or `alias`.
 * `line` and `column` are 1-based, or null when the library gives no position.
 */
export function parseYaml(text) {
  if (typeof text !== 'string') throw new TypeError('parseYaml needs a string');
  if (text.length > MAX_CHARS) return failure('too-large', `the file is longer than ${MAX_CHARS} characters`);
  let doc;
  try {
    doc = load(text, { schema: CORE_SCHEMA });
  } catch (e) {
    if (!(e instanceof YAMLException)) throw e;
    const pos = e.mark ? { line: e.mark.line + 1, column: e.mark.column + 1 } : {};
    return failure(e.reason === DUPLICATE_REASON ? 'duplicate-key' : 'parse', e.reason === DUPLICATE_REASON ? 'duplicate key' : e.reason, pos);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return failure('root', `the top level must be a mapping, got ${describe(doc, text)}`);
  }
  const alias = findAlias(doc);
  if (alias !== null) return failure('alias', 'aliases (*name) are not supported', { path: alias });
  return { ok: true, doc };
}
