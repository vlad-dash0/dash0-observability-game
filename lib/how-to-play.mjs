// The how-to-play copy, one entry per widget, and the view of it for one level (#199). Plain
// text only (no markup, no escaping needed); DOM-free. The How to play modal (app.mjs, howToView) shows one guide at a time, the
// type of the step the player is on (#316); each guide is a few labelled parts. Every claim about
// what costs a star comes from the widget's own PENALTY (exported beside the mount that
// charges it; the Build it board's lives in lib/widgets/help-ladder.mjs, with the ladder), and the ladder
// from LADDER_RUNGS (generated from lib/scoring.mjs), so this file states no star number. A level lists its widgets (registry `widgets`); with none, there is
// no help to show and none is guessed.

import { LADDER_RUNGS, PENALTY as BUILD_PENALTY } from './widgets/help-ladder.mjs';
import { PENALTY as CHOICE_PENALTY } from './widgets/choice.mjs';
import { PENALTY as SORT_PENALTY } from './widgets/sort-it-view.mjs';
import { PENALTY as SPOT_PENALTY } from './widgets/spot-it-view.mjs';
import { PENALTY as INCIDENT_PENALTY } from './widgets/incident-view.mjs';
import { PENALTY as TRADEOFF_PENALTY } from './widgets/trade-off-view.mjs';
import { PENALTY as QUERY_PENALTY } from './widgets/query-it-view.mjs';
import { PENALTY as CONFIGURE_PENALTY } from './widgets/configure-it-view.mjs';

/** Said once a level has a par time (lib/scoring.mjs: over par is one more penalty). */
export const PAR = 'Finishing slower than the level\'s par time counts as one more penalty.';
/** Said instead of the ladder on a level that gives no stars. */
export const NOT_SCORED = 'This level is not scored, so it gives no stars.';
/** Progress only goes up (lib/progress.mjs). */
export const REPLAY = 'Replaying never lowers your best.';

/** Said for a widget with no Hint button on any of its steps on the level. */
export const NO_HINTS = 'This step has no Hint button.';
const ONE_HINT = 'A hint costs one penalty. Some steps have no Hint button.';
const TIERED_HINTS = 'Each hint costs one penalty. The Hint button shows what the next one costs.';

/**
 * The help for each widget: `{title, play, penalty, hints}`. `play` is a few short sentences,
 * `penalty` the widget's own PENALTY object (the same one, never a copy), `hints` what a hint does.
 */
export const HOW_TO = Object.freeze({
  choice: Object.freeze({
    title: 'Multiple choice',
    play: Object.freeze([
      'Read the question and pick the answer you think is right.',
      'A wrong pick shows "Not quite" and the reason. You can then try another answer.',
    ]),
    penalty: CHOICE_PENALTY,
    hints: NO_HINTS,
  }),
  sort: Object.freeze({
    title: 'Sort it',
    play: Object.freeze([
      'Pick one to sort, then choose where it goes. You can also drag it there.',
      'A wrong placement shows "Not quite" for that item. Try another category.',
    ]),
    penalty: SORT_PENALTY,
    hints: TIERED_HINTS,
  }),
  build: Object.freeze({
    title: 'Build it',
    play: Object.freeze([
      'Rebuild the trace. Pick a span, then set what the step asks for.',
      'Usually that is its parent: drag the span onto the parent, or pick the parent. Some steps ask for a kind, a status, links, or the span a log record belongs to.',
      'The step says whether each change is checked at once or when you press Check.',
    ]),
    penalty: BUILD_PENALTY,
    hints: TIERED_HINTS,
  }),
  spot: Object.freeze({
    title: 'Spot it',
    play: Object.freeze(['Pick every line that matches the question, then press Check.']),
    penalty: SPOT_PENALTY,
    hints: TIERED_HINTS,
  }),
  incident: Object.freeze({
    title: 'Incident',
    play: Object.freeze([
      'Open evidence views to investigate. Each view costs minutes of your error budget.',
      'Once you have found enough real clues, the possible causes unlock.',
      'Then pick the cause the evidence supports.',
    ]),
    penalty: INCIDENT_PENALTY,
    hints: TIERED_HINTS,
  }),
  tradeoff: Object.freeze({
    title: 'Trade-off',
    play: Object.freeze([
      'Choose one option for every knob. The plan cost updates as you pick.',
      'The cards do not list what each option keeps. Work that out from what the option does.',
      'Stay within the cap while keeping everything you need, then press Check.',
      'After Check, each card shows what it keeps.',
    ]),
    penalty: TRADEOFF_PENALTY,
    hints: TIERED_HINTS,
  }),
  query: Object.freeze({
    title: 'Query it',
    play: Object.freeze([
      'Write a PromQL query and press Run.',
      'A new query that runs shows its result. Running one you already tried shows the same result again, and that is free.',
      'A syntax error or an unsupported feature is explained, not marked wrong.',
    ]),
    penalty: QUERY_PENALTY,
    hints: ONE_HINT,
  }),
  configure: Object.freeze({
    title: 'Configure it',
    play: Object.freeze([
      'Edit the config and press Check.',
      'The feedback says what Check found. Keep going until it passes.',
    ]),
    penalty: CONFIGURE_PENALTY,
    hints: ONE_HINT,
  }),
});

