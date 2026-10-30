// Self-test for test/helpers/focus.mjs: it must flag every focus() that a browser
// would ignore, so a focus walk cannot pass by landing on a dead element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';

test('unfocusable() flags disabled, detached and not natively focusable targets', () => {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  dom.body.innerHTML = [
    '<button id="ok-button">b</button>',
    '<input id="ok-input">',
    '<select id="ok-select"></select>',
    '<textarea id="ok-textarea"></textarea>',
    '<a id="ok-link" href="#x">a</a>',
    '<div id="ok-tabindex" tabindex="-1">d</div>',
    '<button id="bad-disabled" disabled>b</button>',
    '<div id="bad-div">d</div>',
    '<a id="bad-anchor">a</a>',
  ].join('');
  for (const el of dom.body.querySelectorAll('*')) el.focus();
  const detached = dom.document.createElement('button');
  detached.id = 'bad-detached';
  detached.focus();
  assert.deepEqual(focus.unfocusable(), ['#bad-disabled', '#bad-div', '#bad-anchor', '#bad-detached']);
  assert.equal(focus.names().length, 10);
  assert.equal(focus.last(), '#bad-detached');
});
