// Instant-query evaluator for the PromQL subset (docs/M1-DESIGN.md §4.6). Pure: takes a
// dataset `{series: [{labels, samples: [[t, v]]}]}` (seconds, samples ascending, the metric name
// in the `__name__` label), an evaluation time and the query text; returns a result object,
// never throws for bad input:
//   {kind:'vector', series:[{labels, value}]} sorted by label set | {kind:'scalar', value}
//   | {kind:'syntax', message, at} | {kind:'unsupported', what} | {kind:'error', message}
// Semantics follow https://prometheus.io/docs/prometheus/latest/querying/basics/ (selectors,
// 5m lookback), .../operators/ (aggregation, matching) and .../functions/ (rate, increase,
// histogram_quantile); the numeric kernels live in math.mjs.

import { bucketQuantile, extrapolatedDelta } from './math.mjs';
import { failed, QueryFail, unsupported } from './lex.mjs';
import { parse, testMatcher } from './parse.mjs';

/** Default `--query.lookback-delta`: an instant selector sees samples in (t - 300s, t]. */
export const LOOKBACK_SECONDS = 300;
const NAME = '__name__';

/** Canonical text of a label set, keys sorted: `a="1",b="2"`. Also the sort key of a result. */
export const labelKey = (labels) =>
  Object.keys(labels).sort().map((k) => `${k}=${JSON.stringify(labels[k])}`).join(',');

const pick = (labels, keep) => Object.fromEntries(Object.entries(labels).filter(([k]) => keep.includes(k)));
const omit = (labels, drop) => Object.fromEntries(Object.entries(labels).filter(([k]) => !drop.includes(k)));
const ARITH = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b };
const CMP = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b };

const selected = (dataset, sel) => dataset.series.filter((s) => sel.matchers.every((m) => testMatcher(m, s.labels[m.label] ?? '')));

/** A vector may not hold two samples with the same label set (Prometheus errors the same way). */
function unique(series) {
  const seen = new Set();
  for (const s of series) {
    const k = labelKey(s.labels);
    if (seen.has(k)) throw failed(`vector cannot contain metrics with the same labelset {${k}}`);
    seen.add(k);
  }
  return series;
}

function evalCall(node, ctx) {
  const { dataset, time } = ctx;
  if (node.fn === 'histogram_quantile') {
    const q = evalNode(node.args[0], ctx);
    const groups = new Map();
    for (const s of evalNode(node.args[1], ctx)) {
      const le = s.labels.le === '+Inf' || s.labels.le === 'Inf' ? Infinity : Number(s.labels.le ?? NaN);
      if (Number.isNaN(le) || s.labels.le === '') continue; // no usable `le`: the series is ignored
      const labels = omit(s.labels, ['le', NAME]);
      const k = labelKey(labels);
      if (!groups.has(k)) groups.set(k, { labels, buckets: [] });
      groups.get(k).buckets.push({ le, count: s.value });
    }
    return [...groups.values()].map((g) => ({ labels: g.labels, value: bucketQuantile(q, g.buckets) }));
  }
  const { sel, range } = node.args[0];
  const out = [];
  for (const s of selected(dataset, sel)) {
    const inWindow = s.samples.filter(([t]) => t > time - range && t <= time);
    const value = extrapolatedDelta(inWindow, time - range, time, range, node.fn === 'rate');
    if (value !== null) out.push({ labels: omit(s.labels, [NAME]), value });
  }
  return unique(out);
}

function evalAgg(node, ctx) {
  const groups = new Map();
  for (const s of evalNode(node.arg, ctx)) {
    const labels = node.by ? pick(s.labels, node.by) : node.without ? omit(s.labels, [...node.without, NAME]) : {};
    const k = labelKey(labels);
    if (!groups.has(k)) groups.set(k, { labels, values: [] });
    groups.get(k).values.push(s.value);
  }
  const reduce = {
    sum: (v) => v.reduce((a, b) => a + b, 0),
    avg: (v) => v.reduce((a, b) => a + b, 0) / v.length,
    count: (v) => v.length,
    // Like Prometheus, NaN loses to any number; the result is NaN only when every input is.
    min: (v) => v.reduce((a, b) => (b < a || Number.isNaN(a) ? b : a)),
    max: (v) => v.reduce((a, b) => (b > a || Number.isNaN(a) ? b : a)),
  }[node.op];
  return [...groups.values()].map((g) => ({ labels: g.labels, value: reduce(g.values) }));
}

