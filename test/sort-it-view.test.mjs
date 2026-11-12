// lib/widgets/sort-it-view.mjs on the kit (#156 P3a): the Sort it view model (sortView), its
// markup (a wide split: the board, then the kit side column with the score card and the
// success card), the mount (penalties, the drop path, the shuffled pool, focus). Spec:
// docs/M1-DESIGN.md §4.1; the P3a RED spec S1-S10. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { decls, read, rules } from './helpers/css.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newSortState, place } from '../lib/widgets/sort-it.mjs';
import { mountSort, quoted, renderSort, sortView } from '../lib/widgets/sort-it-view.mjs';
import { withGuide } from './helpers/guide-ctx.mjs';

// The core's fixture: i1 -> metric, i2 -> log, i3 -> trace, i4 -> metric.
function fixture() {
  return {
    id: 'signals',
    buckets: [
      { id: 'metric', label: 'Metric' },
      { id: 'log', label: 'Log' },
      { id: 'trace', label: 'Trace' },
    ],
    items: [
      { id: 'i1', label: 'Request rate', bucket: 'metric', why: 'A number over time.' },
      { id: 'i2', label: 'Stack trace text', bucket: 'log', why: 'A timestamped record.', whyNot: { metric: 'Not a number.' } },
      { id: 'i3', label: 'Checkout call tree', bucket: 'trace', why: 'Spans with parents.' },
      { id: 'i4', label: 'Queue depth', bucket: 'metric', why: 'A gauge.' },
    ],
  };
}

/** A ctx.shuffle that reverses (never the authored order) and counts its calls. */
function reversing() {
  const calls = [];
  const shuffle = (a) => {
    calls.push(a.length);
    return [...a].reverse();
  };
  return { shuffle, calls };
}

/**
 * A counting stub ctx on a fresh DOM with the widget rendered; `finish` is onComplete's target.
 * `shuffle` is ctx.shuffle (identity unless a test needs another order: the tests below select
 * items by id). The swirl is injected and records the `reduced` flag of each call.
 */
function setup(spec = fixture(), { shuffle = (a) => [...a], ...opts } = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, hints: 0, done: 0 };
  const swirls = [];
  const ctx = {
    ovBody: dom.body,
    ovActions: dom.actions,
    escapeHtml,
    signal: new AbortController().signal,
    shuffle,
    mistake() {
      counts.mistakes += 1;
    },
    hint() {
      counts.hints += 1;
    },
  };
  const fresh = spec ?? fixture();
  dom.body.innerHTML = renderSort(fresh, newSortState(fresh), { selected: null, escapeHtml, ...opts });
  dom.actions.innerHTML = '<button id="finish" disabled>Finish</button>';
  const onComplete = () => {
    counts.done += 1;
    const fin = dom.actions.querySelector('#finish');
    fin.disabled = false;
    return fin;
  };
  const swirl = (host, o) => {
    swirls.push(o.reduced);
  };
  const mount = (extra = {}) => mountSort(ctx, spec, { onComplete, swirl, ...extra });
  return { ctx, dom, focus, counts, swirls, mount };
}

const items = () => qa('[data-item]').map((b) => b.dataset.item);
const enabledBuckets = () => qa('[data-bucket]').filter((b) => !b.disabled).map((b) => b.dataset.bucket);
const pressed = (id) => q(`[data-item="${id}"]`).getAttribute('aria-pressed');
const feedback = () => q('#signals-feedback [data-feedback-text]').textContent;
const tone = () => q('#signals-feedback').getAttribute('data-tone');
const placed = (bucket) => q(`[data-bucket-list="${bucket}"]`).textContent;
const text = (sel) => q(sel).textContent.replace(/\s+/g, ' ').trim();
/** The "Sorted N of M" line, read from the widget's text (dt/dd or one line), normalised. */
function sorted() {
  const m = q('[data-sort]').textContent.replace(/\s+/g, ' ').match(/Sorted\s*(\d+) of (\d+)/);
  return m ? `Sorted ${m[1]} of ${m[2]}` : null;
}
const sortTo = (item, bucket) => {
  click(`[data-item="${item}"]`);
  click(`[data-bucket="${bucket}"]`);
};
const ids = (list) => list.map((x) => (typeof x === 'string' ? x : x.id));

/** Drag `item` (null: drag nothing of ours) onto `bucket`'s drop zone; true if dragover allowed the drop. */
function drop(item, bucket) {
  const data = {};
  const dataTransfer = { setData: (k, v) => { data[k] = String(v); }, getData: (k) => data[k] ?? '' };
  if (item !== null) q(`[data-item="${item}"]`).ondragstart({ dataTransfer });
  const zone = q(`[data-drop="${bucket}"]`);
  let allowed = false;
  zone.ondragover({ preventDefault: () => { allowed = true; }, dataTransfer });
  zone.ondrop({ preventDefault() {}, dataTransfer });
  return allowed;
}

const ALPINE = /\s(?:x-[\w.:-]+|@[\w.:-]+|:[\w.:-]+)=/;
// test/design-system.test.mjs RETIRED: classes the kit replaced; the Sort it markup emits none.
const RETIRED = [
  'back-btn', 'btn', 'bubble', 'build', 'build-btn', 'build-editing', 'build-group-title', 'build-layout',
  'build-log', 'build-logs', 'build-main', 'build-opt', 'build-pick', 'build-status', 'choice', 'choices', 'configure-inactive',
  'configure-input', 'configure-label', 'configure-more', 'configure-note', 'env-editor', 'env-issues', 'env-label', 'env-note',
  'feedback', 'ghost', 'good', 'help-btn', 'help-chip', 'help-chips', 'help-chips-title', 'help-cost', 'help-count',
  'help-counts', 'help-h', 'help-hint-head', 'help-hint-row', 'help-hint-text', 'help-pips', 'help-rule',
  'help-score', 'help-side', 'help-star', 'help-stars', 'help-swirl', 'help-tier', 'help-win', 'help-win-closing',
  'help-win-stars', 'help-win-text', 'help-win-title', 'info', 'lesson-intro', 'lesson-stage', 'primary', 'q',
  'query-data', 'query-input', 'query-label', 'query-note', 'show', 'small', 'sort-bucket-btn', 'sort-hint',
  'sort-item', 'speech', 'spot-line', 'tradeoff-keeps', 'tradeoff-option',
];
const INSTR = 'Pick one to sort.';

// ---- S1, S2 sortView: the board as data -------------------------------------------------

test('S0 category targets are kit drop options in an equal-width drops row, enabled or not; items are not', () => {
  const spec = fixture();
  makeDom(`<div data-sort>${renderSort(spec, newSortState(spec))}</div>`);
  const targets = qa('[data-bucket]');
  assert.equal(targets.length, spec.buckets.length);
  for (const b of targets) assert.ok(b.classList.contains('ui-option--drop'), b.dataset.bucket);
  assert.ok(q('.ui-options--drops [data-bucket]'));
  for (const it of qa('[data-item]')) assert.equal(it.classList.contains('ui-option--drop'), false);
});

test('S1 sortView: the pool is the remaining items in display order, the buckets in spec order with their placed items; placed plus left is total', () => {
  const spec = fixture();
  let { state } = place(spec, newSortState(spec), 'i1', 'metric');
  ({ state } = place(spec, state, 'i2', 'metric'));
  // The display order is deliberately not the spec order, so a pool built from spec.items fails.
  const v = sortView(spec, state, { order: ['i3', 'i1', 'i4', 'i2'], selected: 'i2' });
  assert.deepEqual(ids(v.pool), ['i3', 'i4', 'i2'], 'remaining items, in display order');
  assert.deepEqual(v.pool.filter((p) => p.pressed).map((p) => p.id), ['i2'], 'only the selected item is pressed');
  assert.deepEqual(v.buckets.map((b) => b.id), ['metric', 'log', 'trace'], 'buckets in spec order');
  assert.deepEqual(v.buckets.map((b) => b.enabled), [false, true, true], 'i2 already tried metric');
  assert.deepEqual(ids(v.buckets[0].placed), ['i1']);
  assert.deepEqual(ids(v.buckets[1].placed), []);
  assert.deepEqual(ids(v.buckets[2].placed), []);
  assert.equal(v.left, 3);
  assert.equal(v.total, 4);
  assert.equal(v.done, false);
  assert.equal(v.buckets.reduce((n, b) => n + b.placed.length, 0) + v.left, v.total, 'placed plus left is total');
});

