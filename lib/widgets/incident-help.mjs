// The incident board's hint tiers, pure (#143; docs/M1-DESIGN.md §4.3). hintFor(s, st, tier)
// -> {html, views, hypothesis}: the hint text (authored HTML), the tiles to outline and the
// cause to outline (or null). Tier 1 is the scenario's authored `hint`, else one generic rule
// that names nothing; tier 2 names two clue views, unopened first, and outlines only the
// unopened; tier 3 names the right cause, outlines it and says how to unlock it only while it
// is locked. A hint never changes the state or unlocks anything (canAnswer stays the one rule),
// and which views are clues comes only from `clueIds`. DOM-free.

import { HINT_TIERS } from './help-ladder.mjs';
import { canAnswer, clueIds } from './incident.mjs';

/** Tier 1 when the scenario authors none: one rule for every board, naming no view. */
export const GENERIC_HINT =
  'Read what the alert says, then open the views that could explain it rather than the ones that only describe load or health. ' +
  'Every look costs minutes, and some views mislead.';

/** "1 clue", "2 clues": the one wording of a count of clues (the board's lock line uses it too). */
export const countClues = (n) => `${n} clue${n === 1 ? '' : 's'}`;

/** Tier 2: two clue views, the unopened ones first (stable), and which of them are still unopened. */
function worthOpening(s, st) {
  const label = (id) => s.views.find((v) => v.id === id).label;
  const ids = clueIds(s);
  const picked = [...ids.filter((id) => !st.opened.includes(id)), ...ids.filter((id) => st.opened.includes(id))].slice(0, 2);
  const views = picked.filter((id) => !st.opened.includes(id));
  const names = picked.map((id) => `<b>${label(id)}</b>`).join(' and ');
  const note = views.length > 0 ? ' (outlined in Step 1)' : picked.length === 2 ? ' (you have both open)' : ' (you have it open)';
  return { html: `<p>Worth opening: ${names}${note}.</p>`, views, hypothesis: null };
}

/** Tier 3: the right cause, outlined; the unlock clause only while the causes are locked. */
function theCause(s, st) {
  const right = s.hypotheses.find((h) => h.right);
  const clause = canAnswer(s, st) ? '' : ` It stays locked until you have found ${countClues(s.answerAfterViews)}.`;
  return {
    html: `<p>The cause the evidence supports is <b>${right.label}</b>, outlined in Step 3.${clause}</p>`,
    views: [],
    hypothesis: right.id,
  };
}

/** The hint for `tier` (1 to 3) in state `st`. Throws a TypeError for another tier. */
export function hintFor(s, st, tier) {
  if (!Number.isInteger(tier) || tier < 1 || tier > HINT_TIERS) {
    throw new TypeError(`incident hint: tier must be an integer from 1 to ${HINT_TIERS}, got ${String(tier)}`);
  }
  if (tier === 1) return { html: s.hint ?? `<p>${GENERIC_HINT}</p>`, views: [], hypothesis: null };
  return tier === 2 ? worthOpening(s, st) : theCause(s, st);
}
