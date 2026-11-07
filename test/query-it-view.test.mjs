// lib/widgets/query-it-view.mjs: the Query it view and mount (render, the one penalty, focus).
// Spec: docs/M1-DESIGN.md §4.7. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newQueryState } from '../lib/widgets/query-it.mjs';
import { RULE, formatValue, mountQuery, renderQuery, resultHtml, seriesText } from '../lib/widgets/query-it-view.mjs';
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
  let swirled = 0;
  const swirl = () => { swirled += 1; };
  return { dom, focus, counts, swirled: () => swirled, mount: (extra = {}) => mountQuery(ctx, spec, { onComplete, swirl, ...extra }) };
}

const feedback = () => q('#qa-feedback').textContent.trim();
const tone = () => q('#qa-feedback').getAttribute('data-tone');
const HELPS = { helps: { hints: true } };
const rows = () => qa('#qa-result tbody tr').map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
const ask = (text) => {
  q('#qa-input').value = text;
  click('#qa-run');
};
const askAll = (...texts) => texts.forEach(ask);


test('renderQuery: a labelled code textarea with no autocorrect, a Run button, a kit feedback region, in a wide split with the side column', () => {
  const { mount } = setup();
  mount();
  const input = q('#qa-input');
  assert.equal(input.localName, 'textarea');
  assert.equal(q('label[for="qa-input"]').textContent, 'Your PromQL query');
  for (const [attr, want] of [['spellcheck', 'false'], ['autocomplete', 'off'], ['autocapitalize', 'off'], ['autocorrect', 'off']]) {
    assert.equal(input.getAttribute(attr), want, attr);
  }
  assert.equal(input.value, '');
  assert.equal(q('#qa-run').textContent.trim(), 'Run');
  const fb = q('#qa-feedback');
  assert.equal(fb.getAttribute('role'), 'status');
  assert.equal(fb.getAttribute('aria-live'), 'polite');
  assert.equal(fb.getAttribute('tabindex'), '-1');
  assert.equal(fb.hasAttribute('hidden'), true);
  assert.equal(q('[data-query]').hasAttribute('role'), false);
  assert.equal(qa('[data-query] .ui-split .ui-split-side aside').length, 1, 'the side column beside the board');
  assert.equal(q('#qa-win').hasAttribute('hidden'), true, 'the success card waits for success');
  assert.equal(q('#qa-wrong').textContent, '0');
  assert.equal(q('#qa-hints').textContent, '0');
  assert.equal(qa('#qa-stars [data-star="possible"]').length, 5);
  assert.equal(q('.ui-score-rule').textContent, RULE);
  assert.equal(q('#qa-result').textContent.trim(), 'Run a query to see its result.');
});

test('renderQuery: no helps means no hint button and a tier line that says so; helps.hints adds the Hint button', () => {
  setup();
  assert.equal(qa('#qa-hint').length, 0);
  assert.equal(q('#qa-hint-tier').textContent, 'No hints on this level.');
  setup({ ...fixture(), ...HELPS });
  assert.equal(qa('#qa-hint').length, 1);
  assert.equal(q('[data-help="hints"]').getAttribute('data-on'), 'true');
});

test('renderQuery: names the dataset and the evaluation time in the input\'s note, which describes it', () => {
  setup();
  assert.equal(q('#qa-input').getAttribute('aria-describedby'), 'qa-input-note');
  assert.ok(q('#qa-input-note').textContent.includes('Checkout and cart HTTP metrics'));
  assert.ok(q('#qa-input-note').textContent.includes('t = 3000 s'));
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
  assert.equal(q('[data-query]').getAttribute('role'), 'group');
  assert.equal(q('[data-query]').getAttribute('aria-labelledby'), 'qa-q');
  assert.throws(() => renderQuery(fixture(), newQueryState(fixture()), { escapeHtml, labelledBy: 'a b' }), /query "qa": labelledBy must be a plain token/);
});

test('the supported subset is listed in the widget, every item read from SUPPORTED', () => {
  setup();
  const box = q('[data-fold="supported"]');
  assert.equal(box.localName, 'details');
  assert.equal(q('[data-fold="supported"] summary').textContent.trim(), 'Supported here');
  const text = box.textContent;
  for (const g of SUPPORTED) {
    assert.ok(text.includes(g.title), g.title);
    assert.ok(text.includes(g.note), g.note);
    for (const item of g.items) assert.ok(text.includes(item), item);
  }
  assert.ok(text.includes('reported as unsupported, not as wrong'));
});

