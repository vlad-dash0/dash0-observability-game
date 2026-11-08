// The Trade-off help ladder, pure (#160; same contract as spot-it-help.mjs): the helps a trade-off
// step declares (`spec.helps`, today only `hints`) and the three hint tiers. Every tier is worked
// out from the spec's own answer and `evaluatePlan`, the one pricing of a plan, so there is no
// second grader: a hint never decides whether a plan passes, and it is never a failed Check.
// Knob labels and the authored hint are trusted authored HTML. DOM-free.

import { validateHelps } from './help-ladder.mjs';
import { allPlans, evaluatePlan } from './trade-off.mjs';

/** The Trade-off helps, in chip order: [key, label]. */
export const TRADEOFF_HELPS = Object.freeze([['hints', 'Hints']]);
const KEYS = TRADEOFF_HELPS.map(([k]) => k);

/** The tier 1 hint when a step has no authored `hint`. Plain text. */
export const TRADEOFF_RULE =
  'The plan costs the sum of the options you pick, and must fit the cap and keep every need. The cards show what each option costs, not what it keeps: work that out from what the option does. A Check shows what the picked options keep. Picking is free; a wrong Check or a hint counts as one penalty.';

/** The helps of `spec`, every key true or false. Without `helps`: hints off. */
export function tradeoffHelps(spec) {
  return Object.fromEntries(KEYS.map((k) => [k, spec.helps?.[k] === true]));
}

/** Problems with the helps of a valid TradeoffSpec (and its `hint` line). */
export function validateTradeoffHelps(spec) {
  const problems = validateHelps(spec.helps, KEYS);
  if (spec.hint !== undefined && !(typeof spec.hint === 'string' && spec.hint.trim() !== '')) {
    problems.push('hint: not non-empty text');
  }
  if (problems.some((p) => p.startsWith('helps:'))) return problems; // a malformed helps object: say only that
  if (spec.hint !== undefined && !tradeoffHelps(spec).hints) problems.push('hint: shown only when helps.hints is on');
  if (tradeoffHelps(spec).hints) {
    // Tier 2 reads the answer as the one plan that passes; a second passing plan would make it point wrongly.
    const passing = allPlans(spec).filter((p) => {
      const r = evaluatePlan(spec, p);
      return r.over === 0 && r.lost.length === 0;
    });
    if (passing.length > 1) problems.push(`helps: hints need a single passing plan, but ${passing.length} plans pass`);
  }
  return problems;
}

/**
 * Hint tier `tier` (1 to 3) for `picks`: { html, hinted, apply }; every html is a <p>.
 *   tier 1  the step's authored `hint` or TRADEOFF_RULE; nothing outlined
 *   tier 2  narrows to two options of one knob (`hinted`, [{knob, option}] in spec order): the first
 *           knob, in spec order, whose pick is not the answer's, with the answer's option and one
 *           decoy of that knob (drawn through `shuffle` from the options that are neither the
 *           answer nor the current pick, so the pair never says which is which; none left: nothing
 *           outlined); when the picks already fit the cap and keep every need, none and "press Check"
 *   tier 3  `apply` = the answer's picks; the widget picks them in and runs its Check (never a mistake)
 */
export function hintFor(spec, picks, tier, { shuffle = (list) => list } = {}) {
  if (tier === 1) return { html: `<p>${spec.hint !== undefined ? spec.hint : TRADEOFF_RULE}</p>`, hinted: [], apply: null };
  if (tier === 3) {
    return { html: '<p>Picked for you: the plan that fits the cap and keeps everything you need.</p>', hinted: [], apply: { ...spec.answer } };
  }
  const r = evaluatePlan(spec, picks);
  if (r.complete && r.over === 0 && r.lost.length === 0) {
    return { html: '<p>Your picks already fit the cap and keep everything you need. Press Check.</p>', hinted: [], apply: null };
  }
  const knob = spec.knobs.find((k) => picks[k.id] !== spec.answer[k.id]);
  // The decoy is never the current pick: that pick is wrong, so the other outlined card would be the answer.
  const decoys = knob.options.filter((o) => o.id !== spec.answer[knob.id] && o.id !== picks[knob.id]).map((o) => o.id);
  if (decoys.length === 0) {
    return { html: `<p>Look again at: ${knob.label}.</p>`, hinted: [], apply: null };
  }
  const decoy = shuffle([...decoys])[0];
  const hinted = knob.options.filter((o) => o.id === spec.answer[knob.id] || o.id === decoy).map((o) => ({ knob: knob.id, option: o.id }));
  return {
    html: `<p>Look again at: ${knob.label}. One of the two outlined options belongs in a plan that fits the cap and keeps everything you need.</p>`,
    hinted,
    apply: null,
  };
}
