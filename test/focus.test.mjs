// lib/widgets/focus.mjs: the one rule for "can this element take focus", shared by the
// widgets (where focus goes next) and test/helpers/focus.mjs (what a focus walk accepts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { canFocus } from '../lib/widgets/focus.mjs';

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