test('the reference passes: Right plus the explanation as markup, a table of the series, locked read-only, done once, the success card focused', () => {
  const { counts, focus, swirled, mount } = setup();
  mount();
  ask(REF);
  assert.ok(feedback().startsWith('Right. Take the rate first, then sum the labels away.'));
  assert.equal(qa('#qa-feedback code').length, 1);
  assert.deepEqual(rows(), [['{service="cart"}', '16'], ['{service="checkout"}', '12']]);
  assert.equal(tone(), 'success');
  assert.equal(q('#qa-input').readOnly, true, 'locked read-only, not disabled');
  assert.equal(q('#qa-input').disabled, false);
  assert.equal(q('#qa-run').disabled, true);
  assert.equal(counts.mistakes, 0);
  assert.equal(counts.done, 1);
  assert.equal(q('#qa-win').hasAttribute('hidden'), false, 'the success card is on the right');
  assert.equal(q('#qa-win-stars').textContent, '5 of 5 stars: 0 wrong queries, 0 hints.');
  assert.equal(qa('#qa-stars [data-star="earned"]').length, 5);
  assert.equal(swirled(), 1);
  assert.equal(focus.last(), '#qa-win-title');
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
    assert.equal(tone(), 'error', 'a wrong answer is the error tone (D7)');
    assert.equal(q('#qa-wrong').textContent, '1');
    assert.equal(q('#qa-wrong-label').textContent, 'wrong query');
    assert.equal(q('#qa-win').hasAttribute('hidden'), true);
    assert.notEqual(q('#qa-input').readOnly, true);
    assert.equal(feedback().includes('sum by (service)'), false);
  }
  const { counts, mount } = setup({ ...fixture(), reference: 'sum by (route) (rate(http_server_requests_total{service="checkout"}[5m]))' });
  mount();
  ask('sum by (status) (rate(http_server_requests_total{service="checkout"}[5m]))');
  assert.equal(feedback(), 'Not quite. Different series than expected: the labels are not right.');
  assert.equal(counts.mistakes, 1);
});

test('the wrong count label is plural from two; the hint cost follows the wrong queries', () => {
  const { mount } = setup({ ...fixture(), ...HELPS });
  mount();
  ask('sum(rate(http_server_requests_total[5m]))');
  assert.equal(q('#qa-wrong-label').textContent, 'wrong query');
  assert.equal(q('#qa-hint-cost').textContent, 'costs 1 star');
  ask('sum by (service) (increase(http_server_requests_total[5m]))');
  assert.equal(q('#qa-wrong-label').textContent, 'wrong queries');
  ask('rate(nothing_here[5m])');
  assert.equal(q('#qa-hint-cost').textContent, 'costs no star now');
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
  assert.equal(tone(), 'neutral');
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#qa-wrong').textContent, '1');
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
  assert.equal(tone(), 'neutral', 'information, not a wrong answer');
  assert.equal(q('#qa-wrong').textContent, '0');
  assert.equal(rows().length, 0);
});

test('blank text is free and asks for a query', () => {
  const { counts, mount } = setup();
  mount();
  ask('  \n ');
  assert.equal(feedback(), 'Type a query first.');
  assert.equal(tone(), 'neutral');
  assert.equal(counts.mistakes, 0);
});

test('the given text can be run as is, and is graded like any other', () => {
  const { counts, mount } = setup({ ...fixture(), given: 'http_server_requests_total' });
  mount();
  click('#qa-run');
  assert.ok(feedback().startsWith('Not quite.'));
  assert.equal(counts.mistakes, 1);
});

test('hint tier 1 charges once per click: ctx.hint() and the score card, trusted markup, the tier line and the next button label', () => {
  const { counts, mount } = setup({ ...fixture(), ...HELPS, hint: 'Try <code>rate</code> first.' });
  mount();
  assert.equal(q('#qa-hint').textContent.trim(), 'Hint 1 of 3');
  click('#qa-hint');
  assert.equal(counts.hints, 1);
  assert.equal(q('#qa-hints').textContent, '1');
  assert.ok(q('#qa-hint-text').textContent.includes('Try rate first.'));
  assert.equal(qa('#qa-hint-text code').length, 1);
  assert.equal(q('#qa-hint').textContent.trim(), 'Hint 2 of 3');
  assert.equal(q('#qa-hint').disabled, false);
  assert.ok(q('#qa-hint-tier').textContent.includes('1 of 3 used'));
  assert.equal(counts.mistakes, 0);
});

test('hint tiers advance 1, 2, 3 and stop: each click is one ctx.hint(), the fourth does nothing', () => {
  const { counts, mount } = setup({ ...fixture(), ...HELPS });
  mount();
  ask('sum(rate(http_server_requests_total[5m]))');
  assert.equal(counts.mistakes, 1);
  click('#qa-hint');
  assert.ok(q('#qa-hint-text').textContent.includes('Hint 1 of 3'));
  click('#qa-hint');
  assert.ok(q('#qa-hint-text').textContent.includes('Hint 2 of 3'));
  assert.ok(q('#qa-hint-text').textContent.includes('The answer reads http_server_requests_total.'));
  assert.equal(counts.hints, 2);
  assert.equal(counts.done, 0);
  click('#qa-hint');
  assert.equal(counts.hints, 3);
  q('#qa-hint').disabled = false;
  click('#qa-hint');
  assert.equal(counts.hints, 3, 'no fourth charge');
});

