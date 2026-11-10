// The kit modal (docs/DESIGN-SYSTEM.md "Modal"): the shells in index.html and the Tab trap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { focusables, trapTab } from '../lib/modal-focus.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const shell = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8')).document;

test('every dialog on the page but the reward is one kit modal: the same shell, a named close, a focusable title', () => {
  const modals = [...shell.querySelectorAll('.ui-modal')];
  assert.deepEqual(modals.map((m) => m.id), ['howto-modal', 'about-modal', 'save-modal', 'board-modal', 'account-modal']);
  for (const m of modals) {
    assert.equal(m.getAttribute('role'), 'dialog', m.id);
    assert.equal(m.getAttribute('aria-modal'), 'true', m.id);
    assert.ok(m.getAttribute('x-show'), `${m.id} is opened by Alpine state`);
    assert.equal(m.closest('#hub') === null && m.closest('.overlay') === null, true, `${m.id} sits outside what it makes inert`);
    const title = shell.getElementById(m.getAttribute('aria-labelledby'));
    assert.ok(m.contains(title) && title.localName === 'h2', `${m.id} is named by its h2`);
    assert.equal(title.getAttribute('tabindex'), '-1', `${m.id}: focus lands on the title`);
    assert.equal(title.closest('.ui-modal-head') !== null, true);
    const x = m.querySelector('.ui-modal-head .ui-btn--icon');
    assert.ok(x && x.getAttribute('aria-label') && /^close/.test(x.getAttribute('@click')), `${m.id} has a close button with a name`);
    assert.ok(m.querySelector('.ui-modal-card > .ui-modal-body'), `${m.id} has a body that scrolls inside the card`);
  }
});

test('the board and account modals are kit shells with an app-drawn body, and the openers they return focus to exist', () => {
  for (const [id, body, title, opener] of [['board-modal', 'board-body', 'board-title', 'board-open'], ['account-modal', 'account-body', 'account-title', 'account-open']]) {
    const m = shell.getElementById(id);
    assert.equal(m.getAttribute('x-show'), id === 'board-modal' ? 'boardOpen' : 'accountOpen');
    assert.equal(m.getAttribute('aria-labelledby'), title);
    const b = shell.getElementById(body);
    assert.ok(b && b.classList.contains('ui-modal-body') && m.contains(b), `${id} body`);
    assert.equal(b.hasAttribute('x-ignore'), true, `${id}: the app writes the body, so Alpine skips it`);
    assert.equal(b.querySelectorAll('[x-text],[x-show],[\\@click]').length, 0);
    const o = shell.getElementById(opener);
    assert.ok(o && o.closest('#hub') !== null && o.classList.contains('ui-btn'), `${opener} is a hub kit button`);
  }
});

test('the shells take their look from the kit alone: no style attribute, no extra classes on the card parts', () => {
  for (const sel of ['.ui-modal', '.ui-modal-card', '.ui-modal-head', '.ui-modal-body', '.ui-modal-foot']) {
    for (const el of shell.querySelectorAll(sel)) {
      assert.equal(el.hasAttribute('style'), false, sel);
      assert.equal(el.classList.length, 1, `${sel} carries only its kit class`);
    }
  }
});

// A modal with a heading (tabindex -1), two buttons, a disabled one and a hidden one.
function fixture() {
  const { document } = parseHTML(`<!doctype html><body><button id="before">b</button>
    <div id="m"><h2 id="t" tabindex="-1">T</h2><button id="a">a</button><button id="off" disabled>x</button>
    <div hidden><button id="gone">g</button></div><a id="b" href="#">b</a><button id="z">z</button><div id="tail"></div></div></body>`);
  const modal = document.getElementById('m');
  // linkedom does not track focus: record it, and read it back as document.activeElement.
  let current = null;
  for (const el of document.querySelectorAll('*')) el.focus = () => { current = el; };
  Object.defineProperty(document, 'activeElement', { get: () => current });
  const key = (shiftKey = false, k = 'Tab') => {
    return { key: k, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
  };
  return { document, modal, key, at: (id) => { document.getElementById(id).focus(); } };
}

test('focusables: buttons and links in order, not disabled, hidden or tabindex -1 ones', () => {
  const { modal } = fixture();
  assert.deepEqual(focusables(modal).map((e) => e.id), ['a', 'b', 'z']);
});

test('Tab on the last control wraps to the first, and is cancelled', () => {
  const { document, modal, key, at } = fixture();
  at('z');
  const e = key();
  assert.equal(trapTab(e, modal, document), true);
  assert.equal(e.prevented, true);
  assert.equal(document.activeElement.id, 'a');
});

test('Shift+Tab on the first control, or on the title, wraps to the last', () => {
  const { document, modal, key, at } = fixture();
  at('a');
  assert.equal(trapTab(key(true), modal, document), true);
  assert.equal(document.activeElement.id, 'z');
  at('t');
  assert.equal(trapTab(key(true), modal, document), true);
  assert.equal(document.activeElement.id, 'z');
});

test('Tab in the middle is left to the browser', () => {
  const { document, modal, key, at } = fixture();
  at('b');
  for (const shift of [false, true]) {
    const e = key(shift);
    assert.equal(trapTab(e, modal, document), false);
    assert.equal(e.prevented, false);
  }
  at('t');
  assert.equal(trapTab(key(false), modal, document), false, 'Tab from the title goes to the first control natively');
});

test('an inside element that Tab does not list (a scroller, the tail) still wraps at the edges, so focus never reaches body', () => {
  const { document, modal, key, at } = fixture();
  at('tail');
  const e = key();
  assert.equal(trapTab(e, modal, document), true, 'Tab after the last control wraps');
  assert.equal(e.prevented, true);
  assert.equal(document.activeElement.id, 'a');
  at('tail');
  assert.equal(trapTab(key(true), modal, document), false, 'Shift+Tab from the tail goes back to the last control natively');
  at('t');
  assert.equal(trapTab(key(true), modal, document), true);
  assert.equal(document.activeElement.id, 'z');
});

test('focus outside the modal is pulled back in', () => {
  const { document, modal, key, at } = fixture();
  at('before');
  assert.equal(trapTab(key(), modal, document), true);
  assert.equal(document.activeElement.id, 'a');
  at('before');
  assert.equal(trapTab(key(true), modal, document), true);
  assert.equal(document.activeElement.id, 'z');
});

test('other keys, no modal and an empty modal', () => {
  const { document, modal, key } = fixture();
  assert.equal(trapTab(key(false, 'Enter'), modal, document), false);
  assert.equal(trapTab(key(), null, document), false);
  const { document: d2 } = parseHTML('<body><div id="e"><p>text</p></div></body>');
  const e = key();
  assert.equal(trapTab(e, d2.getElementById('e'), d2), true, 'nothing to focus: Tab stays put');
  assert.equal(e.prevented, true);
});
