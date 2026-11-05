// lib/widgets/build-it-view.mjs: the Build it view and mount (#146: Dash0-style waterfall,
// drag onto the parent, the pick path, the help ladder, specific notes, scoring through ctx,
// the success card and its swirl; logs mode keeps its attach flow). Spec: docs/M1-DESIGN.md
// §4.2. Asserts strings, numbers and booleans only, never DOM nodes.
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
import { checkBuild } from '../lib/widgets/build-it.mjs';
import { noteFor } from '../lib/widgets/build-it-help.mjs';
import { A, B, C, D, E, b1Spec } from './fixtures/build-b1.mjs';
import { S1, S2, S3, S4, T2, logsSpec } from './fixtures/build-logs.mjs';

const ALL = { queue: true, tint: true, guide: true, instant: true, hints: true };
const CHECK = { hints: true }; // context-propagation's ladder: Check button, hints on

/** A counting ctx on a fresh DOM with the widget rendered. */
function setup(spec = b1Spec(), { reduceMotion = false } = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, hints: 0, done: 0, swirls: [] };
  const ctx = {
    ovBody: dom.body,
    ovActions: dom.actions,
    escapeHtml,
    reduceMotion,
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
  const swirl = (host, opts) => counts.swirls.push(opts.reduced);
  const mount = (extra = {}) => mountBuild(ctx, spec, { onComplete, swirl, ...extra });
  return { ctx, dom, focus, counts, mount };
}

const withHelps = (helps, extra = {}) => ({ ...b1Spec(), helps, ...extra });
const placedIds = () => qa('[data-span]:not([data-arriving])').map((r) => r.dataset.span);
const arriving = () => qa('[data-arriving]').map((r) => r.dataset.span);
const waiting = () => qa('[data-waiting]').map((r) => r.dataset.waiting);
const status = () => q('[id$="-status"]').textContent;
/** The status line's tone (#158 D7: error for a wrong move that costs, neutral for information). */
const tone = () => q('[id$="-status"]').getAttribute('data-tone');
const feedback = () => q('#b1-feedback').textContent;
const fbTone = () => q('#b1-feedback').getAttribute('data-tone');
/** The first paragraph of a failed Check's feedback ("Not yet: N problems."). */
const fbHead = (id) => q(`#${id}-feedback p`).textContent;
const label = (id) => q(`[data-span="${id}"]`).getAttribute('aria-label');
// getAttribute, not dataset: linkedom's dataset does not see attributes set after its first read.
const marks = () => qa('[data-span]').map((r) => `${r.dataset.span}:${r.getAttribute('data-mark') ?? ''}${r.getAttribute('data-other') === 'true' ? '+other' : ''}`);
const ev = () => {
  const e = { prevented: false, dataTransfer: { setData() {}, effectAllowed: '' } };
  e.preventDefault = () => {
    e.prevented = true;
  };
  return e;
};
/** Drag span `id` (its row) onto drop target `to` (a span id or 'root'); returns whether the target accepted the drag. */
function drag(id, to) {
  const row = q(`[data-span="${id}"]`);
  assert.equal(row.getAttribute('draggable'), 'true', `${id} is draggable`);
  row.ondragstart(ev());
  const target = q(`[data-drop="${to}"]`);
  const over = ev();
  target.ondragover(over);
  target.ondrop(ev());
  row.ondragend?.(ev());
  return over.prevented;
}
const pick = (span, parent) => {
  click(`[data-span="${span}"]`);
  click(`[data-parent="${parent}"]`);
};
const solveQueue = () => {
  drag(B, A);
  drag(C, B);
  drag(D, C);
  drag(E, 'root');
};
const ALPINE = /\s(?:x-[\w.:-]+|@[\w.:-]+|:[\w.:-]+)=/;
const cleanMarkup = (html) => !ALPINE.test(html) && !/\sstyle=/.test(html) && !/\son\w+=/.test(html) && !html.includes('—');

// ---- board and rows --------------------------------------------------------------------

test('one instruction line, rendered by renderBuild, describes every span row; the helps chips say what is on', () => {
  setup(withHelps(ALL));
  assert.equal(q('#b1-instr').textContent, 'Drag each span onto its parent, or pick a span and then its parent.');
  assert.equal(q('#b1-instr').hasAttribute('aria-live') || q('#b1-instr').hasAttribute('role'), false, 'not a live region');
  assert.equal(qa('[data-span]').every((r) => r.getAttribute('aria-describedby') === 'b1-instr'), true);
  assert.equal(q('#b1-helps').textContent, 'Helps: One span at a time on Trace tint on Time-window guide on Instant feedback on Hints on');
  setup(withHelps({ hints: true }));
  assert.equal(q('#b1-helps').textContent, 'Helps: One span at a time off Trace tint off Time-window guide off Instant feedback off Hints on');
});

test('rows: name and service first, kind, status and timing secondary; 8-char trace ids with the full id in a tooltip, no ellipsis', () => {
  setup(withHelps({}));
  assert.deepEqual(placedIds(), [A, B, C, D, E], 'every span a root, trace 4bf9 then 0af7, by start');
  assert.equal(label(B), 'POST, storefront, CLIENT, UNSET, 10 to 90 ms, trace 4bf92f35, root');
  assert.deepEqual(qa(`[data-span="${E}"] [data-trace]`).map((t) => `${t.textContent}|${t.getAttribute('title')}`), ['trace 0af76519|trace id 0af7651916cd43dd8448eb211c80319c']);
  assert.equal(q(`[data-span="${B}"] .wf-name`).textContent, 'POST');
  assert.equal(q(`[data-span="${B}"] .wf-svc`).textContent, 'storefront');
  assert.equal(q('[data-build="b1"]').textContent.includes('…'), false);
  assert.equal(q('[data-meta]').textContent, 'Spans5Services2Window0 to 100 ms');
});

test('the waterfall is real text: tick labels in ms and each bar labelled with its duration and name, no style attributes', () => {
  setup(withHelps({}));
  assert.deepEqual(qa('[data-tick]').map((t) => t.textContent), ['0', '20 ms', '40 ms', '60 ms', '80 ms', '100 ms']);
  assert.deepEqual(qa(`[data-span="${D}"] [data-bar]`).map((b) => `${b.getAttribute('x')} ${b.getAttribute('width')}`), ['20% 10%']);
  assert.equal(q(`[data-span="${D}"] [data-bar-label]`).textContent, '10ms validate cart');
  assert.equal(qa('[style]').length, 0);
  assert.equal(qa('.wf-track').every((s) => s.getAttribute('aria-hidden') === 'true' && !s.hasAttribute('viewBox')), true, 'no stretched viewBox');
});

test('colour by service, from a legend; ERROR is a marker, not the fill', () => {
  const spec = withHelps({});
  spec.spans[3].status = 'ERROR';
  setup(spec);
  assert.deepEqual(qa('[data-span]').map((r) => r.dataset.svc), ['0', '0', '1', '1', '0'], 'storefront 0, api-gateway 1');
  assert.deepEqual(qa('[data-legend-svc]').map((l) => `${l.dataset.legendSvc}:${l.textContent}`), ['0:storefront', '1:api-gateway']);
  assert.equal(q(`[data-span="${D}"]`).dataset.error, 'true');
  assert.equal(q(`[data-span="${C}"]`).dataset.error, 'false');
  assert.equal(q('[data-legend]').textContent.includes('ERROR'), true);
});