test('hint tier 3 fills the reference in and runs it without a mistake: neutral, success card, three hints charged', () => {
  const { counts, focus, swirled, mount } = setup({ ...fixture(), ...HELPS });
  mount();
  click('#qa-hint');
  click('#qa-hint');
  assert.equal(q('#qa-input').value, '');
  click('#qa-hint');
  assert.equal(q('#qa-input').value, REF);
  assert.equal(counts.hints, 3);
  assert.equal(counts.mistakes, 0);
  assert.equal(counts.done, 1);
  assert.equal(tone(), 'neutral');
  assert.ok(feedback().startsWith('Filled in for you. Take the rate first'));
  assert.deepEqual(rows(), [['{service="cart"}', '16'], ['{service="checkout"}', '12']]);
  assert.equal(q('#qa-input').readOnly, true);
  assert.equal(q('#qa-win').hasAttribute('hidden'), false);
  assert.equal(q('#qa-win-stars').textContent, '2 of 5 stars: 0 wrong queries, 3 hints.');
  assert.equal(q('#qa-hint').disabled, true);
  assert.equal(swirled(), 1);
  assert.equal(focus.last(), '#qa-win-title');
});

test('hint tier 2 reads the text typed now; Escape on the hint goes back to the Hint button', () => {
  const { focus, mount } = setup({ ...fixture(), ...HELPS });
  mount();
  q('#qa-input').value = 'rate(nothing_here[5m])';
  click('#qa-hint');
  click('#qa-hint');
  assert.ok(q('#qa-hint-text').textContent.includes('Yours returns no data.'));
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#qa-hint-text').onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), '#qa-hint');
  assert.deepEqual(focus.unfocusable(), []);
});

test('the score card follows a wrong query then a hint: stars drop, and the success line counts both', () => {
  const { mount } = setup({ ...fixture(), ...HELPS });
  mount();
  ask('sum(rate(http_server_requests_total[5m]))');
  assert.equal(qa('#qa-stars [data-star="possible"]').length, 4);
  click('#qa-hint');
  assert.equal(qa('#qa-stars [data-star="possible"]').length, 3);
  ask(REF);
  assert.equal(q('#qa-win-stars').textContent, '3 of 5 stars: 1 wrong query, 1 hint.');
  assert.equal(qa('#qa-stars [data-star="earned"]').length, 3);
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

test('resultHtml escapes every label and value; a scalar is one captioned row; a long vector is cut with a count; none is a note', () => {
  const evil = resultHtml({ kind: 'vector', series: [{ labels: { a: '<img src=x onerror=1>' }, value: 1 }] });
  assert.equal(evil.includes('<img'), false);
  assert.ok(evil.includes('&lt;img'));
  const scalar = resultHtml({ kind: 'scalar', value: 4 });
  assert.ok(scalar.includes('<caption>Query result</caption>'));
  assert.ok(scalar.includes('<td>Scalar</td><td data-num>4</td>'));
  assert.ok(scalar.includes('>Kind</th>'));
  const many = { kind: 'vector', series: Array.from({ length: 27 }, (_, i) => ({ labels: { i: String(i) }, value: i })) };
  const html = resultHtml(many);
  assert.equal(html.split('<tr>').length - 1, 21);
  assert.ok(html.includes('<caption>Query result: 27 series</caption>'));
  assert.ok(html.includes('and 7 more series'));
  assert.ok(resultHtml({ kind: 'vector', series: [] }).includes('No series.'));
  assert.equal(resultHtml({ kind: 'vector', series: [] }).includes('<table'), false);
});

test('a long result in the view shows 20 rows and the count of the rest', () => {
  const { mount } = setup();
  mount();
  ask('http_server_request_duration_seconds_bucket');
  assert.equal(rows().length, 20);
  assert.ok(q('#qa-result').textContent.includes('and 8 more series'));
  assert.ok(q('#qa-result').textContent.includes('more series'));
});

test('Escape on the shown hint is handled and moves focus off it to the hint button while one is left (#178)', () => {
  const { focus, mount } = setup({ ...fixture(), ...HELPS, hint: 'Try <code>rate</code> first.' });
  mount();
  click('#qa-hint');
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#qa-hint-text').onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), '#qa-hint');
  assert.deepEqual(focus.unfocusable(), []);
});

test('the Query it markup emits no retired class, no style attribute and no Alpine attribute', () => {
  setup({ ...fixture(), ...HELPS });
  const html = q('[data-query]').outerHTML;
  const classes = new Set(qa('[data-query], [data-query] *').flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)));
  for (const c of ['btn', 'ghost', 'info', 'show', 'small', 'query-input', 'query-data', 'query-note', 'query-label', 'query-table']) {
    assert.equal(classes.has(c), false, c);
  }
  assert.equal(/\sstyle=|\sx-|\s@|\s:[a-z]|\son[a-z]+=/.test(html), false);
});

test('after tier 3 solves the step the Hint button is spent, so Escape on the hint goes to the read-only textarea', () => {
  const { focus, mount } = setup({ ...fixture(), ...HELPS });
  mount();
  click('#qa-hint');
  click('#qa-hint');
  click('#qa-hint');
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#qa-hint-text').onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), '#qa-input');
});