test('S2 sortView: with no selection, or once done, no bucket is enabled', () => {
  const spec = fixture();
  const order = ['i3', 'i1', 'i4', 'i2'];
  const fresh = sortView(spec, newSortState(spec), { order, selected: null });
  assert.deepEqual(fresh.buckets.map((b) => b.enabled), [false, false, false], 'nothing selected');
  assert.deepEqual(fresh.pool.map((p) => p.pressed), [false, false, false, false]);
  assert.equal(fresh.left, 4);
  let state = newSortState(spec);
  for (const it of spec.items) ({ state } = place(spec, state, it.id, it.bucket));
  const done = sortView(spec, state, { order, selected: 'i1' });
  assert.deepEqual(done.buckets.map((b) => b.enabled), [false, false, false], 'done');
  assert.deepEqual(ids(done.pool), []);
  assert.equal(done.left, 0);
  assert.equal(done.done, true);
  assert.deepEqual(done.buckets.map((b) => ids(b.placed)), [['i1', 'i4'], ['i2'], ['i3']]);
});

// ---- S3 kit markup ------------------------------------------------------------------------

test('S3 renderSort: kit markup in one split; the side column with a hidden success card and zeroed score; toggle items; categories as choice buttons and plain groups; no retired class', () => {
  const { mount } = setup();
  assert.equal(qa('.ui-split').length, 1, 'one board-and-side split');
  assert.equal(qa('.ui-split-side [id="signals-win"]').length, 1, 'the success card is in the side column');
  assert.equal(q('#signals-win').hasAttribute('hidden'), true, 'hidden until success');
  assert.equal(q('#signals-wrong').textContent, '0');
  assert.equal(q('#signals-hints').textContent, '0');
  assert.deepEqual(items(), ['i1', 'i2', 'i3', 'i4']);
  for (const b of qa('[data-item]')) {
    assert.equal(b.localName, 'button', b.dataset.item);
    assert.equal(b.classList.contains('ui-option--toggle'), true, `${b.dataset.item} is a kit toggle option`);
    assert.equal(b.getAttribute('aria-pressed'), 'false', b.dataset.item);
  }
  const group = q('[data-item="i1"]').closest('[role="group"]');
  assert.ok(group, 'the items are in a group');
  assert.equal(Boolean(group.getAttribute('aria-label') || group.getAttribute('aria-labelledby')), true, 'the group is named');
  const describedBy = () => q('[data-item="i1"]').closest('[role="group"]').getAttribute('aria-describedby');
  assert.equal(describedBy(), 'signals-instr', 'the group is described by the instruction');
  mount();
  sortTo('i2', 'log');
  assert.equal(describedBy(), 'signals-instr', 'still after a placement');
  setup();
  assert.deepEqual(qa('[data-bucket]').map((b) => b.dataset.bucket), ['metric', 'log', 'trace']);
  assert.deepEqual(qa('[data-bucket]').map((b) => b.textContent.trim()), ['Metric', 'Log', 'Trace']);
  // #261: no boxes. The choice buttons are a plain row; each category is a plain group with a tally heading.
  for (const b of qa('[data-bucket]')) {
    assert.equal(b.closest('[data-drop]') === null, true, `${b.dataset.bucket} is a choice button, not inside a drop zone`);
    assert.equal(b.classList.contains('ui-option--choice'), true, `${b.dataset.bucket} is a kit choice option`);
  }
  assert.equal(qa('.ui-panel--drop, .sort-buckets').length, 0, 'no drop panel and no bucket grid');
  assert.deepEqual(qa('[data-drop]').map((g) => g.dataset.drop), ['metric', 'log', 'trace']);
  for (const g of qa('[data-drop]')) {
    assert.equal(g.classList.contains('ui-panel'), false, 'a group is not a panel');
    assert.equal(g.querySelector('[data-bucket-list]').dataset.bucketList, g.dataset.drop, 'its list sits in its group');
  }
  assert.deepEqual(qa('.sort-group-title').map((t) => t.textContent.replace(/\s+/g, ' ').trim()), ['Metric (0)', 'Log (0)', 'Trace (0)']);
  assert.deepEqual(enabledBuckets(), [], 'nothing selected: every bucket is disabled');
  assert.deepEqual(qa('[data-bucket-list]').map((l) => `${l.getAttribute('data-bucket-list')}:${l.textContent}`), ['metric:', 'log:', 'trace:']);
  assert.equal(qa('[id="signals-instr"]').length, 1, 'one instruction line');
  assert.equal(q('#signals-instr').innerHTML, INSTR, 'plain text');
  assert.equal(q('#signals-instr').hasAttribute('aria-live'), false, 'not live');
  assert.equal(qa('[id="signals-feedback"]').length, 1);
  const fb = q('#signals-feedback');
  assert.equal(fb.classList.contains('ui-feedback'), true, 'the kit feedback region');
  assert.equal(fb.hasAttribute('hidden'), true, 'hidden until something happens');
  assert.equal(fb.getAttribute('role'), 'status');
  const hint = qa('[id="signals-hint"]');
  assert.equal(hint.length <= 1, true, 'the instruction no longer takes the side column\'s #<id>-hint');
  if (hint.length) assert.equal(hint[0].localName, 'button', '#signals-hint is the hint button');
  assert.equal(sorted(), 'Sorted 0 of 4');
  const classes = qa('[data-sort], [data-sort] *').flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean);
  assert.deepEqual(classes.filter((c) => RETIRED.includes(c)), [], 'no retired class');
});

test('S3 the instruction id follows the spec id', () => {
  makeDom();
  const spec = { ...fixture(), id: 'other-sort' };
  globalThis.document.body.innerHTML = renderSort(spec, newSortState(spec), { selected: null, escapeHtml });
  assert.equal(q('#other-sort-instr').textContent, INSTR);
  assert.equal(qa('#signals-instr').length, 0);
});

test('S3 renderSort: the selected item is pressed and only its untried categories are enabled; placed items move to their group', () => {
  const spec = fixture();
  let { state } = place(spec, newSortState(spec), 'i1', 'metric');
  ({ state } = place(spec, state, 'i2', 'metric'));
  makeDom();
  globalThis.document.body.innerHTML = renderSort(spec, state, { selected: 'i2', escapeHtml });
  assert.deepEqual(items(), ['i2', 'i3', 'i4'], 'a placed item leaves the pool');
  assert.equal(pressed('i2'), 'true');
  assert.equal(pressed('i3'), 'false');
  assert.deepEqual(enabledBuckets(), ['log', 'trace']);
  assert.equal(placed('metric'), 'Request rate');
  assert.equal(placed('log'), '');
  assert.equal(text('[data-drop="metric"] .sort-group-title'), 'Metric (1)', 'the tally follows the placed items');
  assert.equal(sorted(), 'Sorted 1 of 4');
});

test('each group heading tallies its own category, not the board', () => {
  const spec = fixture();
  let { state } = place(spec, newSortState(spec), 'i1', 'metric');
  ({ state } = place(spec, state, 'i4', 'metric'));
  ({ state } = place(spec, state, 'i3', 'trace'));
  makeDom();
  globalThis.document.body.innerHTML = renderSort(spec, state, { selected: null, escapeHtml });
  assert.deepEqual(qa('.sort-group-title').map((t) => t.textContent.replace(/\s+/g, ' ').trim()), ['Metric (2)', 'Log (0)', 'Trace (1)']);
});

