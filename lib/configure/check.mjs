// Configure it core (docs/M1-DESIGN.md §4.8): parse YAML text, validate it against a
// declarative schema, and say whether each pipeline flows. Pure, DOM-free, no timers (I2).
// Every problem is data: `{kind, path, message, ...detail}`, with `path` the key path of the
// offending key (`service.pipelines.traces.exporters[1]`), never a prose blob.

import { parseYaml } from './parse.mjs';
import { joinPath, resolvePattern } from './paths.mjs';
import { validateSchema } from './schema.mjs';

const WORDS = {
  mapping: 'a mapping', list: 'a list', string: 'a string', number: 'a number',
  integer: 'an integer', boolean: 'a boolean', null: 'null',
};
const isMapping = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The type name of a parsed value: null, boolean, number, string, list or mapping. */
function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value === 'object' ? 'mapping' : typeof value;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** `a`, `a or b`, `a, b or c`. */
const orList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

const TYPE_TESTS = {
  mapping: isMapping,
  list: Array.isArray,
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  integer: Number.isInteger,
  boolean: (v) => typeof v === 'boolean',
};

/** Validate `value` against `node`, pushing errors in document order. */
function validateNode(node, value, path, errors) {
  if (node.type === 'any') return;
  if (value === null && node.nullable) return;
  if (!TYPE_TESTS[node.type](value)) {
    const got = kindOf(value);
    errors.push({ kind: 'wrong-type', path, message: `expected ${WORDS[node.type]}, got ${WORDS[got]}`, expected: node.type, got });
    return;
  }
  if (node.enum !== undefined && !node.enum.includes(value)) {
    errors.push({
      kind: 'bad-value', path, message: `must be one of ${node.enum.map((v) => JSON.stringify(v)).join(', ')}`, allowed: [...node.enum],
    });
    return;
  }
  if (node.type === 'list') {
    if (node.min !== undefined && value.length < node.min) {
      errors.push({ kind: 'too-few', path, message: `needs at least ${plural(node.min, 'item', 'items')}`, min: node.min });
    }
    value.forEach((item, i) => validateNode(node.items, item, joinPath(path, i), errors));
  } else if (node.type === 'mapping') {
    validateMapping(node, value, path, errors);
  }
}

function validateMapping(node, value, path, errors) {
  const known = node.keys ?? {};
  const keys = Object.keys(value);
  if (node.min !== undefined && keys.length < node.min) {
    errors.push({ kind: 'too-few', path, message: `needs at least ${plural(node.min, 'entry', 'entries')}`, min: node.min });
  }
  for (const key of node.required ?? []) {
    if (!Object.hasOwn(value, key)) {
      errors.push({ kind: 'missing-key', path: joinPath(path, key), message: `missing required key ${JSON.stringify(key)}` });
    }
  }
  const pattern = node.keyPattern === undefined ? null : new RegExp(node.keyPattern);
  for (const key of keys) {
    const keyPath = joinPath(path, key);
    if (Object.hasOwn(known, key)) {
      validateNode(known[key], value[key], keyPath, errors);
    } else if (node.additional !== undefined) {
      if (pattern !== null && !pattern.test(key)) {
        const expect = node.keyExpect ?? `a key matching ${node.keyPattern}`;
        errors.push({ kind: 'bad-key', path: keyPath, message: `invalid key ${JSON.stringify(key)}: expected ${expect}` });
      } else {
        validateNode(node.additional, value[key], keyPath, errors);
      }
    } else {
      errors.push({ kind: 'unknown-key', path: keyPath, message: `unknown key ${JSON.stringify(key)}`, allowed: Object.keys(known).sort() });
    }
  }
}

/** The names defined under the mappings at the plain paths `sections`. */
function definedNames(doc, sections) {
  const names = new Set();
  for (const section of sections) {
    for (const { value } of resolvePattern(doc, section)) {
      if (isMapping(value)) Object.keys(value).forEach((k) => names.add(k));
    }
  }
  return names;
}

/** `schema.refs` plus one ref per pipeline stage: the names a config uses must be defined. */
function allRefs(schema) {
  const stages = schema.pipelines?.stages ?? [];
  return [
    ...(schema.refs ?? []),
    ...stages.map((st) => ({ at: `${schema.pipelines.at}.*.${st.key}[]`, in: st.in })),
  ];
}

