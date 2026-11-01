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
    for (const k of node.required ?? []) {
      if (!Object.hasOwn(isObject(keys) ? keys : {}, k)) out.push(`${where}: required key ${JSON.stringify(k)} is not in keys`);
    }
    if (node.additional !== undefined) nodeProblems(node.additional, `${where}.additional`, out);
    if ('keyPattern' in node) {
      try {
        new RegExp(node.keyPattern);
      } catch {
        out.push(`${where}: keyPattern is not a valid regular expression`);
      }
    }
  }
}

/** A dotted path of plain keys (no `*`, no `[]`). */
function plainPath(path, where, out) {
  try {
    const segs = parsePattern(path);
    if (segs.some((s) => s.key === '*' || s.each)) out.push(`${where}: ${JSON.stringify(path)} must be a plain dotted path`);
  } catch (e) {
    out.push(`${where}: ${e.message}`);
  }
}

function inProblems(list, where, out) {
  if (!Array.isArray(list) || list.length === 0) return void out.push(`${where}: in must be a non-empty list of paths`);
  list.forEach((p) => plainPath(p, where, out));
}

/**
 * Authoring problems in a schema as messages, `[]` when it is well formed.
 * Shape: `{root: node, refs?: [{at, in: [path]}], pipelines?: {at, stages: [{key, in: [path]}]}}`.
 */
export function validateSchema(schema) {
  const out = [];
  if (!isObject(schema) || schema.root === undefined) return ['a schema is an object with a root node'];
  nodeProblems(schema.root, 'root', out);
  (schema.refs ?? []).forEach((ref, i) => {
    try {
      parsePattern(ref?.at);
    } catch (e) {
      out.push(`refs[${i}]: ${e.message}`);
    }
    inProblems(ref?.in, `refs[${i}]`, out);
  });
  if (schema.pipelines !== undefined) {
    const p = schema.pipelines;
    plainPath(p?.at, 'pipelines', out);
    if (!Array.isArray(p?.stages) || p.stages.length === 0) out.push('pipelines: stages must be a non-empty list');
    else p.stages.forEach((st, i) => inProblems(st?.in, `pipelines.stages[${i}]`, out));
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
