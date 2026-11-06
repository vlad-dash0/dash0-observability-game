// The Query it hint ladder in the real levels (#159 Q2): every query step of every level, through
// the registry, declares helps, has an authored tier 1 that gives nothing of its reference away,
// a tier 2 that never leaks, and a tier 3 that completes the step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { referenceResult } from '../lib/promql/grade.mjs';
import { parse } from '../lib/promql/parse.mjs';
import { hintFor, queryHelps } from '../lib/widgets/query-it-help.mjs';
import { newQueryState, runQuery } from '../lib/widgets/query-it.mjs';

const levels = ACTS.flatMap((a) => [...a.levels, ...(a.boss ? [a.boss] : [])]);
const STEPS = levels.flatMap((lv) => (lv.play?.steps ?? []).filter((s) => s.query).map((s) => s.query));

/** What a reference gives away, from its parse: metric names, matcher values, functions, grouping labels. */
function secrets(reference) {
  const parsed = parse(reference);
  assert.equal(parsed.kind, 'ok', reference);
  const metrics = new Set();
  const values = new Set();
  const funcs = new Set();
  const labels = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n === null || typeof n !== 'object') return;
    if (n.type === 'sel') {
      for (const m of n.matchers) (m.label === '__name__' ? metrics : values).add(m.value);
      for (const m of n.matchers) if (m.label !== '__name__') labels.add(m.label);
    }
    if (n.type === 'call') funcs.add(n.fn);
    if (n.type === 'agg') {
      funcs.add(n.op);
      for (const l of [...(n.by ?? []), ...(n.without ?? [])]) labels.add(l);
    }
    if (n.matching) for (const l of n.matching.labels ?? []) labels.add(l);
    for (const v of Object.values(n)) walk(v);
  };
  walk(parsed.ast);
  return { metrics, values, funcs, labels };
}

const strip = (html) => html.replace(/<[^>]*>/g, ' ');
const has = (text, word) => new RegExp(`(^|[^\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(text);
const textOf = (html) => strip(html).replace(/&#39;/g, "'");

test('the registry has query steps to check', () => {
  assert.ok(STEPS.length >= 8, `found ${STEPS.length}`);
});

test('every query step declares helps and every hinted step has an authored hint', () => {
  for (const spec of STEPS) {
    assert.ok(spec.helps !== undefined, `${spec.id}: no helps`);
    if (queryHelps(spec).hints) assert.ok(typeof spec.hint === 'string' && spec.hint.trim() !== '', `${spec.id}: hints on, no authored hint`);
  }
});

test('tier 1 gives away no metric, function, grouping label or matcher value of the reference', () => {
  for (const spec of STEPS) {
    const text = textOf(hintFor(spec, '', 1, { e: escapeHtml }).html);
    const { metrics, values, funcs, labels } = secrets(spec.reference);
    for (const w of [...metrics, ...values, ...funcs, ...labels]) assert.ok(!has(text, w), `${spec.id}: tier 1 names "${w}": ${text}`);
  }
});

test('tier 2 leaks no function, grouping label, matcher value or number, for blank and for the starting text', () => {
  for (const spec of STEPS) {
    const { funcs, labels, values } = secrets(spec.reference);
    const want = referenceResult(spec.dataset, spec.at, spec.reference);
    const nums = (want.kind === 'scalar' ? [want.value] : want.series.map((s) => s.value)).flatMap((v) => [String(v), String(Math.round(v * 100) / 100), String(Math.round(v))]);
    for (const start of ['', spec.given ?? '']) {
      const raw = hintFor(spec, start, 2, { e: escapeHtml }).html;
      const text = textOf(raw);
      for (const w of [...funcs, ...labels, ...values]) {
        // the label names an answer's series are grouped by are part of its shape; tier 2 may say them
        if (labels.has(w) && !funcs.has(w) && !values.has(w)) continue;
        assert.ok(!has(text, w), `${spec.id}: tier 2 names "${w}": ${text}`);
      }
      assert.ok(!text.includes(spec.reference), `${spec.id}: tier 2 quotes the reference`);
      const counts = text.replace(/\b\d+ (of \d+ )?series\b/g, ' ').replace(/\bof \d+\b/g, ' ');
      for (const n of nums) if (!/^0$/.test(n)) assert.ok(!has(counts, n), `${spec.id}: tier 2 shows the number ${n}: ${text}`);
    }
  }
});

test('tier 3 fills in a query that completes the step', () => {
  for (const spec of STEPS) {
    const { apply } = hintFor(spec, '', 3, { e: escapeHtml });
    assert.equal(runQuery(spec, newQueryState(spec), apply).outcome, 'right', spec.id);
  }
});
