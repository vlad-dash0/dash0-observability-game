// lib/widgets/build-it-view.mjs: the Build it view and mount (waterfall, text alternative,
// panel, penalties, recheck, hint, escaping, focus). Spec: docs/M1-DESIGN.md §4.2, §7 P5.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newBuildState, setParent } from '../lib/widgets/build-it.mjs';
import { mountBuild, renderBuild } from '../lib/widgets/build-it-view.mjs';
import { A, B, C, D, E, b1Spec } from './fixtures/build-b1.mjs';

/** A counting stub ctx on a fresh DOM with the widget rendered; `finish` is onComplete's target. */
function setup(spec = b1Spec()) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, hints: 0, done: 0 };
  const ctx = {
    ovBody: dom.body,
    ovActions: dom.actions,
    escapeHtml,
    mistake() {
      counts.mistakes += 1;
    },
    hint() {
      counts.hints += 1;
    },
  };
  dom.body.innerHTML = renderBuild(spec, newBuildState(spec), { escapeHtml });
  dom.actions.innerHTML = '<button id="finish" disabled>Finish</button>';
  const onComplete = () => {
    counts.done += 1;
    const fin = dom.actions.querySelector('#finish');
    fin.disabled = false;
    return fin;
  };
  const mount = (extra = {}) => mountBuild(ctx, spec, { onComplete, ...extra });
  return { ctx, dom, focus, counts, mount };
}

const rows = () => qa('[data-span]').map((b) => b.textContent);
const spanIds = () => qa('[data-span]').map((b) => b.dataset.span);
const feedback = () => q('#b1-feedback').textContent;
const rects = () => qa('svg rect').map((r) => ['x', 'y', 'width', 'height'].map((a) => r.getAttribute(a)).join(' '));
const panel = (attr) => qa(`[${attr}]`).map((b) => b.getAttribute(attr));
const parentTo = (span, parent) => {
  click(`[data-span="${span}"]`);
  click(`[data-parent="${parent}"]`);
};
const solve = () => {
  parentTo(B, A);
  parentTo(C, B);
  parentTo(D, C);
};
const ALPINE = /\s(?:x-[\w.:-]+|@[\w.:-]+|:[\w.:-]+)=/;

