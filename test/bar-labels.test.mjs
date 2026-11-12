// Waterfall bar labels placed by measurement (lib/widgets/bar-labels.mjs, #332): inside the bar when the
// label fits, else just right of it, else just left, else inside with the name cut to an ellipsis.
// The DOM has no layout, so the measurements are stubbed on the elements: 10px a glyph, a 400px track.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { fitBarLabels } from '../lib/widgets/bar-labels.mjs';

const TRACK = 400;
const GLYPH = 10;

/** One row's track: a bar at `x`% `w`% wide and its label text; measured widths stubbed. */
function board(x, w, dur, name) {
  const { body } = makeDom();
  body.innerHTML =
    '<div class="wf-board"><svg class="wf-track">' +
    `<rect data-bar x="${x}%" width="${w}%"></rect>` +
    `<text data-bar-label x="${x}%" dx="7"><tspan class="wf-dur">${dur}ms</tspan><tspan data-bar-name> ${name}</tspan></text>` +
    '</svg></div>';
  const track = body.querySelector('.wf-track');
  track.getBoundingClientRect = () => ({ width: TRACK });
  const text = body.querySelector('[data-bar-label]');
  const nameSpan = body.querySelector('[data-bar-name]');
  text.getComputedTextLength = () => (`${dur}ms`.length + nameSpan.textContent.length) * GLYPH;
  return { root: body.querySelector('.wf-board'), text, nameSpan };
}

test('#332 a label that fits in its bar stays inside it', () => {
  const { root, text } = board(10, 80, 90, 'ok'); // 320px bar, 70px label
  fitBarLabels(root);
  assert.equal(text.getAttribute('x'), '10%');
  assert.equal(text.getAttribute('dx'), '7');
  assert.equal(text.hasAttribute('data-out'), false);
});

test('#332 a label wider than a short bar goes just right of it', () => {
  const { root, text } = board(10, 10, 10, 'compute totals'); // 40px bar, 170px label, 280px free to the right
  fitBarLabels(root);
  assert.equal(text.getAttribute('x'), '20%', 'at the bar end');
  assert.equal(text.getAttribute('dx'), '7');
  assert.equal(text.hasAttribute('data-out'), true);
  assert.equal(text.hasAttribute('text-anchor'), false);
});

test('#332 with no room on the right it ends just left of the bar', () => {
  const { root, text } = board(80, 18, 20, 'orders process'); // bar 320-392, label 180px, 8px free right, 320px free left
  fitBarLabels(root);
  assert.equal(text.getAttribute('x'), '80%');
  assert.equal(text.getAttribute('dx'), '-7');
  assert.equal(text.getAttribute('text-anchor'), 'end');
  assert.equal(text.hasAttribute('data-out'), true);
});

test('#332 with no room on either side the name is cut to an ellipsis and the duration stays', () => {
  const { root, text, nameSpan } = board(5, 90, 60, 'POST provider/charges /with/a/very/long/path/that/fits/nowhere'); // 360px bar, 10px each side
  fitBarLabels(root);
  assert.equal(text.hasAttribute('data-out'), false);
  assert.equal(nameSpan.textContent.endsWith('…'), true, nameSpan.textContent);
  assert.equal(text.getComputedTextLength() <= 360 - 7 - 3, true, 'the cut label fits the bar');
  assert.equal(text.querySelector('.wf-dur').textContent, '60ms');
});

test('#332 a second fit starts from the full name (a resize can widen the bar)', () => {
  const { root, nameSpan } = board(5, 90, 60, 'POST provider/charges /with/a/very/long/path/that/fits/nowhere');
  fitBarLabels(root);
  const cut = nameSpan.textContent;
  root.querySelector('.wf-track').getBoundingClientRect = () => ({ width: 4000 });
  fitBarLabels(root);
  assert.equal(nameSpan.textContent.length > cut.length, true);
  assert.equal(nameSpan.textContent.includes('…'), false);
});

test('#332 nothing changes where the browser cannot measure', () => {
  const { root, text } = board(10, 10, 10, 'compute totals');
  text.getComputedTextLength = undefined;
  fitBarLabels(root);
  assert.equal(text.getAttribute('x'), '10%');
  assert.equal(text.hasAttribute('data-out'), false);
});
