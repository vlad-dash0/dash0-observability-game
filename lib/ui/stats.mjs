// Kit stats and dots (docs/DESIGN-SYSTEM.md "Components"): a row of label/value pairs (a
// description list) and a row of progress dots with a spoken summary. Pure string builders;
// DOM-free.

import { bool, fail, int, oneOf, opts, text } from './check.mjs';

/** `<dl class="ui-stats">`: one `<div><dt>label</dt><dd>value</dd></div>` per item (text, escaped). */
export function stats(items) {
  if (!Array.isArray(items) || items.length === 0) fail('stats', 'items must be a non-empty array');
  const rows = items.map((it, i) => {
    const { label, value } = opts('stats', it, ['label', 'value']);
    return `<div><dt>${text('stats', label, `items[${i}].label`)}</dt><dd>${text('stats', value, `items[${i}].value`)}</dd></div>`;
  });
  return `<dl class="ui-stats">${rows.join('')}</dl>`;
}

/** Dot fills: success (mint, the default) or hint (violet, the hint pips). */
export const DOTS_TONES = Object.freeze(['success', 'hint']);

/**
 * `total` dots, the first `on` filled. By default `label` says it in words (role=img). With
 * `decorative`, the dots sit beside a text line that already says it: aria-hidden, no label.
 * `tone` sets data-tone (fill colour); without it the dots are success mint.
 */
export function dots(args) {
  const { total, on, label, decorative = false, tone } = opts('dots', args, ['total', 'on', 'label', 'decorative', 'tone']);
  int('dots', total, 'total', 1, 50);
  int('dots', on, 'on', 0, total);
  bool('dots', decorative, 'decorative');
  if (decorative && label !== undefined) fail('dots', 'a decorative row takes no label (its text line says it)');
  const a11y = decorative ? ' aria-hidden="true"' : ` role="img" aria-label="${text('dots', label, 'label')}"`;
  const t = tone === undefined ? '' : ` data-tone="${oneOf('dots', tone, DOTS_TONES, 'tone')}"`;
  const ds = Array.from({ length: total }, (_, i) => `<i data-on="${i < on}"></i>`).join('');
  return `<span class="ui-dots"${a11y}${t}>${ds}</span>`;
}