test('renderSort: labels are trusted HTML, labelledBy makes [data-sort] a group, a bad labelledBy is a TypeError', () => {
  const spec = fixture();
  spec.items[0].label = '<code>http.server.request.count</code>';
  makeDom();
  globalThis.document.body.innerHTML = renderSort(spec, newSortState(spec), { selected: null, escapeHtml, labelledBy: 'sort-q' });
  assert.equal(q('[data-item="i1"] code') === null, false, 'label markup is kept');
  assert.equal(q('[data-sort]').getAttribute('data-sort'), 'signals');
  assert.equal(q('[data-sort]').getAttribute('role'), 'group');
  assert.equal(q('[data-sort]').getAttribute('aria-labelledby'), 'sort-q');
  globalThis.document.body.innerHTML = renderSort(spec, newSortState(spec), { selected: null, escapeHtml });
  assert.equal(q('[data-sort]').hasAttribute('aria-labelledby'), false, 'no labelledBy, no label');
  for (const bad of ['', 'a"b', 'two words']) {
    assert.throws(() => renderSort(spec, newSortState(spec), { selected: null, escapeHtml, labelledBy: bad }), { name: 'TypeError', message: /labelledBy/ }, JSON.stringify(bad));
  }
});

test('no Alpine attributes, no style= and no on*= attributes, before and during play', () => {
  const { dom, mount } = setup();
  const check = (when) => {
    const html = dom.body.innerHTML;
    assert.equal(ALPINE.test(html), false, `${when}: Alpine attribute`);
    assert.equal(/\sstyle=/.test(html), false, `${when}: style=`);
    assert.equal(/\son\w+=/.test(html), false, `${when}: on*=`);
  };
  check('rendered');
  mount();
  click('[data-item="i2"]');
  check('selected');
  click('[data-bucket="metric"]');
  check('wrong');
  click('[data-bucket="log"]');
  check('right');
});

// ---- S4 the pool is shuffled once per mount ----------------------------------------------

test('S4 the pool is shuffled once through ctx.shuffle and keeps that order through a wrong try and a right placement', () => {
  const r = reversing();
  const { focus, mount } = setup(fixture(), { shuffle: r.shuffle });
  mount();
  assert.deepEqual(items(), ['i4', 'i3', 'i2', 'i1'], 'the shuffled order, not the authored one');
  assert.equal(focus.last(), 'item:i4', 'focus starts on the first item shown');
  sortTo('i2', 'metric'); // wrong
  assert.deepEqual(items(), ['i4', 'i3', 'i2', 'i1']);
  click('[data-bucket="log"]'); // right
  assert.deepEqual(items(), ['i4', 'i3', 'i1'], 'still reversed, minus the placed item');
  assert.equal(focus.last(), 'item:i1', 'focus goes to the next item as shown, not in spec order');
  sortTo('i3', 'trace');
  assert.deepEqual(items(), ['i4', 'i1']);
  assert.equal(r.calls.length, 1, 'shuffled exactly once; redraws never reshuffle');
});

// ---- S5-S7 penalties and feedback --------------------------------------------------------

test('mounting focuses the first item and changes nothing else', () => {
  const { focus, counts, swirls, mount } = setup();
  mount();
  assert.equal(focus.last(), 'item:i1');
  assert.deepEqual(qa('[data-item]').map((b) => b.getAttribute('draggable')), ['true', 'true', 'true', 'true'], 'the mount makes items draggable');
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 0 });
  assert.deepEqual(swirls, []);
  assert.equal(q('#signals-feedback').hasAttribute('hidden'), true);
  assert.deepEqual(enabledBuckets(), []);
  assert.equal(q('#signals-win').hasAttribute('hidden'), true);
});

test('choosing an item presses it and enables its buckets', () => {
  const { focus, mount } = setup();
  mount();
  click('[data-item="i2"]');
  assert.equal(pressed('i2'), 'true');
  assert.equal(pressed('i1'), 'false');
  assert.deepEqual(enabledBuckets(), ['metric', 'log', 'trace']);
  assert.equal(focus.last(), 'bucket:metric');
});

test('S5 a wrong placement costs one mistake, is an error, counts on the score card, says so without the answer, and disables that bucket', () => {
  const { counts, mount } = setup();
  mount();
  sortTo('i2', 'metric');
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#signals-wrong').textContent, '1');
  assert.equal(q('#signals-stars').getAttribute('aria-label'), '4 of 5 stars still possible');
  assert.equal(tone(), 'error', 'a wrong answer is an error (D7), not information');
  assert.equal(q('#signals-feedback').hasAttribute('hidden'), false);
  assert.equal(feedback(), 'Not quite. "Stack trace text" does not go in "Metric". Not a number.');
  assert.equal(feedback().includes('Log'), false, 'the right bucket is not named');
  assert.equal(pressed('i2'), 'true', 'the item stays selected');
  assert.deepEqual(enabledBuckets(), ['log', 'trace']);
  assert.equal(placed('metric'), '');
  assert.equal(sorted(), 'Sorted 0 of 4');
  sortTo('i1', 'log');
  assert.equal(counts.mistakes, 2);
  assert.equal(q('#signals-wrong').textContent, '2');
  assert.equal(feedback(), 'Not quite. "Request rate" does not go in "Log".', 'no whyNot, no extra text');
  assert.equal(feedback().includes('Metric'), false, 'the right bucket is not revealed');
});

test('S6 a repeated drop on a tried bucket is free and neutral', () => {
  const { counts, mount } = setup();
  mount();
  assert.equal(drop('i2', 'metric'), true, 'dragover allows the drop');
  assert.equal(counts.mistakes, 1);
  drop('i2', 'metric');
  assert.equal(counts.mistakes, 1, 'repeating a tried bucket is free');
  assert.equal(q('#signals-wrong').textContent, '1');
  assert.equal(tone(), 'neutral');
  assert.equal(feedback(), 'You already tried "Metric" for "Stack trace text".');
});

test('S7 then the right placement costs nothing, is a success, says why, lists the item in its bucket and counts it sorted', () => {
  const { counts, mount } = setup();
  mount();
  sortTo('i2', 'metric');
  click('[data-bucket="log"]');
  assert.equal(counts.mistakes, 1);
  assert.equal(tone(), 'success');
  assert.equal(feedback(), 'Right. "Stack trace text" goes in "Log". A timestamped record.');
  assert.equal(placed('log').includes('Stack trace text'), true);
  assert.equal(sorted(), 'Sorted 1 of 4');
  assert.deepEqual(items(), ['i1', 'i3', 'i4']);
  assert.deepEqual(enabledBuckets(), [], 'nothing is selected after a right placement');
  assert.equal(counts.done, 0);
  assert.equal(q('#signals-win').hasAttribute('hidden'), true);
  sortTo('i4', 'metric');
  assert.equal(sorted(), 'Sorted 2 of 4');
});

test('choosing a different item re-enables the buckets the first one tried', () => {
  const { mount } = setup();
  mount();
  sortTo('i2', 'metric');
  click('[data-item="i1"]');
  assert.equal(pressed('i1'), 'true');
  assert.equal(pressed('i2'), 'false');
  assert.deepEqual(enabledBuckets(), ['metric', 'log', 'trace']);
  click('[data-item="i2"]');
  assert.deepEqual(enabledBuckets(), ['log', 'trace'], 'and i2 still remembers its try');
});

test('two wrongs on different items cost two mistakes', () => {
  const { counts, mount } = setup();
  mount();
  sortTo('i2', 'metric');
  sortTo('i3', 'log');
  assert.equal(counts.mistakes, 2);
  assert.equal(q('#signals-wrong').textContent, '2');
});

// ---- S8 completion -----------------------------------------------------------------------

test('S8 completion: onComplete once, the success card shown and focused, the swirl once, and nothing after done', () => {
  const { counts, focus, swirls, mount } = setup();
  mount();
  sortTo('i1', 'metric');
  sortTo('i2', 'log');
  sortTo('i3', 'trace');
  assert.equal(counts.done, 0);
  sortTo('i4', 'log');
  assert.equal(counts.done, 0, 'a wrong last try does not complete');
  click('[data-bucket="metric"]');
  assert.equal(counts.done, 1);
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Right. "Queue depth" goes in "Metric". A gauge.');
  assert.deepEqual(items(), []);
  assert.equal(q('#signals-win').hasAttribute('hidden'), false, 'the success card is shown');
  assert.equal(text('#signals-win-stars'), '4 of 5 stars: 1 wrong placement, 0 hints.');
  assert.equal(focus.last(), '#signals-win-title');
  assert.deepEqual(swirls, [false], 'the swirl plays once, motion allowed');
  assert.equal(q('#finish').disabled, false);
  assert.equal(sorted(), 'Sorted 4 of 4');
  drop(null, 'trace');
  for (const b of qa('[data-bucket]')) b.onclick?.({});
  assert.equal(counts.done, 1, 'nothing after completion calls it again');
  assert.equal(counts.mistakes, 1);
  assert.deepEqual(swirls, [false]);
  assert.equal(feedback(), 'Right. "Queue depth" goes in "Metric". A gauge.', 'nothing after done says anything');
  assert.equal(focus.last(), '#signals-win-title');
});

