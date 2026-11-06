// The editor kit (#159): the panel shared by the code-editing widgets (a lead, a code field,
// one action and its feedback region), and the lock that ends an attempt. Built only from
// lib/ui helpers; the hint lives in the side column. DOM-free at import.

import { button, feedback, field, panel } from '../ui/index.mjs';

/**
 * Section 1: `leadHtml` (trusted, optional) and a code field; section 2: the action button
 * (disabled when `readonly`) in `.editor-actions`, then the feedback region `feedbackId`.
 */
export function editorPanel({ inputId, label, rows, value, noteHtml, readonly = false, actionId, actionLabel, feedbackId, leadHtml = '' }) {
  return panel({
    sections: [
      leadHtml + field({ id: inputId, label, kind: 'code', rows, value, noteHtml, readonly }),
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
