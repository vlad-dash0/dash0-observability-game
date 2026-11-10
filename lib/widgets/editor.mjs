// The editor kit (#159): the panel shared by the code-editing widgets (a lead, a code field,
// one action and its feedback region), and the lock that ends an attempt. Built only from
// lib/ui helpers; the hint lives in the side column. DOM-free at import.

import { button, feedback, field, panel } from '../ui/index.mjs';

/**
 * `wrap` soft-wraps the code field (queries, env lists); YAML keeps its lines.
 * Section 1: `leadHtml` (trusted, optional) and a code field; section 2: the action button
 * (disabled when `readonly`) in `.editor-actions`, then the feedback region `feedbackId`.
 */
export function editorPanel({ inputId, label, rows, value, noteHtml, wrap = false, readonly = false, actionId, actionLabel, feedbackId, leadHtml = '' }) {
  return panel({
    sections: [
      leadHtml + field({ id: inputId, label, kind: 'code', rows, value, noteHtml, wrap, readonly }),
      '<div class="editor-actions">' +
        button({ id: actionId, label: actionLabel, variant: 'primary', disabled: readonly }) +
        '</div>' + feedback({ id: feedbackId }),
    ],
  });
}

/**
 * End editing: the input goes read-only (never disabled, so it keeps focus and can still be
 * selected and copied) and each button is disabled.
 */
export function lockEditor(input, ...buttons) {
  input.readOnly = true;
  for (const b of buttons) b.disabled = true;
}

/**
 * Make a code textarea grow with its text so the page has one scroll: its `rows` attribute (set
 * in markup, never a style, so the CSP holds) is the minimum, `max` the most it grows to; past
 * that it scrolls inside. The row count starts at the number of lines and adds rows while the
 * browser still reports overflow, which covers soft-wrapped lines. Refits on typing and, where
 * the browser has a ResizeObserver, when the width changes (not the height, which is our own doing) (a phone turning). Returns `fit`: call
 * it after setting `input.value` from script, which fires no input event. `signal` (the level's) removes the listener and disconnects the observer when it aborts.
 */
export function fitEditor(input, { max = 40, signal } = {}) {
  const min = Number(input.getAttribute('data-min-rows') ?? input.getAttribute('rows')) || 3;
  input.setAttribute('data-min-rows', String(min));
  let busy = false;
  let lastWidth;
  const fit = () => {
    if (busy) return;
    busy = true;
    lastWidth = input.clientWidth;
    const lines = String(input.value ?? '').split('\n').length;
    let rows = Math.min(max, Math.max(min, lines));
    input.setAttribute('rows', String(rows));
    // scrollHeight is undefined off a browser (the DOM tests), so the loop is a no-op there.
    while (rows < max && input.scrollHeight > input.clientHeight + 1) {
      rows += 1;
      input.setAttribute('rows', String(rows));
    }
    busy = false;
  };
  input.addEventListener('input', fit, { signal });
  if (typeof globalThis.ResizeObserver === 'function') {
    // Refit only when the width changed since the last fit: a wrap change is the only resize that alters the
    // rows, and setting `rows` moves the height alone, so the refit never re-triggers itself (no
    // "ResizeObserver loop" warning, and no timer or frame needed).
    const ro = new globalThis.ResizeObserver(() => {
      if (input.clientWidth !== lastWidth) fit();
    });
    ro.observe(input);
    signal?.addEventListener('abort', () => ro.disconnect(), { once: true });
  }
  fit();
  return fit;
}