test('the focus sequence: item, bucket, next untried bucket, next item, the success heading', () => {
  const { focus, mount } = setup();
  mount();
  sortTo('i2', 'metric'); // wrong
  click('[data-bucket="log"]'); // right
  sortTo('i3', 'trace');
  sortTo('i4', 'metric');
  sortTo('i1', 'metric');
  assert.deepEqual(focus.names(), [
    'item:i1',
    'bucket:metric', 'bucket:log', 'item:i3',
    'bucket:metric', 'item:i4',
    'bucket:metric', 'item:i1',
    'bucket:metric', '#signals-win-title',
  ]);
  assert.deepEqual(focus.unfocusable(), [], 'focused only enabled, connected elements');
});

test('after a wrong try focus wraps to the next untried bucket', () => {
  const { focus, mount } = setup();
  mount();
  sortTo('i1', 'trace');
  assert.equal(focus.last(), 'bucket:metric', 'from the last bucket it wraps to the first');
  click('[data-bucket="log"]');
  assert.equal(focus.last(), 'bucket:metric');
});

test('the drop path is the click path: a wrong drop costs a mistake, a right drop places', () => {
  const { counts, mount } = setup();
  mount();
  assert.equal(drop('i2', 'metric'), true, 'dragover allows the drop');
  assert.equal(counts.mistakes, 1);
  assert.equal(tone(), 'error');
  assert.equal(feedback(), 'Not quite. "Stack trace text" does not go in "Metric". Not a number.');
  assert.equal(pressed('i2'), 'true', 'the dropped item becomes the selection');
  assert.deepEqual(enabledBuckets(), ['log', 'trace']);
  drop('i2', 'log');
  assert.equal(counts.mistakes, 1);
  assert.equal(tone(), 'success');
  assert.equal(feedback(), 'Right. "Stack trace text" goes in "Log". A timestamped record.');
  assert.equal(placed('log'), 'Stack trace text');
  drop(null, 'trace');
  assert.equal(counts.mistakes, 1, 'an empty drop costs nothing');
  assert.equal(feedback(), 'Pick one to sort first.', 'the finished drag was cleared');
});

test('dropping an item on an enabled category button takes the click path; a disabled one is not a drop target', () => {
  const { counts, mount } = setup();
  mount();
  const data = {};
  const dataTransfer = { setData: (k, v) => { data[k] = String(v); }, getData: (k) => data[k] ?? '' };
  const dropOnButton = (item, bucket) => {
    q(`[data-item="${item}"]`).ondragstart({ dataTransfer });
    const btn = q(`[data-bucket="${bucket}"]`);
    let allowed = false;
    btn.ondragover({ preventDefault: () => { allowed = true; } });
    btn.ondrop({ preventDefault() {} });
    return allowed;
  };
  click('[data-item="i2"]');
  assert.equal(dropOnButton('i2', 'metric'), true, 'dragover allows the drop');
  assert.equal(counts.mistakes, 1, 'a wrong drop costs a mistake');
  assert.equal(q('[data-bucket="metric"]').disabled, true);
  assert.equal(q('[data-bucket="metric"]').ondrop, null, 'a tried category is no drop target');
  click('[data-item="i2"]');
  dropOnButton('i2', 'log');
  assert.equal(placed('log'), 'Stack trace text');
  assert.equal(counts.mistakes, 1);
});

test('a bucket with nothing selected costs nothing, is neutral and asks to pick one first', () => {
  const { counts, focus, mount } = setup();
  mount();
  drop(null, 'metric');
  assert.equal(counts.mistakes, 0);
  assert.equal(q('#signals-wrong').textContent, '0');
  assert.equal(tone(), 'neutral');
  assert.equal(feedback(), 'Pick one to sort first.');
  assert.equal(focus.last(), 'item:i1');
  assert.deepEqual(items(), ['i1', 'i2', 'i3', 'i4']);
});

test('a disabled bucket ignores a click that gets through anyway', () => {
  const { counts, mount } = setup();
  mount();
  q('[data-bucket="metric"]').onclick({});
  assert.equal(q('#signals-feedback').hasAttribute('hidden'), true, 'nothing selected, nothing said');
  sortTo('i2', 'metric');
  q('[data-bucket="metric"]').onclick({});
  assert.equal(counts.mistakes, 1);
});

test('the success heading takes focus whatever onComplete returns', () => {
  for (const [name, target] of [['nothing', () => undefined], ['disabled', () => q('#finish')], ['enabled', () => {
    q('#finish').disabled = false;
    return q('#finish');
  }]]) {
    const { focus, mount } = setup();
    mount({ onComplete: target });
    sortTo('i1', 'metric');
    sortTo('i2', 'log');
    sortTo('i3', 'trace');
    sortTo('i4', 'metric');
    assert.equal(focus.last(), '#signals-win-title', name);
    assert.deepEqual(focus.unfocusable(), [], name);
  }
});

// ---- S9 no answer in the markup ----------------------------------------------------------

test('S9 no item carries its answer: no attribute of a [data-item] equals its bucket id, before and during play', () => {
  const spec = fixture();
  const answer = Object.fromEntries(spec.items.map((it) => [it.id, it.bucket]));
  const { mount } = setup(spec);
  const check = (when) => {
    for (const b of qa('[data-item]')) {
      const leaks = [...b.getAttributeNames()].filter((n) => b.getAttribute(n) === answer[b.dataset.item]);
      assert.deepEqual(leaks, [], `${when}: ${b.dataset.item}`);
    }
  };
  check('rendered');
  mount();
  check('mounted');
  sortTo('i2', 'metric');
  check('after a wrong try');
});

// ---- the mount's contract ----------------------------------------------------------------

test('an invalid spec is a TypeError naming the id and its problems, and nothing is wired', () => {
  const spec = fixture();
  spec.items[0].bucket = 'span';
  spec.items[1].why = '';
  const { counts, mount } = setup(spec);
  assert.throws(() => mount(), (err) => err instanceof TypeError
    && err.message.startsWith('sort "signals":')
    && err.message.includes('unknown bucket "span"')
    && err.message.includes('why is not non-empty text'));
  assert.equal(typeof q('[data-item="i1"]').onclick, 'object');
  assert.equal(counts.mistakes, 0);
  const { mount: bad } = setup(null);
  assert.throws(() => bad(), { name: 'TypeError', message: /^sort "undefined":/ });
});

test('mountSort refuses a spec that is not rendered, or a missing onComplete', () => {
  const { ctx, mount } = setup();
  ctx.ovBody.innerHTML = '';
  assert.throws(() => mount(), { name: 'TypeError', message: /^sort "signals": not rendered/ });
  const { mount: again } = setup();
  assert.throws(() => again({ onComplete: undefined }), { name: 'TypeError', message: /onComplete/ });
});

test('whyNot is read for its own keys only: a "constructor" bucket never shows Object\'s function', () => {
  const spec = fixture();
  spec.buckets[2] = { id: 'constructor', label: 'Constructor' };
  spec.items[2].bucket = 'constructor';
  const { counts, mount } = setup(spec);
  mount();
  sortTo('i2', 'constructor'); // i2 has a partial whyNot ({metric}); none for constructor
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Not quite. "Stack trace text" does not go in "Constructor".');
  assert.equal(feedback().includes('function'), false);
  assert.equal(feedback().includes('native code'), false);
});

