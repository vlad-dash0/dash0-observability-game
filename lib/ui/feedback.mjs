// Kit feedback (docs/DESIGN-SYSTEM.md "Components"): THE one place a widget says how an
// action went. Tones: neutral (information: "Opened logs"), success (right), error (a wrong
// answer, which costs a star; D7). The tone is data-tone plus an icon with alt text, never
// colour alone. feedback() renders the region; setFeedback / clearFeedback change only the
// element they are given. DOM-free at import.

import { bool, fail, idAttr, opts } from './check.mjs';

export const FEEDBACK_TONES = Object.freeze(['neutral', 'success', 'error']);

/** A live region (role=status), hidden until set; `bar` is the slim variant under a board. */
export function feedback(args) {
  const { id, bar = false } = opts('feedback', args, ['id', 'bar']);
  const idA = idAttr('feedback', id);
  bool('feedback', bar, 'bar');
  return `<div class="ui-feedback${bar ? ' ui-feedback--bar' : ''}"${idA} role="status" aria-live="polite" tabindex="-1" hidden>` +
    '<span class="ui-feedback-ico"></span><div class="ui-feedback-text" data-feedback-text></div></div>';
}

/** The text slot of a feedback() region, or a TypeError naming `helper`. */
function slot(helper, el) {
  const s = el && typeof el.querySelector === 'function' ? el.querySelector('[data-feedback-text]') : null;
  if (!s) fail(helper, 'el must be a region rendered by feedback()');
  return s;
}

/**
 * Show `html` (trusted authored HTML; escape player text first) in region `el` with `tone`.
 * Checks everything first, so a bad call leaves the region as it was. Scrolls the region into view (#331) unless `{ scroll: false }`: pass that when a step shows its first line as it opens, which must stay at the top.
 */
export function setFeedback(el, tone, bodyHtml, { scroll = true } = {}) {
  if (!FEEDBACK_TONES.includes(tone)) fail('setFeedback', `tone must be one of ${FEEDBACK_TONES.join(', ')}, got ${String(tone)}`);
  if (typeof bodyHtml !== 'string') fail('setFeedback', 'html must be a string');
  const s = slot('setFeedback', el);
  el.setAttribute('data-tone', tone);
  s.innerHTML = bodyHtml;
  el.removeAttribute('hidden');
  // The one seam for "the answer must be seen" (#331): every widget's feedback scrolls into view, the least scroll,
  // and .ui-feedback's scroll-margin keeps it clear of the pinned footer. No animation option: the global
  // reduced-motion rule makes scroll-behavior auto.
  if (scroll && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
}

/** Hide region `el`, drop its tone and empty its text. */
export function clearFeedback(el) {
  const s = slot('clearFeedback', el);
  el.removeAttribute('data-tone');
  s.innerHTML = '';
  el.setAttribute('hidden', '');
}