// ---- arrival queue ---------------------------------------------------------------------

test('queue: the first root is placed, the next span arrives, the rest wait and are not interactive', () => {
  const { counts, focus, mount } = setup(withHelps(ALL));
  mount();
  assert.deepEqual([placedIds(), arriving(), waiting()], [[A], [B], [C, D, E]]);
  assert.equal(focus.last(), `span:${B}`, 'focus starts on the arriving span');
  assert.equal(q('[data-meta]').textContent.startsWith('Spans1 of 5 placed'), true);
  assert.equal(q('[data-queue]').textContent.includes('Span 2 of 5 arriving'), true);
  for (const id of waiting()) {
    const w = q(`[data-waiting="${id}"]`);
    assert.deepEqual([w.hasAttribute('tabindex'), w.getAttribute('draggable'), w.hasAttribute('data-drop'), w.hasAttribute('data-span')], [false, null, false, false]);
    assert.equal(w.getAttribute('aria-label').endsWith('waiting, not arrived yet'), true);
  }
  click(`[data-waiting="${D}"]`);
  assert.equal(status(), "This span hasn't arrived yet; place the current one first.");
  assert.equal(tone(), 'neutral', 'free information, not a wrong answer');
  assert.deepEqual([counts.mistakes, placedIds().length], [0, 1], 'free, and nothing moved');
  assert.equal(q('[data-arriving]').hasAttribute('data-drop'), false, 'the arriving span is not a drop target');
});

test('queue: spans arrive in start order as each one is placed', () => {
  const { mount } = setup(withHelps(ALL));
  mount();
  drag(B, A);
  assert.deepEqual([placedIds(), arriving(), waiting()], [[A, B], [C], [D, E]]);
  drag(C, B);
  drag(D, C);
  assert.deepEqual([arriving(), waiting()], [[E], []]);
  assert.equal(q('[data-queue]').textContent.includes('last one'), true);
});

// ---- drag and drop ---------------------------------------------------------------------

test('a drag onto a span calls setParent: the tree redraws, a right drop ticks and costs nothing', () => {
  const { counts, focus, mount } = setup(withHelps(ALL));
  mount();
  assert.equal(drag(B, A), true, 'A accepts the drop');
  assert.equal(status(), 'POST (storefront) sits under POST /checkout (storefront). Right.');
  assert.equal(tone(), 'success');
  assert.equal(q(`[data-span="${B}"]`).dataset.verdict, 'ok');
  assert.equal(q(`[data-span="${B}"]`).dataset.depth, '1');
  assert.equal(label(B).endsWith('parent POST /checkout (storefront), right'), true);
  assert.equal(counts.mistakes, 0);
  assert.equal(focus.last(), `span:${C}`, 'focus moves to the next arriving span');
});

test('a wrong drop costs one mistake, says a specific note and stays; the same drop again is free', () => {
  const { counts, mount } = setup(withHelps(ALL));
  mount();
  drag(B, 'root');
  assert.equal(counts.mistakes, 1);
  assert.equal(status(), 'POST (storefront) is a root, but not quite. POST (storefront) is a root now, yet another span of trace 4bf92f35 was already running when it started. Which call was it doing work for? It stays here; move it when you are ready.');
  assert.equal(tone(), 'error', 'D7: a wrong drop costs a star, so it is the error tone');
  assert.equal(q(`[data-span="${B}"]`).dataset.verdict, 'no');
  assert.deepEqual(arriving(), [C], 'placed anyway; the next span arrives');
  drag(B, 'root');
  assert.equal(counts.mistakes, 1, 'an unchanged repeat is free');
  assert.equal(status(), 'POST (storefront) is already a root.');
  assert.equal(tone(), 'neutral', 'a free repeat is information');
  drag(B, A);
  assert.deepEqual([counts.mistakes, q(`[data-span="${B}"]`).dataset.verdict], [1, 'ok'], 'retrying is free');
});

test('a cross-trace drop names both trace ids', () => {
  const { counts, mount } = setup(withHelps(ALL));
  mount();
  drag(B, A);
  drag(C, B);
  drag(D, C);
  drag(E, C);
  assert.equal(counts.mistakes, 1);
  assert.equal(status().includes('GET /products (storefront) carries trace id 0af76519, POST /checkout (api-gateway) carries 4bf92f35. Different trace ids, so it can\'t be the parent.'), true);
});

test('while a span moves: itself and its descendants are refused, a drop there is free and says it would loop', () => {
  const { counts, mount } = setup(withHelps(ALL));
  mount();
  drag(B, A);
  drag(C, B);
  drag(D, C);
  q(`[data-span="${B}"]`).ondragstart(ev());
  assert.deepEqual(marks(), [`${A}:likely`, `${B}:src`, `${C}:invalid`, `${D}:invalid`, `${E}:`], 'E is arriving: not a target');
  assert.equal(q(`[data-span="${C}"]`).getAttribute('aria-disabled'), 'true');
  const over = ev();
  q(`[data-drop="${D}"]`).ondragover(over);
  assert.equal(over.prevented, false, 'a descendant is not a drop target');
  q(`[data-drop="${D}"]`).ondrop(ev());
  assert.equal(status(), 'validate cart (api-gateway) is already below POST (storefront), so that would make a loop.');
  assert.equal(tone(), 'neutral', 'a refused loop is free, so it is information');
  assert.equal(counts.mistakes, 0);
  assert.equal(label(B).endsWith('parent POST /checkout (storefront), right'), true, 'nothing changed');
  q(`[data-span="${C}"]`).ondragend?.(ev());
  assert.deepEqual(marks().map((m) => m.split(':')[1]), ['', '', '', '', ''], 'marks cleared after the drag');
});

test('the time-window guide: a band at the moving span\'s window on every placed row, and the spans that contain it highlight', () => {
  const { mount } = setup(withHelps(ALL));
  mount();
  drag(B, A);
  drag(C, B);
  q(`[data-span="${D}"]`).ondragstart(ev());
  assert.deepEqual(qa('[data-band]').map((b) => `${b.getAttribute('x')} ${b.getAttribute('width')}`), ['20% 10%', '20% 10%', '20% 10%']);
  assert.deepEqual(marks().slice(0, 3), [`${A}:likely`, `${B}:likely`, `${C}:likely`]);
  q(`[data-span="${D}"]`).ondragend(ev());
  assert.equal(qa('[data-band]').length, 0);
  const off = setup(withHelps({ ...ALL, guide: false }));
  off.mount();
  q(`[data-span="${B}"]`).ondragstart(ev());
  assert.deepEqual([qa('[data-band]').length, marks()[0]], [0, `${A}:valid`]);
});

