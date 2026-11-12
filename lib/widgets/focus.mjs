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
 *
 * Known differences from the browser's focusable-area rule: a control counts as disabled
 * only by its own disabled property or a disabled fieldset, and the fieldset rules out any element inside it, so an a[href] or tabindex element there is not focusable here, though a browser (which disables only form controls) would focus it;
 * contenteditable, summary and area are not focusable here unless they carry a tabindex;
 * and nothing hidden is detected (the hidden attribute, display:none, visibility, inert).
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
 * with none focusable the key is left unhandled (no preventDefault) and focus stays. Other keys are untouched.
 */
export function escapeFromHint(text, ...targets) {
  if (!text) return;
  text.onkeydown = (e) => {
    if (e?.key !== 'Escape') return;
    // A target may be a function (read when the key is pressed, as the control it names can change) returning an element or a list.
    const to = targets.flatMap((t) => (typeof t === 'function' ? t() : t)).find(canFocus);
    if (!to) return; // nothing to move to: leave the key to the app, as before
    e.preventDefault();
    to.focus();
  };
}

/**
 * Where a new step puts focus (#339): `el` (the step's first control) when it is fully inside the visible area, which ends at
 * the pinned footer (.ui-actions) or the viewport bottom, whichever is higher; else the step's heading (its question when that is in view, else its
 * lesson), made focusable with tabindex=-1. Never scrolls (preventScroll), so the step stays at its top. Returns the element
 * focused. Without layout (no getBoundingClientRect, or a box of zero size) `el` counts as visible.
 */
export function focusFirst(el, { fallback = null } = {}) {
  const target = canFocus(el) ? el : fallback;
  if (!target) return null;
  if (target === el && !isBelowFold(el)) {
    el.focus({ preventScroll: true });
    return el;
  }
  const step = el?.closest?.('.ui-step') ?? null;
  // The question when it is in view, else the lesson (the step's top); with no lesson, the question wherever it is.
  const question = step?.querySelector('.ui-question') ?? null;
  const lesson = step?.querySelector('.ui-lesson') ?? null;
  const head = question && !isBelowFold(question) ? question : lesson ?? question;
  const to = target === el && head ? head : target;
  if (to !== el && !to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1');
  to.focus({ preventScroll: true });
  return to;
}

/** True when `el` is not wholly above the footer bar and inside the viewport (a zero-size box, as in a DOM without layout, is visible). */
function isBelowFold(el) {
  if (typeof el.getBoundingClientRect !== 'function') return false;
  const r = el.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return false;
  const doc = el.ownerDocument;
  // The pinned footer is the app's #ov-actions bar (its padding sits above .ui-actions); the kit bar alone in a bare DOM.
  const tops = ['#ov-actions', '.ui-actions'].map((sel) => doc.querySelector(sel)?.getBoundingClientRect?.().top);
  const view = doc.defaultView?.innerHeight;
  const limit = Math.min(...[...tops, view].map((t) => (t > 0 ? t : Infinity)));
  return r.top < 0 || r.bottom > limit;
}
