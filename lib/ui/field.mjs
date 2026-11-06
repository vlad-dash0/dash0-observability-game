// Kit form fields (docs/DESIGN-SYSTEM.md "Components"): a labelled text or code input, and
// radio and checkbox rows with custom (appearance: none) controls. Pure string builders;
// DOM-free.

import { bool, esc, html, idAttr, int, oneOf, opts, text, token } from './check.mjs';

/**
 * A label and its input: `kind` text (`<input type="text">`), code (a mono `<textarea>`
 * on the code background, `rows` high, no spellcheck) or secret (`<input type="password">`,
 * no autofill, no value ever: a non-empty `value` or `readonly` throws). `value` is escaped; `noteHtml` (trusted)
 * becomes `#<id>-note`, which describes the input.
 */
export function field(args) {
  const { id, label, kind = 'text', rows = 4, value = '', readonly = false, noteHtml } =
    opts('field', args, ['id', 'label', 'kind', 'rows', 'value', 'readonly', 'noteHtml']);
  const idA = idAttr('field', id);
  const l = text('field', label, 'label');
  oneOf('field', kind, ['text', 'code', 'secret'], 'kind');
  int('field', rows, 'rows', 1, 60);
  if (typeof value !== 'string') throw new TypeError('field: value must be a string');
  bool('field', readonly, 'readonly');
  html('field', noteHtml, 'noteHtml', { optional: true });
  // A secret is write-only: no value attribute can ever carry it back into the markup.
  if (kind === 'secret' && (value !== '' || readonly)) {
    throw new TypeError('field: a secret takes no value and is never readonly');
  }
  const ro = readonly ? ' readonly' : '';
  const desc = noteHtml === undefined ? '' : ` aria-describedby="${id}-note"`;
  let input;
  if (kind === 'code') {
    input = `<textarea class="ui-input ui-input--code"${idA} rows="${rows}" spellcheck="false"${ro}${desc}>${esc(value)}</textarea>`;
  } else if (kind === 'secret') {
    input = `<input type="password" class="ui-input"${idA} autocomplete="off" autocapitalize="off" spellcheck="false"${desc}>`;
  } else {
    input = `<input type="text" class="ui-input"${idA} value="${esc(value)}"${ro}${desc}>`;
  }
  const n = noteHtml === undefined ? '' : `<p class="ui-note" id="${id}-note">${noteHtml}</p>`;
  return `<div class="ui-field"><label class="ui-field-label" for="${id}">${l}</label>${input}${n}</div>`;
}

function check(helper, type, args) {
  const { id, name, value, labelHtml, checked = false, disabled = false } =
    opts(helper, args, ['id', 'name', 'value', 'labelHtml', 'checked', 'disabled']);
  const idA = idAttr(helper, id, { optional: true });
  const n = type === 'radio' || name !== undefined ? ` name="${token(helper, name, 'name')}"` : '';
  const v = type === 'radio' || value !== undefined ? ` value="${text(helper, value, 'value')}"` : '';
  html(helper, labelHtml, 'labelHtml');
  bool(helper, checked, 'checked');
  bool(helper, disabled, 'disabled');
  return `<label class="ui-check"><input type="${type}" class="ui-check-input"${n}${v}${idA}` +
    `${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}><span class="ui-check-label">${labelHtml}</span></label>`;
}

/** A radio row: `name` and `value` required, label trusted HTML. */
export const radio = (args) => check('radio', 'radio', args);

/** A checkbox row: `name` and `value` optional, label trusted HTML. */
export const checkbox = (args) => check('checkbox', 'checkbox', args);