test('long labels wrap: kit options and feedback break anywhere; placed items cap their width (widgets.css); base.css has no Sort rule left', () => {
  const body = (file, sel) => rules(read(file)).filter((r) => r.selector.split(',').map((s) => s.trim()).includes(sel))
    .flatMap((r) => decls(r.body)).map(([k, v]) => `${k}:${v}`);
  for (const [file, sel, cap] of [['styles/kit.css', '.ui-option', true], ['styles/kit.css', '.ui-feedback', false], ['styles/widgets.css', '.sort-placed li', true]]) {
    const d = body(file, sel);
    assert.equal(d.some((x) => /^overflow-wrap:\s*anywhere$/.test(x)), true, `${file} ${sel} overflow-wrap: anywhere`);
    if (cap) assert.equal(d.some((x) => /^max-width:\s*100%$/.test(x)), true, `${file} ${sel} max-width: 100%`);
  }
  const base = rules(read('styles/base.css')).map((r) => r.selector).filter((s) => /\.sort[-\w]*/.test(s));
  assert.deepEqual(base, [], 'the retired base.css Sort rules are gone');
});

test('lib/widgets uses no timers (I2)', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'widgets');
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  assert.equal(files.includes('sort-it-view.mjs'), true);
  for (const f of files) {
    const hits = readFileSync(join(dir, f), 'utf8').match(/\b(?:setTimeout|setInterval|requestAnimationFrame)\b/g) ?? [];
    assert.deepEqual(hits, [], f);
  }
});

// ---- the help ladder on the board (#156) ------------------------------------------

const withHints = (extra = {}) => ({ ...fixture(), helps: { hints: true }, ...extra });
const hintedBuckets = () => qa('[data-bucket][data-hinted]').map((b) => b.dataset.bucket);
const chips = () => text('#signals-helps');
const hintText = () => q('#signals-hint-text').innerHTML;
const hintLabel = () => text('#signals-hint');
const tierLine = () => text('#signals-hint-tier');

test('three hint tiers on i2: three hints and no mistake, two outlined candidates at tier 2, then i2 placed in Log and the outlines gone', () => {
  const { counts, mount } = setup(withHints());
  mount();
  click('[data-item="i2"]');
  click('#signals-hint'); // tier 1: the rule
  assert.deepEqual(counts, { mistakes: 0, hints: 1, done: 0 });
  assert.equal(q('#signals-hints').textContent, '1');
  assert.deepEqual(hintedBuckets(), [], 'tier 1 outlines nothing');
  assert.equal(pressed('i2'), 'true');
  click('#signals-hint'); // tier 2: identity shuffle, decoy metric, listed metric then log
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 });
  assert.equal(q('#signals-hints').textContent, '2');
  assert.deepEqual(hintedBuckets(), ['metric', 'log'], 'exactly the two candidates, in spec order');
  assert.equal(pressed('i2'), 'true', 'the hinted item stays selected');
  assert.deepEqual(enabledBuckets(), ['metric', 'log', 'trace'], 'a hint tries nothing');
  click('#signals-hint'); // tier 3: placed for you
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 0 }, 'a placed hint costs a hint, never a mistake');
  assert.equal(q('#signals-hints').textContent, '3');
  assert.equal(q('#signals-wrong').textContent, '0');
  assert.equal(placed('log'), 'Stack trace text');
  assert.equal(feedback(), 'Placed for you.', 'a hint placement is not earned: no "Right."');
  assert.equal(tone(), 'neutral');
  assert.equal(hintText().includes('Placed for you. "Stack trace text" goes in <b>Log</b>. A timestamped record.'), true,
    'the hint panel says where and why');
  assert.deepEqual(items(), ['i1', 'i3', 'i4']);
  assert.deepEqual(hintedBuckets(), [], 'the outlines clear once the item is placed');
  assert.equal(sorted(), 'Sorted 1 of 4');
});

test('the outlines clear when the player places the item after tier 2', () => {
  const { counts, mount } = setup(withHints());
  mount();
  click('[data-item="i2"]');
  click('#signals-hint');
  click('#signals-hint');
  assert.deepEqual(hintedBuckets(), ['metric', 'log']);
  click('[data-bucket="log"]');
  assert.equal(placed('log'), 'Stack trace text');
  assert.deepEqual(hintedBuckets(), []);
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 });
});

test('tier 3 on the last remaining item completes the board once; the win line counts the hints', () => {
  const { counts, swirls, mount } = setup(withHints());
  mount();
  sortTo('i1', 'metric');
  sortTo('i2', 'log');
  sortTo('i3', 'trace');
  click('[data-item="i4"]');
  click('#signals-hint');
  click('#signals-hint');
  assert.equal(counts.done, 0);
  click('#signals-hint');
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 1 });
  assert.equal(placed('metric'), 'Request rateQueue depth');
  assert.equal(q('#signals-win').hasAttribute('hidden'), false, 'the success card is shown');
  assert.equal(text('#signals-win-stars'), '2 of 5 stars: 0 wrong placements, 3 hints.');
  assert.deepEqual(swirls, [false]);
  assert.equal(q('#finish').disabled, false);
  assert.equal(q('#signals-hint').disabled, true);
  q('#signals-hint').onclick?.({});
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 1 }, 'nothing after done');
});

test('the Hint button: tier and cost before use; with nothing selected it picks the first item shown; disabled with nothing to hint after done', () => {
  const r = reversing();
  const { counts, mount } = setup(withHints(), { shuffle: r.shuffle });
  mount();
  assert.equal(chips(), 'Helps: Instant feedback on Hints on');
  assert.equal(text('#signals-hint'), 'Hint 1 of 3');
  assert.equal(q('#signals-hint').disabled, false);
  assert.equal(text('#signals-hint-cost'), 'costs 1 penalty');
  click('#signals-hint'); // nothing selected: the target is the first item SHOWN (i4, reversed), not i1
  assert.equal(pressed('i4'), 'true');
  assert.equal(pressed('i1'), 'false');
  assert.equal(text('#signals-hint'), 'Hint 2 of 3');
  assert.deepEqual(counts, { mistakes: 0, hints: 1, done: 0 });
  // Finish the board by hand: the button is disabled and says there is nothing to hint.
  sortTo('i4', 'metric');
  sortTo('i3', 'trace');
  sortTo('i2', 'log');
  sortTo('i1', 'metric');
  assert.equal(counts.done, 1);
  assert.equal(q('#signals-hint').disabled, true);
  assert.equal(text('#signals-hint-tier'), 'Nothing to hint right now.');
  q('#signals-hint').onclick?.({});
  assert.deepEqual(counts, { mistakes: 0, hints: 1, done: 1 }, 'a click that gets through anyway costs nothing');
});

test('hints off (and no helps key): no Hint button, the tier line says so, the chips say hints off', () => {
  for (const spec of [{ ...fixture(), helps: { hints: false } }, fixture()]) {
    const { counts, mount } = setup(spec);
    mount();
    assert.equal(qa('[id="signals-hint"]').length, 0, JSON.stringify(spec.helps));
    assert.equal(text('#signals-hint-tier'), 'No hints on this level.');
    assert.equal(chips(), 'Helps: Instant feedback on Hints off');
    sortTo('i1', 'metric');
    assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 0 });
  }
});

// Two buckets: no item ever has three untried, so its ladder is the rule and the placement.
function pairFixture() {
  return {
    id: 'signals',
    helps: { hints: true },
    buckets: [
      { id: 'metric', label: 'Metric' },
      { id: 'log', label: 'Log' },
    ],
    items: [
      { id: 'i1', label: 'Request rate', bucket: 'metric', why: 'A number over time.' },
      { id: 'i2', label: 'Stack trace text', bucket: 'log', why: 'A timestamped record.' },
    ],
  };
}

test('the rule is charged once per board: after the rule on i2, Hint on i1 gives its tier 2, not the rule again', () => {
  const { counts, mount } = setup(withHints());
  mount();
  click('[data-item="i2"]');
  assert.equal(hintLabel(), 'Hint 1 of 3');
  click('#signals-hint'); // the rule, for the board
  assert.equal(hintText().includes('Ask what this one actually is'), true, 'tier 1 is the rule');
  assert.deepEqual(counts, { mistakes: 0, hints: 1, done: 0 });
  click('[data-item="i1"]');
  assert.equal(hintLabel(), 'Hint 2 of 3', 'i1 starts with the rule already used');
  assert.equal(tierLine(), '1 of 3 hints used on this item');
  click('#signals-hint');
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 }, 'one click, one hint');
  assert.equal(q('#signals-hints').textContent, '2');
  assert.equal(hintText().includes('Ask what'), false, 'not the rule again');
  assert.equal(hintText().includes('It is one of these two'), true, 'tier 2 for i1');
  assert.deepEqual(hintedBuckets(), ['metric', 'log'], 'i1 outlined: Metric (right) and the identity-drawn decoy Log');
  assert.equal(hintLabel(), 'Hint 3 of 3');
});