function evalBin(node, ctx) {
  const l = evalNode(node.lhs, ctx);
  const r = evalNode(node.rhs, ctx);
  const filter = node.op in CMP;
  const f = filter ? CMP[node.op] : ARITH[node.op];
  const lScalar = node.lhs.vt === 'scalar';
  const rScalar = node.rhs.vt === 'scalar';
  if (lScalar && rScalar) return f(l, r); // scalar-only comparisons are rejected by the parser
  if (lScalar || rScalar) {
    const out = [];
    for (const s of lScalar ? r : l) {
      const [a, b] = lScalar ? [l, s.value] : [s.value, r];
      if (!filter) out.push({ labels: omit(s.labels, [NAME]), value: f(a, b) });
      else if (f(a, b)) out.push(s); // a comparison keeps the vector's sample, name included
    }
    return unique(out);
  }
  const m = node.matching;
  const sig = (labels) => labelKey(m?.kind === 'on' ? pick(labels, m.labels) : omit(labels, [NAME, ...(m?.labels ?? [])]));
  const resultLabels = (labels) => {
    const base = filter ? labels : omit(labels, [NAME]);
    if (!m) return base;
    return m.kind === 'on' ? pick(base, m.labels) : omit(base, m.labels);
  };
  const right = new Map();
  for (const s of r) {
    const k = sig(s.labels);
    if (right.has(k)) throw failed(`found duplicate series for the match group {${k}} on the right-hand side of the operation; many-to-one matching is not supported`);
    right.set(k, s);
  }
  const matched = new Set();
  const out = [];
  for (const s of l) {
    const k = sig(s.labels);
    const partner = right.get(k);
    if (!partner) continue;
    if (matched.has(k)) throw failed(`multiple matches for the match group {${k}} on the left-hand side of the operation; many-to-one matching is not supported`);
    matched.add(k);
    if (!filter) out.push({ labels: resultLabels(s.labels), value: f(s.value, partner.value) });
    else if (f(s.value, partner.value)) out.push({ labels: resultLabels(s.labels), value: s.value });
  }
  return unique(out);
}

function evalNode(node, ctx) {
  switch (node.type) {
    case 'num': return node.value;
    case 'paren': return evalNode(node.arg, ctx);
    case 'neg': {
      const v = evalNode(node.arg, ctx);
      return node.vt === 'scalar' ? -v : v.map((s) => ({ labels: omit(s.labels, [NAME]), value: -s.value }));
    }
    case 'sel': {
      const out = [];
      for (const s of selected(ctx.dataset, node)) {
        const last = s.samples.findLast(([t]) => t <= ctx.time);
        if (last && last[0] > ctx.time - LOOKBACK_SECONDS) out.push({ labels: s.labels, value: last[1] });
      }
      return out;
    }
    case 'call': return evalCall(node, ctx);
    case 'agg': return evalAgg(node, ctx);
    case 'bin': return evalBin(node, ctx);
    default: throw new Error(`unhandled node type ${node.type}`);
  }
}

/** Evaluate `query` at `time` (seconds) over `dataset`. See the file header for the result shapes. */
export function evaluate(dataset, time, query) {
  if (!Number.isFinite(time)) throw new TypeError(`evaluate: time must be a finite number, got ${time}`);
  const parsed = parse(query);
  if (parsed.kind !== 'ok') return parsed;
  const { ast } = parsed;
  try {
    if (ast.vt === 'matrix') throw unsupported('a range vector as the query result (wrap it in rate() or increase())');
    const v = evalNode(ast, { dataset, time });
    if (ast.vt === 'scalar') return { kind: 'scalar', value: v };
    const series = [...v].sort((a, b) => {
      const ka = labelKey(a.labels);
      const kb = labelKey(b.labels);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return { kind: 'vector', series };
  } catch (e) {
    if (e instanceof QueryFail) return e.result;
    throw e;
  }
}
