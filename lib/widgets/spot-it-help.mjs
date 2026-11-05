// The Spot it help ladder, pure (#160; docs/M1-DESIGN.md §4.4): the helps a spot step declares
// (`spec.helps`, today only `hints`) and the three hint tiers. Everything derives from what
// `checkSpot` reports for the current picks (`extra`: picked non-faults, `missing`: unpicked
// faults); this module never reads the spec's answer itself, so there is no second grader.
// Line text is plain text and escaped. DOM-free.

import { validateHelps } from './help-ladder.mjs';
import { checkSpot } from './spot-it.mjs';

/** The Spot it helps, in chip order: [key, label]. */
export const SPOT_HELPS = Object.freeze([['hints', 'Hints']]);
const KEYS = SPOT_HELPS.map(([k]) => k);

/** The tier 1 hint when a step has no authored `hint`. Plain text. */
export const SPOT_RULE =
  'Ask the question of each line on its own. How unusual a line looks tells you nothing. Picking is free; a wrong Check or a hint costs a star.';

/** The helps of `spec`, every key true or false. Without `helps`: hints off. */
export function spotHelps(spec) {
  return Object.fromEntries(KEYS.map((k) => [k, spec.helps?.[k] === true]));
}

/** Problems with the helps of a valid SpotSpec (and its `hint` line). */
export function validateSpotHelps(spec) {
  const problems = validateHelps(spec.helps, KEYS);
  if (spec.hint !== undefined && !(typeof spec.hint === 'string' && spec.hint.trim() !== '')) {
    problems.push('hint: not non-empty text');
  }
  if (problems.some((p) => p.startsWith('helps:'))) return problems; // a malformed helps object: say only that
  if (spec.hint !== undefined && !spotHelps(spec).hints) problems.push('hint: shown only when helps.hints is on');
  return problems;
}

const defaultEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Hint tier `tier` (1 to 3) for the picks in `state`: { html, hinted, apply }; every html is a <p>.
 *   tier 1  the step's authored `hint` or SPOT_RULE; nothing outlined
 *   tier 2  narrows to two lines (`hinted`, spec order): with a fault still unpicked, that fault
 *           and a decoy (an unpicked non-fault, never a picked line); with only wrong picks, one
 *           wrong pick and one right pick; with nothing wrong or missing, none. Both random
 *           choices go through `shuffle`, so the pair never leaks which one is which
 *   tier 3  `apply` = the line ids the picks must become (every line that belongs, nothing
 *           else, spec order); the widget toggles them in and runs its Check (never a mistake)
 */
export function hintFor(spec, state, tier, { shuffle = (list) => list, e = defaultEscape } = {}) {
  if (tier === 1) return { html: `<p>${spec.hint !== undefined ? spec.hint : SPOT_RULE}</p>`, hinted: [], apply: null };
  const { extra, missing } = checkSpot(spec, state); // the returned state is thrown away
  const ids = spec.lines.map((l) => l.id);
  const inOrder = (list) => ids.filter((id) => list.includes(id));
  const code = (id) => `<code>${e(spec.lines.find((l) => l.id === id).text)}</code>`;
  if (tier === 2) {
    if (missing.length > 0) {
      const m = shuffle([...missing])[0];
      const unpicked = ids.filter((id) => !state.selected.includes(id) && !missing.includes(id));
      const d = unpicked.length === 0 ? undefined : shuffle([...unpicked])[0];
      if (d === undefined) {
        return { html: `<p>${code(m)} belongs and is not picked yet.</p>`, hinted: [m], apply: null };
      }
      const pair = inOrder([m, d]);
      return {
        html: `<p>One of these two outlined lines belongs and is not picked yet: ${code(pair[0])} or ${code(pair[1])}.</p>`,
        hinted: pair,
        apply: null,
      };
    }
    if (extra.length > 0) {
      const x = shuffle([...extra])[0];
      const right = state.selected.filter((id) => !extra.includes(id));
      const f = shuffle([...right])[0];
      const pair = inOrder([x, f]);
      return {
        html: `<p>One of these two outlined picks does not belong: ${code(pair[0])} or ${code(pair[1])}.</p>`,
        hinted: pair,
        apply: null,
      };
    }
    return { html: '<p>Your picks are already the answer. Press Check.</p>', hinted: [], apply: null };
  }
  const apply = inOrder([...state.selected.filter((id) => !extra.includes(id)), ...missing]);
  return { html: '<p>Picked for you: every line that belongs, and nothing else.</p>', hinted: [], apply };
}