test('a 2-bucket board: "Hint 1 of 2", then after the rule "Hint 2 of 2" places the item, for every item', () => {
  const { counts, mount } = setup(pairFixture());
  mount();
  click('[data-item="i1"]');
  assert.equal(hintLabel(), 'Hint 1 of 2', 'tier 2 cannot narrow two buckets: it is not offered');
  assert.equal(tierLine(), 'No hints used on this item yet');
  click('#signals-hint');
  assert.equal(hintLabel(), 'Hint 2 of 2');
  assert.equal(tierLine(), '1 of 2 hints used on this item');
  assert.deepEqual(hintedBuckets(), []);
  click('#signals-hint');
  assert.equal(placed('metric'), 'Request rate', 'the second hint places it');
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 });
  assert.equal(feedback(), 'Placed for you.');
  assert.equal(tone(), 'neutral');
  // i2 is the next target: the rule was already shown on this board.
  assert.equal(hintLabel(), 'Hint 2 of 2');
  assert.equal(tierLine(), '1 of 2 hints used on the next item');
  click('#signals-hint');
  assert.equal(placed('log'), 'Stack trace text');
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 1 });
});

test('a wrong try that leaves two untried drops tier 2 for that item: the next hint after the rule places it', () => {
  const { counts, mount } = setup(withHints());
  mount();
  sortTo('i2', 'metric'); // wrong: i2 has log and trace untried
  assert.equal(counts.mistakes, 1);
  assert.equal(hintLabel(), 'Hint 1 of 2');
  click('#signals-hint');
  assert.equal(hintLabel(), 'Hint 2 of 2');
  click('#signals-hint');
  assert.equal(placed('log'), 'Stack trace text');
  assert.deepEqual(counts, { mistakes: 1, hints: 2, done: 0 });
});

test('the outlines are per item: gone while another item is selected, back on reselecting; tier counts are per item', () => {
  const { counts, mount } = setup(withHints());
  mount();
  click('[data-item="i2"]');
  click('#signals-hint');
  click('#signals-hint'); // tier 2 on i2: metric and log
  assert.deepEqual(hintedBuckets(), ['metric', 'log']);
  assert.equal(tierLine(), '2 of 3 hints used on this item');
  click('[data-item="i1"]');
  assert.deepEqual(hintedBuckets(), [], 'i2\'s outlines are not i1\'s');
  assert.equal(hintLabel(), 'Hint 2 of 3', 'i1 has only the board-wide rule used');
  assert.equal(tierLine(), '1 of 3 hints used on this item');
  click('[data-item="i2"]');
  assert.deepEqual(hintedBuckets(), ['metric', 'log'], 'reselecting i2 redraws its outlines');
  assert.equal(hintLabel(), 'Hint 3 of 3');
  assert.equal(tierLine(), '2 of 3 hints used on this item');
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 }, 'selecting costs nothing');
  click('[data-bucket="metric"]'); // the decoy: wrong, two untried left, but the tier 2 given stays counted
  assert.deepEqual(counts, { mistakes: 1, hints: 2, done: 0 });
  assert.deepEqual(hintedBuckets(), ['log'], 'the tried decoy loses its outline; the right bucket keeps it');
  assert.equal(hintLabel(), 'Hint 3 of 3');
  assert.equal(tierLine(), '2 of 3 hints used on this item');
});

test('the tier-2 decoy is drawn through ctx.shuffle: a reversing draw picks Trace, not Metric', () => {
  // The first call shuffles the pool (kept in authored order here); later calls draw the decoy reversed.
  let calls = 0;
  const shuffle = (a) => (calls++ === 0 ? [...a] : [...a].reverse());
  const { counts, mount } = setup(withHints(), { shuffle });
  mount();
  assert.deepEqual(items(), ['i1', 'i2', 'i3', 'i4']);
  click('[data-item="i2"]');
  click('#signals-hint');
  click('#signals-hint'); // untried wrong for i2: metric, trace; reversed, the decoy is trace
  assert.deepEqual(hintedBuckets(), ['log', 'trace'], 'the decoy came from ctx.shuffle; listed in spec order');
  assert.equal(calls >= 2, true, 'ctx.shuffle drew the decoy');
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 });
});

test('the hint panel follows the hint target: each item\'s own tier-2 pair on reselect, else the rule once shown, else empty', () => {
  // Reversing on every call: the pool reads i4 i3 i2 i1, and each decoy is the LAST untried wrong
  // bucket, so i2 (-> log) gets Log or Trace while i1 (-> metric) gets Metric or Trace: distinct pairs.
  const r = reversing();
  const { counts, mount } = setup(withHints(), { shuffle: r.shuffle });
  mount();
  const pairOf = (html) => [...html.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.equal(hintText(), '', 'before any hint the panel is empty');
  click('[data-item="i3"]');
  assert.equal(hintText(), '', 'selecting an item before any hint leaves the panel empty: no free rule');
  click('[data-item="i2"]');
  click('#signals-hint'); // tier 1: the rule
  click('#signals-hint'); // tier 2 on i2
  assert.deepEqual(pairOf(hintText()), ['Log', 'Trace']);
  assert.deepEqual(hintedBuckets(), ['log', 'trace']);
  click('[data-item="i1"]');
  click('#signals-hint'); // tier 2 on i1 (the rule is board-wide)
  assert.deepEqual(pairOf(hintText()), ['Metric', 'Trace']);
  assert.deepEqual(hintedBuckets(), ['metric', 'trace']);
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 0 });
  click('[data-item="i2"]');
  assert.deepEqual(pairOf(hintText()), ['Log', 'Trace'], 'reselecting i2 shows i2\'s own pair, not i1\'s last hint');
  assert.equal(hintText().includes('Hint 2 of 3'), true, 'with its own eyebrow');
  assert.deepEqual(hintedBuckets(), ['log', 'trace'], 'the text and the outlines name the same pair');
  click('[data-item="i1"]');
  assert.deepEqual(pairOf(hintText()), ['Metric', 'Trace']);
  assert.deepEqual(hintedBuckets(), ['metric', 'trace']);
  click('[data-item="i3"]'); // no hint of its own, but the rule was paid for on this board
  assert.equal(hintText().includes('Ask what this one actually is'), true, 'the rule text stays');
  assert.equal(hintText().includes('Hint 1 of 3'), true);
  assert.deepEqual(pairOf(hintText()), [], 'no other item\'s pair');
  assert.deepEqual(hintedBuckets(), []);
  // A wrong try re-syncs too: i1's own hint, then placing i1 drops it and the next target shows the rule.
  sortTo('i1', 'trace');
  assert.deepEqual(pairOf(hintText()), ['Metric', 'Trace'], 'after a wrong try i1\'s own hint text stays');
  assert.deepEqual(hintedBuckets(), ['metric'], 'the tried decoy loses its outline');
  click('[data-bucket="metric"]');
  assert.equal(placed('metric'), 'Request rate');
  assert.equal(hintText().includes('Ask what this one actually is'), true, 'placed: the next target has no own hint, so the rule');
  assert.deepEqual(counts, { mistakes: 1, hints: 3, done: 0 }, 'syncing the panel never charges');
});

