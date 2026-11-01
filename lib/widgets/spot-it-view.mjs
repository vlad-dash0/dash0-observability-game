// Spot it widget view (docs/M1-DESIGN.md §4.4): markup for a SpotSpec and SpotState, and
// mountSpot, the only home of "a wrong check costs one mistake; repeating the same
// selection is free" (I1). Line text is plain text and escaped; `explain` and `whyNot` are
// trusted authored HTML; ids are escaped. DOM-free at import time.

import { canFocus } from './focus.mjs';
import { checkSpot, newSpotState, toggleLine, validateSpotSpec } from './spot-it.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;

/**
 * Markup for Spot it `spec` in `state`: one toggle button per line (`data-line`,
 * `aria-pressed`, the escaped text in <code> as its accessible name), `#<id>-check` and the
 * `#<id>-feedback` status region. With `labelledBy` (a plain token; TypeError otherwise)
 * the widget is a labelled group.
 */
export function renderSpot(spec, state, { escapeHtml: e, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`spot "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const off = state.solved ? ' disabled' : '';
  const lines = spec.lines
    .map(
      (l) =>
        `<li><button class="spot-line" data-line="${e(l.id)}" aria-pressed="${state.selected.includes(l.id)}"${off}>` +
        `<code>${e(l.text)}</code></button></li>`,
    )
    .join('');
  return (
    `<div class="spot" data-spot="${e(spec.id)}" data-target="${e(spec.target)}"${group}>` +
    `<ul class="spot-lines">${lines}</ul>` +
    `<button class="btn" id="${e(spec.id)}-check"${off}>Check</button>` +
    `<div class="feedback" id="${e(spec.id)}-feedback" role="status" aria-live="polite" tabindex="-1"></div>` +
    `</div>`
  );
}

/**
 * Wire Spot it `spec` (rendered by renderSpot into ctx.ovBody) from a fresh state and focus
 * its first line. Lines toggle in place (free, focus stays). Check: nothing selected, "Pick
 * at least one line first." (free); a wrong selection, ctx.mistake() and "Not quite. ..."
 * with the `whyNot` of each picked non-fault (the faults are never revealed); the same wrong
 * selection again, "Same as last time: ..." (free); exactly the fault set, "Right. <explain>",
 * lines and Check locked, onComplete() once and its return focused if it passes canFocus,
 * else the feedback. Throws TypeError (naming the spec id) for an invalid spec, a missing
 * onComplete, or a spec that is not rendered.
 */
export function mountSpot(ctx, spec, { onComplete } = {}) {
  const problems = validateSpotSpec(spec);
  const fail = (msg) => {
    throw new TypeError(`spot "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-spot="${spec.id}"]`);
  const checkBtn = box?.querySelector(`[id="${spec.id}-check"]`);
  const fb = box?.querySelector(`[id="${spec.id}-feedback"]`);
  if (!box || !checkBtn || !fb) fail('not rendered (use renderSpot with the same spec)');

  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };

  let state = newSpotState(spec);

  for (const btn of box.querySelectorAll('[data-line]')) {
    btn.onclick = () => {
      if (btn.disabled) return;
      state = toggleLine(spec, state, btn.dataset.line).state;
      btn.setAttribute('aria-pressed', String(state.selected.includes(btn.dataset.line)));
    };
  }

  checkBtn.onclick = () => {
    if (checkBtn.disabled) return;
    const result = checkSpot(spec, state);
    state = result.state;
    if (result.outcome === 'right') {
      for (const btn of box.querySelectorAll('[data-line]')) btn.disabled = true;
      checkBtn.disabled = true;
      say('good', `Right. ${spec.explain}`);
      focusOn(onComplete());
      return;
    }
    if (result.outcome === 'empty') {
      say('info', 'Pick at least one line first.');
    } else if (result.outcome === 'repeat') {
      say('info', 'Same as last time: that selection is still wrong.');
    } else {
      ctx.mistake();
      // Own keys only: a line id like "constructor" must not read Object.prototype.
      const why = result.extra.filter((id) => Object.hasOwn(spec.whyNot ?? {}, id)).map((id) => spec.whyNot[id]);
      const head = result.extra.length
        ? `${result.extra.length} of your picks ${result.extra.length === 1 ? 'is' : 'are'} not a fault.`
        : 'Everything you picked is a fault, but there is more.';
      say('info', ['Not quite.', head, ...why].join(' '));
    }
    fb.focus();
  };

  focusOn(box.querySelector(`[data-line="${spec.lines[0].id}"]`));
}
