// Kit option cards (docs/DESIGN-SYSTEM.md "Components"): every selectable answer, view, item
// or line. The kind is a static modifier; runtime state is attributes the widget sets:
// aria-pressed (selected), data-state (correct / wrong / locked / opened), data-hinted,
// disabled. Pure string builders; DOM-free.

import { bool, esc, fail, html, idAttr, oneOf, opts, text, token } from './check.mjs';

export const OPTION_KINDS = Object.freeze(['choice', 'tile', 'hypothesis', 'toggle', 'line', 'radio']);
export const OPTION_STATES = Object.freeze(['correct', 'wrong', 'locked', 'opened']);
export const OPTIONS_LAYOUTS = Object.freeze(['list', 'grid', 'wrap']);
const ATTR = /^[a-z][a-z0-9-]*$/;

/**
 * One option: `data-<attr>="<value>"` is its behaviour hook (value is escaped text),
 * `labelHtml` / `metaHtml` trusted HTML. A button for every kind but `radio`, which is a
 * label around `<input type="radio" name>` (`pressed` = checked). `pressed` undefined
 * leaves aria-pressed off (not a toggle); `locked` also sets aria-disabled.
 */
export function option(args) {
  const { attr, value, labelHtml, metaHtml, kind = 'choice', pressed, state, disabled = false, hinted = false, name } =
    opts('option', args, ['attr', 'value', 'labelHtml', 'metaHtml', 'kind', 'pressed', 'state', 'disabled', 'hinted', 'name']);
  if (typeof attr !== 'string' || !ATTR.test(attr)) fail('option', `attr must be a lower-case data-* name, got ${String(attr)}`);
  const v = text('option', value, 'value');
  html('option', labelHtml, 'labelHtml');
  html('option', metaHtml, 'metaHtml', { optional: true });
  oneOf('option', kind, OPTION_KINDS, 'kind');
  if (pressed !== undefined) bool('option', pressed, 'pressed');
  if (state !== undefined) oneOf('option', state, OPTION_STATES, 'state');
  bool('option', disabled, 'disabled');
  bool('option', hinted, 'hinted');
  if ((kind === 'radio') !== (name !== undefined)) fail('option', 'name is required for, and only for, the radio kind');
  const st = state === undefined ? '' : ` data-state="${state}"`;
  const hint = hinted ? ' data-hinted' : '';
  const body = `<span class="ui-option-label">${labelHtml}</span>${metaHtml === undefined ? '' : `<span class="ui-option-meta">${metaHtml}</span>`}`;
  if (kind === 'radio') {
    const input = `<input type="radio" class="ui-option-input" name="${token('option', name, 'name')}" value="${v}"` +
      `${pressed ? ' checked' : ''}${disabled ? ' disabled' : ''}>`;
    return `<label class="ui-option ui-option--radio" data-${attr}="${v}"${st}${hint}>${input}${body}</label>`;
  }
  const pr = pressed === undefined ? '' : ` aria-pressed="${pressed}"`;
  const locked = state === 'locked' ? ' aria-disabled="true"' : '';
  return `<button type="button" class="ui-option ui-option--${kind}" data-${attr}="${v}"${pr}${st}${locked}${hint}${disabled ? ' disabled' : ''}>${body}</button>`;
}

/** The group around options: list (a column), grid (tiles, minmax(200px, 1fr)) or wrap (a pool). */
export function options(args) {
  const { id, labelledBy, layout = 'list', itemsHtml } = opts('options', args, ['id', 'labelledBy', 'layout', 'itemsHtml']);
  const idA = idAttr('options', id, { optional: true });
  if (labelledBy !== undefined) token('options', labelledBy, 'labelledBy');
  oneOf('options', layout, OPTIONS_LAYOUTS, 'layout');
  html('options', itemsHtml, 'itemsHtml');
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${esc(labelledBy)}"`;
  return `<div class="ui-options ui-options--${layout}"${idA}${group}>${itemsHtml}</div>`;
}
