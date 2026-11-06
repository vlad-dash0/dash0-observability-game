// The Query it help ladder, pure (#159): lib/widgets/query-it-help.mjs. Helps, validation and the
// three hint tiers; tier 2 is derived from referenceResult and gradeQuery, so there is no second grader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { gradeQuery, referenceResult } from '../lib/promql/grade.mjs';
import histograms from '../levels/histograms.mjs';
import promqlBasics from '../levels/promql-basics.mjs';
import redAndUse from '../levels/red-and-use.mjs';
import { hintFor, QUERY_HELPS, QUERY_RULE, queryHelps, validateQueryHelps } from '../lib/widgets/query-it-help.mjs';
import { at, ds } from './helpers/promql.mjs';

const REF = 'sum by (route) (rate(http_server_requests_total{service="checkout", status="500"}[5m]))';
function spec(extra = {}) {
  return { id: 'q', dataset: 'checkout-http', at: 3600, reference: REF, explain: 'x', helps: { hints: true }, ...extra };
}
const h = (text, tier = 2, s = spec()) => hintFor(s, text, tier, { e: escapeHtml }).html;

// ---- helps / validation ---------------------------------------------------------------

test('QUERY_HELPS has one help, hints', () => {
  assert.deepEqual(QUERY_HELPS.map(([k, l]) => `${k}:${l}`), ['hints:Hints']);
});

test('queryHelps: hints on only when the step says so', () => {
  assert.equal(queryHelps(spec()).hints, true);
  assert.equal(queryHelps(spec({ helps: { hints: false } })).hints, false);
  assert.equal(queryHelps(spec({ helps: undefined })).hints, false, 'no helps key: hints off');
  assert.equal(queryHelps(spec({ helps: {} })).hints, false);
});

test('validateQueryHelps names a bad key, value, object, hint and a hint with hints off', () => {
  assert.deepEqual(validateQueryHelps(spec()), []);
  assert.deepEqual(validateQueryHelps(spec({ helps: undefined })), []);
  assert.deepEqual(validateQueryHelps(spec({ hint: 'Group by route.' })), []);
  assert.deepEqual(validateQueryHelps(spec({ helps: { hints: true, q: true } })), ['helps: "q" is not one of hints']);
  assert.deepEqual(validateQueryHelps(spec({ helps: { hints: 'yes' } })), ['helps: "hints" is not true or false']);
  assert.deepEqual(validateQueryHelps(spec({ helps: 'all' })), ['helps: not an object']);
  assert.deepEqual(validateQueryHelps(spec({ hint: '  ' })), ['hint: not non-empty text']);
  assert.deepEqual(validateQueryHelps(spec({ hint: 'x', helps: { hints: false } })), ['hint: shown only when helps.hints is on']);
  assert.deepEqual(validateQueryHelps(spec({ hint: 'x', helps: undefined })), ['hint: shown only when helps.hints is on']);
  assert.deepEqual(validateQueryHelps(spec({ hint: 'x', helps: 'all' })), ['helps: not an object'], 'a malformed helps says only that');
});

// ---- tier 1 and 3 ---------------------------------------------------------------------

test('tier 1 is the authored hint, else the rule, in a <p>', () => {
  assert.equal(h('', 1), `<p>${QUERY_RULE}</p>`);
  assert.equal(h('', 1, spec({ hint: 'Use <code>rate</code>.' })), '<p>Use <code>rate</code>.</p>');
  assert.equal(hintFor(spec(), '', 1).apply, undefined);
  assert.match(QUERY_RULE, /^Say what one series of the answer is about, then choose/);
});

test('tier 3 applies the reference, and the reference grades ok', () => {
  const r = hintFor(spec(), 'junk', 3);
  assert.equal(r.apply, REF);
  assert.equal(r.html, '<p>Filled in for you: a query that gives the answer.</p>');
  assert.equal(gradeQuery('checkout-http', 3600, r.apply, REF).ok, true);
});

// ---- tier 2 ---------------------------------------------------------------------------

const MET = 'http_server_requests_total';
const HEAD = `The answer reads ${MET}. It returns 2 series, one per route.`;

test('tier 2 reads the ANSWER count, not the player result (answer 2 by route, player 3 by status)', () => {
  // A small dataset: two routes, three statuses.
  const rows = [];
  for (const route of ['/a', '/b']) for (const status of ['200', '404', '500']) rows.push([{ __name__: 'x', route, status }, [[100, 1], [300, 31]]]);
  const s = spec({ dataset: ds(...rows), at: 300, reference: 'sum by (route) (rate(x[5m]))' });
  const player = 'sum by (status) (rate(x[5m]))';
  assert.equal(referenceResult(s.dataset, s.at, s.reference).series.length, 2);
  const g = gradeQuery(s.dataset, s.at, player, s.reference);
  assert.equal(g.reason, 'wrong-count');
  assert.equal(g.result.series.length, 3);
  assert.equal(h(player, 2, s), '<p>The answer reads x. It returns 2 series, one per route. Yours returns 3.</p>');
});

