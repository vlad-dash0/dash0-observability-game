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
