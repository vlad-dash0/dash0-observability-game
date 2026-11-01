// The declarative schema format of Configure it (docs/M1-DESIGN.md §4.8) and the check
// that a schema is well formed, so an authoring typo fails loudly instead of passing everything.
import { parsePattern } from './paths.mjs';

export const TYPES = ['mapping', 'list', 'string', 'number', 'integer', 'boolean', 'any'];
const SCALARS = ['string', 'number', 'integer', 'boolean'];
const NODE_PROPS = {
  mapping: ['type', 'keys', 'required', 'additional', 'keyPattern', 'keyExpect', 'nullable', 'min'],
  list: ['type', 'items', 'min'],
  string: ['type', 'enum'],
  number: ['type', 'enum'],
  integer: ['type', 'enum'],
  boolean: ['type', 'enum'],
  any: ['type'],
};

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function nodeProblems(node, where, out) {
  if (!isObject(node)) return void out.push(`${where}: a schema node must be an object`);
  if (!TYPES.includes(node.type)) return void out.push(`${where}: unknown type ${JSON.stringify(node.type)}`);
  for (const prop of Object.keys(node)) {
    if (!NODE_PROPS[node.type].includes(prop)) out.push(`${where}: unknown property "${prop}" for type ${node.type}`);
  }
  if ('min' in node && !(Number.isInteger(node.min) && node.min >= 1)) out.push(`${where}: min must be an integer of at least 1`);
  if ('nullable' in node && typeof node.nullable !== 'boolean') out.push(`${where}: nullable must be true or false`);
  if (SCALARS.includes(node.type) && 'enum' in node && !(Array.isArray(node.enum) && node.enum.length > 0)) {
    out.push(`${where}: enum must be a non-empty list`);
  }
  if (node.type === 'list') {
    if (node.items === undefined) out.push(`${where}: a list needs items`);
    else nodeProblems(node.items, `${where}.items`, out);
  }
  if (node.type === 'mapping') {
    const keys = node.keys ?? {};
    if (!isObject(keys)) out.push(`${where}: keys must be an object`);
    else for (const [k, child] of Object.entries(keys)) nodeProblems(child, `${where}.keys.${k}`, out);
    if ('required' in node && !(Array.isArray(node.required) && node.required.every((k) => typeof k === 'string'))) {
      out.push(`${where}: required must be a list of strings`);
    } else {
      for (const k of node.required ?? []) {
        if (!Object.hasOwn(isObject(keys) ? keys : {}, k)) out.push(`${where}: required key ${JSON.stringify(k)} is not in keys`);
      }
    }
    if (node.additional !== undefined) nodeProblems(node.additional, `${where}.additional`, out);
    if ('keyPattern' in node) {
      if (typeof node.keyPattern !== 'string') {
        out.push(`${where}: keyPattern must be a string`);
      } else {
        try {
          new RegExp(node.keyPattern);
        } catch {
          out.push(`${where}: keyPattern is not a valid regular expression`);
        }
      }
    }
    if ('keyExpect' in node && typeof node.keyExpect !== 'string') out.push(`${where}: keyExpect must be a string`);
  }
}

const SINGLE_KEY = /^[A-Za-z0-9_\-/]+$/;

/** `value` is a string and a pattern `parsePattern` accepts; `plain` also forbids `*` and `[]`. */
function pathProblems(value, where, out, { what, plain }) {
  if (typeof value !== 'string') return void out.push(`${where}: ${what} must be a string`);
  try {
    const segs = parsePattern(value);
    if (plain && segs.some((s) => s.key === '*' || s.each)) out.push(`${where}: ${JSON.stringify(value)} must be a plain dotted path`);
  } catch (e) {
    out.push(`${where}: ${e.message}`);
  }
}

function inProblems(list, where, out) {
  if (!Array.isArray(list) || list.length === 0) return void out.push(`${where}: in must be a non-empty list of paths`);
  if (list.some((p) => typeof p !== 'string')) return void out.push(`${where}: in entries must be strings`);
  list.forEach((p) => pathProblems(p, where, out, { what: 'path', plain: true }));
}

function unknownProps(obj, allowed, where, out) {
  for (const prop of Object.keys(obj)) if (!allowed.includes(prop)) out.push(`${where}: unknown property "${prop}"`);
}

/**
 * Authoring problems in a schema as messages, `[]` when it is well formed.
 * Shape: `{root: node, refs?: [{at, in: [path]}], pipelines?: {at, stages: [{key, in: [path]}]}}`.
 */
export function validateSchema(schema) {
  const out = [];
  if (!isObject(schema) || schema.root === undefined) return ['a schema is an object with a root node'];
  unknownProps(schema, ['root', 'refs', 'pipelines'], 'schema', out);
  nodeProblems(schema.root, 'root', out);
  if (schema.refs !== undefined) {
    if (!Array.isArray(schema.refs)) out.push('refs: must be a list');
    else {
      schema.refs.forEach((ref, i) => {
        const where = `refs[${i}]`;
        if (!isObject(ref)) return void out.push(`${where}: a ref must be an object`);
        unknownProps(ref, ['at', 'in'], where, out);
        pathProblems(ref.at, where, out, { what: 'at', plain: false });
        inProblems(ref.in, where, out);
      });
    }
  }
  if (schema.pipelines !== undefined) {
    const p = schema.pipelines;
    if (!isObject(p)) return [...out, 'pipelines: must be an object'];
    unknownProps(p, ['at', 'stages'], 'pipelines', out);
    pathProblems(p.at, 'pipelines', out, { what: 'at', plain: true });
    if (!Array.isArray(p.stages) || p.stages.length === 0) out.push('pipelines: stages must be a non-empty list');
    else {
      p.stages.forEach((st, i) => {
        const where = `pipelines.stages[${i}]`;
        if (!isObject(st)) return void out.push(`${where}: a stage must be an object`);
        unknownProps(st, ['key', 'in'], where, out);
        if (typeof st.key !== 'string') out.push(`${where}: key must be a string`);
        else if (!SINGLE_KEY.test(st.key)) out.push(`${where}: key ${JSON.stringify(st.key)} must be a single plain key`);
        inProblems(st.in, where, out);
      });
    }
  }
  return out;
}

/** Freeze a schema (or any plain data) all the way down, so a shared schema cannot be edited. */
export function deepFreeze(value) {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