test('tier 2 comparison, one assertion per branch', () => {
  assert.equal(h(''), `<p>${HEAD}</p>`, 'blank adds nothing');
  assert.equal(h('   '), `<p>${HEAD}</p>`);
  assert.equal(h(undefined), `<p>${HEAD}</p>`);
  assert.equal(h('sum by ('), `<p>${HEAD} Yours does not run yet.</p>`, 'syntax');
  assert.equal(h('topk(1, http_server_requests_total)'), `<p>${HEAD} Yours does not run yet.</p>`, 'unsupported');
  assert.equal(
    h(`rate(${MET}[5m]) / on(route) rate(${MET}[5m])`),
    `<p>${HEAD} Yours does not run yet.</p>`,
    'runtime error',
  );
  assert.equal(h('nope_metric'), `<p>${HEAD} Yours returns no data.</p>`, 'empty');
  assert.equal(h(`sum(rate(${MET}{service="checkout", status="500"}[5m]))`), `<p>${HEAD} Yours returns 1.</p>`, 'wrong-count');
  assert.equal(
    h(`sum by (service) (rate(${MET}{status="500"}[5m]))`),
    `<p>${HEAD} Yours has 2, grouped by service.</p>`,
    'wrong-labels',
  );
  assert.equal(h(`${REF} * 2`), `<p>${HEAD} Yours is higher than the answer for 1 of 2 series.</p>`, 'wrong-values (/quote is 0, so doubling leaves it)');
  assert.equal(h(`${REF} + 0`), `<p>${HEAD} Yours already gives the answer: press Run.</p>`, 'ok');
  assert.equal(h(REF), `<p>${HEAD} Yours already gives the answer: press Run.</p>`);
});

test('tier 2 for an answer with no labels and for a scalar answer', () => {
  const one = spec({ at: 2700, reference: `sum(increase(${MET}{route="/pay"}[10m]))` });
  assert.equal(h('', 2, one), `<p>The answer reads ${MET}. It returns one series with no labels.</p>`);
  assert.equal(
    h(`sum by (route) (increase(${MET}{route="/pay"}[10m]))`, 2, one),
    `<p>The answer reads ${MET}. It returns one series with no labels. Yours has 1, grouped by route.</p>`,
    'labels where the answer has none',
  );
  const num = spec({ reference: '1 + 1' });
  assert.equal(h('', 2, num), '<p>It is a single number.</p>', 'no metric, so no metric sentence');
  assert.equal(h('2', 2, num), '<p>It is a single number. Yours already gives the answer: press Run.</p>');
  assert.equal(h('3', 2, num), '<p>It is a single number. Yours is higher than the answer.</p>');
  assert.equal(h('1', 2, num), '<p>It is a single number. Yours is lower than the answer.</p>');
  assert.equal(h(`sum(rate(${MET}[5m]))`, 2, num), '<p>It is a single number. Yours has 1, grouped by nothing.</p>');
  assert.equal(
    h(REF, 2, num),
    '<p>It is a single number. Yours has 2, grouped by route.</p>',
    'a grouped vector against a number',
  );
});

test('tier 2 wrong values says which way, per series, with no numbers', () => {
  assert.equal(h(`${REF} + 1`), `<p>${HEAD} Yours is higher than the answer for all 2 series.</p>`, 'all higher');
  assert.equal(h(`${REF} - 1`), `<p>${HEAD} Yours is lower than the answer for all 2 series.</p>`, 'all lower');
  assert.equal(
    h(`${REF} * 2`),
    `<p>${HEAD} Yours is higher than the answer for 1 of 2 series.</p>`,
    'one of two higher',
  );
  // Two series, one above and one below the answer: matched by labels, not by position.
  const rows = [[{ __name__: 'x', k: 'a' }, [[100, 0], [300, 60]]], [{ __name__: 'x', k: 'b' }, [[100, 0], [300, 60]]], [{ __name__: 'y', k: 'a' }, [[100, 0], [300, 120]]], [{ __name__: 'y', k: 'b' }, [[100, 0], [300, 30]]]];
  const mixed = spec({ dataset: ds(...rows), at: 300, reference: 'sum by (k) (rate(x[5m]))' });
  assert.equal(
    h('sum by (k) (rate(y[5m]))', 2, mixed),
    '<p>The answer reads x. It returns 2 series, one per k. Yours reads y. Yours is higher for 1 and lower for 1 of 2 series.</p>',
    'mixed (and a different metric)',
  );
  const num = spec({ reference: '1 + 1' });
  assert.equal(h('5', 2, num), '<p>It is a single number. Yours is higher than the answer.</p>');
  assert.equal(h('0', 2, num), '<p>It is a single number. Yours is lower than the answer.</p>');
});

