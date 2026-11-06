// Grading for Query it (docs/M1-DESIGN.md §4.6): run the learner's query and the reference
// query on the same dataset at the same time and compare the RESULT series (label sets and
// values), never the query text, so any correct formulation passes.

import { getDataset } from './datasets.mjs';
import { evaluate, labelKey } from './eval.mjs';

/** |a - b| <= absolute + relative * max(|a|, |b|); NaN equals NaN, an infinity equals itself. */
export const TOLERANCE = { absolute: 1e-9, relative: 1e-6 };

export function sameNumber(a, b) {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= TOLERANCE.absolute + TOLERANCE.relative * Math.max(Math.abs(a), Math.abs(b));
}

const FAILURES = new Set(['syntax', 'unsupported', 'error']);

/**
 * The evaluated answer: `reference` run on `dataset` (a name or an object) at `time`, the one
 * evaluation gradeQuery compares against. A reference that gives no data is an authoring bug and throws.
 */
export function referenceResult(dataset, time, reference) {
  const data = typeof dataset === 'string' ? getDataset(dataset) : dataset;
  const want = evaluate(data, time, reference);
  if (want.kind === 'vector' ? want.series.length === 0 : want.kind !== 'scalar') {
    throw new Error(`reference query ${JSON.stringify(reference)} gives no data: ${JSON.stringify(want)}`);
  }
  return want;
}

/**
 * Grade `query` against `reference` (a query text) on `dataset` (a registered name or a
 * dataset object) at `time`. `{ok: true, result}` or `{ok: false, reason, result, ...detail}` with
 * `reason` one of: `syntax` (+`message`, `at`), `unsupported` (+`what`), `error` (+`message`,
 * a runtime error such as many-to-one matching), `empty` (no data), `wrong-count`,
 * `wrong-labels`, `wrong-values`. Checked in that order, so a wrong grouping is reported as a
 * count or label problem before any value is looked at. A reference that cannot produce data
 * is an authoring bug and throws.
 */
export function gradeQuery(dataset, time, query, reference) {
  const data = typeof dataset === 'string' ? getDataset(dataset) : dataset;
  const want = referenceResult(data, time, reference);
  const got = evaluate(data, time, query);
  const fail = (reason, extra = {}) => ({ ok: false, reason, result: got, ...extra });
  if (FAILURES.has(got.kind)) {
    const { kind, ...detail } = got;
    return fail(kind, detail);
  }
  if (got.kind === 'scalar' || want.kind === 'scalar') {
    if (got.kind !== want.kind) return got.kind === 'vector' && got.series.length === 0 ? fail('empty') : fail('wrong-labels');
    return sameNumber(got.value, want.value) ? { ok: true, result: got } : fail('wrong-values');
  }
  if (got.series.length === 0) return fail('empty');
  if (got.series.length !== want.series.length) return fail('wrong-count');
  // Both are sorted by label set, so equal label sets line up index by index.
  const keys = got.series.map((s) => labelKey(s.labels));
  if (keys.some((k, i) => k !== labelKey(want.series[i].labels))) return fail('wrong-labels');
  if (got.series.some((s, i) => !sameNumber(s.value, want.series[i].value))) return fail('wrong-values');
  return { ok: true, result: got };
}