test('trace tint: one tint per trace id; while moving, candidates from another trace fade and say so', () => {
  const { mount } = setup(withHelps(ALL));
  mount();
  for (const [s, p] of [[B, A], [C, B], [D, C]]) drag(s, p);
  assert.deepEqual(qa('[data-trace]').map((t) => t.dataset.tint), ['0', '0', '0', '0', '1']);
  q(`[data-span="${E}"]`).ondragstart(ev());
  assert.deepEqual(marks(), [`${A}:likely+other`, `${B}:likely+other`, `${C}:likely+other`, `${D}:overflow+other`, `${E}:`], 'E is arriving, so not on the board yet');
  assert.equal(q(`[data-span="${C}"] [data-tags]`).textContent.includes('other trace'), true);
  const plain = setup(withHelps({ hints: true }));
  plain.mount();
  assert.deepEqual(qa('[data-trace]').map((t) => t.dataset.tint ?? 'none'), ['none', 'none', 'none', 'none', 'none']);
});

test('drop onto the root zone makes the span a root; the zone accepts only while a span moves', () => {
  const { counts, mount } = setup(withHelps(ALL));
  mount();
  for (const [s, p] of [[B, A], [C, B], [D, C]]) drag(s, p);
  const idle = ev();
  q('[data-drop="root"]').ondragover(idle);
  assert.equal(idle.prevented, false);
  assert.equal(drag(E, 'root'), true);
  assert.equal(counts.mistakes, 0);
  assert.equal(label(E).endsWith('root, right'), true);
});

// ---- pick path -------------------------------------------------------------------------

