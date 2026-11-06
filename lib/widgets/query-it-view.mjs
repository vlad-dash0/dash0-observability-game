// Query it widget view (docs/M1-DESIGN.md §4.7): markup for a QuerySpec and QueryState, and
// mountQuery, the only home of "a wrong query costs one mistake; syntax, unsupported and
// runtime errors and repeats are free" (I1). Everything typed or computed (query text, labels,
// values, error messages, dataset title) is escaped; `explain` and `hint` are trusted authored
// HTML. DOM-free at import time.

import { canFocus } from './focus.mjs';
import { newQueryState, normalizeQuery, runQuery, validateQuerySpec } from './query-it.mjs';
import { getDataset } from '../promql/datasets.mjs';
import { SUPPORTED } from '../promql/supported.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;

/** What costs a star on a Query it board (mountQuery charges it), and what does not. */
export const PENALTY = Object.freeze({
  costs: 'a query that returns the wrong series or values, a hint',
  free: 'Syntax errors, unsupported features, queries that fail to run and running the same failing query again are free.',
});
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

/** The result of a query as markup: a scalar line, or a table of series (at most 20 rows, then a count). */
export function resultHtml(result, e) {
  if (result.kind === 'scalar') return `<p class="query-scalar">Scalar: <b>${e(formatValue(result.value))}</b></p>`;
  if (result.series.length === 0) return '<p class="query-none">No series.</p>';
  const shown = result.series.slice(0, MAX_ROWS);
  const body = shown
    .map((s) => `<tr><td><code>${e(seriesText(s.labels))}</code></td><td class="query-num">${e(formatValue(s.value))}</td></tr>`)
    .join('');
  const more = result.series.length - shown.length;
  return (
    `<table class="query-table"><thead><tr><th scope="col">Series</th><th scope="col">Value</th></tr></thead><tbody>${body}</tbody></table>` +
    (more > 0 ? `<p class="query-more">and ${more} more series</p>` : '')
  );
}

const supportedHtml = (e) =>
  `<details class="query-supported"><summary>Supported here</summary>` +
  SUPPORTED.map(
    (g) =>
      `<p class="query-group"><b>${e(g.title)}:</b> ${g.items.map((i) => `<code>${e(i)}</code>`).join(' ')}<br>` +
      `<span class="query-note">${e(g.note)}</span></p>`,
  ).join('') +
  `<p class="query-note">Anything else is reported as unsupported, not as wrong.</p></details>`;

/**
 * Markup for Query it `spec` in `state`: the dataset and evaluation time, the "Supported here"
 * list, a labelled `#<id>-input` textarea (prefilled with `given`), `#<id>-run`, the optional
 * `#<id>-hint` and `#<id>-hint-text`, the `#<id>-result` and the `#<id>-feedback` status
 * region. With `labelledBy` (a plain token; TypeError otherwise) the widget is a labelled group.
 */
export function renderQuery(spec, state, { escapeHtml: e, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`query "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const off = state.solved ? ' disabled' : '';
  const id = e(spec.id);
  const hint = spec.hint === undefined
    ? ''
    : `<button class="btn ghost small" id="${id}-hint"${off}>Show a hint</button>` +
      `<div class="feedback info" id="${id}-hint-text" tabindex="-1"></div>`;
  return (
    `<div class="query" data-query="${id}"${group}>` +
    `<p class="query-data">Data: ${e(getDataset(spec.dataset).title)}. Your query runs at t = ${e(spec.at)} s.</p>` +
    supportedHtml(e) +
    `<label class="query-label" for="${id}-input">Your PromQL query</label>` +
    `<textarea class="query-input" id="${id}-input" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off"${off}>${e(spec.given ?? '')}</textarea>` +
    `<button class="btn" id="${id}-run"${off}>Run</button>${hint}` +
    `<div class="query-result" id="${id}-result"></div>` +
    `<div class="feedback" id="${id}-feedback" role="status" aria-live="polite" tabindex="-1"></div>` +
    `</div>`
  );
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
 * the textarea. Run: blank, "Type a query first." (free); a query that is not valid PromQL, not
 * supported, or fails at run time, a message saying which and where (free, nothing marked
 * wrong); a query that gives other series or values, ctx.mistake() and "Not quite. ..." naming
 * the category in plain words (the reference is never shown); the same failing query again
 * (whitespace aside), its own result again and "You already ran this query. ..." (free); the right series, "Right. <explain>",
 * input and Run locked, onComplete() once and its return focused if it passes canFocus, else
 * the feedback. Every Run shows the learner's own result. Focus stays put after a Run that
 * does not finish (the live region announces it). The hint calls ctx.hint() once. Throws
 * TypeError (naming the spec id) for an invalid spec, a missing onComplete, or a spec that is
 * not rendered.
 */
export function mountQuery(ctx, spec, { onComplete } = {}) {
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
  if (!box || !input || !runBtn || !resultEl || !fb) fail('not rendered (use renderQuery with the same spec)');
  const hintBtn = pick('hint');
  const hintText = pick('hint-text');

  const e = ctx.escapeHtml;
  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };

  // Set as a property too: a textarea's markup content is parsed, its value is not.
  if (spec.given !== undefined) input.value = spec.given;
  let state = newQueryState(spec);
  // Result markup of each wrong query run, by normalised text, so a repeat can show its own rows.
  const shown = new Map();

  runBtn.onclick = () => {
    if (runBtn.disabled) return;
    const result = runQuery(spec, state, input.value);
    state = result.state;
    const { outcome, grade } = result;
    if (outcome === 'blank') return void say('info', 'Type a query first.');
    if (outcome === 'repeat') {
      resultEl.innerHTML = shown.get(normalizeQuery(input.value)) ?? '';
      return void say('info', 'You already ran this query. Nothing new was counted.');
    }
    const ran = grade.result.kind === 'vector' || grade.result.kind === 'scalar';
    resultEl.innerHTML = ran ? resultHtml(grade.result, e) : '';
    if (outcome === 'wrong') shown.set(normalizeQuery(input.value), resultEl.innerHTML);
    if (outcome === 'right') {
      input.disabled = true;
      runBtn.disabled = true;
      if (hintBtn) hintBtn.disabled = true;
      say('good', `Right. ${spec.explain}`);
      return void focusOn(onComplete());
    }
    if (outcome === 'syntax') {
      say('info', `Syntax error at character ${grade.at + 1}: ${e(sentence(grade.message))}`);
    } else if (outcome === 'unsupported') {
      say('info', `Not supported here: ${e(sentence(grade.what))} Nothing was marked wrong; see "Supported here" above.`);
    } else if (outcome === 'error') {
      say('info', `That query could not run: ${e(sentence(grade.message))} Nothing was marked wrong.`);
    } else {
      ctx.mistake();
      say('info', `Not quite. ${WRONG[result.reason]}`);
    }
    return undefined;
  };

  if (hintBtn && hintText) {
    hintBtn.onclick = () => {
      if (hintBtn.disabled) return;
      ctx.hint();
      hintBtn.disabled = true;
      hintText.classList.add('show');
      hintText.innerHTML = spec.hint;
      hintText.focus();
    };
  }

  focusOn(input);
}