test('tier 2 wrong values with the right shape but another metric says what it reads', () => {
  const s = spec({
    dataset: ds([{ __name__: 'x', route: '/a' }, [[100, 0], [300, 60]]], [{ __name__: 'x', route: '/b' }, [[100, 0], [300, 60]]], [{ __name__: 'z', route: '/a' }, [[100, 0], [300, 6]]], [{ __name__: 'z', route: '/b' }, [[100, 0], [300, 6]]]),
    at: 300,
    reference: 'sum by (route) (rate(x[5m]))',
  });
  assert.equal(
    h('sum by (route) (rate(z[5m]))', 2, s),
    '<p>The answer reads x. It returns 2 series, one per route. Yours reads z. Yours is lower than the answer for all 2 series.</p>',
  );
  assert.equal(
    h('sum by (route) (rate(x[5m])) * 2', 2, s),
    '<p>The answer reads x. It returns 2 series, one per route. Yours is higher than the answer for all 2 series.</p>',
    'the same metric: no metric sentence',
  );
  // the real case from review: hist-avg answered with a request counter
  const avg = histograms.play.steps.find((st) => st.query?.id === 'hist-avg').query;
  assert.equal(
    h(`sum(rate(${MET}{route="/pay"}[5m]))`, 2, avg),
    '<p>The answer reads http_server_request_duration_seconds_sum, http_server_request_duration_seconds_count. It returns one series with no labels. Yours reads http_server_requests_total. Yours is higher than the answer.</p>',
  );
});

test('tier 2 names several answer labels and escapes the text it builds', () => {
  const s = spec({ reference: `sum by (route, status) (rate(${MET}{service="checkout"}[5m]))` });
  assert.equal(h('', 2, s), `<p>The answer reads ${MET}. It returns 4 series, one per route, status.</p>`);
  const calls = [];
  hintFor(s, '', 2, { e: (t) => (calls.push(t), '<ESC>') });
  assert.equal(hintFor(s, '', 2, { e: () => '<ESC>' }).html, '<p><ESC></p>');
  assert.equal(calls.length, 1);
});

test('tier 2 does not leak: no function, no label value, no long piece of the reference but metric names', () => {
  const refs = [
    REF,
    `sum(increase(${MET}{route="/pay"}[10m]))`,
    'sum by (service_name) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER"}[5m]))',
  ];
  const players = ['', 'sum by (', 'nope', REF, `sum(rate(${MET}[5m]))`, `${REF} * 2`];
  for (const reference of refs) {
    const dataset = reference.includes('span_metrics') ? 'checkout-spanmetrics' : 'checkout-http';
    const s = spec({ reference, dataset });
    const want = referenceResult(dataset, s.at, reference);
    const values = want.series.flatMap((x) => Object.entries(x.labels)).filter(([k]) => k !== '__name__').map(([, v]) => v);
    const metric = reference.match(/[a-z_]+_total/)[0];
    for (const p of players) {
      const html = h(p, 2, s);
      for (const fn of ['rate', 'increase', 'sum by', 'histogram_quantile', 'sum(']) {
        assert.ok(!html.includes(fn), `${fn} leaked: ${html}`);
      }
      for (const v of values) assert.ok(!html.includes(v), `label value ${v} leaked: ${html}`);
      const stripped = reference.split(metric).join('');
      for (let i = 0; i + 12 < stripped.length; i++) {
        assert.ok(!html.includes(stripped.slice(i, i + 13)), `reference piece leaked: ${stripped.slice(i, i + 13)}`);
      }
    }
  }
});