test('one untried bucket left: "No more hints", disabled, and a forced click charges nothing', () => {
  const { counts, mount } = setup(withHints());
  mount();
  sortTo('i2', 'metric');
  sortTo('i2', 'trace'); // i2 -> log: only the right bucket is left untried
  assert.deepEqual(counts, { mistakes: 2, hints: 0, done: 0 });
  assert.equal(pressed('i2'), 'true', 'i2 is still the hint target');
  assert.equal(hintLabel(), 'No more hints');
  assert.equal(q('#signals-hint').disabled, true);
  q('#signals-hint').onclick?.({});
  q('#signals-hint').disabled = false; // gets through anyway
  q('#signals-hint').onclick?.({});
  assert.deepEqual(counts, { mistakes: 2, hints: 0, done: 0 }, 'no hint charged');
  assert.equal(q('#signals-hints').textContent, '0');
  assert.equal(placed('log'), '', 'nothing placed for the player');
  assert.equal(hintText(), '', 'and nothing shown');
  // Another item still has its ladder.
  click('[data-item="i1"]');
  assert.equal(hintLabel(), 'Hint 1 of 3');
  assert.equal(q('#signals-hint').disabled, false);
});

test('the outlines follow the hint target: tier 2 on i1, then i2 placed by hand: nothing selected, i1 is the target again and its pair is outlined and shown', () => {
  const { counts, mount } = setup(withHints());
  mount();
  const pairOf = (html) => [...html.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(items(), ['i1', 'i2', 'i3', 'i4'], 'i1 is first in display order');
  click('[data-item="i1"]');
  click('#signals-hint'); // the rule
  click('#signals-hint'); // tier 2 on i1 (-> metric): identity decoy log, listed metric then log
  assert.deepEqual(hintedBuckets(), ['metric', 'log']);
  click('[data-item="i2"]');
  assert.deepEqual(hintedBuckets(), [], 'i2 is the target while selected: i1\'s outlines are not drawn');
  click('[data-bucket="log"]'); // i2 right, by hand
  assert.equal(placed('log'), 'Stack trace text');
  assert.deepEqual(items().map(pressed), ['false', 'false', 'false'], 'nothing is selected after a right placement');
  assert.equal(tierLine(), '2 of 3 hints used on the next item', 'the target fell back to i1, first remaining');
  assert.deepEqual(hintedBuckets(), ['metric', 'log'], 'i1\'s untried pair is outlined with nothing selected');
  assert.deepEqual(pairOf(hintText()), ['Metric', 'Log'], 'the panel names the same pair as the outlines');
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 });
});

test('item ids that are Object.prototype names ("constructor") mount with hints on and climb the whole ladder', () => {
  const spec = {
    id: 'signals',
    helps: { hints: true },
    buckets: [
      { id: 'metric', label: 'Metric' },
      { id: 'log', label: 'Log' },
      { id: 'trace', label: 'Trace' },
    ],
    items: [
      { id: 'constructor', label: 'Ctor item', bucket: 'log', why: 'A record.' },
      { id: 'i1', label: 'Request rate', bucket: 'metric', why: 'A number over time.' },
    ],
  };
  const { counts, mount } = setup(spec);
  mount(); // the target at mount is "constructor" (first shown): no own map entry yet
  assert.equal(hintLabel(), 'Hint 1 of 3');
  assert.equal(tierLine(), 'No hints used on the next item yet');
  assert.deepEqual(hintedBuckets(), []);
  assert.equal(hintText(), '');
  click('#signals-hint'); // the rule
  assert.equal(hintLabel(), 'Hint 2 of 3');
  assert.equal(tierLine(), '1 of 3 hints used on this item');
  click('#signals-hint'); // tier 2: untried wrong metric, trace; identity decoy metric
  assert.deepEqual(hintedBuckets(), ['metric', 'log']);
  assert.equal(hintLabel(), 'Hint 3 of 3');
  assert.equal(tierLine(), '2 of 3 hints used on this item');
  click('#signals-hint'); // tier 3: placed for you
  assert.equal(placed('log'), 'Ctor item');
  assert.equal(feedback(), 'Placed for you.');
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 0 });
  assert.deepEqual(items(), ['i1']);
  assert.equal(hintLabel(), 'Hint 2 of 3', 'i1 starts after the board-wide rule');
});

test('one bucket left with no hint taken: the side line says so, no dots, "No more hints" disabled', () => {
  const { counts, mount } = setup(withHints());
  mount();
  sortTo('i2', 'metric');
  sortTo('i2', 'trace'); // only log, the right bucket, is untried
  assert.equal(tierLine(), 'Only one place left for this item.');
  assert.equal(q('#signals-hint-tier').querySelectorAll('.ui-dots').length, 0, 'no dots');
  assert.equal(hintLabel(), 'No more hints');
  assert.equal(q('#signals-hint').disabled, true);
  assert.deepEqual(counts, { mistakes: 2, hints: 0, done: 0 });
  // Another item with its ladder intact shows the count and its dots again.
  click('[data-item="i1"]');
  assert.equal(tierLine(), 'No hints used on this item yet');
  assert.equal(q('#signals-hint-tier').querySelectorAll('.ui-dots i').length, 3);
});

test('after a tier 3 placement of a non-last item the panel keeps "Placed for you." until the next selection, then re-syncs', () => {
  const { mount } = setup(withHints());
  mount();
  click('[data-item="i2"]');
  click('#signals-hint');
  click('#signals-hint');
  click('#signals-hint'); // tier 3: i2 placed; i1 becomes the target
  assert.equal(placed('log'), 'Stack trace text');
  assert.equal(tierLine(), '1 of 3 hints used on the next item', 'the side line already follows i1');
  assert.equal(hintText().includes('Placed for you. "Stack trace text" goes in <b>Log</b>. A timestamped record.'), true,
    'the panel keeps the tier 3 text');
  assert.equal(hintText().includes('Ask what this one actually is'), false, 'not yet the rule for i1');
  click('[data-item="i3"]');
  assert.equal(hintText().includes('Placed for you.'), false, 'the next selection re-syncs the panel');
  assert.equal(hintText().includes('Ask what this one actually is'), true, 'i3 has no own hint: the rule');
  assert.equal(hintText().includes('Hint 1 of 3'), true);
});

test('Escape on a shown hint is handled, focuses the hint button and leaves the level open (#178)', () => {
  const { focus, mount } = setup(withHints());
  mount();
  click('[data-item="i2"]');
  click('#signals-hint');
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#signals-hint-text').onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), '#signals-hint');
});

test('Escape on the hint with no tier left (button spent) falls back to the untried bucket, and is handled (#178)', () => {
  const { focus, mount } = setup(withHints());
  mount();
  sortTo('i2', 'metric');
  sortTo('i2', 'trace');
  assert.equal(q('#signals-hint').disabled, true);
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#signals-hint-text').onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), 'bucket:log');
});

test('#17 P3 the success line counts a guide question as a hint, in the stars too', () => {
  const { ctx, counts, mount } = setup();
  withGuide(ctx);
  mount();
  ctx.askedGuide();
  assert.equal(text('#signals-hints'), '1');
  sortTo('i1', 'metric');
  sortTo('i2', 'log');
  sortTo('i3', 'trace');
  sortTo('i4', 'metric');
  assert.equal(counts.hints, 1);
  assert.equal(text('#signals-win-stars'), '4 of 5 stars: 0 wrong placements, 1 hint.');
});

// ---- #321 P1: feedback in view, readable wording, a finished board that looks finished -----------

import { breakable } from '../lib/widgets/sort-it-view.mjs';

function spyScroll() {
  const calls = [];
  q('#signals-feedback').scrollIntoView = (o) => calls.push(o);
  return calls;
}

test('#321 a placement scrolls its feedback into view by the least distance (the setFeedback seam, #331)', () => {
  const { mount } = setup();
  mount();
  const calls = spyScroll();
  sortTo('i2', 'metric');
  assert.deepEqual(calls, [{ block: 'nearest' }]);
  click('[data-bucket="log"]');
  assert.equal(calls.length, 2, 'a right placement reveals its note too');
});

test('#321 the feedback clears the page chrome when scrolled to, and the live region still announces', () => {
  const css = read('styles/kit.css');
  const rule = rules(css).find((r) => r.selector === '.ui-feedback' && r.body.includes('scroll-margin-block-end'));
  assert.ok(rule && 'scroll-margin-block-end' in Object.fromEntries(decls(rule.body)), 'scroll-margin on the kit feedback');
  makeDom(renderSort(fixture(), newSortState(fixture())));
  assert.equal(q('#signals-feedback').getAttribute('role'), 'status');
  assert.equal(q('#signals-feedback').getAttribute('aria-live'), 'polite');
});

