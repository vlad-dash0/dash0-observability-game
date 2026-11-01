// lib/widgets/spot-it-view.mjs: the Spot it view and mount (render, the one penalty, focus).
// Spec: docs/M1-DESIGN.md §4.4. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newSpotState } from '../lib/widgets/spot-it.mjs';
import { mountSpot, renderSpot } from '../lib/widgets/spot-it-view.mjs';

function fixture() {
  return {
    id: 'bomb',
    target: 'metric',
    lines: [
      { id: 's1', text: 'http_requests_total{route="/cart"}' },
      { id: 's2', text: 'http_requests_total{user_id="8841"}' },
      { id: 's3', text: 'http_requests_total{method="GET"}' },
      { id: 's4', text: 'http_requests_total{trace_id="4bf9"}' },
    ],
    faults: ['s2', 's4'],
    whyNot: { s1: 'A route is a small, fixed set.' },
    explain: '<code>user_id</code> and <code>trace_id</code> explode cardinality.',
  };
}

function setup(spec = fixture(), opts = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, done: 0 };
  const ctx = { ovBody: dom.body, ovActions: dom.actions, escapeHtml, mistake() { counts.mistakes += 1; } };
  dom.body.innerHTML = renderSpot(spec, newSpotState(spec), { escapeHtml, ...opts });
  dom.actions.innerHTML = '<button id="finish" disabled>Finish</button>';
  const onComplete = () => {
    counts.done += 1;
    const fin = dom.actions.querySelector('#finish');
    fin.disabled = false;
    return fin;
  };
  return { dom, focus, counts, mount: (extra = {}) => mountSpot(ctx, spec, { onComplete, ...extra }) };
}

const pressed = () => qa('[data-line]').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.line);
const feedback = () => q('#bomb-feedback').textContent;
const pickAll = (...ids) => ids.forEach((id) => click(`[data-line="${id}"]`));
const check = () => click('#bomb-check');

