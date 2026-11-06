// The one rule for "can this element take focus now", shared by every widget (where
// focus goes next) and by test/helpers/focus.mjs (what a focus walk accepts).
// DOM-free at import time.

const NATIVE = new Set(['button', 'input', 'select', 'textarea']);

/**
 * True when a fieldset[disabled] ancestor disables `el`. A control inside that fieldset's
 * first <legend> stays enabled (HTML: "disabled fieldset").
 */
function inDisabledFieldset(el) {
  for (let fs = el.parentElement; fs; fs = fs.parentElement) {
    if (fs.localName !== 'fieldset' || !fs.hasAttribute('disabled')) continue;
    const legend = [...fs.children].find((c) => c.localName === 'legend');
    if (!legend || !legend.contains(el)) return true;
  }
  return false;
}

/**
 * True only for an element that is connected, not disabled (nor inside a disabled
 * fieldset), not input[type=hidden], and natively focusable (button, input, select,
 * textarea, a[href]) or carrying a tabindex attribute.
 */
export function canFocus(el) {
  if (!el || el.nodeType !== 1 || !el.isConnected) return false;
  if (el.disabled || inDisabledFieldset(el)) return false;
  const tag = el.localName;
  if (tag === 'input' && (el.getAttribute('type') ?? '').toLowerCase() === 'hidden') return false;
  const native = NATIVE.has(tag) || (tag === 'a' && el.hasAttribute('href'));
  return native || el.hasAttribute('tabindex');
}

/**
 * Escape on a shown hint (#178): the hint is the innermost thing, so the key must not
 * reach the app's Escape and close the level. Wires `text.onkeydown` so Escape calls
 * preventDefault and moves focus to the first of `targets` that canFocus (the hint
 * button, then for a once-only hint, whose button is now disabled, the field to work in);
 * with none focusable focus stays on the hint. Other keys are untouched.
 */
export function escapeFromHint(text, ...targets) {
  if (!text) return;
  text.onkeydown = (e) => {
    if (e?.key !== 'Escape') return;
    e.preventDefault();
    targets.find(canFocus)?.focus();
  };
}
