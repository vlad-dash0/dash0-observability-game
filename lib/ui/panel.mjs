// Kit panel (docs/DESIGN-SYSTEM.md "Components"): a surface card with a 1px border and
// divided sections. Variants: inset (a card inside a card), alert (the firing banner, D1),
// drop (dashed: drop zones only). Pure string builder; DOM-free.

import { fail, html, idAttr, oneOf, opts } from './check.mjs';

export const PANEL_VARIANTS = Object.freeze(['inset', 'alert', 'drop']);

/** `<section class="ui-panel">`: an optional head, then one `.ui-panel-sec` per section (trusted HTML). */
export function panel(args) {
  const { id, variant, headHtml, sections } = opts('panel', args, ['id', 'variant', 'headHtml', 'sections']);
  const idA = idAttr('panel', id, { optional: true });
  if (variant !== undefined) oneOf('panel', variant, PANEL_VARIANTS, 'variant');
  html('panel', headHtml, 'headHtml', { optional: true });
  if (!Array.isArray(sections) || sections.length === 0) fail('panel', 'sections must be a non-empty array');
  sections.forEach((s, i) => html('panel', s, `sections[${i}]`));
  const cls = variant === undefined ? 'ui-panel' : `ui-panel ui-panel--${variant}`;
  const head = headHtml === undefined ? '' : `<div class="ui-panel-head">${headHtml}</div>`;
  return `<section class="${cls}"${idA}>${head}${sections.map((s) => `<div class="ui-panel-sec">${s}</div>`).join('')}</section>`;
}
