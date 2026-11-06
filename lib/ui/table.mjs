// Kit table (docs/DESIGN-SYSTEM.md "Components"): a data table in a horizontal scroll wrap;
// the same look as a table inside prose(). Pure string builder; DOM-free.

import { fail, int, opts, text } from './check.mjs';
import { regionAttrs } from './text.mjs';

const cell = (v) => (v === '' ? '' : text('table', v, 'cell'));

/**
 * `head` (non-empty text list), `rows` (lists of text or numbers, each as long as `head`; ''
 * is an empty cell), `numeric` (column indexes: right-aligned tabular figures), `caption`.
 */
export function table(args) {
  const { caption, head, rows, numeric = [] } = opts('table', args, ['caption', 'head', 'rows', 'numeric']);
  const c = text('table', caption, 'caption', { optional: true });
  if (!Array.isArray(head) || head.length === 0) fail('table', 'head must be a non-empty array');
  if (!Array.isArray(rows)) fail('table', 'rows must be an array');
  if (!Array.isArray(numeric)) fail('table', 'numeric must be an array of column indexes');
  numeric.forEach((n) => int('table', n, 'numeric index', 0, head.length - 1));
  const num = (i) => (numeric.includes(i) ? ' data-num' : '');
  const th = head.map((h, i) => `<th scope="col"${num(i)}>${text('table', h, 'head')}</th>`).join('');
  const body = rows.map((r, ri) => {
    if (!Array.isArray(r) || r.length !== head.length) fail('table', `row ${ri} must have ${head.length} cells`);
    return `<tr>${r.map((v, i) => `<td${num(i)}>${cell(v)}</td>`).join('')}</tr>`;
  }).join('');
  const cap = c === undefined ? '' : `<caption>${c}</caption>`;
  const wrap = regionAttrs(cap);
  return `<div class="ui-table-wrap"${wrap}><table class="ui-table">${cap}<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}
