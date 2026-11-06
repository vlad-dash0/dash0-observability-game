// lib/widgets/query-it-view.mjs: the Query it view and mount (render, the one penalty, focus).
// Spec: docs/M1-DESIGN.md §4.7. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newQueryState } from '../lib/widgets/query-it.mjs';
import { formatValue, mountQuery, renderQuery, resultHtml, seriesText } from '../lib/widgets/query-it-view.mjs';
import { SUPPORTED } from '../lib/promql/supported.mjs';

const REF = 'sum by (service) (rate(http_server_requests_total[5m]))';
const ALT = 'sum without (route, status) (\n  rate(http_server_requests_total[5m])\n)';

function fixture() {
  return {
    id: 'qa',
    dataset: 'checkout-http',
    at: 3000,
    reference: REF,
    explain: 'Take the <code>rate</code> first, then sum the labels away.',
  };
}

function setup(spec = fixture(), opts = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, hints: 0, done: 0 };
  const ctx = { ovBody: dom.body, ovActions: dom.actions, escapeHtml, mistake() { counts.mistakes += 1; }, hint() { counts.hints += 1; } };
  dom.body.innerHTML = renderQuery(spec, newQueryState(spec), { escapeHtml, ...opts });
  dom.actions.innerHTML = '<button id="finish" disabled>Finish</button>';
  const onComplete = () => {
    counts.done += 1;
    const fin = dom.actions.querySelector('#finish');
    fin.disabled = false;
    return fin;
  };
  return { dom, focus, counts, mount: (extra = {}) => mountQuery(ctx, spec, { onComplete, ...extra }) };
}

const feedback = () => q('#qa-feedback').textContent;
const rows = () => qa('#qa-result tbody tr').map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
const ask = (text) => {
  q('#qa-input').value = text;
  click('#qa-run');
};
const askAll = (...texts) => texts.forEach(ask);


test('renderQuery: a labelled monospace-ready textarea with no autocorrect, a Run button, a live feedback region', () => {
  setup();
  const input = q('#qa-input');
  assert.equal(input.localName, 'textarea');
  assert.equal(q('label[for="qa-input"]').textContent, 'Your PromQL query');
  for (const [attr, want] of [['spellcheck', 'false'], ['autocomplete', 'off'], ['autocapitalize', 'off'], ['autocorrect', 'off']]) {
    assert.equal(input.getAttribute(attr), want, attr);
  }
  assert.equal(input.className, 'query-input');
  assert.equal(input.value, '');
  assert.equal(q('#qa-run').textContent, 'Run');
  const fb = q('#qa-feedback');
  assert.equal(fb.getAttribute('role'), 'status');
  assert.equal(fb.getAttribute('aria-live'), 'polite');
  assert.equal(fb.getAttribute('tabindex'), '-1');
  assert.equal(q('.query').hasAttribute('role'), false);
  assert.equal(qa('#qa-hint').length, 0);
});

test('renderQuery: names the dataset and the evaluation time, escaped', () => {
  setup();
  assert.ok(q('.query-data').textContent.includes('Checkout and cart HTTP metrics'));
  assert.ok(q('.query-data').textContent.includes('t = 3000 s'));
});

test('given prefills the textarea; in the markup it is escaped, so it cannot close the tag', () => {
  const given = 'x{a="</textarea><img src=x>"}';
  const spec = { ...fixture(), given };
  const html = renderQuery(spec, newQueryState(spec), { escapeHtml });
  assert.equal(html.includes('</textarea><img'), false);
  const { mount } = setup(spec);
  mount();
  assert.equal(q('#qa-input').value, given);
  assert.equal(qa('img').length, 0);
});

test('renderQuery: labelledBy makes a labelled group; a bad token is a TypeError naming the spec', () => {
  setup(fixture(), { labelledBy: 'qa-q' });
  assert.equal(q('.query').getAttribute('role'), 'group');
  assert.equal(q('.query').getAttribute('aria-labelledby'), 'qa-q');
  assert.throws(() => renderQuery(fixture(), newQueryState(fixture()), { escapeHtml, labelledBy: 'a b' }), /query "qa": labelledBy must be a plain token/);
});

test('the supported subset is listed in the widget, every item read from SUPPORTED', () => {
  setup();
  const box = q('.query-supported');
  assert.equal(box.localName, 'details');
  assert.equal(q('.query-supported summary').textContent, 'Supported here');
  const text = box.textContent;
  for (const g of SUPPORTED) {
    assert.ok(text.includes(g.title), g.title);
    assert.ok(text.includes(g.note), g.note);
    for (const item of g.items) assert.ok(text.includes(item), item);
  }
  assert.ok(text.includes('reported as unsupported, not as wrong'));
});

