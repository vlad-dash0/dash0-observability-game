// Kit meter (docs/DESIGN-SYSTEM.md "Components"): a budget or cost as a row of cells with a
// text line that is the accessible value; the cells are decoration (aria-hidden). Pure string
// builder; DOM-free.

import { bool, esc, fail, idAttr, int, opts, text } from './check.mjs';

/**
 * `value` of `max` (both finite, 0 <= value, 0 < max) as `cells` cells (20 by default):
 * round(min(value, max) / max * cells) `spent` (or `over` when `over`), then up to
 * `previewCells` `preview` (what the next action would cost), then `left`. The text line
 * `#<id>-value` reads "<value> of <max>[ <unit>]".
 */
export function meter(args) {
  const { id, label, value, max, cells = 20, unit, previewCells = 0, over = false } =
    opts('meter', args, ['id', 'label', 'value', 'max', 'cells', 'unit', 'previewCells', 'over']);
  const idA = idAttr('meter', id);
  const l = text('meter', label, 'label');
  if (!Number.isFinite(value) || value < 0) fail('meter', `value must be a finite number >= 0, got ${String(value)}`);
  if (!Number.isFinite(max) || max <= 0) fail('meter', `max must be a finite number > 0, got ${String(max)}`);
  int('meter', cells, 'cells', 1, 100);
  const u = text('meter', unit, 'unit', { optional: true });
  int('meter', previewCells, 'previewCells', 0);
  bool('meter', over, 'over');
  const spent = Math.round((Math.min(value, max) / max) * cells);
  const preview = Math.min(previewCells, cells - spent);
  const kinds = Array.from({ length: cells }, (_, i) => (i < spent ? (over ? 'over' : 'spent') : i < spent + preview ? 'preview' : 'left'));
  const line = `${esc(value)} of ${esc(max)}${u === undefined ? '' : ` ${u}`}`;
  return `<div class="ui-meter"${idA}><p class="ui-meter-head"><span class="ui-meter-label">${l}</span> ` +
    `<span class="ui-meter-value" id="${id}-value">${line}</span></p>` +
    `<div class="ui-meter-cells" aria-hidden="true">${kinds.map((k) => `<i data-cell="${k}"></i>`).join('')}</div></div>`;
}
