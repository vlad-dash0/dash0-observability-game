// The how-to-play copy, one entry per widget, and the view of it for one level (#199). Plain
// text only (no markup, no escaping needed); DOM-free, no UI reads it yet. Every claim about
// what costs a star comes from the widget's own PENALTY (exported beside the mount that
// charges it; the Build it board's lives in lib/widgets/help-ladder.mjs, with the ladder), and the ladder
// from LADDER (generated from lib/scoring.mjs), so this file states no star number. A level lists its widgets (registry `widgets`); with none, there is
// no help to show and none is guessed.

import { LADDER, PENALTY as BUILD_PENALTY } from './widgets/help-ladder.mjs';
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
export const NO_HINTS = 'No hints.';
const ONE_HINT = 'Show a hint costs one penalty. Some steps have no hint.';
const TIERED_HINTS =
  "Each hint counts as one penalty. Where the board has hints, the Hint button shows what the next one costs on that board's score card.";

/**
 * The help for each widget: `{title, play, penalty, hints}`. `penalty` is the widget's own
 * PENALTY object (the same one, never a copy), `hints` what a hint does for that widget.
 */
export const HOW_TO = Object.freeze({
  choice: Object.freeze({
    title: 'Multiple choice',
    play: 'Pick the answer you think is right. A wrong pick gets a Not quite and its reason, and you can try another.',
    penalty: CHOICE_PENALTY,
    hints: NO_HINTS,
  }),
  sort: Object.freeze({
    title: 'Sort it',
    play: 'Drag each item into the right bucket, or pick an item and then a bucket. A wrong placement gets a Not quite for that item; try another bucket.',
    penalty: SORT_PENALTY,
    hints: TIERED_HINTS,
  }),
  build: Object.freeze({
    title: 'Build it',
    play: 'Rebuild the trace. Pick a span, then give it what the step asks for. Usually that is its parent: drag it onto the parent, or pick the parent. Sometimes it is a kind, a status, links, or the span a log record belongs to. The step says if a change is graded at once or when you press Check.',
    penalty: BUILD_PENALTY,
    hints: TIERED_HINTS,
  }),
  spot: Object.freeze({
    title: 'Spot it',
    play: 'Pick every line that matches the question, then press Check.',
    penalty: SPOT_PENALTY,
    hints: TIERED_HINTS,
  }),
  incident: Object.freeze({
    title: 'Incident',
    play: 'Open evidence views to investigate; each costs minutes of your error budget. Once you have found enough real clues the possible causes unlock. Then pick the cause the evidence supports.',
    penalty: INCIDENT_PENALTY,
    hints: TIERED_HINTS,
  }),
  tradeoff: Object.freeze({
    title: 'Trade-off',
    play: 'Choose one option for every knob. The plan cost updates as you pick. Stay within the cap while keeping everything you need, then press Check.',
    penalty: TRADEOFF_PENALTY,
    hints: NO_HINTS,
  }),
  query: Object.freeze({
    title: 'Query it',
    play: 'Write a PromQL query and press Run. A new query that runs shows its result; running one you already tried again changes nothing and is free. A syntax error or an unsupported feature is explained, not marked wrong.',
    penalty: QUERY_PENALTY,
    hints: ONE_HINT,
  }),
  configure: Object.freeze({
    title: 'Configure it',
    play: 'Edit the config and press Check. The feedback says what the checker found; keep going until it passes.',
    penalty: CONFIGURE_PENALTY,
    hints: ONE_HINT,
  }),
});

/** The star sentence of one widget: what costs, then what is free (nothing, when it names none). */
const starsOf = ({ costs, free }) => `Penalties count against the level's stars: ${costs}.${free === '' ? '' : ` ${free}`}`;

/**
 * The help for `level` ({widgets, hintless, scored, scoring: {parMs}}, a built registry level), as
 * `{topics: [{key, title, play, stars, hints}], footer}`: one topic per distinct widget in play
 * order. A scored level's footer is the star ladder (plus the par sentence with a par time) and
 * REPLAY; an unscored one has empty `stars` and NOT_SCORED. A widget in `hintless` (no step of
 * it on the level shows a Hint button) says NO_HINTS, whatever its entry says. No widgets: no topics, no footer.
 * Throws on a widget with no entry (the registry never lets one through).
 */
export function howToView(level) {
  const keys = [...new Set(level.widgets)];
  const hintless = new Set(level.hintless ?? []);
  if (keys.length === 0) return { topics: [], footer: '' };
  const topics = keys.map((key) => {
    const entry = Object.hasOwn(HOW_TO, key) ? HOW_TO[key] : null;
    if (entry === null) throw new TypeError(`how to play: no help for widget ${JSON.stringify(key)}`);
    return {
      key,
      title: entry.title,
      play: entry.play,
      stars: level.scored ? starsOf(entry.penalty) : '',
      hints: hintless.has(key) ? NO_HINTS : entry.hints,
    };
  });
  if (!level.scored) return { topics, footer: NOT_SCORED };
  const par = level.scoring.parMs != null ? ` ${PAR}` : '';
  return { topics, footer: `Stars for the whole level: ${LADDER}${par} ${REPLAY}` };
}
