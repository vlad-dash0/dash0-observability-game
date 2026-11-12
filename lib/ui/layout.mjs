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
 * Board and side column. Use it inside step({wide: true}): the enclosing `.ui-step` is the
 * `level` container, and from 960px of the step's width the side column is 300px and sticky;
 * narrower (a narrow step is at most 760px, so always) it stacks under the main column.
 */
export function split(args) {
  const { mainHtml, sideHtml } = opts('split', args, ['mainHtml', 'sideHtml']);
  html('split', mainHtml, 'mainHtml');
  html('split', sideHtml, 'sideHtml');
  return `<div class="ui-split"><div class="ui-split-main">${mainHtml}</div><div class="ui-split-side">${sideHtml}</div></div>`;
}

/** The actions bar: pill buttons, right-aligned, always as wide as the widest step (#331), so Next never moves; `wide` is accepted for the callers that still pass it and no longer changes the markup. */
export function actions(args) {
  const { wide = false, buttonsHtml } = opts('actions', args, ['wide', 'buttonsHtml']);
  bool('actions', wide, 'wide');
  html('actions', buttonsHtml, 'buttonsHtml');
  return `<div class="ui-actions">${buttonsHtml}</div>`;
}