test('pick path: picking a span offers root and every placed span, itself and its descendants disabled; it takes the same path', () => {
  const { counts, focus, mount } = setup(withHelps({ ...ALL, queue: false }));
  mount();
  pick(B, A);
  pick(C, B);
  click(`[data-span="${B}"]`);
  assert.equal(q(`[data-span="${B}"]`).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(qa('[data-parent]').map((b) => `${b.dataset.parent}${b.disabled ? ' disabled' : ''}`), ['none', A, `${B} disabled`, `${C} disabled`, D, E]);
  assert.equal(q(`[data-span="${A}"]`).getAttribute('data-parent-of-selected'), 'true', 'its current parent is marked');
  assert.equal(marks()[0], `${A}:likely`, 'targets show while a span is picked');
  click(`[data-parent="${E}"]`);
  assert.equal(counts.mistakes, 1);
  assert.equal(status().startsWith('POST (storefront) sits under GET /products (storefront), but not quite.'), true);
  assert.equal(focus.last(), `parent:${E}`);
  click('[data-parent="none"]');
  assert.equal(counts.mistakes, 2, 'another wrong placement costs again');
  click(`[data-parent="${A}"]`);
  assert.equal(counts.mistakes, 2);
  assert.equal(focus.last(), `span:${B}`, 'right: focus back on the span');
});

test('pick path with the queue: the arriving span gets a panel of root and the placed spans only', () => {
  const { counts, mount } = setup(withHelps(ALL));
  mount();
  click(`[data-span="${B}"]`);
  assert.deepEqual(qa('[data-parent]').map((b) => b.dataset.parent), ['none', A]);
  click(`[data-parent="${A}"]`);
  assert.deepEqual([arriving(), counts.mistakes], [[C], 0]);
});

test('Escape cancels a pick', () => {
  const { mount, dom } = setup(withHelps(ALL));
  mount();
  click(`[data-span="${B}"]`);
  q('[data-build="b1"]').onkeydown({ key: 'Escape', preventDefault() {} });
  assert.equal(q(`[data-span="${B}"]`).getAttribute('aria-pressed'), 'false');
  assert.equal(status(), 'Cancelled.');
  assert.equal(cleanMarkup(dom.body.innerHTML), true);
});

test('Escape during a pick is marked handled so the level stays open; with nothing picked it is left to the app', () => {
  const { mount } = setup(withHelps(ALL));
  mount();
  const esc = () => {
    const e = { key: 'Escape', defaultPrevented: false };
    e.preventDefault = () => {
      e.defaultPrevented = true;
    };
    q('[data-build="b1"]').onkeydown(e);
    return e.defaultPrevented;
  };
  click(`[data-span="${B}"]`);
  assert.equal(esc(), true, 'the pick owns this Escape');
  assert.equal(status(), 'Cancelled.');
  assert.equal(esc(), false, 'nothing picked: the app may close the level');
});

/** Press Escape on Build it box `id`; returns whether the widget marked it handled. */
const escOn = (id) => {
  const e = { key: 'Escape', defaultPrevented: false };
  e.preventDefault = () => {
    e.defaultPrevented = true;
  };
  q(`[data-build="${id}"]`).onkeydown(e);
  return e.defaultPrevented;
};

test('Escape is the widget\'s only while a move is pending: a selection with no pick is left to the app', () => {
  // After a wrong instant drop the span stays selected, but nothing is being moved.
  const wrong = setup(withHelps({ ...ALL, queue: false }));
  wrong.mount();
  drag(C, E);
  assert.equal(wrong.counts.mistakes, 1, 'a wrong drop');
  const note = status();
  assert.equal(escOn('b1'), false, 'after a wrong drop');
  assert.equal(status(), note, 'no "Cancelled." for a move that was not pending');
  click(`[data-span="${D}"]`);
  assert.equal(escOn('b1'), true, 'during a pick it is still the widget\'s');
  // A kind step: a row click only selects the span.
  setup({ ...b1Spec(), edit: ['kind'], answer: { [B]: { kind: 'SERVER' } } }).mount();
  click(`[data-span="${B}"]`);
  assert.equal(escOn('b1'), false, 'select-only row on a kind step');
  // Logs mode: a selected record is a selection, not a pending move.
  setup(logsSpec()).mount();
  click('[data-log="l-cart"]');
  assert.equal(escOn('l1'), false, 'a selected record');
  // After success a row click selects, and nothing can move.
  setup(withHelps(ALL)).mount();
  solveQueue();
  click(`[data-span="${C}"]`);
  assert.equal(escOn('b1'), false, 'after success');
});

// ---- completion, success card and swirl ----------------------------------------------

test('instant feedback: placing the last span right assembles the trace, once, with no Check button', () => {
  const { counts, focus, mount } = setup(withHelps(ALL, { closing: '<code>GET /products</code> stays a root.' }));
  mount();
  assert.equal(qa('#b1-check').length, 0);
  assert.equal(q('#b1-win').hidden, true);
  solveQueue();
  assert.deepEqual([counts.done, counts.mistakes], [1, 0]);
  assert.equal(feedback(), 'Right. Every span checks out.');
  assert.equal(fbTone(), 'success');
  assert.equal(q('#b1-win').hidden, false);
  assert.equal(q('#b1-win-title').textContent, 'Trace assembled');
  assert.equal(q('#b1-win-stars').textContent, '5 of 5 stars: 0 wrong drops, 0 hints.');
  assert.equal(q('#b1-win-closing').textContent, 'GET /products stays a root.');
  assert.equal(focus.last(), '#b1-win-title');
  assert.deepEqual(counts.swirls, [false], 'the swirl played once');
  assert.equal(qa('[data-span]').every((r) => r.getAttribute('draggable') !== 'true'), true, 'locked');
  assert.equal(qa('#b1-reset').every((b) => b.disabled), true);
  assert.deepEqual(focus.unfocusable(), []);
});

test('the swirl never plays on a wrong result, honours reduced motion, and a recheck of a right trace does not replay it', () => {
  const { counts, mount } = setup(withHelps(CHECK), { reduceMotion: true });
  mount();
  click('#b1-check');
  pick(B, A);
  click('#b1-check');
  assert.deepEqual(counts.swirls, [], 'two failed checks, no swirl');
  pick(C, B);
  pick(D, C);
  click('#b1-check');
  assert.deepEqual(counts.swirls, [true], 'played once, told to keep still');
  q('#b1-check').onclick({});
  assert.deepEqual(counts.swirls, [true]);
  assert.equal(counts.done, 1);
});

test('without an injected swirl the default draws the static ring when WebGL is missing, in the success card only', () => {
  const { mount } = setup(withHelps(CHECK));
  mount({ swirl: undefined });
  for (const [s, p] of [[B, A], [C, B], [D, C]]) pick(s, p);
  assert.equal(qa('[data-swirl] circle').length, 0);
  click('#b1-check');
  assert.equal(qa('[data-swirl] circle').length > 100, true);
  assert.equal(q('[data-swirl]').getAttribute('aria-hidden'), 'true');
});

// ---- Check mode, scoring ---------------------------------------------------------------

test('Check mode: moves are free and unmarked; a failed Check costs one, an unchanged repeat is free', () => {
  const { counts, focus, mount } = setup(withHelps(CHECK));
  mount();
  pick(B, A);
  assert.equal(status(), 'POST (storefront) now sits under POST /checkout (storefront).');
  assert.equal(q(`[data-span="${B}"]`).hasAttribute('data-verdict'), false, 'no tick without instant feedback');
  click('#b1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(fbHead('b1'), 'Not yet: 2 problems.');
  assert.equal(fbTone(), 'error', 'D7: a failed Check costs a star, so it is the error tone');
  assert.deepEqual(qa('#b1-feedback li').map((li) => li.dataset.code), ['wrong-parent', 'wrong-parent']);
  assert.equal(qa('#b1-feedback li')[1].textContent.startsWith('validate cart (api-gateway) is a root now'), true, 'the specific note, not the generic message');
  assert.equal(focus.last(), '#b1-feedback');
  click('#b1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(fbHead('b1'), 'Same as last time: 2 problems.');
  assert.equal(fbTone(), 'neutral', 'a free repeat is information');
  pick(C, A);
  pick(C, 'none');
  click('#b1-check');
  assert.equal(counts.mistakes, 1, 'an edit undone is the same state');
  assert.equal(q('#b1-wrong-label').textContent, 'failed Checks');
  assert.equal(q('#b1-wrong').textContent, '1');
});

test('score card: wrong drops and hints count, the stars follow the one rule, muted until success', () => {
  const { counts, mount } = setup(withHelps(ALL));
  mount();
  assert.equal(q('#b1-stars').getAttribute('aria-label'), '5 of 5 stars still possible');
  drag(B, 'root');
  click('#b1-hint');
  assert.deepEqual([counts.mistakes, counts.hints], [1, 1]);
  assert.deepEqual([q('#b1-wrong').textContent, q('#b1-hints').textContent, q('#b1-wrong-label').textContent], ['1', '1', 'wrong drops']);
  assert.equal(q('#b1-stars').getAttribute('aria-label'), '3 of 5 stars still possible');
  assert.deepEqual(qa('#b1-stars [data-star]').map((s) => s.dataset.star), ['possible', 'possible', 'possible', 'lost', 'lost']);
  drag(B, A);
  drag(C, B);
  drag(D, C);
  drag(E, 'root');
  assert.equal(q('#b1-stars').getAttribute('aria-label'), '3 of 5 stars');
  assert.deepEqual(qa('#b1-stars [data-star]').map((s) => s.dataset.star), ['earned', 'earned', 'earned', 'lost', 'lost']);
  assert.equal(q('#b1-win-stars').textContent, '3 of 5 stars: 1 wrong drop, 1 hint.');
});

test('Reset puts the board back but keeps what was paid', () => {
  const { counts, mount } = setup(withHelps(ALL));
  mount();
  drag(B, 'root');
  click('#b1-reset');
  assert.deepEqual([placedIds(), arriving()], [[A], [B]]);
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#b1-wrong').textContent, '1');
  assert.equal(status(), 'Reset. The first span is placed; the rest arrive one at a time.');
});

// ---- hints -----------------------------------------------------------------------------

test('hint tiers: each costs one ctx.hint(); tier 2 outlines two candidates, tier 3 places the span with a reason and no mistake', () => {
  const { counts, focus, mount } = setup(withHelps(ALL));
  mount();
  assert.equal(q('#b1-hint').textContent, 'Hint 1 of 3');
  assert.equal(q('#b1-hint-cost').textContent, 'costs 1 star');
  // The decorative pips (kit dots, aria-hidden) follow the words after a space.
  assert.equal(q('#b1-hint-tier').textContent.trim(), 'For POST (storefront): 0 of 3 used');
  assert.equal(q('#b1-hint-tier [aria-hidden="true"]').getAttribute('data-tone'), 'hint');
  click('#b1-hint');
  assert.equal(counts.hints, 1);
  assert.equal(q('#b1-hint-text').textContent.startsWith('Hint 1 of 3 · POST (storefront)A child starts after its parent starts'), true);
  assert.equal(focus.last(), '#b1-hint-text');
  click('#b1-hint');
  assert.deepEqual(qa('[data-hint-cand="true"]').map((r) => r.dataset.span ?? r.dataset.drop), ['root', A]);
  click('#b1-hint');
  assert.deepEqual([counts.hints, counts.mistakes], [3, 0]);
  assert.equal(q('#b1-hint-text').textContent.includes('Placed for you. POST /checkout (storefront) is the innermost span of trace 4bf92f35'), true);
  assert.equal(label(B).endsWith('parent POST /checkout (storefront), right'), true);
  assert.equal(qa('[data-hint-cand="true"]').length, 0);
  assert.equal(q('#b1-hint').textContent, 'Hint 1 of 3', 'the next arriving span has its own three');
  assert.equal(q('#b1-hint-tier').textContent.trim(), 'For POST /checkout (api-gateway): 0 of 3 used');
});

test('tier 3 when the answer parent sits below the hinted span: it is lifted out first, then the span is placed; no loop, no wrong drop', () => {
  // 2.4's ladder: Check mode. B dragged onto C, then C picked: C's answer parent B is C's child.
  const check = setup(withHelps({ hints: true }));
  check.mount();
  drag(B, C);
  click(`[data-span="${C}"]`);
  click('#b1-hint');
  click('#b1-hint');
  click('#b1-hint');
  assert.deepEqual([check.counts.hints, check.counts.mistakes], [3, 0]);
  assert.equal(label(C).endsWith('parent POST (storefront)'), true, 'C sits under B');
  assert.equal(label(B).endsWith('parent POST /checkout (storefront)'), true, 'B lifted to its own answer parent, A');
  assert.equal(q('#b1-hint-text').textContent.includes('Placed for you. POST (storefront) sat below it, so it moves out first, under POST /checkout (storefront).'), true);
  assert.equal(status(), 'POST (storefront) moves out first, under POST /checkout (storefront); POST /checkout (api-gateway) now sits under POST (storefront).');
  click('#b1-check');
  assert.deepEqual(qa('#b1-feedback li').map((li) => li.dataset.code), ['wrong-parent'], 'only D is left (C has no issue)');
  assert.equal(check.counts.mistakes, 1, 'that Check failed on D, the only cost');

  // The same with instant feedback (no queue): the wrong drop costs one, the hint none.
  const instant = setup(withHelps({ ...ALL, queue: false }));
  instant.mount();
  drag(B, C);
  assert.equal(instant.counts.mistakes, 1, 'the wrong drop');
  click(`[data-span="${C}"]`);
  click('#b1-hint');
  click('#b1-hint');
  click('#b1-hint');
  assert.deepEqual([instant.counts.hints, instant.counts.mistakes], [3, 1]);
  assert.equal(label(C).endsWith('parent POST (storefront), right'), true, 'C under B, and checkBuild finds nothing wrong with it');
  assert.equal(label(B).endsWith('parent POST /checkout (storefront), right'), true);
});

test('tier 3 lift in instant mode: the status names the lift; a lift that leaves the lifted span wrong says so, and costs nothing', () => {
  const triple = (spec) => {
    click('#b1-hint');
    click('#b1-hint');
    click('#b1-hint');
    return spec;
  };
  // Lifted to its own answer parent: the status carries the lift before the verdict.
  const up = setup(withHelps({ ...ALL, queue: false }));
  up.mount();
  drag(B, C);
  click(`[data-span="${C}"]`);
  triple();
  assert.equal(status(), 'POST (storefront) moves out first, under POST /checkout (storefront); POST /checkout (api-gateway) sits under POST (storefront). Right.');

  // Lifted to the root because its own answer parent (A) is below C too: B ends wrong.
  const deep = setup(withHelps({ ...ALL, queue: false }));
  deep.mount();
  drag(D, C);
  drag(A, D); // wrong: A is a root in the answer
  drag(B, A);
  assert.equal(deep.counts.mistakes, 1);
  assert.equal(label(B).endsWith('parent POST /checkout (storefront), right'), true, 'B is right before the hint');
  click(`[data-span="${C}"]`);
  triple();
  assert.deepEqual([deep.counts.hints, deep.counts.mistakes], [3, 1], 'the lift is not charged');
  assert.equal(label(B).endsWith('root, not right yet'), true, 'B is wrong after the lift');
  assert.equal(label(C).endsWith('parent POST (storefront), right'), true);
  const st = newBuildState(b1Spec());
  setParent(b1Spec(), st, B, null);
  const textOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const why = textOf(noteFor(b1Spec(), st, checkBuild(b1Spec(), st).issues.find((i) => i.spanId === B), escapeHtml));
  assert.equal(status(), `POST (storefront) moves out first, to the root, and is not where it belongs yet: ${why} Then POST /checkout (api-gateway) sits under POST (storefront). Right.`);
  assert.equal(q('#b1-hint-text').textContent.includes(`POST (storefront) sat below it, so it moves out first, to the root, and is not where it belongs yet: ${why}`), true, 'the hint panel says so too');
});

test('hints stop at three per span; with no hints on the level there is no button', () => {
  const { counts, mount } = setup(withHelps({ ...ALL, queue: false }));
  mount();
  click(`[data-span="${D}"]`);
  click('#b1-hint');
  click('#b1-hint');
  click(`[data-parent="${A}"]`);
  click(`[data-span="${D}"]`);
  click('#b1-hint');
  assert.equal(counts.hints, 3);
  assert.equal(label(D).endsWith('parent POST /checkout (api-gateway), right'), true);
  click(`[data-span="${D}"]`);
  click(`[data-parent="${A}"]`);
  click(`[data-span="${D}"]`);
  assert.deepEqual([q('#b1-hint').textContent, q('#b1-hint').disabled], ['No more hints', true]);
  setup(withHelps({ instant: false }));
  assert.equal(qa('#b1-hint').length, 0);
  assert.equal(q('#b1-hint-tier').textContent, 'No hints on this level.');
});

// ---- other span fields (span-kinds, events-and-links) ---------------------------------

test('kind editing with instant feedback: a wrong kind costs one and says why it is off; the last right kind assembles', () => {
  const spec = { ...b1Spec(), edit: ['kind'], answer: { [B]: { kind: 'SERVER' } }, helps: { tint: true, instant: true, hints: true } };
  const { counts, mount } = setup(spec);
  mount();
  assert.equal(q('#b1-instr').textContent, 'Pick a span, then its kind.');
  assert.equal(qa('[data-span]').every((r) => r.getAttribute('draggable') !== 'true'), true, 'no drag without parent editing');
  click(`[data-span="${B}"]`);
  click('[data-kind="PRODUCER"]');
  assert.equal(counts.mistakes, 1);
  assert.equal(status().startsWith('POST (storefront) is now PRODUCER, but not quite. POST (storefront): the kind doesn\'t match'), true);
  click('[data-kind="PRODUCER"]');
  assert.equal(counts.mistakes, 1, 'unchanged: free');
  click('[data-kind="SERVER"]');
  assert.deepEqual([counts.mistakes, counts.done], [1, 1]);
  assert.equal(q('#b1-win-title').textContent, 'Every span checks out');
  assert.equal(q('#b1-win-stars').textContent, '4 of 5 stars: 1 wrong pick, 0 hints.');
});

test('a tier-3 kind hint on a span still wrong in its status is neutral and free: the hint fixed one field, not the move', () => {
  const spec = { ...b1Spec(), edit: ['kind', 'status'], answer: { [B]: { kind: 'SERVER', status: 'ERROR' } }, helps: { tint: true, instant: true, hints: true } };
  const { counts, mount } = setup(spec);
  mount();
  click(`[data-span="${B}"]`);
  click('#b1-hint');
  click('#b1-hint');
  click('#b1-hint');
  assert.equal(counts.hints, 3);
  assert.equal(label(B), 'POST, storefront, SERVER, UNSET, 10 to 90 ms, trace 4bf92f35, root, not right yet', 'the hint set the kind; the status is still UNSET');
  assert.equal(status(), 'POST (storefront) is now SERVER, but not quite. POST (storefront): check the status. Only an operation that failed is ERROR. It stays here; move it when you are ready.');
  assert.equal(tone(), 'neutral', 'a move the hint made is information, not an error');
  assert.deepEqual([counts.mistakes, counts.done], [0, 0], 'no mistake charged, and the board is not done');
});

test('status and links in Check mode with no helps: edits are free, Check grades them', () => {
  const spec = { ...b1Spec(), edit: ['status', 'links'], answer: { [E]: { status: 'ERROR', links: [B] } } };
  const { counts, mount } = setup(spec);
  mount();
  click(`[data-span="${E}"]`);
  click('[data-status="ERROR"]');
  assert.equal(status(), 'GET /products (storefront) now has status ERROR.');
  click(`[data-link="${A}"]`);
  click(`[data-link="${B}"]`);
  click('#b1-check');
  assert.equal(counts.mistakes, 1);
  assert.deepEqual(qa('#b1-feedback li').map((li) => li.dataset.code), ['extra-link']);
  click(`[data-link="${A}"]`);
  click('#b1-check');
  assert.equal(counts.done, 1);
});

// ---- findings of the review of c7f2f6c (#146) ---------------------------------------------
test('stars are this board only: a penalty on an earlier step is not counted, the board\'s own wrong drop is', () => {
  const clean = setup(withHelps(ALL));
  clean.counts.mistakes = 1; // a slip on an earlier step of the level (the level's own stars would be 4)
  clean.mount();
  assert.equal(q('#b1-stars').getAttribute('aria-label'), '5 of 5 stars still possible');
  solveQueue();
  assert.equal(q('#b1-win-stars').textContent, '5 of 5 stars: 0 wrong drops, 0 hints.');
  assert.equal(q('#b1-stars').getAttribute('aria-label'), '5 of 5 stars');
  assert.deepEqual(qa('#b1-stars [data-star]').map((s) => s.dataset.star), ['earned', 'earned', 'earned', 'earned', 'earned']);
  assert.equal(q('aside[aria-label="Result, score and hints"]').textContent.includes('Stars count this board only'), true);

  const slip = setup(withHelps(ALL));
  slip.counts.mistakes = 1;
  slip.mount();
  drag(B, 'root');
  assert.equal(q('#b1-stars').getAttribute('aria-label'), '4 of 5 stars still possible');
  click('#b1-hint');
  assert.equal(q('#b1-hint-cost').textContent, 'costs 1 star', 'the hint cost is read from the board too');
  drag(B, A);
  drag(C, B);
  drag(D, C);
  drag(E, 'root');
  assert.equal(q('#b1-win-stars').textContent, '3 of 5 stars: 1 wrong drop, 1 hint.');
});

test('Check mode: the board\'s stars count its own failed Checks, not the level\'s', () => {
  const { counts, mount } = setup(withHelps(CHECK));
  counts.mistakes = 2;
  mount();
  assert.equal(q('#b1-stars').getAttribute('aria-label'), '5 of 5 stars still possible');
  click('#b1-check');
  assert.equal(q('#b1-stars').getAttribute('aria-label'), '4 of 5 stars still possible');
});

test('pick path on the rows: pick a span, then click its parent row; the same span again cancels', () => {
  const { counts, focus, mount } = setup(withHelps({ ...ALL, queue: false }));
  mount();
  click(`[data-span="${B}"]`);
  assert.equal(q(`[data-span="${B}"]`).getAttribute('aria-pressed'), 'true');
  click(`[data-span="${A}"]`);
  assert.equal(status(), 'POST (storefront) sits under POST /checkout (storefront). Right.');
  assert.equal(label(B).endsWith('parent POST /checkout (storefront), right'), true);
  assert.equal(q(`[data-span="${B}"]`).getAttribute('aria-pressed'), 'false');
  assert.equal(counts.mistakes, 0);
  assert.equal(focus.last(), `span:${B}`);
  click(`[data-span="${C}"]`);
  click(`[data-span="${C}"]`);
  assert.equal(status(), 'Cancelled.');
  assert.equal(q(`[data-span="${C}"]`).getAttribute('aria-pressed'), 'false');
  assert.equal(label(C).endsWith('root'), true, 'nothing moved');
  click(`[data-span="${C}"]`);
  click(`[data-span="${E}"]`);
  assert.equal(counts.mistakes, 1, 'a wrong parent row costs like a wrong drop');
  assert.equal(status().startsWith('POST /checkout (api-gateway) sits under GET /products (storefront), but not quite.'), true);
});

test('pick path on the rows: a descendant row is refused as a loop, free; the root zone makes a root; Escape cancels', () => {
  const { counts, mount } = setup(withHelps({ ...ALL, queue: false }));
  mount();
  pick(B, A);
  pick(C, B);
  click(`[data-span="${B}"]`);
  click(`[data-span="${C}"]`);
  assert.equal(status(), 'POST /checkout (api-gateway) is already below POST (storefront), so that would make a loop.');
  assert.equal(counts.mistakes, 0);
  assert.equal(label(B).endsWith('parent POST /checkout (storefront), right'), true, 'nothing changed');
  click(`[data-span="${E}"]`);
  click('[data-drop="root"]');
  assert.equal(status(), 'GET /products (storefront) is already a root.');
  click(`[data-span="${C}"]`);
  click('[data-drop="root"]');
  assert.equal(status().startsWith('POST /checkout (api-gateway) is a root, but not quite.'), true);
  assert.equal(counts.mistakes, 1);
  click(`[data-span="${E}"]`);
  q('[data-build="b1"]').onkeydown({ key: 'Escape', preventDefault() {} });
  click(`[data-span="${A}"]`);
  assert.equal(q(`[data-span="${E}"]`).getAttribute('aria-pressed'), 'false', 'a row click after Escape picks, it does not move');
  assert.equal(label(E).endsWith('root'), true);
});

test('after a wrong graded move the span stays selected but not picked: the root zone moves nothing', () => {
  const { counts, mount } = setup(withHelps({ ...ALL, queue: false }));
  mount();
  click(`[data-span="${C}"]`);
  click(`[data-span="${E}"]`);
  assert.equal(counts.mistakes, 1, 'a wrong parent row');
  const before = [label(C), status()];
  click('[data-drop="root"]');
  assert.deepEqual([label(C), status(), counts.mistakes], [...before, 1], 'no move, no cost');
});

test('pick path on the rows with the queue: the arriving span is not a parent yet', () => {
  const { counts, mount } = setup(withHelps(ALL));
  mount();
  click(`[data-span="${A}"]`);
  click(`[data-span="${B}"]`);
  assert.deepEqual([arriving(), counts.mistakes], [[B], 0], 'nothing moved, nothing paid');
  assert.equal(label(A).endsWith('root'), true);
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
  assert.equal(fbHead('b1'), 'Not yet: 3 problems.');
  click(`[data-link="${B}"]`);
  click(`[data-link="${B}"]`);
  click('#b1-check');
  assert.equal(counts.mistakes, 1, 'links {B, C} added as C then B are the same graded state');
  assert.equal(fbHead('b1'), 'Same as last time: 3 problems.');
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
  assert.equal(fbHead('l1'), 'Same as last time: 1 problem.');
});

// ---- markup hygiene, escaping, errors -------------------------------------------------

test('no Alpine, style= or on*= attributes and no em dash, before, during and after play', () => {
  const { dom, mount } = setup(withHelps(ALL));
  const seen = [dom.body.innerHTML];
  mount();
  drag(B, 'root');
  seen.push(dom.body.innerHTML);
  q(`[data-span="${B}"]`).ondragstart(ev());
  seen.push(dom.body.innerHTML);
  q(`[data-span="${B}"]`).ondragend(ev());
  click('#b1-hint');
  click('#b1-hint');
  seen.push(dom.body.innerHTML);
  drag(B, A);
  drag(C, B);
  drag(D, C);
  drag(E, 'root');
  seen.push(dom.body.innerHTML);
  assert.equal(seen.length, 5);
  for (const html of seen) assert.equal(cleanMarkup(html), true);
});

test('data text is escaped everywhere: rows, bars, panel, notes and problems', () => {
  const spec = withHelps(CHECK);
  spec.spans[0].name = '<img src=x>POST & "go"';
  spec.spans[0].service = '<b>store</b>';
  const { counts, mount } = setup(spec);
  mount();
  pick(B, A);
  q(`[data-span="${A}"]`).ondragstart(ev());
  q(`[data-drop="${B}"]`).ondrop(ev()); // a refused loop, through a drop: the panel disables it
  const hostile = () => qa('img').length + qa('b').filter((b) => b.textContent === 'store').length;
  assert.equal(hostile(), 0, 'no element came from data text');
  assert.equal(label(A).startsWith('<img src=x>POST & "go", <b>store</b>, SERVER'), true);
  assert.equal(status(), 'POST (storefront) is already below <img src=x>POST & "go" (<b>store</b>), so that would make a loop.');
  click('#b1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(hostile(), 0);
});

test('an invalid spec or helps, a missing render, or a missing onComplete is a TypeError naming the id', () => {
  const bad = b1Spec();
  bad.spans[0].kind = 'server';
  assert.throws(() => setup(bad).mount(), (err) => err instanceof TypeError && err.message.startsWith('build "b1": invalid spec:') && err.message.includes('kind "server"'));
  assert.throws(() => setup(withHelps({ queue: 'yes' })).mount(), { name: 'TypeError', message: /helps: "queue" is not true or false/ });
  const { ctx, mount: unrendered } = setup();
  ctx.ovBody.innerHTML = '';
  assert.throws(() => unrendered(), { name: 'TypeError', message: /^build "b1": not rendered/ });
  assert.throws(() => setup().mount({ onComplete: undefined }), { name: 'TypeError', message: /onComplete/ });
});

test('every focus target could take focus', () => {
  const { focus, mount } = setup(withHelps({ ...ALL, queue: false }));
  mount();
  pick(B, 'none');
  click('#b1-hint');
  pick(B, A);
  pick(C, B);
  pick(D, C);
  assert.equal(focus.names().length > 6, true);
  assert.deepEqual(focus.unfocusable(), []);
});

// ---- styles ----------------------------------------------------------------------------

test('styles: tokens only; services and traces from tokens.css; the selected bar outlined; ERROR a stroke; no focus ring on the success heading', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  // The .wf-* rules live in widgets.css; the side column is the kit's (kit.css, #158).
  const css = strip(['kit.css', 'widgets.css'].map((f) => readFileSync(join(root, 'styles', f), 'utf8')).join('\n'));
  const tokens = strip(readFileSync(join(root, 'styles', 'tokens.css'), 'utf8'));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sels: sel.split(',').map((s) => s.trim()), body: body.replace(/\s+/g, ' ') }));
  const bodyOf = (sel) => rules.filter((r) => r.sels.includes(sel)).map((r) => r.body).join(';');
  for (let i = 0; i < 6; i++) {
    assert.equal(new RegExp(`--color-svc-${i}:\\s*light-dark\\(`).test(tokens), true, `--color-svc-${i}`);
    assert.equal(/fill:\s*var\(--color-svc-\d\)/.test(bodyOf(`.wf-row[data-svc="${i}"] .wf-bar`)), true, `bar fill for service ${i}`);
  }
  for (const t of [0, 1]) assert.equal(new RegExp(`--color-trace-${t}:\\s*light-dark\\(`).test(tokens), true, `--color-trace-${t}`);
  assert.equal(/stroke:\s*var\(--color-error\)/.test(bodyOf('.wf-row[data-error="true"] .wf-bar')), true, 'ERROR is a stroke, not the fill');
  assert.equal(/outline|stroke/.test(bodyOf('.wf-row[aria-pressed="true"] .wf-bar')), true, 'the selected bar is outlined');
  assert.equal(/outline:\s*none/.test(bodyOf('.ui-win-title:focus')), true);
  const mine = rules.filter((r) => r.sels.some((s) => /\.(wf|ui)-/.test(s))).map((r) => r.body).join(' ');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|oklch\(/.test(mine), false, 'tokens only, so both themes follow');
});