test('renderBuild: an SVG bar per span with x, y, width and height attributes and no style', () => {
  setup();
  // All roots: trace 4bf9 (A, B, C, D by start) then trace 0af7 (E).
  assert.deepEqual(spanIds(), [A, B, C, D, E]);
  assert.deepEqual(rects(), ['0 0 100 4', '10 6 80 4', '15 12 70 4', '20 18 10 4', '40 24 20 4']);
  assert.equal(q('svg').getAttribute('viewBox'), '0 0 100 30');
  assert.equal(q('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(qa('svg [style]').length + qa('svg style').length, 0);
});

test('renderBuild: the <ol> text alternative states name, service, kind, status, times and parent', () => {
  const spec = b1Spec();
  const st = newBuildState(spec);
  setParent(spec, st, B, A);
  setParent(spec, st, E, C);
  spec.spans[3].parentId = 'ffffffffffffffff';
  makeDom();
  globalThis.document.body.innerHTML = renderBuild(spec, newBuildState(spec), { escapeHtml });
  assert.equal(rows()[3], 'validate cart · api-gateway · INTERNAL · UNSET · 20–30 ms · Parent: ffffffffffffffff (not found)');
  globalThis.document.body.innerHTML = renderBuild(spec, st, { escapeHtml, selected: B });
  assert.equal(qa('ol > li > [data-span]').length, 5);
  assert.deepEqual(rows(), [
    'POST /checkout · storefront · SERVER · UNSET · 0–100 ms · Parent: none',
    'POST api-gateway · storefront · CLIENT · UNSET · 10–90 ms · Parent: POST /checkout (storefront)',
    'POST /checkout · api-gateway · SERVER · UNSET · 15–85 ms · Parent: none',
    'validate cart · api-gateway · INTERNAL · UNSET · 20–30 ms · Parent: none',
    'GET /products · storefront · SERVER · UNSET · 40–60 ms · Parent: POST /checkout (api-gateway), in another trace',
  ]);
  assert.deepEqual(qa('[data-span]').map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false', 'false', 'false']);
  assert.deepEqual(qa('ol > li').map((li) => li.getAttribute('data-depth')), ['0', '1', '0', '0', '0']);
});

test('the panel has only the editable controls of the selected span', () => {
  const spec = b1Spec();
  makeDom();
  globalThis.document.body.innerHTML = renderBuild(spec, newBuildState(spec), { escapeHtml });
  assert.deepEqual([panel('data-parent'), panel('data-kind'), panel('data-status'), panel('data-link')], [[], [], [], []], 'nothing selected');
  assert.equal(q('[data-build-panel]').textContent, 'Pick a span to edit it.');
  globalThis.document.body.innerHTML = renderBuild(spec, newBuildState(spec), { escapeHtml, selected: C });
  assert.deepEqual(panel('data-parent'), ['none', A, B, C, D, E]);
  assert.deepEqual(qa('[data-parent]').map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false', 'false']);
  assert.deepEqual([panel('data-kind'), panel('data-status'), panel('data-link')], [[], [], []]);
  spec.edit = ['parent', 'kind', 'status', 'links'];
  globalThis.document.body.innerHTML = renderBuild(spec, newBuildState(spec), { escapeHtml, selected: C });
  assert.deepEqual(panel('data-kind'), ['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL']);
  assert.deepEqual(qa('[data-kind]').map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false']);
  assert.deepEqual(panel('data-status'), ['UNSET', 'ERROR', 'OK']);
  assert.deepEqual(panel('data-link'), [A, B, D, E], 'no link to itself');
  assert.deepEqual(qa('[data-link]').map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false']);
  spec.edit = ['kind'];
  globalThis.document.body.innerHTML = renderBuild(spec, newBuildState(spec), { escapeHtml, selected: C });
  assert.deepEqual([panel('data-parent').length, panel('data-kind').length, panel('data-status').length, panel('data-link').length], [0, 5, 0, 0]);
});

test('renderBuild: check button, live feedback; a hint button only when the spec has a hint', () => {
  setup();
  assert.equal(q('#b1-check').textContent, 'Check');
  const fb = q('#b1-feedback');
  assert.deepEqual([fb.getAttribute('role'), fb.getAttribute('aria-live'), fb.getAttribute('tabindex'), fb.className], ['status', 'polite', '-1', 'feedback']);
  assert.equal(qa('[id="b1-hint"]').length, 0);
  setup({ ...b1Spec(), hint: 'Follow the <code>parent</code> ids.' });
  assert.equal(q('#b1-hint').textContent, 'Show a hint');
  assert.equal(q('#b1-hint-text').textContent, '', 'the hint stays hidden until asked for');
});

test('mounting focuses the first span and changes nothing else', () => {
  const { focus, counts, mount } = setup();
  mount();
  assert.equal(focus.last(), `span:${A}`);
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 0 });
  assert.equal(feedback(), '');
});

test('choosing a span presses it and focuses its first control; setting a parent redraws the waterfall', () => {
  const { focus, counts, mount } = setup();
  mount();
  click(`[data-span="${C}"]`);
  assert.equal(q(`[data-span="${C}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(focus.last(), 'parent:none');
  click(`[data-parent="${B}"]`);
  assert.equal(feedback(), 'POST /checkout (api-gateway) now has parent POST api-gateway (storefront).');
  assert.equal(focus.last(), `parent:${B}`);
  assert.equal(q(`[data-parent="${B}"]`).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(spanIds(), [A, B, C, D, E]);
  assert.equal(rows()[2].endsWith('Parent: POST api-gateway (storefront)'), true);
  click('[data-parent="none"]');
  assert.equal(feedback(), 'POST /checkout (api-gateway) is now a root span.');
  assert.equal(counts.mistakes, 0, 'edits are free');
  parentTo(D, B);
  parentTo(B, A);
  assert.deepEqual(spanIds(), [A, B, D, C, E], 'D now sits under B, before the root C');
  assert.deepEqual(rects().slice(0, 3), ['0 0 100 4', '10 6 80 4', '20 12 10 4']);
});

test('a refused cycle or self-parent is free, says it would make a loop and changes nothing', () => {
  const { focus, counts, mount } = setup();
  mount();
  solve();
  parentTo(A, D);
  assert.equal(counts.mistakes, 0);
  assert.equal(feedback(), 'validate cart (api-gateway) is already below POST /checkout (storefront), so that would make a loop.');
  assert.equal(rows()[0].endsWith('Parent: none'), true);
  assert.equal(focus.last(), `parent:${D}`);
  click(`[data-parent="${A}"]`);
  assert.equal(feedback(), 'POST /checkout (storefront) can\'t be its own parent: that would make a loop.');
  assert.equal(counts.mistakes, 0);
  assert.equal(q('[data-parent="none"]').getAttribute('aria-pressed'), 'true');
});

test('a failing Check costs one mistake and lists the problems; an identical recheck is free', () => {
  const { focus, counts, mount } = setup();
  mount();
  parentTo(B, A);
  click('#b1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#b1-feedback').firstChild.textContent, 'Not yet: 2 problems.');
  assert.deepEqual(qa('#b1-feedback li').map((li) => li.textContent), [
    'POST /checkout (api-gateway): the parent is not right.',
    'validate cart (api-gateway): the parent is not right.',
  ]);
  assert.equal(focus.last(), '#b1-feedback');
  click('#b1-check');
  assert.equal(counts.mistakes, 1, 'the same state again is free');
  assert.equal(q('#b1-feedback').firstChild.textContent, 'Same as last time: 2 problems.');
  parentTo(C, A);
  parentTo(C, 'none');
  click('#b1-check');
  assert.equal(counts.mistakes, 1, 'an edit undone is the same state');
  parentTo(C, B);
  click('#b1-check');
  assert.equal(counts.mistakes, 2, 'a new failing state costs again');
  assert.equal(q('#b1-feedback').firstChild.textContent, 'Not yet: 1 problem.');
  parentTo(C, 'none');
  click('#b1-check');
  assert.equal(counts.mistakes, 3, 'only the last failed state is free, not every earlier one');
  assert.equal(counts.done, 0);
});

test('a passing Check calls onComplete once, focuses its return and locks the controls', () => {
  const { focus, counts, mount } = setup();
  mount();
  solve();
  click('#b1-check');
  assert.equal(counts.mistakes, 0);
  assert.equal(counts.done, 1);
  assert.equal(feedback(), 'Right. Every span checks out.');
  assert.equal(q('#b1-feedback').className, 'feedback good show');
  assert.equal(focus.last(), '#finish');
  assert.equal(q('#b1-check').disabled, true);
  assert.deepEqual(qa('[data-parent]').filter((b) => !b.disabled).length, 0);
  q('#b1-check').onclick({});
  assert.equal(counts.done, 1, 'a click that gets through does not complete twice');
});

test('onComplete returning nothing or an unfocusable element hands focus to the feedback', () => {
  for (const [name, target] of [['nothing', () => undefined], ['disabled', () => q('#finish')]]) {
    const { focus, mount } = setup();
    mount({ onComplete: target });
    solve();
    click('#b1-check');
    assert.equal(focus.last(), '#b1-feedback', name);
  }
});

test('the hint costs one ctx.hint(), shows its text, and is used once', () => {
  const { focus, counts, mount } = setup({ ...b1Spec(), hint: 'Follow the <code>parent</code> ids.' });
  mount();
  click('#b1-hint');
  assert.equal(counts.hints, 1);
  assert.equal(q('#b1-hint').disabled, true);
  assert.equal(q('#b1-hint-text').textContent, 'Follow the parent ids.');
  assert.equal(q('#b1-hint-text code').textContent, 'parent', 'the hint is authored HTML');
  assert.equal(q('#b1-hint-text').className, 'feedback info show');
  assert.equal(focus.last(), '#b1-hint-text');
  q('#b1-hint').onclick({});
  assert.equal(counts.hints, 1);
  assert.equal(counts.mistakes, 0);
});

test('data text is escaped everywhere: rows, panel, feedback and problems (I3)', () => {
  const spec = b1Spec();
  spec.spans[0].name = '<img src=x>POST & "go"';
  spec.spans[0].service = '<b>store</b>';
  const { counts, mount } = setup(spec);
  mount();
  parentTo(B, A);
  parentTo(A, B);
  assert.equal(qa('img').length + qa('b').length, 0, 'no element came from data text');
  const label = '<img src=x>POST & "go" (<b>store</b>)';
  assert.equal(rows()[0].startsWith('<img src=x>POST & "go" · <b>store</b> · SERVER'), true);
  assert.equal(rows()[1].endsWith(`Parent: ${label}`), true);
  assert.equal(feedback(), `POST api-gateway (storefront) is already below ${label}, so that would make a loop.`);
  assert.equal(q(`[data-parent="${A}"]`).textContent, label);
  click(`[data-span="${A}"]`);
  click(`[data-parent="${C}"]`);
  click('#b1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(qa('#b1-feedback li')[0].textContent, `${label}: the parent is not right.`);
  assert.equal(qa('img').length + qa('b').length, 0);
});

test('no Alpine attributes, no style= and no on*= attributes, before and during play', () => {
  const spec = { ...b1Spec(), hint: 'Look up.' };
  spec.edit = ['parent', 'kind', 'status', 'links'];
  const { dom, mount } = setup(spec);
  const check = (when) => {
    const html = dom.body.innerHTML;
    assert.equal(ALPINE.test(html), false, `${when}: Alpine attribute`);
    assert.equal(/\sstyle=/.test(html), false, `${when}: style=`);
    assert.equal(/\son\w+=/.test(html), false, `${when}: on*=`);
  };
  check('rendered');
  mount();
  click(`[data-span="${E}"]`);
  check('selected');
  click('[data-kind="CONSUMER"]');
  click('[data-status="ERROR"]');
  click(`[data-link="${A}"]`);
  click('#b1-hint');
  click('#b1-check');
  check('checked');
});

test('kind, status and link controls edit the span and say so, for free', () => {
  const spec = b1Spec();
  spec.edit = ['kind', 'status', 'links'];
  spec.answer = { [E]: { kind: 'CONSUMER', links: [B] } };
  const { focus, counts, mount } = setup(spec);
  mount();
  click(`[data-span="${E}"]`);
  assert.equal(focus.last(), 'kind:SERVER');
  click('[data-kind="CONSUMER"]');
  assert.equal(feedback(), 'GET /products (storefront) is now CONSUMER.');
  assert.equal(focus.last(), 'kind:CONSUMER');
  click('[data-status="OK"]');
  assert.equal(feedback(), 'GET /products (storefront) now has status OK.');
  click(`[data-link="${B}"]`);
  assert.equal(feedback(), 'GET /products (storefront) now links to POST api-gateway (storefront).');
  assert.equal(q(`[data-link="${B}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(focus.last(), `link:${B}`);
  click(`[data-link="${A}"]`);
  click(`[data-link="${A}"]`);
  assert.equal(feedback(), 'GET /products (storefront) no longer links to POST /checkout (storefront).');
  assert.equal(rows()[4], 'GET /products · storefront · CONSUMER · OK · 40–60 ms · Parent: none');
  assert.equal(counts.mistakes, 0);
  click('#b1-check');
  assert.equal(counts.mistakes, 1);
  assert.deepEqual(qa('#b1-feedback li').map((li) => li.textContent), ['GET /products (storefront): the status is not right.']);
  click('[data-status="UNSET"]');
  click('#b1-check');
  assert.equal(counts.done, 1);
  assert.deepEqual(focus.unfocusable(), []);
});

test('every focus target could take focus', () => {
  const { focus, mount } = setup({ ...b1Spec(), hint: 'Look up.' });
  mount();
  parentTo(A, A);
  click('#b1-check');
  click('#b1-hint');
  solve();
  click('#b1-check');
  assert.equal(focus.names().length > 8, true);
  assert.deepEqual(focus.unfocusable(), []);
});

test('an invalid spec, a missing render or a missing onComplete is a TypeError naming the id', () => {
  const spec = b1Spec();
  spec.spans[0].kind = 'server';
  const { counts, mount } = setup(spec);
  assert.throws(() => mount(), (err) => err instanceof TypeError && err.message.startsWith('build "b1": invalid spec:') && err.message.includes('kind "server"'));
  assert.equal(typeof q(`[data-span="${A}"]`).onclick, 'object', 'nothing is wired');
  assert.equal(counts.mistakes, 0);
  const { ctx, mount: unrendered } = setup();
  ctx.ovBody.innerHTML = '';
  assert.throws(() => unrendered(), { name: 'TypeError', message: /^build "b1": not rendered/ });
  const { mount: again } = setup();
  assert.throws(() => again({ onComplete: undefined }), { name: 'TypeError', message: /onComplete/ });
});

test('styles: rows, panel buttons and problems wrap anywhere; bars are coloured by kind without inline style', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(join(root, 'styles', 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    sels: sel.split(',').map((s) => s.trim()),
    body: body.replace(/\s+/g, ' '),
  }));
  const bodyOf = (sel) => rules.filter((r) => r.sels.includes(sel)).map((r) => r.body).join(';');
  for (const sel of ['.build-span', '.build-opt', '.build-issues li']) {
    assert.equal(/max-width:\s*100%/.test(bodyOf(sel)), true, `${sel} max-width: 100%`);
    assert.equal(/overflow-wrap:\s*anywhere/.test(bodyOf(sel)), true, `${sel} overflow-wrap: anywhere`);
  }
  assert.equal(/fill:/.test(bodyOf('.wf-bar')), true, '.wf-bar has a fill');
  assert.equal(/stroke:/.test(bodyOf('.wf-bar.selected')), true, 'the selected bar is outlined, not colour alone');
});
