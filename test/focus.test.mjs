// lib/widgets/focus.mjs: the one rule for "can this element take focus", shared by the
// widgets (where focus goes next) and test/helpers/focus.mjs (what a focus walk accepts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { canFocus, focusFirst } from '../lib/widgets/focus.mjs';

/** Render `html` into the overlay; `byId(id)` answers canFocus for that element. */
function render(html) {
  const dom = makeDom();
  dom.body.innerHTML = html;
  return (id) => canFocus(dom.document.getElementById(id));
}

test('a button inside a disabled fieldset cannot take focus; in an enabled one it can', () => {
  const can = render(
    '<fieldset disabled><div><button id="off">b</button></div></fieldset>' +
      '<fieldset><button id="on">b</button></fieldset>',
  );
  assert.equal(can('off'), false);
  assert.equal(can('on'), true);
});

test('a control in the first legend of a disabled fieldset can still take focus', () => {
  const can = render(
    '<fieldset disabled><legend><button id="in-legend">b</button></legend>' +
      '<legend><button id="second-legend">b</button></legend></fieldset>',
  );
  assert.equal(can('in-legend'), true);
  assert.equal(can('second-legend'), false);
});

test('a hidden input cannot take focus; a text input can', () => {
  const can = render('<input id="hidden" type="hidden"><input id="hidden-caps" type="HIDDEN"><input id="text">');
  assert.equal(can('hidden'), false);
  assert.equal(can('hidden-caps'), false);
  assert.equal(can('text'), true);
});

test('a non-element is never focusable', () => {
  const dom = makeDom();
  const text = dom.body.appendChild(dom.document.createTextNode('t')); // connected, not an element
  for (const v of [false, null, undefined, 0, text]) {
    assert.equal(canFocus(v), false, String(v));
  }
});

test('escapeFromHint: with no focusable target the Escape is not prevented and nothing is focused; a function target is read at the key', async () => {
  const { escapeFromHint } = await import('../lib/widgets/focus.mjs');
  const dom = makeDom();
  dom.body.innerHTML = '<div id="t" tabindex="-1"></div><button id="b" disabled>b</button><button id="later">l</button>';
  const text = dom.document.getElementById('t');
  const calls = [];
  dom.window.HTMLElement.prototype.focus = function focus() {
    calls.push(this.id);
  };
  const press = () => {
    const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    text.onkeydown(e);
    return e.defaultPrevented;
  };
  let pick = null;
  escapeFromHint(text, dom.document.getElementById('b'), () => pick);
  assert.equal(press(), false, 'nothing can take focus: left to the app');
  assert.deepEqual(calls, []);
  pick = dom.document.getElementById('later');
  assert.equal(press(), true);
  assert.deepEqual(calls, ['later']);
});

// ---- #339: a new step never focuses a control that is off-screen ----

/** A step with a question and a first control; `rects` stubs layout (linkedom has none). Returns what took focus. */
function step({ control, footerTop = 600, viewport = 700 }) {
  const dom = makeDom();
  dom.body.innerHTML = '<div class="ui-step"><p class="ui-lesson" id="lesson">l</p><h3 class="ui-question" id="ask">q</h3><button id="first">go</button></div>';
  dom.actions.innerHTML = '<div class="ui-actions"></div>';
  const rect = (top, bottom) => () => ({ top, bottom, width: 10, height: bottom - top });
  const doc = dom.document;
  doc.querySelector('#first').getBoundingClientRect = rect(...control);
  doc.querySelector('.ui-actions').getBoundingClientRect = rect(footerTop, footerTop + 60);
  dom.window.innerHeight = viewport;
  const log = [];
  dom.window.HTMLElement.prototype.focus = function focus(o) { log.push([this.id, o?.preventScroll === true]); };
  return { first: doc.querySelector('#first'), log, doc };
}

test('#339 focusFirst focuses the first control, without scrolling, when it is wholly above the footer', () => {
  const t = step({ control: [200, 240] });
  assert.equal(focusFirst(t.first).id, 'first');
  assert.deepEqual(t.log, [['first', true]]);
});

test('#339 focusFirst focuses the step question (made focusable) when the control sits under the footer', () => {
  const t = step({ control: [590, 630] });
  assert.equal(focusFirst(t.first).id, 'ask');
  assert.deepEqual(t.log, [['ask', true]]);
  assert.equal(t.doc.querySelector('#ask').getAttribute('tabindex'), '-1');
});

test('#339 when the question is below the fold too, focus goes to the lesson at the top of the step', () => {
  const t = step({ control: [900, 940] });
  t.doc.querySelector('#ask').getBoundingClientRect = () => ({ top: 800, bottom: 830, width: 10, height: 30 });
  assert.equal(focusFirst(t.first).id, 'lesson');
  assert.deepEqual(t.log, [['lesson', true]]);
});

test('#339 focusFirst treats a control below the viewport as off-screen when the footer is lower than the window', () => {
  const t = step({ control: [800, 840], footerTop: 900, viewport: 700 });
  assert.equal(focusFirst(t.first).id, 'ask');
});

test('#339 focusFirst falls back to the lesson when the step has no question, and to the given fallback when there is no control', () => {
  const t = step({ control: [590, 630] });
  t.doc.querySelector('#ask').remove();
  assert.equal(focusFirst(t.first).id, 'lesson');
  const u = step({ control: [0, 0] });
  assert.equal(focusFirst(null, { fallback: u.doc.querySelector('#ask') }).id, 'ask');
  assert.equal(focusFirst(null), null);
});

test('#339 without layout (no size) the control counts as visible', () => {
  const t = step({ control: [0, 0] });
  assert.equal(focusFirst(t.first).id, 'first');
});
