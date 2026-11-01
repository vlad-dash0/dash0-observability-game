// lib/widgets/sort-it-view.mjs: the Sort it view and mount (render, penalties, drop path,
// focus). Spec: docs/M1-DESIGN.md §4.1, §7 P2. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newSortState, place } from '../lib/widgets/sort-it.mjs';
import { mountSort, renderSort } from '../lib/widgets/sort-it-view.mjs';

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

/** A counting stub ctx on a fresh DOM with the widget rendered; `finish` is onComplete's target. */
function setup(spec = fixture(), opts = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, done: 0 };
  const ctx = {
    ovBody: dom.body,
    ovActions: dom.actions,
    escapeHtml,
    mistake() {
      counts.mistakes += 1;
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
  const mount = (extra = {}) => mountSort(ctx, spec, { onComplete, ...extra });
  return { ctx, dom, focus, counts, mount };
}

const items = () => qa('[data-item]').map((b) => b.dataset.item);
const enabledBuckets = () => qa('[data-bucket]').filter((b) => !b.disabled).map((b) => b.dataset.bucket);
const pressed = (id) => q(`[data-item="${id}"]`).getAttribute('aria-pressed');
const feedback = () => q('#signals-feedback').textContent;
const placed = (bucket) => q(`[data-bucket-list="${bucket}"]`).textContent;
const sortTo = (item, bucket) => {
  click(`[data-item="${item}"]`);
  click(`[data-bucket="${bucket}"]`);
};

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

test('renderSort: one draggable, unpressed button per item, one disabled button and list per bucket, a live feedback region', () => {
  setup();
  assert.deepEqual(items(), ['i1', 'i2', 'i3', 'i4']);
  assert.deepEqual(qa('[data-item]').map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false']);
  assert.deepEqual(qa('[data-item]').map((b) => b.getAttribute('draggable')), ['true', 'true', 'true', 'true']);
  assert.deepEqual(qa('[data-bucket]').map((b) => b.dataset.bucket), ['metric', 'log', 'trace']);
  assert.deepEqual(qa('[data-bucket]').map((b) => b.textContent), ['Metric', 'Log', 'Trace']);
  assert.deepEqual(enabledBuckets(), [], 'nothing selected: every bucket is disabled');
  assert.deepEqual(qa('[data-bucket-list]').map((l) => `${l.getAttribute('data-bucket-list')}:${l.textContent}`), ['metric:', 'log:', 'trace:']);
  assert.equal(qa('[data-drop]').length, 3);
  assert.equal(qa('[id="signals-feedback"]').length, 1);
  const fb = q('#signals-feedback');
  assert.equal(fb.getAttribute('role'), 'status');
  assert.equal(fb.getAttribute('aria-live'), 'polite');
  assert.equal(fb.getAttribute('tabindex'), '-1');
  assert.equal(fb.className, 'feedback');
  assert.equal(q('.sort').hasAttribute('role'), false, 'no labelledBy, no group');
});

const HINT = 'Drag each item into the right bucket, or pick an item and then a bucket.';

test('renderSort: one plain-text instruction line, not a live region, describes the item list, before and during play', () => {
  const { dom, mount } = setup();
  const check = (when) => {
    assert.equal(qa('#signals-hint').length, 1, `${when}: one hint`);
    assert.equal(q('#signals-hint').textContent, HINT, `${when}: text`);
    assert.equal(q('#signals-hint').innerHTML, HINT, `${when}: plain text, no markup`);
    assert.equal(q('#signals-hint').className, 'sort-hint', `${when}: class`);
    assert.equal(q('#signals-hint').hasAttribute('role'), false, `${when}: no role`);
    assert.equal(q('#signals-hint').hasAttribute('aria-live'), false, `${when}: not live`);
    assert.equal(q('.sort-pool').getAttribute('aria-describedby'), 'signals-hint', `${when}: pool described by the hint`);
  };
  check('rendered');
  mount();
  check('mounted');
  click(q('[data-item="i1"]'));
  check('item selected');
  click(q('[data-bucket="log"]'));
  check('after a wrong try');
  click(q('[data-item="i1"]'));
  click(q('[data-bucket="metric"]'));
  check('after a right placement');
  assert.equal(dom.body.querySelectorAll('[data-sort] > .sort-hint').length, 1, 'the hint sits outside the redrawn board');
});

test('renderSort: the hint id follows the spec id and is escaped', () => {
  makeDom();
  const spec = fixture();
  const html = renderSort({ ...spec, id: 'a"b' }, newSortState(spec), { selected: null, escapeHtml });
  globalThis.document.body.innerHTML = html;
  assert.equal(q('.sort-hint').id, 'a"b-hint');
  assert.equal(q('.sort-pool').getAttribute('aria-describedby'), 'a"b-hint');
});

test('renderSort: the selected item is pressed and only its untried buckets are enabled; placed items move to their list', () => {
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
});

test('renderSort: labels are trusted HTML, ids are escaped, labelledBy makes a group', () => {
  const spec = fixture();
  spec.items[0].label = '<code>http.server.request.count</code>';
  makeDom();
  const html = renderSort({ ...spec, id: 'a"b' }, newSortState(spec), { selected: null, escapeHtml, labelledBy: 'sort-q' });
  globalThis.document.body.innerHTML = html;
  assert.equal(q('[data-item="i1"] code') === null, false, 'label markup is kept');
  assert.equal(q('.sort').getAttribute('data-sort'), 'a"b', 'the id round-trips through an attribute');
  assert.equal(html.includes('data-sort="a"b"'), false);
  assert.equal(q('.sort').getAttribute('role'), 'group');
  assert.equal(q('.sort').getAttribute('aria-labelledby'), 'sort-q');
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

test('mounting focuses the first item and changes nothing else', () => {
  const { focus, counts, mount } = setup();
  mount();
  assert.equal(focus.last(), 'item:i1');
  assert.deepEqual(counts, { mistakes: 0, done: 0 });
  assert.equal(feedback(), '');
  assert.deepEqual(enabledBuckets(), []);
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

test('a wrong placement costs one mistake, says so without the answer, and disables that bucket', () => {
  const { counts, mount } = setup();
  mount();
  sortTo('i2', 'metric');
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Not quite. Stack trace text is not Metric. Not a number.');
  assert.equal(q('#signals-feedback').className, 'feedback info show');
  assert.equal(pressed('i2'), 'true', 'the item stays selected');
  assert.deepEqual(enabledBuckets(), ['log', 'trace']);
  assert.equal(placed('metric'), '');
  sortTo('i1', 'log');
  assert.equal(feedback(), 'Not quite. Request rate is not Log.', 'no whyNot, no extra text');
  assert.equal(feedback().includes('Metric'), false, 'the right bucket is not revealed');
});

test('then the right placement costs nothing, says why and lists the item in its bucket', () => {
  const { counts, mount } = setup();
  mount();
  sortTo('i2', 'metric');
  click('[data-bucket="log"]');
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Right. Stack trace text goes in Log. A timestamped record.');
  assert.equal(q('#signals-feedback').className, 'feedback good show');
  assert.equal(placed('log').includes('Stack trace text'), true);
  assert.deepEqual(items(), ['i1', 'i3', 'i4']);
  assert.deepEqual(enabledBuckets(), [], 'nothing is selected after a right placement');
  assert.equal(counts.done, 0);
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
});

test('onComplete is called once, only after the last right placement', () => {
  const { counts, mount } = setup();
  mount();
  sortTo('i1', 'metric');
  sortTo('i2', 'log');
  sortTo('i3', 'trace');
  assert.equal(counts.done, 0);
  sortTo('i4', 'log');
  assert.equal(counts.done, 0, 'a wrong last try does not complete');
  click('[data-bucket="metric"]');
  assert.equal(counts.done, 1);
  assert.equal(feedback(), 'Right. Queue depth goes in Metric. A gauge.');
  assert.deepEqual(items(), []);
  drop(null, 'trace');
  assert.equal(counts.done, 1, 'nothing after completion calls it again');
  assert.equal(counts.mistakes, 1);
});

test('the focus sequence: item, bucket, next untried bucket, next item, onComplete target', () => {
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
    'bucket:metric', '#finish',
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
  assert.equal(feedback(), 'Not quite. Stack trace text is not Metric. Not a number.');
  assert.equal(pressed('i2'), 'true', 'the dropped item becomes the selection');
  assert.deepEqual(enabledBuckets(), ['log', 'trace']);
  drop('i2', 'metric');
  assert.equal(counts.mistakes, 1, 'repeating a tried bucket is free');
  drop('i2', 'log');
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Right. Stack trace text goes in Log. A timestamped record.');
  assert.equal(placed('log'), 'Stack trace text');
});

test('a bucket with nothing selected costs nothing and asks for an item first', () => {
  const { counts, focus, mount } = setup();
  mount();
  drop(null, 'metric');
  assert.equal(counts.mistakes, 0);
  assert.equal(feedback(), 'Pick an item first.');
  assert.equal(focus.last(), 'item:i1');
  assert.deepEqual(items(), ['i1', 'i2', 'i3', 'i4']);
});

test('a disabled bucket ignores a click that gets through anyway', () => {
  const { counts, mount } = setup();
  mount();
  q('[data-bucket="metric"]').onclick({});
  assert.equal(feedback(), '', 'nothing selected');
  sortTo('i2', 'metric');
  q('[data-bucket="metric"]').onclick({});
  assert.equal(counts.mistakes, 1);
});

test('onComplete returning nothing or an unfocusable element hands focus to the feedback', () => {
  for (const [name, target] of [['nothing', () => undefined], ['disabled', () => q('#finish')]]) {
    const { focus, mount } = setup();
    mount({ onComplete: target });
    sortTo('i1', 'metric');
    sortTo('i2', 'log');
    sortTo('i3', 'trace');
    sortTo('i4', 'metric');
    assert.equal(focus.last(), '#signals-feedback', name);
    assert.deepEqual(focus.unfocusable(), [], name);
  }
});

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
  assert.equal(feedback(), 'Not quite. Stack trace text is not Constructor.');
  assert.equal(feedback().includes('function'), false);
  assert.equal(feedback().includes('native code'), false);
});

test('long labels wrap: .sort-item, the bucket button and placed items cap their width; they and feedback break anywhere', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(join(root, 'styles', 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    sels: sel.split(',').map((s) => s.trim()),
    body: body.replace(/\s+/g, ' '),
  }));
  for (const sel of ['.sort-item', '.sort-bucket-btn', '.sort-placed li', '.feedback']) {
    const body = rules.filter((r) => r.sels.includes(sel)).map((r) => r.body).join(';');
    if (sel !== '.feedback') assert.equal(/max-width:\s*100%/.test(body), true, `${sel} max-width: 100%`);
    assert.equal(/overflow-wrap:\s*anywhere/.test(body), true, `${sel} overflow-wrap: anywhere`);
  }
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