function checkRefs(doc, schema, errors) {
  for (const ref of allRefs(schema)) {
    const defined = definedNames(doc, ref.in);
    for (const { path, value } of resolvePattern(doc, ref.at)) {
      if (typeof value !== 'string' || defined.has(value)) continue;
      errors.push({
        kind: 'unknown-ref', path, message: `${JSON.stringify(value)} is not defined under ${orList(ref.in)}`, ref: value, in: [...ref.in],
      });
    }
  }
}

const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);

/** Components defined in a stage section that no pipeline names: they are silently inactive. */
function inactiveComponents(doc, schema) {
  const { at, stages } = schema.pipelines;
  const used = new Set();
  for (const st of stages) {
    for (const { value } of resolvePattern(doc, `${at}.*.${st.key}[]`)) {
      if (typeof value === 'string') st.in.forEach((section) => used.add(`${section}\0${value}`));
    }
  }
  const sections = [...new Set(stages.flatMap((st) => st.in))];
  return sections.flatMap((section) => resolvePattern(doc, section).flatMap(({ value }) =>
    (isMapping(value) ? Object.keys(value) : []).filter((id) => !used.has(`${section}\0${id}`)).map((id) => ({ section, id }))));
}

function buildVerdict(doc, schema, errors) {
  const [found] = resolvePattern(doc, schema.pipelines.at);
  const pipelines = found && isMapping(found.value)
    ? Object.keys(found.value).map((name) => {
        const prefix = joinPath(found.path, name);
        const reasons = errors.filter((e) => under(e.path, prefix));
        return { name, flowing: reasons.length === 0, reasons };
      })
    : [];
  return {
    flowing: errors.length === 0 && pipelines.length > 0 && pipelines.every((p) => p.flowing),
    pipelines,
    inactive: inactiveComponents(doc, schema),
  };
}

/**
 * Check `text` against `schema` (shape: lib/configure/schema.mjs `validateSchema`).
 * Returns `{ok, errors, doc, verdict}`: `ok` is "no errors"; `doc` the parsed mapping, or null
 * if the text did not parse; `verdict` is null without `schema.pipelines` or on a parse
 * failure, else `{flowing, pipelines: [{name, flowing, reasons}], inactive: [{section, id}]}`.
 * A pipeline's `flowing` is about its own wiring (its `reasons` are the errors under it);
 * the top-level `flowing` also needs the whole config to be error-free, as a Collector would
 * refuse to start otherwise. A schema that is not well formed is an authoring bug and throws.
 */
export function checkConfig(text, schema) {
  const problems = validateSchema(schema);
  if (problems.length > 0) throw new Error(`invalid schema: ${problems.join('; ')}`);
  const parsed = parseYaml(text);
  if (!parsed.ok) return { ok: false, errors: [parsed.error], doc: null, verdict: null };
  const errors = [];
  validateNode(schema.root, parsed.doc, '', errors);
  checkRefs(parsed.doc, schema, errors);
  const verdict = schema.pipelines === undefined ? null : buildVerdict(parsed.doc, schema, errors);
  return { ok: errors.length === 0, errors, doc: parsed.doc, verdict };
}

/** One error as a line of text: `path: message`, or `line L, column C: message`, or just the message. */
export function describeError(e) {
  if (e.path !== '') return `${e.path}: ${e.message}`;
  return e.line === null || e.line === undefined ? e.message : `line ${e.line}, column ${e.column}: ${e.message}`;
}

const passes = (r) => r.ok && (r.verdict === null || r.verdict.flowing);

/**
 * Authoring check for a Configure it spec (I7): the reference must pass its own checker, and
 * `given` (if any) must not, or there is nothing to fix. Messages, `[]` when fine.
 */
export function referenceProblems(schema, reference, given) {
  const ref = checkConfig(reference, schema);
  const out = ref.errors.map((e) => `reference: ${describeError(e)}`);
  if (ref.ok && !passes(ref)) out.push('reference: no pipeline flows');
  if (given !== undefined && passes(checkConfig(given, schema))) {
    out.push('given: already passes the checker, so there is nothing to fix');
  }
  return out;
}