test('the reference passes: Right plus the explanation as markup, a table of the series, locked, done once, Finish focused', () => {
  const { counts, focus, mount } = setup();
  mount();
  ask(REF);
  assert.ok(feedback().startsWith('Right. Take the rate first, then sum the labels away.'));
  assert.equal(qa('#qa-feedback code').length, 1);
  assert.deepEqual(rows(), [['{service="cart"}', '16'], ['{service="checkout"}', '12']]);
  assert.equal(q('#qa-input').disabled, true);
  assert.equal(q('#qa-run').disabled, true);
  assert.equal(counts.mistakes, 0);
  assert.equal(counts.done, 1);
  assert.equal(focus.last(), '#finish');
});

test('an equivalent query written differently passes too', () => {
  const { counts, mount } = setup();
  mount();
  ask(ALT);
  assert.ok(feedback().startsWith('Right.'));
  assert.equal(counts.mistakes, 0);
  assert.equal(counts.done, 1);
});

test('wrong answers cost one mistake each and name the category in plain words, never the reference', () => {
  const cases = [
    ['sum(rate(http_server_requests_total[5m]))', 'Not quite. Different series than expected: the number of series is not right.'],
    ['sum by (service) (increase(http_server_requests_total[5m]))', 'Not quite. Right shape, wrong values.'],
    ['rate(nothing_here[5m])', 'Not quite. Your query returned no data.'],
  ];
  for (const [text, want] of cases) {
    const { counts, mount } = setup();
    mount();
    ask(text);
    assert.equal(feedback(), want, text);
    assert.equal(counts.mistakes, 1, text);
    assert.equal(counts.done, 0);
    assert.equal(q('#qa-input').disabled, false);
    assert.equal(feedback().includes('sum by (service)'), false);
  }
  const { counts, mount } = setup({ ...fixture(), reference: 'sum by (route) (rate(http_server_requests_total{service="checkout"}[5m]))' });
  mount();
  ask('sum by (status) (rate(http_server_requests_total{service="checkout"}[5m]))');
  assert.equal(feedback(), 'Not quite. Different series than expected: the labels are not right.');
  assert.equal(counts.mistakes, 1);
});

test('a wrong query shows its own result as a table', () => {
  const { mount } = setup();
  mount();
  ask('sum(rate(http_server_requests_total[5m]))');
  assert.deepEqual(rows(), [['{}', '28']]);
});

test('the same wrong query again, whitespace aside, is free; a different wrong one costs again', () => {
  const { counts, mount } = setup();
  mount();
  ask('  sum   by (route)\n(rate(http_server_requests_total[5m]))\n');
  const firstRows = rows();
  assert.ok(firstRows.length > 0);
  ask('sum by (route) (rate(http_server_requests_total[5m]))');
  assert.deepEqual(rows(), firstRows);
  assert.equal(feedback(), 'You already ran this query. Nothing new was counted.');
  assert.equal(counts.mistakes, 1);
  ask('sum(increase(http_server_requests_total[5m]))');
  assert.equal(counts.mistakes, 2);
});

test('a repeat of an earlier (not the last) query shows that query\'s rows and says it was already tried', () => {
  const { counts, mount } = setup();
  mount();
  const A = 'sum(rate(http_server_requests_total[5m]))';
  const B = 'sum by (route) (rate(http_server_requests_total[5m]))';
  askAll(A, B);
  const rowsB = rows();
  assert.notDeepEqual(rowsB, [['{}', '28']]);
  ask(A);
  assert.deepEqual(rows(), [['{}', '28']]);
  assert.equal(feedback(), 'You already ran this query. Nothing new was counted.');
  assert.equal(counts.mistakes, 2);
  ask(B);
  assert.deepEqual(rows(), rowsB);
  assert.equal(counts.mistakes, 2);
});

test('a repeat after a syntax error cleared the panel shows that query\'s rows again', () => {
  const { counts, mount } = setup();
  mount();
  const A = 'sum(rate(http_server_requests_total[5m]))';
  ask(A);
  ask('sum by (service) (');
  assert.equal(rows().length, 0);
  ask(A);
  assert.deepEqual(rows(), [['{}', '28']]);
  assert.equal(feedback(), 'You already ran this query. Nothing new was counted.');
  assert.equal(counts.mistakes, 1);
});

test('syntax, unsupported and runtime errors are free, however often, and say what went wrong', () => {
  const { counts, mount } = setup();
  mount();
  ask('sum by (service) (');
  assert.ok(feedback().startsWith('Syntax error at character 19: unexpected end of input'), feedback());
  ask('rate(http_server_requests_total[5m]) offset 5m');
  assert.ok(feedback().startsWith('Not supported here: offset modifier.'), feedback());
  assert.ok(feedback().includes('Nothing was marked wrong'));
  ask('irate(http_server_requests_total[5m])');
  assert.ok(feedback().startsWith('Not supported here: function irate().'), feedback());
  ask('irate(http_server_requests_total[5m])');
  ask('rate(http_server_requests_total[5m]) / on(service) rate(http_server_requests_total[5m])');
  assert.ok(feedback().startsWith('That query could not run: '), feedback());
  assert.equal(counts.mistakes, 0);
  assert.equal(rows().length, 0);
});

