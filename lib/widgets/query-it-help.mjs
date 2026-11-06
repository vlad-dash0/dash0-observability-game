// The Query it help ladder, pure (#159; docs/M1-DESIGN.md §4.6): the helps a query step declares
// (`spec.helps`, today only `hints`) and the three hint tiers. Tier 2 reads the answer through
// the grader's own functions (`referenceResult`, `gradeQuery`), so there is no second grader.
// It names the answer's metrics and shape, never a label value, a function or the reference text.
// Line text is plain text and escaped. DOM-free.

import { gradeQuery, referenceResult } from '../promql/grade.mjs';
import { parse } from '../promql/parse.mjs';
import { validateHelps } from './help-ladder.mjs';

/** The Query it helps, in chip order: [key, label]. */
export const QUERY_HELPS = Object.freeze([['hints', 'Hints']]);
const KEYS = QUERY_HELPS.map(([k]) => k);

/** The tier 1 hint when a step has no authored `hint`. Plain text. */
export const QUERY_RULE =
  'Say what one series of the answer is about, then choose the metric, the function and the grouping that give exactly that. A query that does not run is free.';

/** The helps of `spec`, every key true or false. Without `helps`: hints off. */
export function queryHelps(spec) {
  return Object.fromEntries(KEYS.map((k) => [k, spec.helps?.[k] === true]));
}

/** Problems with the helps of a valid QuerySpec (and its `hint` line). */
export function validateQueryHelps(spec) {
  const problems = validateHelps(spec.helps, KEYS);
  if (spec.hint !== undefined && !(typeof spec.hint === 'string' && spec.hint.trim() !== '')) {
    problems.push('hint: not non-empty text');
  }
  if (problems.some((p) => p.startsWith('helps:'))) return problems; // a malformed helps object: say only that
  if (spec.hint !== undefined && !queryHelps(spec).hints) problems.push('hint: shown only when helps.hints is on');
  return problems;
}

const defaultEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The metric names a query selects by `__name__="..."`, in order, once each. */
function metricNames(query) {
  const parsed = parse(query);
  const names = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'sel') {
      for (const m of node.matchers) if (m.label === '__name__' && m.op === '=' && !names.includes(m.value)) names.push(m.value);
    }
    for (const v of Object.values(node)) walk(v);
  };
  if (parsed.kind === 'ok') walk(parsed.ast);
  return names;
}

/** The label names a vector's series carry (not `__name__`), sorted. */
const labelNames = (series) => [...new Set(series.flatMap((s) => Object.keys(s.labels)))].filter((k) => k !== '__name__').sort();

const plural = (n) => `${n} series`;

/**
 * Hint tier `tier` (1 to 3) for the player's query `text`: { html, apply? }; every html is a <p>.
 *   tier 1  the step's authored `hint` or QUERY_RULE
 *   tier 2  the answer's metric names and shape (from the reference's own result), then how the
 *           player's query compares (from gradeQuery's reason); blank adds nothing
 *   tier 3  `apply` = the reference query; the widget fills it in and runs its Run, no mistake
 */
export function hintFor(spec, text, tier, { e = defaultEscape } = {}) {
  if (tier === 1) return { html: `<p>${spec.hint !== undefined ? spec.hint : QUERY_RULE}</p>` };
  if (tier === 3) return { apply: spec.reference, html: '<p>Filled in for you: a query that gives the answer.</p>' };
  const want = referenceResult(spec.dataset, spec.at, spec.reference);
  const names = metricNames(spec.reference);
  const parts = [];
  if (names.length > 0) parts.push(`The answer reads ${names.join(', ')}.`);
  if (want.kind === 'scalar') parts.push('It is a single number.');
  else {
    const labels = labelNames(want.series);
    parts.push(
      labels.length === 0 && want.series.length === 1
        ? 'It returns one series with no labels.'
        : `It returns ${plural(want.series.length)}, one per ${labels.length === 0 ? 'series' : labels.join(', ')}.`,
    );
  }
  if (typeof text === 'string' && text.trim() !== '') {
    const g = gradeQuery(spec.dataset, spec.at, text, spec.reference);
    if (g.ok) parts.push('Yours already gives the answer: press Run.');
    else if (g.reason === 'syntax' || g.reason === 'unsupported' || g.reason === 'error') parts.push('Yours does not run yet.');
    else if (g.reason === 'empty') parts.push('Yours returns no data.');
    else if (g.reason === 'wrong-count') parts.push(`Yours returns ${g.result.series.length}.`);
    else if (g.reason === 'wrong-labels') {
      if (g.result.kind === 'scalar') parts.push('Yours is a single number.');
      else {
        const labels = labelNames(g.result.series);
        parts.push(`Yours has ${g.result.series.length}, grouped by ${labels.length === 0 ? 'nothing' : labels.join(', ')}.`);
      }
    } else parts.push('Your series match; the values do not.');
  }
  return { html: `<p>${e(parts.join(' '))}</p>` };
}