// ---- logs mode (#113): fixture L1 (test/fixtures/build-logs.mjs) -----------------------
// Axis: min -40, max 100, range 140. Rows: S1, S2, S3 (trace 4bf9, from 0) then S4 (trace 0af7, from 30).

const LOG_IDS = ['l-boot', 'l-cart', 'l-other', 'l-charge', 'l-worker'];
const logLines = () => qa('[data-log]').map((b) => b.textContent);
const logIds = () => qa('[data-log]').map((b) => b.dataset.log);
const lstatus = () => q('#l1-status').textContent;
const lfeedback = () => q('#l1-feedback').textContent;
const ticks = () => qa('[data-log-tick]').map((l) => `${l.closest('[data-span]').dataset.span}@${l.getAttribute('x')}`);
const cursors = () => [...new Set(qa('[data-cursor]').map((l) => l.getAttribute('x1')))];
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

test('V1 logs mode: a log stream of data-log buttons, one row per span, no drag, no root zone', () => {
  setup(logsSpec());
  assert.deepEqual(logIds(), LOG_IDS, 'spec order');
  assert.deepEqual(logLines(), [
    '-40 ms · INFO · checkout · trace_id=(none) · span_id=(none) · Application started · thread.name=main',
    '30 ms · DEBUG · checkout · trace_id=(none) · span_id=(none) · Cart validated · order.id=8841',
    '60 ms · INFO · checkout · trace_id=(none) · span_id=(none) · Order accepted · order.id=8842',
    '70 ms · INFO · payments · trace_id=(none) · span_id=(none) · Charge submitted · thread.name=http-exec-1',
    '75 ms · ERROR · payments · trace_id=(none) · span_id=(none) · Retry worker gave up on charge · thread.name=retry-worker-2',
  ]);
  assert.deepEqual(placedIds(), [S1, S2, S3, S4], 'one row per span, never one per record');
  assert.deepEqual(qa('[data-bar]').map((b) => `${b.getAttribute('x')} ${b.getAttribute('width')}`), ['28.57% 71.43%', '42.86% 14.29%', '64.29% 28.57%', '50% 35.71%'], 'the record times widen the axis');
  assert.deepEqual([qa('[data-drop]').length, qa('[draggable="true"]').length, qa('[data-parent]').length], [0, 0, 0]);
  assert.equal(q('#l1-instr').textContent, 'Pick a record, then the span it was written in, or No span context.');
  assert.equal(q('[data-build-panel]').textContent, 'Pick a record to attach it, or a span to see its records.');
});

