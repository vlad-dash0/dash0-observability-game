// The Sort it help ladder, pure (#156; docs/M1-DESIGN.md §4.1): the helps a sort step
// declares (`spec.helps`, today only `hints`), which item a hint is for, and the three
// hint tiers and which of them an item still has. Everything derives from the spec's answer
// (`bucketOf`, the way `place` reads it) and the state: there is no second grader. Bucket
// labels and `why` are authored HTML. DOM-free.

import { validateHelps } from './help-ladder.mjs';
import { bucketOf, remaining, untried } from './sort-it.mjs';

/** The Sort it helps, in chip order: [key, label]. Instant feedback is always on, so it has no key. */
export const SORT_HELPS = Object.freeze([['hints', 'Hints']]);
const KEYS = SORT_HELPS.map(([k]) => k);

/** The tier 1 hint when a step has no authored `hint`. Plain text. */
export const SORT_RULE =
  'Ask what the item actually is or does, then which bucket describes that. Each bucket you rule out narrows the rest.';

/** The helps of `spec`, every key true or false. Without `helps`: hints off. */
export function sortHelps(spec) {
  return Object.fromEntries(KEYS.map((k) => [k, spec.helps?.[k] === true]));
}

/** Problems with the helps of a valid SortSpec (and its `hint` line). */
export function validateSortHelps(spec) {
  const problems = validateHelps(spec.helps, KEYS);
  if (spec.hint !== undefined && !(typeof spec.hint === 'string' && spec.hint.trim() !== '')) {
    problems.push('hint: not non-empty text');
  }
  if (problems.some((p) => p.startsWith('helps:'))) return problems; // a malformed helps object: say only that
  if (spec.hint !== undefined && !sortHelps(spec).hints) problems.push('hint: shown only when helps.hints is on');
  return problems;
}

/**
 * The item a hint is for: the selected one if it is still remaining, else the first remaining
 * item in display order (`order`, item ids; spec order if absent). Null when none is left.
 */
export function hintTarget(spec, state, { order = null, selected = null } = {}) {
  const left = remaining(spec, state);
  if (selected !== null && left.includes(selected)) return selected;
  const ids = [...(Array.isArray(order) ? order : []), ...spec.items.map((it) => it.id)];
  return ids.find((id) => left.includes(id)) ?? null;
}

const labelOf = (spec, id) => spec.buckets.find((b) => b.id === id).label;

/** Untried buckets an item needs for tier 2 to narrow it: the right one, a decoy, and one more. */
export const NARROWS_AT = 3;

/**
 * The hint ladder of item `itemId` at this moment: { tiers, done, next }.
 *   tiers  the tier numbers the item has, ascending: 1 (the rule), 2 only when it narrows
 *          (the item's untried buckets number NARROWS_AT or more, or tier 2 was already taken),
 *          always 3 (the placement)
 *   done   how many of them are used: tier 1 counts once the rule was shown for ANY item
 *          (`ruleShown`, charged once per board), tier 2 once it is in `taken` (this item's)
 *   next   the next tier to give, or null when the ladder is spent or only the right bucket is
 *          left untried (a hint would tell nothing)
 * The label "Hint done+1 of tiers.length" is honest: a 2-bucket board after the rule reads 2 of 2.
 */
export function hintLadder(spec, state, itemId, { ruleShown = false, taken = [] } = {}) {
  const two = taken.includes(2) || untried(spec, state, itemId).length >= NARROWS_AT;
  const tiers = [1, ...(two ? [2] : []), 3];
  const used = (t) => (t === 1 ? ruleShown || taken.includes(1) : taken.includes(t));
  const done = tiers.filter(used).length;
  const next = untried(spec, state, itemId).length === 1 ? null : (tiers.find((t) => !used(t)) ?? null);
  return { tiers, done, next };
}

/**
 * Hint tier `tier` (1 to 3) for item `itemId`: { html, cands, apply }; every html is a <p>.
 * Tier 1 is the step's authored `hint` or SORT_RULE. Tier 2 (only offered when it narrows, see
 * hintLadder) narrows to two buckets (`cands`, in spec order): the right one and a decoy
 * picked by `shuffle` from the buckets not yet tried for the item (never a tried one). Tier 3
 * gives the answer and `apply` = {bucket}, which the widget places through `place` (never a
 * mistake).
 */
export function hintFor(spec, state, itemId, tier, { shuffle = (list) => list } = {}) {
  const item = spec.items.find((it) => it.id === itemId);
  const right = bucketOf(spec, itemId);
  if (tier === 1) return { html: `<p>${spec.hint !== undefined ? spec.hint : SORT_RULE}</p>`, cands: [], apply: null };
  if (tier === 2) {
    const wrong = untried(spec, state, itemId).filter((b) => b !== right);
    const decoy = wrong.length === 0 ? undefined : shuffle([...wrong])[0];
    const cands = spec.buckets.map((b) => b.id).filter((b) => b === right || b === decoy);
    const html = `<p>It is one of these two: ${cands.map((c) => `<b>${labelOf(spec, c)}</b>`).join(' or ')}.</p>`;
    return { html, cands, apply: null };
  }
  return { html: `<p>Placed for you. ${item.label} goes in <b>${labelOf(spec, right)}</b>. ${item.why}</p>`, cands: [], apply: { bucket: right } };
}