test('renderSpot: one unpressed button per line with its text as the name, a Check button, a live feedback region', () => {
  setup();
  assert.deepEqual(qa('[data-line]').map((b) => b.dataset.line), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(qa('[data-line]').map((b) => b.textContent), fixture().lines.map((l) => l.text));
  assert.deepEqual(pressed(), []);
  assert.equal(qa('[data-line]').every((b) => b.localName === 'button'), true);
  assert.equal(q('#bomb-check').textContent, 'Check');
  const fb = q('#bomb-feedback');
  assert.equal(fb.getAttribute('role'), 'status');
  assert.equal(fb.getAttribute('aria-live'), 'polite');
  assert.equal(fb.getAttribute('tabindex'), '-1');
  assert.equal(q('.spot').hasAttribute('role'), false);
  assert.equal(q('.spot').getAttribute('data-target'), 'metric');
});

test('renderSpot: line text is escaped plain text; ids are escaped; labelledBy makes a group', () => {
  const spec = fixture();
  spec.lines[0].text = 'x{a="<img src=x onerror=alert(1)>"}';
  const dom = makeDom();
  dom.body.innerHTML = renderSpot({ ...spec, id: 'a"b' }, newSpotState(spec), { escapeHtml, labelledBy: 'spot-q' });
  assert.equal(qa('img').length, 0);
  assert.equal(q('[data-line="s1"]').textContent, spec.lines[0].text);
  assert.equal(q('.spot').getAttribute('data-spot'), 'a"b');
  assert.equal(q('.spot').getAttribute('role'), 'group');
  assert.equal(q('.spot').getAttribute('aria-labelledby'), 'spot-q');
  for (const bad of ['', 'a"b', 'two words']) {
    assert.throws(() => renderSpot(spec, newSpotState(spec), { escapeHtml, labelledBy: bad }), { name: 'TypeError', message: /labelledBy/ }, JSON.stringify(bad));
  }
});

test('no Alpine attributes, no style= and no on*= attributes, before and during play', () => {
  const { dom, mount } = setup();
  const bad = (when) => {
    const html = dom.body.innerHTML;
    assert.equal(/\s(?:x-[\w.:-]+|@[\w.:-]+|:[\w.:-]+)=/.test(html), false, `${when}: Alpine`);
    assert.equal(/\sstyle=/.test(html), false, `${when}: style=`);
    assert.equal(/\son\w+=/.test(html), false, `${when}: on*=`);
  };
  bad('rendered');
  mount();
  pickAll('s1');
  check();
  bad('wrong');
  click('[data-line="s1"]');
  pickAll('s2', 's4');
  check();
  bad('right');
});

test('mounting focuses the first line and changes nothing else', () => {
  const { focus, counts, mount } = setup();
  mount();
  assert.equal(focus.last(), 'line:s1');
  assert.deepEqual(counts, { mistakes: 0, done: 0 });
  assert.equal(feedback(), '');
});

test('clicking a line toggles it, in place, and keeps focus there', () => {
  const { focus, counts, mount } = setup();
  mount();
  const before = focus.names().length;
  click('[data-line="s3"]');
  assert.deepEqual(pressed(), ['s3']);
  click('[data-line="s1"]');
  assert.deepEqual(pressed(), ['s1', 's3']);
  click('[data-line="s3"]');
  assert.deepEqual(pressed(), ['s1']);
  assert.equal(counts.mistakes, 0, 'selecting is free');
  assert.deepEqual(focus.names().slice(before), [], 'no focus jumps while selecting');
});

test('Check with nothing selected is free and asks for a pick', () => {
  const { counts, focus, mount } = setup();
  mount();
  check();
  assert.equal(counts.mistakes, 0);
  assert.equal(feedback(), 'Pick at least one line first.');
  assert.equal(focus.last(), '#bomb-feedback');
});

test('a wrong pick costs one mistake and names why not, without the answer', () => {
  const { counts, mount } = setup();
  mount();
  pickAll('s1', 's2');
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Not quite. 1 of your picks is not a fault. A route is a small, fixed set.');
  assert.equal(q('#bomb-feedback').className, 'feedback info show');
  assert.equal(counts.done, 0);
});

test('a wrong pick without whyNot gets only the generic line; missing faults are named as incomplete', () => {
  const { counts, mount } = setup();
  mount();
  pickAll('s3');
  check();
  assert.equal(feedback(), 'Not quite. 1 of your picks is not a fault.');
  click('[data-line="s3"]');
  pickAll('s2');
  check();
  assert.equal(counts.mistakes, 2);
  assert.equal(feedback(), 'Not quite. Everything you picked is a fault, but there is more.');
});

test('repeating the same wrong selection is free and says so; a changed one costs again', () => {
  const { counts, mount } = setup();
  mount();
  pickAll('s1');
  check();
  check();
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Same as last time: that selection is still wrong.');
  pickAll('s3');
  check();
  assert.equal(counts.mistakes, 2);
});

test('exactly the fault set is right: explains, locks the widget, completes once and focuses the return', () => {
  const { counts, focus, mount } = setup();
  mount();
  pickAll('s4', 's2');
  check();
  assert.equal(counts.mistakes, 0);
  assert.equal(feedback(), 'Right. user_id and trace_id explode cardinality.');
  assert.equal(q('#bomb-feedback').className, 'feedback good show');
  assert.equal(q('#bomb-feedback code') === null, false, 'explain is trusted HTML');
  assert.equal(counts.done, 1);
  assert.equal(focus.last(), '#finish');
  assert.equal(qa('[data-line]').every((b) => b.disabled), true);
  assert.equal(q('#bomb-check').disabled, true);
  assert.deepEqual(focus.unfocusable(), []);
});

test('mounting throws a TypeError naming the spec for a bad spec, no onComplete, or no render', () => {
  const bad = fixture();
  bad.faults = [];
  const a = setup(bad);
  assert.throws(() => a.mount(), { name: 'TypeError', message: /spot "bomb": invalid spec: .*faults/ });
  const b = setup();
  assert.throws(() => b.mount({ onComplete: undefined }), { name: 'TypeError', message: /onComplete/ });
  const c = setup();
  c.dom.body.innerHTML = '';
  assert.throws(() => c.mount(), { name: 'TypeError', message: /not rendered/ });
});
