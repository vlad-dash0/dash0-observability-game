// Configure it widget core (docs/M1-DESIGN.md §4.9): validate a ConfigureSpec and grade a typed
// YAML config through the checker core (lib/configure/, §4.8). Pure and DOM-free; state is never
// mutated. The view and its penalty live in `configure-it-view.mjs` (`mountConfigure`, I1).
//
// ConfigureSpec = { id, schema: name, given: yaml, reference: yaml, target?: [pipeline], hint?: html, explain: html }
// ConfigureState = { tried: string[] (normalised wrong configs), solved }

import { isId } from '../registry.mjs';
import { checkConfig, referenceProblems } from '../configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../configure/collector.mjs';

/** The schemas a spec can name (data holds names, code holds the schemas). */
export const SCHEMAS = Object.freeze({ collector: COLLECTOR_SCHEMA });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const show = (v) => (typeof v === 'string' ? `"${v}"` : String(v));

/** `text` with LF line endings, no trailing spaces and no outer blank lines (indentation is kept: it means something in YAML). */
export const normalizeConfig = (text) =>
  String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');

/** A config passes when it has no errors and, with pipelines to judge, every one flows. */
const passes = (r) => r.ok && (r.verdict === null || r.verdict.flowing);
const unmetTargets = (spec, r) =>
  (spec.target ?? []).filter((name) => !r.verdict?.pipelines.some((p) => p.name === name && p.flowing));

/** Every problem with `spec` (empty when valid). Never throws, never stops at the first. */
export function validateConfigureSpec(spec) {
  try {
    if (!isObject(spec)) return ['spec: not an object'];
    const problems = [];
    if (!isId(spec.id)) problems.push(`spec id ${show(spec.id)} is not kebab-case`);
    if (!isText(spec.explain)) problems.push('explain is not non-empty text');
    if (spec.hint !== undefined && !isText(spec.hint)) problems.push('hint is not non-empty text');
    const known = typeof spec.schema === 'string' && Object.hasOwn(SCHEMAS, spec.schema);
    if (!known) problems.push(`unknown schema ${show(spec.schema)} (one of ${Object.keys(SCHEMAS).join(', ')})`);
    for (const k of ['given', 'reference']) if (!isText(spec[k])) problems.push(`${k} is not non-empty text`);
    const target = spec.target;
    if (target !== undefined) {
      if (!Array.isArray(target) || target.length === 0 || !target.every(isText)) {
        problems.push('target must be a non-empty list of pipeline names');
      } else {
        const twice = target.filter((n, i) => target.indexOf(n) !== i);
        for (const name of new Set(twice)) problems.push(`target names ${show(name)} twice`);
      }
    }
    if (known && isText(spec.given) && isText(spec.reference)) {
      const schema = SCHEMAS[spec.schema];
      problems.push(...referenceProblems(schema, spec.reference, spec.given));
      if (problems.every((p) => !p.startsWith('reference:'))) {
        const ref = checkConfig(spec.reference, schema);
        if (Array.isArray(target)) {
          for (const name of unmetTargets(spec, ref)) {
            problems.push(`target ${show(name)}: the reference has no flowing pipeline with that name`);
          }
        }
      }
    }
    return problems;
  } catch {
    return ['spec could not be read'];
  }
}

export const newConfigureState = () => ({ tried: [], solved: false });

/**
 * Check `text` for `spec` in `state`: `{state, outcome, reason?, result?, unmet?}`. Outcomes:
 * `solved` (already solved, nothing changes), `blank` (free), `right` (passes and meets the
 * target), `parse` (the text is not a readable config: free, never remembered; `result` carries
 * the error), `crash` (the checker threw: free, never remembered), `repeat` (a failing config
 * already tried, free; `result` is its check), `wrong` (+`reason`: `invalid` for schema or wiring
 * errors, `target` for a valid config whose named pipelines do not flow, with `unmet`; remembered).
 * `opts.check` replaces the checker (a seam for tests).
 */
export function runConfigure(spec, state, text, { check = checkConfig } = {}) {
  if (state.solved) return { state, outcome: 'solved' };
  const norm = normalizeConfig(text);
  if (norm === '') return { state, outcome: 'blank' };
  let result;
  try {
    result = check(text, SCHEMAS[spec.schema]);
  } catch {
    return { state, outcome: 'crash' };
  }
  if (result.doc === null) return { state, outcome: 'parse', result };
  const unmet = unmetTargets(spec, result);
  if (passes(result) && unmet.length === 0) return { state: { ...state, solved: true }, outcome: 'right', result };
  if (state.tried.includes(norm)) return { state, outcome: 'repeat', result };
  const next = { ...state, tried: [...state.tried, norm] };
  if (!passes(result)) return { state: next, outcome: 'wrong', reason: 'invalid', result };
  return { state: next, outcome: 'wrong', reason: 'target', result, unmet };
}