test('#321 wording names the item and the category in quotes, so any text reads as a name', () => {
  const spec = fixture();
  spec.items[0].label = 'Is CPU on db-1 above 90%?';
  spec.buckets[0].label = 'New question';
  const { mount } = setup(spec);
  mount();
  sortTo('i1', 'log');
  assert.equal(feedback(), 'Not quite. "Is CPU on db-1 above 90%?" does not go in "Log".');
  click('[data-bucket="metric"]');
  assert.equal(feedback(), 'Right. "Is CPU on db-1 above 90%?" goes in "New question". A number over time.');
});

test('#321 the instructions use no level noun (no item, no category)', () => {
  makeDom(renderSort(fixture(), newSortState(fixture())));
  const lines = qa('.sort-instr').map((p) => p.textContent);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.equal(/\b(item|category)\b/i.test(line), false, line);
});

test('#321 the hint note never embeds the item text', () => {
  const spec = withHints();
  spec.items[0].label = 'Is CPU on db-1 above 90%?';
  const { mount } = setup(spec);
  mount();
  click('[data-item="i1"]');
  assert.equal(tierLine().includes('CPU'), false);
  assert.equal(tierLine().includes(':'), false);
});

test('#321 the hints count says "hint" for one, "hints" for none and many', () => {
  const { mount } = setup(withHints());
  mount();
  const label = () => text('#signals-hints-label');
  assert.equal(label(), 'hints');
  click('[data-item="i2"]');
  click('#signals-hint');
  assert.equal(label(), 'hint');
  click('#signals-hint');
  assert.equal(label(), 'hints');
});

test('#321 a finished board keeps no live controls: no instructions, no item band, no category buttons, results stay', () => {
  const { mount } = setup();
  mount();
  sortTo('i1', 'metric');
  sortTo('i2', 'log');
  sortTo('i3', 'trace');
  assert.ok(q('#signals-instr'), 'live board: instruction shown');
  sortTo('i4', 'metric');
  assert.equal(qa('.sort-instr').length, 0);
  assert.equal(qa('[data-bucket]').length, 0, 'no drop buttons');
  assert.equal(q('[data-region="pool"]').innerHTML, '', 'the band is empty so the stylesheet can drop it');
  assert.equal(text('[data-drop="metric"] .sort-group-title'), 'Metric (2)');
  assert.equal(placed('metric'), 'Request rateQueue depth');
});

test('#321 an empty item band takes no room, and the tally keeps its count on its own line', () => {
  const css = read('styles/widgets.css');
  const pick = (sel) => Object.fromEntries(decls(rules(css).find((r) => r.selector === sel)?.body ?? ''));
  assert.equal(pick('[data-sort] [data-region="pool"]:empty').display, 'none');
  assert.equal(pick('.sort-tally')['white-space'], 'nowrap');
  assert.equal(pick('.sort-tally').flex, 'none');
});

test('#321 breakable: code gets a soft break after . ( and _ only; text outside code and entities stay', () => {
  assert.equal(breakable("<code>tracer.startActiveSpan('charge')</code>"), "<code>tracer.<wbr>startActiveSpan(<wbr>'charge')</code>");
  assert.equal(breakable('<code>http.request.method</code>'), '<code>http.<wbr>request.<wbr>method</code>');
  assert.equal(breakable('<code>a_b</code> then x.y'), '<code>a_<wbr>b</code> then x.y');
  assert.equal(breakable('<code>a &lt; b</code>'), '<code>a &lt; b</code>');
  const spec = fixture();
  spec.items[0].label = '<code>http.request.method</code>';
  makeDom(renderSort(spec, newSortState(spec)));
  assert.equal(q('[data-item="i1"]').innerHTML.includes('http.<wbr>request.<wbr>method'), true, 'the pool renders it breakable');
  assert.equal(q('[data-item="i1"]').textContent.includes('http.request.method'), true, 'the text is unchanged');
});

// ---- #323 review ----------------------------------------------------------------------------

import { HOW_TO } from '../lib/how-to-play.mjs';
import { SORT_RULE } from '../lib/widgets/sort-it-help.mjs';

test('#323 after a placement focus does not scroll (the one reveal does); picking an item still scrolls to its buttons', () => {
  const { focus, mount } = setup();
  mount();
  click('[data-item="i2"]');
  assert.equal(focus.prevented().at(-1), true, 'select: a pick never jumps the page (#339)');
  click('[data-bucket="metric"]');
  assert.equal(focus.last(), 'bucket:log');
  assert.equal(focus.prevented().at(-1), true, 'wrong: no focus scroll');
  click('[data-bucket="log"]');
  assert.equal(focus.prevented().at(-1), true, 'right: no focus scroll');
});

test('#323 the guide, the rule and the instructions share one vocabulary, and no quote is curly', () => {
  assert.equal(/\b(item|category)\b/i.test(HOW_TO.sort.play[0]), false, HOW_TO.sort.play[0]);
  assert.equal(/\b(item|category)\b/i.test(SORT_RULE), false, SORT_RULE);
  const { mount } = setup();
  mount();
  sortTo('i2', 'metric');
  assert.equal(/[“”]/.test(feedback()), false, 'straight quotes only');
  assert.equal(feedback().includes('"Stack trace text"'), true);
});

test('#323 the hint note says which item it counts for', () => {
  const { mount } = setup(withHints());
  mount();
  assert.equal(tierLine(), 'No hints used on the next item yet');
  click('[data-item="i1"]');
  assert.equal(tierLine(), 'No hints used on this item yet');
});

test('#323 breakable adds soft breaks to text runs only, never inside a nested tag or its attributes', () => {
  assert.equal(
    breakable('<code><a href="https://x.io/a_b">x.y</a></code>'),
    '<code><a href="https://x.io/a_b">x.<wbr>y</a></code>',
  );
});

test('#323 the guide tells the player to pick the item again after a wrong placement', () => {
  assert.equal(HOW_TO.sort.play[1].endsWith('Pick it again and try another place.'), true);
});

test('#332 feedback never doubles or nests the quotes around an item or bucket', () => {
  assert.equal(quoted('Stack trace text'), '"Stack trace text"', 'plain text gets one pair');
  assert.equal(quoted('"Payment declined by provider"'), '"Payment declined by provider"', 'a label with its own quotes keeps them, no second pair');
  assert.equal(quoted('<code>{severity_text:"ERROR", body:"x"}</code>'), '<code>{severity_text:"ERROR", body:"x"}</code>', 'a lone code chip marks the name; the quotes inside it are not wrapped again');
  assert.equal(quoted('<code>a</code> in <code>b</code>'), '"<code>a</code> in <code>b</code>"', 'mixed text is still quoted');
});

test('#332 the feedback for a label that carries its own quotes has one pair', () => {
  const spec = fixture();
  spec.items[1].label = '"Payment declined by provider"';
  const { mount } = setup(spec);
  mount();
  sortTo('i2', 'metric');
  assert.equal(feedback(), 'Not quite. "Payment declined by provider" does not go in "Metric". Not a number.');
});

test('#339 picking an item and the prompt after it never scroll; a wrong placement and a right one do', () => {
  const { mount } = setup();
  mount();
  const calls = spyScroll();
  click('[data-item="i2"]');
  assert.deepEqual(calls, [], 'a pick does not scroll');
  click('[data-bucket="metric"]');
  assert.equal(calls.length, 1, 'a wrong placement scrolls');
  click('[data-bucket="log"]');
  assert.equal(calls.length, 2, 'a right one scrolls');
});

test('#339 Escape with an item picked clears the pick and is handled; with none it is left to the app', () => {
  const { mount } = setup();
  mount();
  const esc = () => {
    const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    q('[data-sort]').onkeydown(e);
    return e.defaultPrevented;
  };
  assert.equal(esc(), false, 'nothing picked');
  click('[data-item="i2"]');
  assert.equal(q('[data-item="i2"]').getAttribute('aria-pressed'), 'true');
  assert.equal(esc(), true);
  assert.equal(q('[data-item="i2"]').getAttribute('aria-pressed'), 'false');
});