test('V1 selecting a record presses it and offers "No span context" first, then every span in row order', () => {
  const { counts, mount } = setup(logsSpec());
  mount();
  click('[data-log="l-worker"]');
  assert.deepEqual(qa('[data-log]').map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false', 'true']);
  assert.equal(q('[data-build-panel] [data-panel-title="log"]').textContent, 'Span context for "Retry worker gave up on charge" (payments, 75 ms)');
  assert.deepEqual(qa('[data-attach]').map((b) => b.textContent), [
    'No span context',
    'POST /checkout (checkout) · 0–100 ms',
    'validate cart (checkout) · 20–40 ms',
    'POST /charge (payments) · 50–90 ms',
    'POST /checkout (checkout) · 30–80 ms',
  ]);
  assert.equal(counts.mistakes, 0, 'selecting is free');
});

test('V2 attaching fills in the record ids, ticks the record time on the span row and counts its records', () => {
  const { counts, mount } = setup(logsSpec());
  mount();
  attach('l-other', S4);
  assert.equal(logLines()[2], `60 ms · INFO · checkout · trace_id=${T2} · span_id=${S4} · Order accepted · order.id=8842`);
  assert.deepEqual(ticks(), [`${S4}@71.43%`]);
  assert.equal(label(S4).endsWith(', 1 record'), true);
  assert.equal(lstatus(), `"Order accepted" now carries span_id=${S4} and trace_id=${T2} from POST /checkout (checkout).`);
  attach('l-boot', S1);
  assert.deepEqual(ticks(), [`${S1}@0%`, `${S4}@71.43%`], 'a time outside the bar hangs off it');
  attach('l-boot', 'none');
  assert.equal(lstatus(), '"Application started" now has no span context: trace_id=(none) and span_id=(none).');
  assert.equal(counts.mistakes, 0, 'attaching and detaching are free');
});

test('V3 the cursor marks the selected record time across the waterfall and only then', () => {
  const { mount } = setup(logsSpec());
  mount();
  assert.deepEqual(cursors(), []);
  click('[data-log="l-cart"]');
  assert.deepEqual(cursors(), ['50%']);
  assert.equal(qa('[data-cursor]').length, 4, 'one per row');
  click(`[data-span="${S3}"]`);
  assert.deepEqual(cursors(), [], 'a span selection has no cursor');
});

test('V5 penalties: a failing Check costs one with a specific note per record, the same records again is free', () => {
  const { counts, mount } = setup(logsSpec());
  mount();
  attach('l-cart', S2);
  click('#l1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(fbHead('l1'), 'Not yet: 2 problems.');
  assert.deepEqual(qa('#l1-feedback li').map((li) => li.dataset.code), ['log-not-attached', 'log-not-attached']);
  assert.equal(qa('#l1-feedback li')[0].textContent.startsWith('"Order accepted" (checkout, 60 ms) has no span context yet'), true);
  click('#l1-check');
  assert.equal(counts.mistakes, 1);
  assert.equal(fbHead('l1'), 'Same as last time: 2 problems.');
  attach('l-other', S3);
  click('#l1-check');
  assert.equal(counts.mistakes, 2, 'a changed record is a new state');
  assert.equal(q('#l1-wrong-label').textContent, 'failed Checks');
});

test('V6 a passing Check says every record checks out with the explain, shows the success card and locks the attach controls', () => {
  const spec = { ...logsSpec(), explain: 'The worker thread is not the request <b>thread</b>.' };
  const { focus, counts, mount } = setup(spec);
  mount();
  solveLogs();
  click('#l1-check');
  assert.deepEqual([counts.mistakes, counts.hints, counts.done, counts.swirls.length], [0, 0, 1, 1]);
  assert.equal(lfeedback(), 'Right. Every record checks out. The worker thread is not the request thread.');
  assert.equal(q('#l1-win-title').textContent, 'Every record checks out');
  assert.equal(focus.last(), '#l1-win-title');
  click('[data-log="l-cart"]');
  assert.deepEqual(qa('[data-attach]').map((b) => b.disabled), [true, true, true, true, true]);
  click(`[data-span="${S3}"]`);
  assert.equal(qa('[data-show-log]').length, 1, 'inspecting still works');
});

test('V7 the reverse view: a span shows its attributes read-only and the records carrying its span_id', () => {
  const { mount } = setup(logsSpec());
  mount();
  click(`[data-span="${S3}"]`);
  assert.equal(q('[data-build-panel] [data-panel-title="span"]').textContent, `POST /charge (payments), trace 4bf92f35, span_id ${S3}`);
  assert.deepEqual(qa('[data-build-panel] li').map((li) => li.textContent), ['thread.name=http-exec-1']);
  attach('l-charge', S3);
  click(`[data-span="${S3}"]`);
  click('[data-show-log="l-charge"]');
  assert.equal(q('[data-log="l-charge"]').getAttribute('aria-pressed'), 'true');
  assert.equal(q(`[data-attach="${S3}"]`).getAttribute('aria-pressed'), 'true');
});

test('V8 logs-mode hints: three tiers per record, each one ctx.hint(); the authored hint is tier 1; tier 3 attaches it', () => {
  const { counts, mount } = setup({ ...logsSpec(), hint: 'Compare the <code>thread.name</code>.' });
  mount();
  click('[data-log="l-charge"]');
  click('#l1-hint');
  assert.equal(q('#l1-hint-text').textContent.includes('Compare the thread.name.'), true);
  click('#l1-hint');
  assert.deepEqual(qa('[data-hint-cand="true"]').map((r) => r.dataset.span), [S3], 'no other payments span: the decoy is No span context');
  click('#l1-hint');
  assert.deepEqual([counts.hints, counts.mistakes], [3, 0]);
  assert.equal(logLines()[3].includes(`span_id=${S3}`), true);
  assert.equal(q('#l1-hint-text').textContent.includes('Set for you. POST /charge (payments) was the current span'), true);
});

test('V9 focus: the first record on mount, the first control after a pick, the attach button after an attach', () => {
  const { focus, mount } = setup(logsSpec());
  mount();
  assert.equal(focus.last(), 'log:l-boot');
  click('[data-log="l-cart"]');
  assert.equal(focus.last(), 'attach:none');
  click(`[data-attach="${S2}"]`);
  assert.equal(focus.last(), `attach:${S2}`);
  click(`[data-span="${S3}"]`);
  assert.equal(focus.last(), 'panel-title:span');
  click('#l1-check');
  assert.equal(focus.last(), '#l1-feedback');
  assert.deepEqual(focus.unfocusable(), []);
});

test('V10 logs mode escapes data text and keeps clean markup in every state', () => {
  const spec = logsSpec();
  spec.logs[1].body = '<img src=x>Cart & "ok"';
  spec.spans[1].name = '<s>cart</s>';
  const { dom, mount } = setup({ ...spec, hint: 'Look.' });
  mount();
  const seen = [dom.body.innerHTML];
  attach('l-cart', S2);
  click('#l1-hint');
  click('#l1-check');
  seen.push(dom.body.innerHTML);
  assert.equal(qa('img, s').length, 0);
  assert.equal(logLines()[1].includes('<img src=x>Cart & "ok"'), true);
  for (const html of seen) {
    assert.equal(cleanMarkup(html), true);
    assert.equal(/0{16}/.test(html), false, 'zero ids');
  }
});

test('setParent stays the one transition: the view never writes a parent itself, and there is no second grader', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'widgets', 'build-it-view.mjs'), 'utf8');
  assert.equal(/\.parentId\s*=(?!=)/.test(src), false);
  assert.equal(/checkLogRecords|function checkBuild/.test(src), false, 'no second grader');
  const st = newBuildState(b1Spec());
  assert.equal(setParent(b1Spec(), st, B, A), 'set');
});
