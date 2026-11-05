// Kit buttons (docs/DESIGN-SYSTEM.md "Components"): one pill shape, 14px/600, no shadow.
// primary is the red pill (D2; one per screen), ghost the outlined default, hint the violet
// outline, icon a square glyph button with a spoken label. Pure string builders; DOM-free.

import { bool, fail, idAttr, oneOf, opts, text } from './check.mjs';

export const BUTTON_VARIANTS = Object.freeze(['primary', 'ghost', 'hint', 'icon']);

/**
 * `<button class="ui-btn ui-btn--<variant>">`. `finish` adds data-finish (the level's Finish,
 * the only caller of ctx.finish); `disabled` starts it disabled. An icon button shows `icon`
 * (hidden from screen readers) and speaks `label`.
 */
export function button(args) {
  const { id, label, variant = 'ghost', disabled = false, finish = false, type = 'button', icon } =
    opts('button', args, ['id', 'label', 'variant', 'disabled', 'finish', 'type', 'icon']);
  const idA = idAttr('button', id, { optional: true });
  const l = text('button', label, 'label');
  oneOf('button', variant, BUTTON_VARIANTS, 'variant');
  bool('button', disabled, 'disabled');
  bool('button', finish, 'finish');
  oneOf('button', type, ['button', 'submit'], 'type');
  if ((variant === 'icon') !== (icon !== undefined)) fail('button', 'icon is required for, and only for, the icon variant');
  const body = variant === 'icon' ? `<span aria-hidden="true">${text('button', icon, 'icon')}</span>` : l;
  const aria = variant === 'icon' ? ` aria-label="${l}"` : '';
  return `<button type="${type}" class="ui-btn ui-btn--${variant}"${idA}${aria}${disabled ? ' disabled' : ''}${finish ? ' data-finish' : ''}>${body}</button>`;
}

/** The step's Next: primary, disabled until the widget is done. */
export function nextButton(id) {
  idAttr('nextButton', id);
  return button({ id, label: 'Next', variant: 'primary', disabled: true });
}

/** The level's Finish: primary, disabled until the last step is done, with data-finish. */
export function finishButton(id) {
  idAttr('finishButton', id);
  return button({ id, label: 'Finish', variant: 'primary', disabled: true, finish: true });
}
