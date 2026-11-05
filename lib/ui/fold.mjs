// Kit fold (docs/DESIGN-SYSTEM.md "Components"): an evidence card that folds to one line, a
// native <details> so the browser owns open and closed. Pure string builder; DOM-free.

import { bool, fail, html, opts, token } from './check.mjs';

const CARET =
  '<svg class="ui-fold-caret" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M5 3l4 4-4 4"></path></svg>';

/**
 * `<details class="ui-fold" data-fold="<value>">`: a summary line (caret, the title as an h4 that
 * takes focus by script, `data-heading="<value>"`, optional `metaHtml`) and the body
 * (`bodyHtml`, trusted HTML). `open` starts it open; `fresh` marks the newest card (data-fresh).
 */
export function fold(args) {
  const { value, titleHtml, metaHtml, bodyHtml, open = false, fresh = false } =
    opts('fold', args, ['value', 'titleHtml', 'metaHtml', 'bodyHtml', 'open', 'fresh']);
  token('fold', value, 'value');
  const t = html('fold', titleHtml, 'titleHtml');
  if (t.trim() === '') fail('fold', 'titleHtml must not be empty');
  html('fold', metaHtml, 'metaHtml', { optional: true });
  html('fold', bodyHtml, 'bodyHtml');
  bool('fold', open, 'open');
  bool('fold', fresh, 'fresh');
  const meta = metaHtml === undefined ? '' : `<span class="ui-fold-meta">${metaHtml}</span>`;
  return `<details class="ui-fold" data-fold="${value}"${open ? ' open' : ''}${fresh ? ' data-fresh' : ''}>` +
    `<summary class="ui-fold-summary">${CARET}<h4 class="ui-fold-title" tabindex="-1" data-heading="${value}">${t}</h4>${meta}</summary>` +
    `<div class="ui-fold-body">${bodyHtml}</div></details>`;
}
