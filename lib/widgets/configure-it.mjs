// Configure it widget core (docs/M1-DESIGN.md §4.9): validate a ConfigureSpec and grade a typed
// YAML config through the checker core (lib/configure/, §4.8). Pure and DOM-free; state is never
// mutated. The view and its penalty live in `configure-it-view.mjs` (`mountConfigure`, I1).
//
// ConfigureSpec = { id, schema: name, given: yaml, reference: yaml, target?: [pipeline], uses?: {pipeline: [component id]}, extensions?: [component id] (enabled under service.extensions), forbids?: {pipeline: [component id]} (the pipeline must not list it), hint?: html (tier 1, shown only with helps.hints), helps?: {hints: boolean}, explain: html }
// ConfigureState = { tried: string[] (normalised wrong configs), solved }

import { isId } from '../registry.mjs';
import { checkConfig, enabledExtensions, pipelineComponents, referenceProblems, sectionOf, stagesOf } from '../configure/check.mjs';
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
const usesOf = (spec) => (isObject(spec.uses) ? spec.uses : {});
/** The pipelines that must flow: the `target` ones, then those only `uses` names. */
export const required = (spec) => [...new Set([...(spec.target ?? []), ...Object.keys(usesOf(spec))])];
const unmetTargets = (spec, r) =>
  required(spec).filter((name) => !r.verdict?.pipelines.some((p) => p.name === name && p.flowing));
/**
 * The ids of `uses[name]` that `r` does not have where the reference has them: listed in pipeline `name` under each stage the
 * reference lists them under, and defined in the section the reference defines them in. (An id the reference does not
 * list in that pipeline falls back to any stage.) So an exporter defined and listed as a processor does not count.
 * Each entry says which check failed: `why` is `stage` (not listed where it belongs) or `section` (listed right, defined in the wrong section).
 */
export function missingUsesWhy(spec, r, schema, name) {
  const ref = checkConfig(spec.reference, schema);
  const out = [];
  for (const id of usesOf(spec)[name] ?? []) {
    const keys = stagesOf(ref, schema, name, id);
    if (keys.length === 0) {
      if (!pipelineComponents(r, schema, name).has(id)) out.push({ id, why: 'stage' });
      continue;
    }
    const mine = stagesOf(r, schema, name, id);
    if (!keys.every((k) => mine.includes(k))) { out.push({ id, why: 'stage' }); continue; }
    const section = sectionOf(ref, schema, keys[0], id);
    if (section !== undefined && sectionOf(r, schema, keys[0], id) !== section) out.push({ id, why: 'section' });
  }
  return out;
}
/** The ids `missingUsesWhy` finds. */
export const missingUses = (spec, r, schema, name) => missingUsesWhy(spec, r, schema, name).map(({ id }) => id);
/** The `uses` pipelines (they flow) that leave a required component out of its stage or its section. */
const unmetUses = (spec, r, schema) =>
  Object.keys(usesOf(spec)).filter((name) => missingUses(spec, r, schema, name).length > 0);

const forbidsOf = (spec) => (isObject(spec.forbids) ? spec.forbids : {});
const extensionsOf = (spec) => (Array.isArray(spec.extensions) ? spec.extensions : []);
/** The `forbids` pipelines that list a component the task rules out. */
export const unmetForbids = (spec, r, schema) =>
  Object.entries(forbidsOf(spec))
    .filter(([name, ids]) => { const have = pipelineComponents(r, schema, name); return ids.some((id) => have.has(id)); })
    .map(([name]) => name);
/** The `extensions` ids the config does not enable. */
export const unmetExtensions = (spec, r, schema) => {
  const have = enabledExtensions(r, schema);
  return extensionsOf(spec).filter((id) => !have.has(id));
};

