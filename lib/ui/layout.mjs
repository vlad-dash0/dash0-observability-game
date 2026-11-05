// Kit layout (docs/DESIGN-SYSTEM.md "Layout"): the step frame, the two-column split and the
// actions bar. Pure string builders; *Html params are trusted authored HTML. DOM-free.

import { bool, html, opts } from './check.mjs';

/**
 * The step frame: `.ui-step` caps the width at --layout-narrow (760px, centred) or, with
 * `wide`, at --layout-wide (1320px). The step type decides `wide` (lib/play.mjs STEP_TYPES).
 */
export function step(args) {
  const { wide = false, bodyHtml } = opts('step', args, ['wide', 'bodyHtml']);
  bool('step', wide, 'wide');
  html('step', bodyHtml, 'bodyHtml');
  return `<div class="ui-step${wide ? ' ui-step--wide' : ''}">${bodyHtml}</div>`;
}

/**
 * Board and side column. `.ui-split` is the `level` container: from 960px of its own width
 * the side column is 300px and sticky, below that it stacks under the main column.
 */
export function split(args) {
  const { mainHtml, sideHtml } = opts('split', args, ['mainHtml', 'sideHtml']);
  html('split', mainHtml, 'mainHtml');
  html('split', sideHtml, 'sideHtml');
  return `<div class="ui-split"><div class="ui-split-main">${mainHtml}</div><div class="ui-split-side">${sideHtml}</div></div>`;
}

/** The actions bar: pill buttons, right-aligned, as wide as the step above it. */
export function actions(args) {
  const { wide = false, buttonsHtml } = opts('actions', args, ['wide', 'buttonsHtml']);
  bool('actions', wide, 'wide');
  html('actions', buttonsHtml, 'buttonsHtml');
  return `<div class="ui-actions${wide ? ' ui-actions--wide' : ''}">${buttonsHtml}</div>`;
}
