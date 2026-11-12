// Query it widget view (docs/M1-DESIGN.md §4.7): markup for a QuerySpec and QueryState, and
// mountQuery, the only home of "a wrong query costs one mistake; syntax, unsupported and
// runtime errors and repeats are free" (I1). Everything typed or computed (query text, labels,
// values, error messages, dataset title) is escaped; `explain` and `hint` are trusted authored
// HTML. DOM-free at import time.

import { escapeHtml as escape } from '../lesson-kit.mjs';
import { canFocus } from './focus.mjs';
import { editorPanel, fitEditor, lockEditor } from './editor.mjs';
import { mountHintLadder, ruleText } from './help-ladder.mjs';
import { QUERY_HELPS, hintFor, queryHelps } from './query-it-help.mjs';
import { newQueryState, normalizeQuery, runQuery, validateQuerySpec } from './query-it.mjs';
import { getDataset } from '../promql/datasets.mjs';
import { SUPPORTED } from '../promql/supported.mjs';
import { playSwirl } from '../swirl-render.mjs';
import { eyebrow, fold, helpChips, note, panel, prose, setFeedback, sideColumn, split, table } from '../ui/index.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;

/** What costs a star on a Query it board (mountQuery charges it), and what does not. */
export const PENALTY = Object.freeze({
  costs: 'a query that returns the wrong series or values, a hint',
  free: 'Syntax errors, unsupported features, queries that fail to run and running the same failing query again are free.',
});

/** The score card's rule: Query it has wrong queries and hints. */
export const RULE = ruleText(PENALTY);

const MAX_ROWS = 20;

/** A sample value as Prometheus prints it: six significant digits, `+Inf`, `-Inf`, `NaN`, no `-0`. */
export function formatValue(v) {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '+Inf' : '-Inf';
  return String(Number(v.toPrecision(6)) + 0);
}

/** A label set as selector text: `name{a="1", b="2"}`, labels sorted, values quoted. */
export function seriesText(labels) {
  const { __name__: name = '', ...rest } = labels;
  const body = Object.keys(rest).sort().map((k) => `${k}=${JSON.stringify(rest[k])}`).join(', ');
  return name !== '' && body === '' ? name : `${name}{${body}}`;
}

/**
 * The result of a query as markup: a captioned kit table (a scalar is one row; at most 20
 * series, then a count line), or a note when there are none. Everything is escaped by the kit.
 */
export function resultHtml(result) {
  if (result.kind === 'scalar') {
    return table({ caption: 'Query result', head: ['Kind', 'Value'], rows: [['Scalar', formatValue(result.value)]], numeric: [1] });
  }
  if (result.series.length === 0) return note('No series.');
  const shown = result.series.slice(0, MAX_ROWS);
  const more = result.series.length - shown.length;
  return (
    table({
      caption: `Query result: ${result.series.length} series`,
      head: ['Series', 'Value'],
      rows: shown.map((s) => [seriesText(s.labels), formatValue(s.value)]),
      numeric: [1],
    }) + (more > 0 ? note(`and ${more} more series`) : '')
  );
}

const EMPTY = 'Run a query to see its result.';
const emptyHtml = () => note(EMPTY);

const supportedHtml = () =>
  fold({
    value: 'supported',
    titleHtml: 'Supported here',
    bodyHtml: prose(
      SUPPORTED.map(
        (g) => `<p><b>${escape(g.title)}:</b> ${g.items.map((i) => `<code>${escape(i)}</code>`).join(' ')}<br>${escape(g.note)}</p>`,
      ).join('') + '<p>Anything else is reported as unsupported, not as wrong.</p>',
    ),
  });

/**
 * Markup for Query it `spec` in `state` inside a wide step (a kit split: the board, then the
 * side column). The board is an editor panel (the "Supported here" fold, a labelled
 * `#<id>-input` textarea prefilled with `given` and described by the data line, `#<id>-run`,
 * the `#<id>-feedback` kit region) and a Result panel (`#<id>-result`); the column is the kit
 * sideColumn, whose ids include `#<id>-hint` and `#<id>-hint-text` when the step has
 * `helps.hints`. With `labelledBy` (a plain token; TypeError otherwise) the widget is a
 * labelled group.
 */
