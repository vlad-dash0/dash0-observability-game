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
import { S1, S2, S3, S4, T2, logsSpec } from './fixtures/build-logs.mjs';

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

test('a recheck with the same links in another order is free', () => {
  const spec = b1Spec();
  spec.edit = ['links'];
  spec.answer = { [E]: { links: [A] } };
  const { counts, mount } = setup(spec);
  mount();
  click(`[data-span="${E}"]`);
  click(`[data-link="${B}"]`);
  click(`[data-link="${C}"]`);
  click('#b1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#b1-feedback').firstChild.textContent, 'Not yet: 3 problems.');
  click(`[data-link="${B}"]`);
  click(`[data-link="${B}"]`);
  click('#b1-check');
  assert.equal(counts.mistakes, 1, 'links {B, C} added as C then B are the same graded state');
  assert.equal(q('#b1-feedback').firstChild.textContent, 'Same as last time: 3 problems.');
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

// ---- logs mode (#113, phase B): fixture L1 (test/fixtures/build-logs.mjs) -------------------
// Axis: min -40, max 100, range 140. Rows: S1, S2, S3 (trace 4bf9, from 0) then S4 (trace 0af7, from 30).

const LOG_IDS = ['l-boot', 'l-cart', 'l-other', 'l-charge', 'l-worker'];
const logLines = () => qa('[data-log]').map((b) => b.textContent);
const logIds = () => qa('[data-log]').map((b) => b.dataset.log);
const lfeedback = () => q('#l1-feedback').textContent;
const lines = (cls) => qa(`svg line.${cls}`).map((l) => ['x1', 'x2', 'y1', 'y2'].map((a) => l.getAttribute(a)).join(' '));
const attach = (log, span) => {
  click(`[data-log="${log}"]`);
  click(`[data-attach="${span}"]`);
};
const solveLogs = () => {
  attach('l-boot', 'none');
  attach('l-cart', S2);
  attach('l-other', S4);
  attach('l-charge', S3);
  attach('l-worker', 'none');
};

test('V1 logs mode: a log stream of data-log buttons, one line per record, and the waterfall keeps one row per span', () => {
  setup(logsSpec());
  assert.deepEqual(logIds(), LOG_IDS, 'spec order');
  assert.deepEqual(qa('[data-log]').map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false', 'false']);
  assert.equal(qa('ol.build-logs > li > button.build-log').length, 5);
  assert.deepEqual(logLines(), [
    '-40 ms · INFO · checkout · trace_id=(none) · span_id=(none) · Application started · thread.name=main',
    '30 ms · DEBUG · checkout · trace_id=(none) · span_id=(none) · Cart validated · order.id=8841',
    '60 ms · INFO · checkout · trace_id=(none) · span_id=(none) · Order accepted · order.id=8842',
    '70 ms · INFO · payments · trace_id=(none) · span_id=(none) · Charge submitted · thread.name=http-exec-1',
    '75 ms · ERROR · payments · trace_id=(none) · span_id=(none) · Retry worker gave up on charge · thread.name=retry-worker-2',
  ]);
  assert.deepEqual(spanIds(), [S1, S2, S3, S4], 'one row per span, never one per record');
  assert.equal(qa('svg rect').length, 4);
  assert.deepEqual(rects(), ['28.57 0 71.43 4', '42.86 6 14.29 4', '64.29 12 28.57 4', '50 18 35.71 4'], 'the record times widen the axis');
  assert.equal(q('svg').getAttribute('viewBox'), '0 0 100 24');
  assert.deepEqual([qa('svg line').length, qa('[data-attach]').length, qa('[data-parent]').length], [0, 0, 0]);
  assert.equal(rows()[1], 'validate cart · checkout · INTERNAL · UNSET · 20–40 ms · Parent: POST /checkout (checkout)');
  assert.equal(q('[data-build-panel]').textContent, 'Pick a record to attach it, or a span to see its records.');
});

test('V1 selecting a record presses it and offers "No span context" first, then every span in row order', () => {
  const { counts, mount } = setup(logsSpec());
  mount();
  click('[data-log="l-worker"]');
  assert.deepEqual(qa('[data-log]').map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false', 'true']);
  assert.equal(q('[data-build-panel] .build-editing').textContent, 'Span context for "Retry worker gave up on charge" (payments, 75 ms)');
  assert.deepEqual(qa('[data-attach]').map((b) => b.dataset.attach), ['none', S1, S2, S3, S4]);
  assert.deepEqual(qa('[data-attach]').map((b) => b.textContent), [
    'No span context',
    'POST /checkout (checkout) · 0–100 ms',
    'validate cart (checkout) · 20–40 ms',
    'POST /charge (payments) · 50–90 ms',
    'POST /checkout (checkout) · 30–80 ms',
  ]);
  assert.deepEqual(qa('[data-attach]').map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false']);
  assert.deepEqual(qa('[data-span]').map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false']);
  assert.deepEqual([panel('data-parent'), panel('data-kind'), panel('data-status'), panel('data-link')], [[], [], [], []], 'spans are read-only');
  assert.equal(counts.mistakes, 0, 'selecting is free');
});

test('V2 attaching fills in the record ids, lights a tick at the record time on the span row and counts "Logs: N"', () => {
  const { counts, mount } = setup(logsSpec());
  mount();
  attach('l-other', S4);
  assert.equal(logLines()[2], `60 ms · INFO · checkout · trace_id=${T2} · span_id=${S4} · Order accepted · order.id=8842`);
  assert.deepEqual(lines('wf-log'), ['71.43 71.43 18 22'], 'row 4, at the record time on the shared axis');
  assert.equal(rows()[3].endsWith(' · Logs: 1'), true);
  assert.deepEqual(rows().map((t) => t.includes('Logs:')), [false, false, false, true]);
  assert.deepEqual(logIds(), LOG_IDS, 'the record stays in the stream');
  assert.equal(qa('svg rect').length, 4);
  assert.equal(lfeedback(), `"Order accepted" now carries span_id=${S4} and trace_id=${T2} from POST /checkout (checkout).`);
  assert.equal(q(`[data-attach="${S4}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(q('[data-attach="none"]').getAttribute('aria-pressed'), 'false');
  attach('l-boot', S1);
  assert.deepEqual(lines('wf-log'), ['0 0 0 4', '71.43 71.43 18 22'], 'a timestamp outside the bar hangs off it (the bar starts at 28.57)');
  attach('l-cart', S1);
  assert.equal(rows()[0].endsWith(' · Logs: 2'), true);
  attach('l-boot', 'none');
  assert.equal(logLines()[0].includes('trace_id=(none) · span_id=(none)'), true, 'blank ids read (none)');
  assert.equal(rows()[0].endsWith(' · Logs: 1'), true);
  assert.deepEqual(lines('wf-log'), ['50 50 0 4', '71.43 71.43 18 22']);
  assert.equal(lfeedback(), '"Application started" now has no span context: trace_id=(none) and span_id=(none).');
  assert.equal(counts.mistakes, 0, 'attaching and detaching are free');
});

test('V3 the cursor marks the selected record time across the waterfall and only then', () => {
  const { mount } = setup(logsSpec());
  mount();
  assert.deepEqual(lines('wf-cursor'), []);
  click('[data-log="l-boot"]');
  assert.deepEqual(lines('wf-cursor'), ['0 0 0 24']);
  click('[data-log="l-cart"]');
  assert.deepEqual(lines('wf-cursor'), ['50 50 0 24']);
  click('[data-log="l-worker"]');
  assert.deepEqual(lines('wf-cursor'), ['82.14 82.14 0 24']);
  click(`[data-span="${S3}"]`);
  assert.deepEqual(lines('wf-cursor'), [], 'a span selection has no cursor');
  assert.equal(qa('svg [style]').length, 0);
});

test('V4 span mode has no logs markup at all', () => {
  const { mount } = setup({ ...b1Spec(), edit: ['parent', 'kind', 'status', 'links'] });
  mount();
  click(`[data-span="${C}"]`);
  assert.deepEqual([qa('[data-log]').length, qa('.build-logs').length, qa('svg line').length, qa('[data-attach]').length, qa('[data-show-log]').length], [0, 0, 0, 0, 0]);
  assert.equal(rows().some((t) => t.includes('Logs:')), false);
  assert.equal(q('[data-build-panel] .build-editing').textContent.startsWith('Editing '), true);
});

test('V5 penalties: a failing Check costs one, the same graded records again is free, a changed record costs again', () => {
  const { counts, mount } = setup(logsSpec());
  mount();
  attach('l-cart', S2);
  click('#l1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#l1-feedback').firstChild.textContent, 'Not yet: 2 problems.');
  assert.deepEqual(qa('#l1-feedback li').map((li) => li.textContent), [
    '"Order accepted" (checkout, 60 ms): it has no span context yet.',
    '"Charge submitted" (payments, 70 ms): it has no span context yet.',
  ]);
  click('#l1-check');
  assert.equal(counts.mistakes, 1, 'the same state again is free');
  assert.equal(q('#l1-feedback').firstChild.textContent, 'Same as last time: 2 problems.');
  attach('l-cart', S1);
  attach('l-cart', S2);
  click('#l1-check');
  assert.equal(counts.mistakes, 1, 'an attach undone is the same state');
  attach('l-other', S3);
  click('#l1-check');
  assert.equal(counts.mistakes, 2, 'a changed record is a new state, though the problem count is the same');
  assert.equal(q('#l1-feedback').firstChild.textContent, 'Not yet: 2 problems.');
  assert.equal(qa('#l1-feedback li')[0].textContent.includes('another service'), true);
  assert.equal(counts.done, 0);
});

test('V5 a recheck after attaching the same records in another order is free', () => {
  const { counts, mount } = setup(logsSpec());
  mount();
  attach('l-cart', S2);
  attach('l-charge', S3);
  click('#l1-check');
  attach('l-charge', 'none');
  attach('l-cart', 'none');
  attach('l-charge', S3);
  attach('l-cart', S2);
  click('#l1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#l1-feedback').firstChild.textContent, 'Same as last time: 1 problem.');
});

test('V6 a passing Check says every record checks out with the explain, locks the attach controls and still lets you inspect', () => {
  const spec = { ...logsSpec(), explain: 'The worker thread is not the request <b>thread</b>.' };
  const { focus, counts, mount } = setup(spec);
  mount();
  solveLogs();
  click('#l1-check');
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 1 });
  assert.equal(lfeedback(), 'Right. Every record checks out. The worker thread is not the request thread.');
  assert.equal(q('#l1-feedback b').textContent, 'thread', 'explain is authored HTML');
  assert.equal(q('#l1-feedback').className, 'feedback good show');
  assert.equal(focus.last(), '#finish');
  assert.equal(q('#l1-check').disabled, true);
  assert.deepEqual(qa('[data-attach]').map((b) => b.disabled), [true, true, true, true, true]);
  assert.equal(qa('[data-log]').every((b) => !b.disabled) && qa('[data-span]').every((b) => !b.disabled), true);
  const before = logLines();
  q(`[data-attach="${S1}"]`).onclick({});
  assert.deepEqual(logLines(), before, 'a click that gets through does not change a record');
  click('[data-log="l-cart"]');
  assert.equal(q('[data-log="l-cart"]').getAttribute('aria-pressed'), 'true');
  click(`[data-span="${S3}"]`);
  assert.equal(qa('[data-show-log]').length, 1, 'inspecting still works');
  assert.equal(counts.done, 1);
});

test('V6 the same passing run without explain says only the pass line', () => {
  const { mount } = setup(logsSpec());
  mount();
  solveLogs();
  click('#l1-check');
  assert.equal(lfeedback(), 'Right. Every record checks out.');
});

test('V7 the reverse view: a span shows its attributes read-only and the records carrying its span_id', () => {
  const { mount } = setup(logsSpec());
  mount();
  click(`[data-span="${S3}"]`);
  assert.equal(q(`[data-span="${S3}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(q('[data-build-panel] .build-editing').textContent, `POST /charge (payments), trace 4bf92f3577b34da6a3ce929d0e0e4736, span_id ${S3}`);
  assert.deepEqual(qa('[data-build-panel] .build-attrs li').map((li) => li.textContent), ['thread.name=http-exec-1']);
  assert.equal(qa('[data-show-log]').length, 0);
  assert.equal(q('[data-build-panel]').textContent.includes('No record carries this span_id yet.'), true);
  assert.deepEqual([qa('[data-attach]').length, qa('[data-parent]').length, qa('[data-build-panel] input, [data-build-panel] select').length], [0, 0, 0]);
  attach('l-charge', S3);
  attach('l-worker', S3);
  click(`[data-span="${S3}"]`);
  assert.deepEqual(qa('[data-show-log]').map((b) => b.dataset.showLog), ['l-charge', 'l-worker'], 'spec order');
  assert.equal(qa('[data-show-log]')[0].textContent, '70 ms · INFO · Charge submitted');
  click('[data-show-log="l-worker"]');
  assert.equal(q('[data-log="l-worker"]').getAttribute('aria-pressed'), 'true');
  assert.equal(q(`[data-attach="${S3}"]`).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(lines('wf-cursor'), ['82.14 82.14 0 24']);
  click(`[data-span="${S1}"]`);
  assert.deepEqual(qa('[data-build-panel] .build-attrs li').map((li) => li.textContent), ['order.id=8841']);
  click(`[data-span="${S2}"]`);
  assert.equal(qa('[data-build-panel] .build-attrs li').length, 0);
  assert.equal(q('[data-build-panel]').textContent.includes('No attributes.'), true);
});

test('V8 data text is escaped everywhere in logs mode: stream, panel, feedback and problems', () => {
  const spec = logsSpec();
  spec.logs[1].body = '<img src=x>Cart & "ok"';
  spec.logs[1].service = '<b>shop</b>';
  spec.logs[1].attributes = { '<i>k</i>': '<u>v</u>' };
  spec.spans[1].name = '<s>cart</s>';
  spec.spans[1].service = '<b>shop</b>';
  spec.spans[1].attributes = { '<em>a</em>': '<code>b</code>' };
  const { mount } = setup(spec);
  mount();
  const hostile = () => qa('img, b, i, u, s, em').length;
  assert.equal(hostile(), 0);
  assert.equal(logLines()[1], '30 ms · DEBUG · <b>shop</b> · trace_id=(none) · span_id=(none) · <img src=x>Cart & "ok" · <i>k</i>=<u>v</u>');
  attach('l-cart', S2);
  assert.equal(lfeedback().startsWith('"<img src=x>Cart & "ok"" now carries'), true);
  assert.equal(rows()[1].startsWith('<s>cart</s> · <b>shop</b> · INTERNAL'), true);
  click(`[data-span="${S2}"]`);
  assert.deepEqual(qa('[data-build-panel] .build-attrs li').map((li) => li.textContent), ['<em>a</em>=<code>b</code>']);
  assert.equal(qa('[data-show-log]')[0].textContent, '30 ms · DEBUG · <img src=x>Cart & "ok"');
  click('[data-log="l-cart"]');
  assert.equal(q(`[data-attach="${S2}"]`).textContent, '<s>cart</s> (<b>shop</b>) · 20–40 ms');
  attach('l-cart', S3);
  click('#l1-check');
  assert.equal(qa('#l1-feedback li')[0].textContent.startsWith('"<img src=x>Cart & "ok"" (<b>shop</b>, 30 ms):'), true);
  assert.equal(hostile() + qa('code').length - qa('[data-build-panel] code').length, 0, 'no element came from data text');
});

test('V9 focus: the first record on mount, the first control after a pick, the attach button after an attach, the feedback after a failing Check', () => {
  const spec = { ...logsSpec(), hint: 'Compare the thread names.' };
  const { focus, mount } = setup(spec);
  mount();
  assert.equal(focus.last(), 'log:l-boot');
  click('[data-log="l-cart"]');
  assert.equal(focus.last(), 'attach:none');
  click(`[data-attach="${S2}"]`);
  assert.equal(focus.last(), `attach:${S2}`);
  click(`[data-span="${S3}"]`);
  assert.equal(focus.last(), 'panel-title:span', 'a span with no records: its heading');
  attach('l-charge', S3);
  click(`[data-span="${S3}"]`);
  assert.equal(focus.last(), 'show-log:l-charge');
  click('[data-show-log="l-charge"]');
  assert.equal(focus.last(), 'attach:none');
  click('#l1-check');
  assert.equal(focus.last(), '#l1-feedback');
  click('#l1-hint');
  assert.equal(focus.last(), '#l1-hint-text');
  solveLogs();
  click('#l1-check');
  assert.equal(focus.last(), '#finish');
  click('[data-log="l-cart"]');
  assert.equal(focus.last(), 'panel-title:log', 'locked: the attach buttons are disabled, so the heading takes focus');
  assert.deepEqual(focus.unfocusable(), []);
});

test('V10 no em dash, no zero ids and no style, Alpine or on* attributes in any logs-mode state', () => {
  const { dom, mount } = setup({ ...logsSpec(), hint: 'Look at the thread.', explain: 'Done.' });
  mount();
  const html = () => dom.body.innerHTML;
  const seen = [html()];
  click('[data-log="l-worker"]');
  seen.push(html());
  attach('l-worker', S3);
  seen.push(html());
  click(`[data-span="${S3}"]`);
  seen.push(html());
  click('#l1-check');
  seen.push(html());
  click('#l1-hint');
  solveLogs();
  click('#l1-check');
  seen.push(html());
  assert.equal(seen.length, 6);
  for (const markup of seen) {
    assert.equal(markup.includes('—'), false, 'em dash');
    assert.equal(/0{16}/.test(markup), false, 'zero ids');
    assert.equal(/\sstyle=/.test(markup) || ALPINE.test(markup) || /\son\w+=/.test(markup), false);
  }
});

test('V11 styles: the log stream, the pressed record, the tick and the cursor are drawn from existing tokens, without inline style', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(join(root, 'styles', 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    sels: sel.split(',').map((s) => s.trim()),
    body: body.replace(/\s+/g, ' '),
  }));
  const bodyOf = (sel) => rules.filter((r) => r.sels.includes(sel)).map((r) => r.body).join(';');
  assert.equal(/max-width:\s*100%/.test(bodyOf('.build-log')), true, '.build-log max-width: 100%');
  assert.equal(/overflow-wrap:\s*anywhere/.test(bodyOf('.build-log')), true, '.build-log overflow-wrap: anywhere');
  assert.equal(bodyOf('.build-logs').length > 0, true, '.build-logs');
  assert.equal(/border:\s*3px solid var\(--color-text\)/.test(bodyOf('.build-log[aria-pressed="true"]')), true, 'the pressed record is not colour alone');
  for (const sel of ['.wf-log', '.wf-cursor']) {
    assert.equal(/stroke:\s*var\(--color-[\w-]+\)/.test(bodyOf(sel)), true, `${sel} stroke is a token`);
    assert.equal(/vector-effect:\s*non-scaling-stroke/.test(bodyOf(sel)), true, `${sel} keeps its stroke width under preserveAspectRatio none`);
  }
  assert.equal(/stroke-dasharray:/.test(bodyOf('.wf-cursor')), true, 'the cursor is dashed');
  const mine = ['.build-logs', '.build-log', '.build-log[aria-pressed="true"]', '.wf-log', '.wf-cursor'].map(bodyOf).join(' ');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(mine), false, 'tokens only, so both themes follow');
});