/** Problems with a list of component ids: non-empty text, unique. */
function idListProblems(label, ids) {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isText)) return [`${label} must be a non-empty list of component ids`];
  return [...new Set(ids.filter((n, i) => ids.indexOf(n) !== i))].map((id) => `${label} names ${show(id)} twice`);
}

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
    const uses = spec.uses;
    if (uses !== undefined) {
      if (!isObject(uses) || Object.keys(uses).length === 0) {
        problems.push('uses must be a mapping of pipeline names to non-empty lists of component ids');
      } else {
        for (const [name, ids] of Object.entries(uses)) {
          if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isText)) {
            problems.push(`uses ${show(name)} must be a non-empty list of component ids`);
          } else {
            for (const id of new Set(ids.filter((n, i) => ids.indexOf(n) !== i))) problems.push(`uses ${show(name)} names ${show(id)} twice`);
          }
        }
      }
    }
    const { extensions, forbids } = spec;
    if (extensions !== undefined) problems.push(...idListProblems('extensions', extensions));
    if (forbids !== undefined) {
      if (!isObject(forbids) || Object.keys(forbids).length === 0) {
        problems.push('forbids must be a mapping of pipeline names to non-empty lists of component ids');
      } else {
        for (const [name, ids] of Object.entries(forbids)) problems.push(...idListProblems(`forbids ${show(name)}`, ids));
      }
    }
    if (known && isText(spec.given) && isText(spec.reference)) {
      const schema = SCHEMAS[spec.schema];
      problems.push(...referenceProblems(schema, spec.reference, spec.given));
      if (problems.every((p) => !p.startsWith('reference:'))) {
        const ref = checkConfig(spec.reference, schema);
        if (Array.isArray(target)) {
          for (const name of unmetTargets({ target }, ref)) {
            problems.push(`target ${show(name)}: the reference has no flowing pipeline with that name`);
          }
        }
        if (Array.isArray(extensions) && extensions.every(isText)) {
          const have = enabledExtensions(ref, schema);
          for (const id of new Set(extensions)) if (!have.has(id)) problems.push(`extensions: the reference does not enable ${show(id)}`);
        }
        if (isObject(forbids)) {
          for (const [name, ids] of Object.entries(forbids)) {
            if (!Array.isArray(ids) || !ref.verdict.pipelines.some((p) => p.name === name)) {
              if (Array.isArray(ids)) problems.push(`forbids ${show(name)}: the reference has no pipeline with that name`);
              continue;
            }
            const have = pipelineComponents(ref, schema, name);
            for (const id of ids) if (isText(id) && have.has(id)) problems.push(`forbids ${show(name)}: the reference lists ${show(id)}`);
          }
        }
        if (isObject(uses)) {
          for (const name of unmetTargets({ uses }, ref)) {
            problems.push(`uses ${show(name)}: the reference has no flowing pipeline with that name`);
          }
          for (const [name, ids] of Object.entries(uses)) {
            if (!Array.isArray(ids)) continue;
            const have = pipelineComponents(ref, schema, name);
            for (const id of ids) if (isText(id) && !have.has(id) && ref.verdict.pipelines.some((p) => p.name === name)) problems.push(`uses ${show(name)}: the reference does not list ${show(id)}`);
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
 * errors, `target` for a valid config whose required pipelines (`target` plus those `uses` names) do not flow,
 * with `unmet`; `uses` for one that flows but leaves a `uses` component out, with `unmet` the pipeline
 * names, never the ids; `forbids` for one that lists a forbidden component, with `unmet` the pipeline names;
 * `extensions` for one that leaves a required extension out of the extension list, with `unmet` `['extensions']`
 * (never the ids); remembered).
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
  const flows = passes(result) && unmet.length === 0;
  const schema = SCHEMAS[spec.schema];
  const missing = flows ? unmetUses(spec, result, schema) : [];
  const banned = flows ? unmetForbids(spec, result, schema) : [];
  const noExt = flows ? unmetExtensions(spec, result, schema) : [];
  if (flows && missing.length === 0 && banned.length === 0 && noExt.length === 0) return { state: { ...state, solved: true }, outcome: 'right', result };
  if (state.tried.includes(norm)) return { state, outcome: 'repeat', result };
  const next = { ...state, tried: [...state.tried, norm] };
  if (!passes(result)) return { state: next, outcome: 'wrong', reason: 'invalid', result };
  if (unmet.length > 0) return { state: next, outcome: 'wrong', reason: 'target', result, unmet };
  if (missing.length > 0) return { state: next, outcome: 'wrong', reason: 'uses', result, unmet: missing };
  if (banned.length > 0) return { state: next, outcome: 'wrong', reason: 'forbids', result, unmet: banned };
  return { state: next, outcome: 'wrong', reason: 'extensions', result, unmet: ['extensions'] };
}
