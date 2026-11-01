// Query it widget core (docs/M1-DESIGN.md §4.7): validate a QuerySpec and grade a typed query
// against the reference through lib/promql/grade.mjs. Pure and DOM-free; state is never
// mutated. The view and its penalty live in `query-it-view.mjs` (`mountQuery`, I1).
//
// QuerySpec = { id, dataset: name, at: seconds, reference: query, given?: text, hint?: html, explain: html }
// QueryState = { tried: string[] (normalised wrong queries), solved }

import { isId } from '../registry.mjs';
import { datasetNames, getDataset } from '../promql/datasets.mjs';
import { gradeQuery } from '../promql/grade.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const show = (v) => (typeof v === 'string' ? `"${v}"` : String(v));
const FREE = new Set(['syntax', 'unsupported', 'error']);

/** `text` trimmed with every run of whitespace collapsed to one space (what "the same query" means). */
export const normalizeQuery = (text) => String(text).trim().replace(/\s+/g, ' ');

/** Every problem with `spec` (empty when valid). Never throws, never stops at the first. */
export function validateQuerySpec(spec) {
  if (!isObject(spec)) return ['spec: not an object'];
  const problems = [];
  if (!isId(spec.id)) problems.push(`spec id ${show(spec.id)} is not kebab-case`);
  if (!isText(spec.explain)) problems.push('explain is not non-empty text');
  for (const k of ['hint', 'given']) {
    if (spec[k] !== undefined && !isText(spec[k])) problems.push(`${k} is not non-empty text`);
  }
  const known = typeof spec.dataset === 'string' && datasetNames().includes(spec.dataset);
  if (!known) problems.push(`unknown dataset ${show(spec.dataset)} (one of ${datasetNames().join(', ')})`);
  const { start = -Infinity, end = Infinity } = known ? getDataset(spec.dataset).meta : {};
  if (typeof spec.at !== 'number' || !Number.isFinite(spec.at)) problems.push('at must be a number of seconds');
  else if (spec.at < start || spec.at > end) problems.push(`at ${spec.at} is outside the dataset (${start}..${end})`);
  if (!isText(spec.reference)) problems.push('reference is not non-empty text');
  else if (known && Number.isFinite(spec.at)) {
    try {
      gradeQuery(spec.dataset, spec.at, spec.reference, spec.reference);
    } catch (e) {
      problems.push(`reference does not give data: ${e.message.replace(/^reference query .*? gives no data: /, '')}`);
    }
    if (problems.length === 0 && isText(spec.given) && gradeQuery(spec.dataset, spec.at, spec.given, spec.reference).ok) {
      problems.push('given already passes, so there is nothing to do');
    }
  }
  return problems;
}

export const newQueryState = () => ({ tried: [], solved: false });

/**
 * Run `text` for `spec` in `state`: `{state, outcome, reason?, grade?}`. Outcomes: `solved` (already
 * solved, nothing changes), `blank` (free), `right` (grades ok), `syntax`/`unsupported`/`error`
 * (free, never remembered; `grade` carries the detail), `repeat` (a failing query already tried,
 * free), `wrong` (+`reason`: `empty` | `wrong-count` | `wrong-labels` | `wrong-values`; remembered).
 */
export function runQuery(spec, state, text) {
  if (state.solved) return { state, outcome: 'solved' };
  const norm = normalizeQuery(text);
  if (norm === '') return { state, outcome: 'blank' };
  if (state.tried.includes(norm)) return { state, outcome: 'repeat' };
  const grade = gradeQuery(spec.dataset, spec.at, text, spec.reference);
  if (grade.ok) return { state: { ...state, solved: true }, outcome: 'right', grade };
  if (FREE.has(grade.reason)) return { state, outcome: grade.reason, grade };
  return { state: { ...state, tried: [...state.tried, norm] }, outcome: 'wrong', reason: grade.reason, grade };
}