/** `costs` split at its top-level commas (a comma inside parentheses stays in its item). */
function costItems(costs) {
  const items = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < costs.length; i++) {
    if (costs[i] === '(') depth++;
    else if (costs[i] === ')') depth--;
    else if (costs[i] === ',' && depth === 0) {
      items.push(costs.slice(at, i).trim());
      at = i + 1;
    }
  }
  items.push(costs.slice(at).trim());
  return items;
}

/**
 * The cost sentence of one widget, from its PENALTY: one cost is "A wrong pick costs one penalty.",
 * several "Each of these costs one penalty: a, b and c."; then what is free (nothing, when it names none).
 */
function costsOf({ costs, free }) {
  const items = costItems(costs);
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  const head = items.length === 1 ? `${list[0].toUpperCase()}${list.slice(1)} costs one penalty.` : `Each of these costs one penalty: ${list}.`;
  return `${head}${free === '' ? '' : ` ${free}`}`;
}

/** "No penalties", "1 penalty", "3 or 4 penalties", "3 to 5 penalties", "5 or more penalties" for one rung. */
function rungWho({ from, to }, tail) {
  if (tail) return `${from} or more penalties`;
  if (from === 0 && to === 0) return 'No penalties';
  if (from === to) return `${from} ${from === 1 ? 'penalty' : 'penalties'}`;
  return `${from}${to - from === 1 ? ' or ' : ' to '}${to} penalties`;
}

/** One line per rung of the star ladder: "No penalties: 5 stars". */
const ladderItems = () =>
  LADDER_RUNGS.map((r, i) => {
    const tail = i === LADDER_RUNGS.length - 1;
    const who = LADDER_RUNGS.length === 1 ? 'Any number of penalties' : rungWho(r, tail);
    return `${who}: ${r.stars} ${r.stars === 1 ? 'star' : 'stars'}`;
  });

const part = (label, { text = '', items = [], note = '' } = {}) => ({ label, text, items, note });

/**
 * The help for `level` ({widgets, hintless, scored, scoring: {parMs}}, a built registry level), as
 * `{topics: [{key, title, parts}]}`: one topic per distinct widget in play order, which the modal shows
 * one at a time. `parts` are `{label, text, items, note}`, in order: How it works (the steps, as
 * `text` when there is one and `items` when there are several), What costs a star (scored levels
 * only), Hints, Your stars (the ladder as `items` plus the par and replay `note`; on an unscored
 * level NOT_SCORED as `text`). A widget in `hintless` (no step of it on the level shows a Hint button)
 * says NO_HINTS, whatever its entry says. No widgets: no topics.
 * Throws on a widget with no entry (the registry never lets one through).
 */
export function howToView(level) {
  const keys = [...new Set(level.widgets)];
  const hintless = new Set(level.hintless ?? []);
  const topics = keys.map((key) => {
    const entry = Object.hasOwn(HOW_TO, key) ? HOW_TO[key] : null;
    if (entry === null) throw new TypeError(`how to play: no help for widget ${JSON.stringify(key)}`);
    const one = entry.play.length === 1;
    const parts = [part('How it works', one ? { text: entry.play[0] } : { items: [...entry.play] })];
    if (level.scored) parts.push(part('What costs a star', { text: costsOf(entry.penalty) }));
    parts.push(part('Hints', { text: hintless.has(key) ? NO_HINTS : entry.hints }));
    if (level.scored) {
      const par = level.scoring.parMs != null ? `${PAR} ` : '';
      parts.push(part('Your stars', { items: ladderItems(), note: `${par}${REPLAY}` }));
    } else parts.push(part('Your stars', { text: NOT_SCORED }));
    return { key, title: entry.title, parts };
  });
  return { topics };
}