const H = 'http_server_request_duration_seconds';
const SM = 'traces_span_metrics_calls_total';
/** Tempting wrong queries per real step (the explain texts name them), besides blank and the answer itself. */
const WRONG = {
  'pql-rate': ['sum by (route) (rate(http_server_requests_total{service="checkout"}[5m]))', 'sum by (route) (http_server_requests_total{service="checkout", status="500"})'],
  'pql-increase': ['sum(rate(http_server_requests_total{route="/pay"}[10m]))', 'sum(increase(http_server_requests_total{route="/pay"}[5m]))'],
  'hist-avg': [`sum(rate(${H}_sum[5m])) / sum(rate(${H}_count[5m]))`, 'sum(rate(http_server_requests_total{route="/pay"}[5m]))'],
  'hist-p99': [`histogram_quantile(0.99, sum by (le) (rate(${H}_bucket[5m])))`, `histogram_quantile(0.95, sum by (le) (rate(${H}_bucket{route="/pay"}[5m])))`],
  'hist-p95': [`histogram_quantile(0.99, sum by (service, le) (rate(${H}_bucket[5m])))`],
  'ru-rate': [`sum by (service_name) (rate(${SM}[5m]))`],
  'ru-errors': [
    `sum by (service_name) (rate(${SM}{status_code="STATUS_CODE_ERROR"}[5m])) / sum by (service_name) (rate(${SM}[5m]))`,
    `sum by (service_name) (rate(${SM}{span_kind="SPAN_KIND_SERVER", status_code="STATUS_CODE_ERROR"}[5m])) / sum by (service_name) (rate(${SM}{span_kind="SPAN_KIND_SERVER", status_code="STATUS_CODE_OK"}[5m]))`,
  ],
  'ru-duration': ['histogram_quantile(0.95, sum by (service_name, le) (rate(traces_span_metrics_duration_milliseconds_bucket[5m])))'],
};
const REAL_STEPS = [promqlBasics, histograms, redAndUse].flatMap((l) => l.play.steps.filter((st) => st.query).map((st) => st.query));

test('tier 2 on every real query step leaks no number, label value or function of the answer', () => {
  assert.equal(REAL_STEPS.length, 8);
  for (const q of REAL_STEPS) {
    assert.ok(WRONG[q.id], `${q.id} needs tempting wrong queries`);
    const want = referenceResult(q.dataset, q.at, q.reference);
    const wanted = want.kind === 'scalar' ? [want.value] : want.series.map((x) => x.value);
    const values = want.kind === 'scalar' ? [] : want.series.flatMap((x) => Object.entries(x.labels)).filter(([k]) => k !== '__name__').map(([, v]) => v);
    for (const player of ['', q.reference, ...WRONG[q.id]]) {
      const html = h(player, 2, q);
      const where = `${q.id} / ${player}: ${html}`;
      for (const v of wanted) {
        for (const shown of [String(v), v.toFixed(1), v.toFixed(2), v.toPrecision(3), String(Math.round(v * 100) / 100)]) {
          assert.ok(shown.length < 3 || !html.includes(shown), `value ${shown} leaked: ${where}`);
        }
      }
      for (const v of values) assert.ok(!html.includes(v), `label value ${v} leaked: ${where}`);
      const most = Math.max(want.kind === 'scalar' ? 1 : want.series.length, 3);
      for (const n of html.match(/\d+(\.\d+)?/g) ?? []) assert.ok(/^\d+$/.test(n) && Number(n) <= most, `a number ${n}: ${where}`);
      assert.ok(!/le\b|histogram_quantile|\brate\b|\bincrease\b/.test(html.replace(/[a-z_]+_(bucket|sum|count|total|milliseconds_bucket)/g, '')), `function leaked: ${where}`);
    }
  }
});

// ---- referenceResult ------------------------------------------------------------------

test('referenceResult is what gradeQuery compares against, for every fixture', () => {
  const fixtures = [
    ['checkout-http', 3600, REF],
    ['checkout-http', 2700, `sum(increase(${MET}{route="/pay"}[10m]))`],
    ['checkout-spanmetrics', 3600, 'sum by (service_name) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER"}[5m]))'],
    [ds([{ __name__: 'y', k: 'a' }, [[0, 2]]]), 0, 'y'],
    ['checkout-http', 0, '1 + 1'],
  ];
  for (const [dataset, time, reference] of fixtures) {
    const want = referenceResult(dataset, time, reference);
    assert.ok(want.kind === 'vector' || want.kind === 'scalar');
    // The reference graded against itself is ok, and its result is exactly `want`.
    const g = gradeQuery(dataset, time, reference, reference);
    assert.equal(g.ok, true);
    assert.deepEqual(g.result, want);
  }
});

test('referenceResult throws gradeQuery\'s own message when the answer has no data', () => {
  const empty = at(0, [{ __name__: 'x' }, 1]);
  const catching = (f) => { try { f(); } catch (e) { return e.message; } return null; };
  for (const reference of ['nope', 'x{a="b"}', 'sum(', '1 +']) {
    const a = catching(() => referenceResult(empty, 0, reference));
    const b = catching(() => gradeQuery(empty, 0, 'x', reference));
    assert.match(a, /^reference query .* gives no data: /);
    assert.equal(a, b);
  }
});