test('blank text is free and asks for a query', () => {
  const { counts, mount } = setup();
  mount();
  ask('  \n ');
  assert.equal(feedback(), 'Type a query first.');
  assert.equal(counts.mistakes, 0);
});

test('the given text can be run as is, and is graded like any other', () => {
  const { counts, mount } = setup({ ...fixture(), given: 'http_server_requests_total' });
  mount();
  click('#qa-run');
  assert.ok(feedback().startsWith('Not quite.'));
  assert.equal(counts.mistakes, 1);
});

test('the hint calls ctx.hint() once, shows trusted markup and locks its button', () => {
  const { counts, mount } = setup({ ...fixture(), hint: 'Try <code>rate</code> first.' });
  mount();
  click('#qa-hint');
  assert.equal(counts.hints, 1);
  assert.equal(q('#qa-hint-text').textContent, 'Try rate first.');
  assert.equal(qa('#qa-hint-text code').length, 1);
  assert.equal(q('#qa-hint').disabled, true);
});

test('focus: the textarea on mount; a failing Run keeps focus where it is', () => {
  const { focus, mount } = setup();
  mount();
  assert.deepEqual(focus.names(), ['#qa-input']);
  ask('http_server_requests_total');
  assert.deepEqual(focus.names(), ['#qa-input']);
  assert.deepEqual(focus.unfocusable(), []);
});

test('mountQuery throws a TypeError naming the spec for a bad spec, no onComplete, or no markup', () => {
  const { dom } = setup();
  const ctx = { ovBody: dom.body, escapeHtml, mistake() {}, hint() {} };
  assert.throws(() => mountQuery(ctx, { ...fixture(), dataset: 'nope' }, { onComplete() {} }), /query "qa": invalid spec: unknown dataset "nope"/);
  assert.throws(() => mountQuery(ctx, fixture(), {}), /query "qa": onComplete must be a function/);
  assert.throws(() => mountQuery(ctx, { ...fixture(), id: 'other' }, { onComplete() {} }), /query "other": not rendered/);
});

// ---- result table helpers -------------------------------------------------------------

test('formatValue: six significant digits, +Inf/-Inf/NaN as Prometheus prints them, no negative zero', () => {
  const cases = [[12, '12'], [15.999999999999996, '16'], [0.08333333333333334, '0.0833333'], [1234567.891, '1234570'], [0, '0'], [-0, '0'],
    [Infinity, '+Inf'], [-Infinity, '-Inf'], [NaN, 'NaN'], [-2.5, '-2.5']];
  for (const [v, want] of cases) assert.equal(formatValue(v), want, String(v));
});

test('seriesText: name first, labels sorted, values quoted', () => {
  assert.equal(seriesText({ __name__: 'up', b: '2', a: '1' }), 'up{a="1", b="2"}');
  assert.equal(seriesText({ __name__: 'up' }), 'up');
  assert.equal(seriesText({}), '{}');
  assert.equal(seriesText({ a: 'say "hi"' }), '{a="say \\"hi\\""}');
});

test('resultHtml escapes every label and value; a scalar is one line; a long vector is cut with a count', () => {
  const evil = resultHtml({ kind: 'vector', series: [{ labels: { a: '<img src=x onerror=1>' }, value: 1 }] }, escapeHtml);
  assert.equal(evil.includes('<img'), false);
  assert.ok(evil.includes('&lt;img'));
  assert.equal(resultHtml({ kind: 'scalar', value: 4 }, escapeHtml).includes('Scalar: <b>4</b>'), true);
  const many = { kind: 'vector', series: Array.from({ length: 27 }, (_, i) => ({ labels: { i: String(i) }, value: i })) };
  const html = resultHtml(many, escapeHtml);
  assert.equal(html.split('<tr>').length - 1, 21);
  assert.ok(html.includes('and 7 more series'));
  assert.equal(resultHtml({ kind: 'vector', series: [] }, escapeHtml), '<p class="query-none">No series.</p>');
});

test('a long result in the view shows 20 rows and the count of the rest', () => {
  const { mount } = setup();
  mount();
  ask('http_server_request_duration_seconds_bucket');
  assert.equal(rows().length, 20);
  assert.ok(q('#qa-result').textContent.includes('and 8 more series'));
  assert.ok(q('#qa-result').textContent.includes('more series'));
});

test('Escape on the shown hint is handled and moves focus off it; the once-only hint button is disabled, so focus goes to the textarea (#178)', () => {
  const { focus, mount } = setup({ ...fixture(), hint: 'Try <code>rate</code> first.' });
  mount();
  click('#qa-hint');
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#qa-hint-text').onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), '#qa-input');
  assert.deepEqual(focus.unfocusable(), []);
});
