// Kit stats and dots (docs/DESIGN-SYSTEM.md "Components"): a row of label/value pairs (a
// description list) and a row of progress dots with a spoken summary. Pure string builders;
// DOM-free.

import { fail, int, opts, text } from './check.mjs';

/** `<dl class="ui-stats">`: one `<div><dt>label</dt><dd>value</dd></div>` per item (text, escaped). */
export function stats(items) {
  if (!Array.isArray(items) || items.length === 0) fail('stats', 'items must be a non-empty array');
  const rows = items.map((it, i) => {
    const { label, value } = opts('stats', it, ['label', 'value']);
    return `<div><dt>${text('stats', label, `items[${i}].label`)}</dt><dd>${text('stats', value, `items[${i}].value`)}</dd></div>`;
  });
  return `<dl class="ui-stats">${rows.join('')}</dl>`;
}

/** `total` dots, the first `on` filled; `label` says it in words (role=img). */
export function dots(args) {
  const { total, on, label } = opts('dots', args, ['total', 'on', 'label']);
  int('dots', total, 'total', 1, 50);
  int('dots', on, 'on', 0, total);
  const l = text('dots', label, 'label');
  const ds = Array.from({ length: total }, (_, i) => `<i data-on="${i < on}"></i>`).join('');
  return `<span class="ui-dots" role="img" aria-label="${l}">${ds}</span>`;
}
