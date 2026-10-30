// A minimal browser for level play-throughs (adapted from R's lessons-play.test.mjs):
// linkedom DOM on globalThis, plus tap helpers that act like a real click.
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const SHELL =
  '<!doctype html><html><body><div id="ov-body"></div><div id="ov-actions"></div></body></html>';

/** Install a fresh DOM as globalThis.window/document; returns the overlay elements. */
export function makeDom(html = SHELL) {
  const { window, document } = parseHTML(html);
  globalThis.window = window;
  globalThis.document = document;
  // Web Animations API is not in linkedom; levels only fire-and-forget it.
  window.Element.prototype.animate = () => ({ onfinish: null, cancel() {} });
  return {
    window,
    document,
    body: document.getElementById('ov-body'),
    actions: document.getElementById('ov-actions'),
  };
}

export const q = (sel) => globalThis.document.querySelector(sel);
export const qa = (sel) => [...globalThis.document.querySelectorAll(sel)];

/** Click an element or selector; throws if it is missing, disabled or unwired. */
export function click(elOrSel) {
  const el = typeof elOrSel === 'string' ? q(elOrSel) : elOrSel;
  assert.ok(el, `expected an element for ${elOrSel}`);
  assert.ok(!el.disabled, `${elOrSel} is disabled (dead end?)`);
  assert.equal(typeof el.onclick, 'function', `${elOrSel} has no click handler`);
  el.onclick({ currentTarget: el, target: el });
}

/** Click `sel` then `next` each round until `until` exists (at most `max` rounds). */
export function clickUntil(sel, next, until, max = 30) {
  for (let i = 0; i < max; i++) {
    if (q(until)) return;
    click(sel);
    click(next);
  }
  assert.ok(q(until), `never reached ${until}`);
}