export function renderQuery(spec, state, { escapeHtml: e = escape, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`query "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const id = e(spec.id);
  const helps = queryHelps(spec);
  const chips = helpChips(spec.id, [
    { key: 'instant', label: 'Instant feedback', on: true },
    ...QUERY_HELPS.map(([key, label]) => ({ key, label, on: helps[key] })),
  ]);
  const editor = editorPanel({
    inputId: `${spec.id}-input`,
    label: 'Your PromQL query',
    rows: 3,
    wrap: true,
    value: spec.given ?? '',
    noteHtml: `Data: ${e(getDataset(spec.dataset).title)}. Your query runs at t = ${e(spec.at)} s.`,
    readonly: state.solved === true,
    actionId: `${spec.id}-run`,
    actionLabel: 'Run',
    feedbackId: `${spec.id}-feedback`,
    leadHtml: supportedHtml(),
  });
  const result = panel({
    headHtml: eyebrow('Result'),
    sections: [`<div id="${id}-result" data-region="result">${emptyHtml()}</div>`],
  });
  const side = sideColumn({ id: spec.id, titleHtml: 'Query solved', counts: [{ key: 'wrong', label: '' }], hints: helps.hints, ruleHtml: RULE });
  return `<div data-query="${id}"${group}>${split({ mainHtml: `${chips}${editor}${result}`, sideHtml: side })}</div>`;
}

const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);
const WRONG = {
  empty: 'Your query returned no data.',
  'wrong-count': 'Different series than expected: the number of series is not right.',
  'wrong-labels': 'Different series than expected: the labels are not right.',
  'wrong-values': 'Right shape, wrong values.',
};

/**
 * Wire Query it `spec` (rendered by renderQuery into ctx.ovBody) from a fresh state and focus
 * the textarea. Mount focus applies to a later step; on a level's first screen the app moves focus to Back (docs/DESIGN-SYSTEM.md, Focus).
 * Run: blank, a neutral "Type a query first." (free); a query that is not valid PromQL, not
 * supported, or fails at run time, a neutral message saying which and where (free, nothing
 * marked wrong); a query that gives other series or values, ctx.mistake(), the score card's
 * tally and an error "Not quite. ..." naming the category in plain words (the reference is
 * never shown); the same failing query again (whitespace aside), its own result again and a
 * neutral "You already ran this query. ..." (free); the right series, a success "Right.
 * <explain>", the input read-only (never disabled) and Run disabled, onComplete() once, the
 * success card (swirl once, `swirl` replaces it in tests) with its heading focused. Every Run
 * shows the learner's own result. Focus stays put after a Run that does not finish (the live
 * region announces it). With `helps.hints` each Hint click is one ctx.hint() and one hint on
 * the score card, three tiers in order: the step's rule or authored hint, the answer's shape
 * set against the player's text, then tier 3 fills the reference in and runs Run (never a
 * mistake; a neutral "Filled in for you. <explain>"). Throws TypeError (naming the spec id)
 * for an invalid spec, a missing onComplete, or a spec that is not rendered.
 */
export function mountQuery(ctx, spec, { onComplete, swirl = playSwirl } = {}) {
  ctx.widget?.('query'); // the How to play modal follows the step on screen (#316)
  const problems = validateQuerySpec(spec);
  const fail = (msg) => {
    throw new TypeError(`query "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-query="${spec.id}"]`);
  const pick = (name) => box?.querySelector(`[id="${spec.id}-${name}"]`);
  const [input, runBtn, resultEl, fb] = ['input', 'run', 'result', 'feedback'].map(pick);
  if (!box || !input || !runBtn || !resultEl || !fb || !pick('win')) fail('not rendered (use renderQuery with the same spec)');

  const e = ctx.escapeHtml ?? escape;
  const focusOn = (el, opts) => (canFocus(el) ? el : fb).focus(opts);
  const say = (tone, html) => setFeedback(fb, tone, html);

  // Set as a property too: a textarea's markup content is parsed, its value is not.
  if (spec.given !== undefined) input.value = spec.given;
  const fit = fitEditor(input, { max: 12, signal: ctx.signal });
  let state = newQueryState(spec);
  const ladder = mountHintLadder(ctx, box, spec.id, {
    swirl,
    fallback: () => input,
    wrongNouns: ['wrong query', 'wrong queries'],
    hint: (tier) => hintFor(spec, input.value, tier, { e }),
    fill: (text) => {
      input.value = text;
      fit();
      run({ hinted: true });
    },
  });
  // Result markup of each wrong query run, by normalised text, so a repeat can show its own rows.
  const shown = new Map();

  /** Run `input.value`. `hinted` marks the tier 3 run: the right answer is then not earned. */
  function run({ hinted = false } = {}) {
    if (ladder.done) return;
    const result = runQuery(spec, state, input.value);
    state = result.state;
    const { outcome, grade } = result;
    if (outcome === 'blank') return void say('neutral', 'Type a query first.');
    if (outcome === 'repeat') {
      resultEl.innerHTML = shown.get(normalizeQuery(input.value)) ?? emptyHtml();
      return void say('neutral', 'You already ran this query. Nothing new was counted.');
    }
    const ran = grade.result.kind === 'vector' || grade.result.kind === 'scalar';
    resultEl.innerHTML = ran ? resultHtml(grade.result) : emptyHtml();
    if (outcome === 'wrong') shown.set(normalizeQuery(input.value), resultEl.innerHTML);
    if (outcome === 'right') {
      ladder.complete();
      lockEditor(input, runBtn);
      say(hinted ? 'neutral' : 'success', `${hinted ? 'Filled in for you.' : 'Right.'} ${spec.explain}`);
      onComplete();
      ladder.succeed();
      return;
    }
    if (outcome === 'syntax') {
      say('neutral', `Syntax error at character ${grade.at + 1}: ${e(sentence(grade.message))}`);
    } else if (outcome === 'unsupported') {
      say('neutral', `Not supported here: ${e(sentence(grade.what))} Nothing was marked wrong; see "Supported here" above.`);
    } else if (outcome === 'error') {
      say('neutral', `That query could not run: ${e(sentence(grade.message))} Nothing was marked wrong.`);
    } else {
      ladder.miss();
      say('error', `Not quite. ${WRONG[result.reason]}`);
    }
  }

  runBtn.onclick = () => {
    if (runBtn.disabled) return;
    run();
  };

  focusOn(input, { preventScroll: true }); // a new step opens at its top (#331)
}
