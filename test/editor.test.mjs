// The editor kit (#159 P0): editorPanel's markup contract and lockEditor, on a linkedom DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorPanel, lockEditor } from '../lib/widgets/editor.mjs';
import { canFocus } from '../lib/widgets/focus.mjs';
import { makeDom, q, qa } from './helpers/dom.mjs';

const args = { inputId: 'ed', label: 'Config', rows: 7, value: 'a: 1', actionId: 'ed-go', actionLabel: 'Check it', feedbackId: 'ed-fb' };
const mount = (extra = {}) => {
  const { body } = makeDom();
  body.innerHTML = editorPanel({ ...args, ...extra });
  return body;
};

test('editorPanel: a code textarea, one action, a hidden status region, no hint button', () => {
  mount({ leadHtml: '<p id="lead">Fix it.</p>' });
  const input = q('#ed');
  assert.equal(input.localName, 'textarea');
  assert.equal(input.getAttribute('rows'), '7');
  assert.equal(input.value, 'a: 1');
  for (const a of ['autocomplete', 'autocapitalize', 'autocorrect']) assert.equal(input.getAttribute(a), 'off', a);
  assert.ok(q('#lead'), 'leadHtml renders');
  const go = q('#ed-go');
  assert.equal(go.textContent, 'Check it');
  assert.equal(go.getAttribute('type'), 'button');
  assert.equal(go.disabled, false);
  assert.ok(q('.editor-actions #ed-go'));
  const fb = q('#ed-fb');
  assert.equal(fb.getAttribute('role'), 'status');
  assert.ok(fb.hasAttribute('hidden'));
  assert.equal(qa('button').length, 1, 'the side column owns the hint');
});

test('editorPanel readonly: the input is read-only, never disabled; the action is disabled', () => {
  mount({ readonly: true });
  // linkedom does not reflect the readonly attribute as .readOnly; a browser does.
  assert.ok(q('#ed').hasAttribute('readonly'));
  assert.equal(q('#ed').disabled, false);
  assert.equal(q('#ed-go').disabled, true);
});

test('lockEditor: read-only, still focusable, every button disabled', () => {
  const body = mount();
  const input = q('#ed');
  const extra = document.createElement('button');
  body.appendChild(extra);
  assert.equal(canFocus(input), true);
  lockEditor(input, q('#ed-go'), extra);
  assert.equal(input.readOnly, true);
  assert.equal(input.disabled, false);
  assert.equal(canFocus(input), true);
  assert.equal(q('#ed-go').disabled, true);
  assert.equal(extra.disabled, true);
});

test('editorPanel wrap: a wrapping code field; default is a scrolling one (#321)', () => {
  mount({ wrap: true });
  assert.equal(q('#ed').getAttribute('wrap'), 'soft');
  mount();
  assert.equal(q('#ed').hasAttribute('wrap'), false);
});

test('fitEditor: rows follow the line count between the minimum and the maximum, and refit on typing and on a script fill (#321)', async () => {
  const { fitEditor } = await import('../lib/widgets/editor.mjs');
  mount({ rows: 3, value: 'a\nb\nc\nd\ne' });
  const input = q('#ed');
  const fit = fitEditor(input, { max: 8 });
  assert.equal(input.getAttribute('rows'), '5', 'grows to its content on mount');
  input.value = 'a';
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  assert.equal(input.getAttribute('rows'), '3', 'never below the rows it was given');
  input.value = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
  fit();
  assert.equal(input.getAttribute('rows'), '8', 'a script fill needs the returned fit; the maximum then scrolls inside');
  assert.equal(input.hasAttribute('style'), false, 'attributes only: the CSP forbids a style');
});

test('fitEditor: a soft-wrapped line that still overflows adds rows until the browser reports it fits (#321)', async () => {
  const { fitEditor } = await import('../lib/widgets/editor.mjs');
  mount({ rows: 3, value: 'one long line' });
  const input = q('#ed');
  // A browser reports scrollHeight and clientHeight; model one that needs 6 rows.
  Object.defineProperty(input, 'clientHeight', { get() { return Number(input.getAttribute('rows')) * 20; } });
  Object.defineProperty(input, 'scrollHeight', { get() { return 6 * 20; } });
  fitEditor(input, { max: 12 });
  assert.equal(input.getAttribute('rows'), '6');
});

test('fitEditor: content that always overflows stops at max rows (#326)', async () => {
  const { fitEditor } = await import('../lib/widgets/editor.mjs');
  mount({ rows: 3, value: 'x' });
  const input = q('#ed');
  Object.defineProperty(input, 'clientHeight', { get() { return Number(input.getAttribute('rows')) * 20; } });
  Object.defineProperty(input, 'scrollHeight', { get() { return 10000; } });
  fitEditor(input, { max: 7 });
  assert.equal(input.getAttribute('rows'), '7');
});

test('fitEditor: the signal removes the input listener and disconnects the observer; the observer refits on the next frame (#326)', async () => {
  const { fitEditor } = await import('../lib/widgets/editor.mjs');
  const saved = { ro: globalThis.ResizeObserver, raf: globalThis.requestAnimationFrame };
  const log = { cb: null, disconnected: 0, frames: [] };
  globalThis.ResizeObserver = class { constructor(cb) { log.cb = cb; } observe() {} disconnect() { log.disconnected += 1; } };
  globalThis.requestAnimationFrame = (f) => { log.frames.push(f); return 1; };
  try {
    mount({ rows: 3, value: 'a' });
    const input = q('#ed');
    const ac = new AbortController();
    const opts = [];
    const add = input.addEventListener.bind(input);
    input.addEventListener = (t, f, o) => { opts.push([t, o]); return add(t, f); };
    fitEditor(input, { max: 10, signal: ac.signal });
    assert.equal(opts.find(([t]) => t === 'input')[1].signal, ac.signal, 'the input listener is bound to the signal (a browser removes it on abort)');
    input.value = 'a\nb\nc\nd\ne\nf';
    log.cb();
    assert.equal(input.getAttribute('rows'), '3', 'not refitted inside the observer callback');
    assert.equal(log.frames.length, 1);
    log.frames[0]();
    assert.equal(input.getAttribute('rows'), '6', 'refitted in the frame');
    ac.abort();
    assert.equal(log.disconnected, 1);
  } finally {
    globalThis.ResizeObserver = saved.ro;
    globalThis.requestAnimationFrame = saved.raf;
  }
});
