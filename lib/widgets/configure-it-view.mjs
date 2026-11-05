// Configure it widget view (docs/M1-DESIGN.md §4.9): markup for a ConfigureSpec and ConfigureState,
// the pipeline view drawn from a checker result, and mountConfigure, the only home of "a config
// that would not run costs one mistake; an unreadable text, a checker failure and repeats are
// free" (I1). Everything typed or computed (key paths, component and pipeline names, messages,
// line numbers) is escaped; `explain` and `hint` are trusted authored HTML. DOM-free at import time.

import { describeError, pipelineStages } from '../configure/check.mjs';
import { canFocus } from './focus.mjs';
import { newConfigureState, runConfigure, SCHEMAS, validateConfigureSpec } from './configure-it.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;

/**
 * What costs a star on a Configure it board (mountConfigure charges it), and what does not. Kept to
 * what also holds for the env checker of naming-your-service, which has the same two rules.
 */
export const PENALTY = Object.freeze({
  costs: 'a config that Check reports as wrong, a hint',
  free: 'Checking the same failing config again is free.',
});
const MAX_ERRORS = 20;
const MAX_PIPELINES = 20;
const MAX_REASONS = 5;
const MAX_ITEMS = 20;

const PLACEHOLDER = 'Press Check to see which pipelines flow.';
const UNREADABLE = 'Nothing to show until the YAML can be read.';

/** `a`, `a and b`, `a, b and c`. */
const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The feedback for each way a config is wrong, as html: the one place these messages live. None shows the reference. */
const WRONG = {
  invalid: (run, e) => {
    const n = run.result.errors.length;
    return `Not quite. The Collector would not accept this config: ${count(n, 'problem', 'problems')}.${errorsHtml(run.result.errors, e)}`;
  },
  target: (run, e) => {
    const names = run.unmet.map((n) => `"${e(n)}"`);
    const what = names.length === 1 ? `there is no flowing pipeline named ${names[0]}` : `these pipelines are not flowing: ${names.join(', ')}`;
    return `Not quite. The config is valid, but ${what}.`;
  },
  // Names the pipelines only: which components are missing would give the reference away.
  uses: (run, e) => {
    const many = run.unmet.length > 1;
    return `The ${andList(run.unmet.map(e))} ${many ? 'pipelines run, but they do' : 'pipeline runs, but it does'} not do what the task asks yet.`;
  },
};

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const label = (key) => key.charAt(0).toUpperCase() + key.slice(1);

/** One checker error as a list item: its kind, then `path: message` or `line L, column C: message`. */
const errorItem = (err, e) => `<li><span class="configure-kind">${e(err.kind)}</span> ${e(describeError(err))}</li>`;

/** A list of errors as markup (at most 20 items, then a count). */
export function errorsHtml(errors, e) {
  const more = errors.length - MAX_ERRORS;
  return (
    `<ul class="configure-errors">${errors.slice(0, MAX_ERRORS).map((x) => errorItem(x, e)).join('')}</ul>` +
    (more > 0 ? `<p class="configure-more">and ${count(more, 'more problem', 'more problems')}</p>` : '')
  );
}

function stageHtml({ key, items }, reasons, e) {
  const missing = (i) => reasons.some((r) => r.kind === 'unknown-ref' && r.path.endsWith(`.${key}[${i}]`));
  const shown = items.slice(0, MAX_ITEMS).map(([i, item]) =>
    missing(i) ? `<code class="configure-missing">${e(item)}</code> (not defined)` : `<code>${e(item)}</code>`);
  const more = items.length - MAX_ITEMS;
  const body = shown.length === 0 ? 'none' : shown.join(', ') + (more > 0 ? `, and ${more} more` : '');
  return `<span class="configure-stage"><b>${e(label(key))}:</b> ${body}</span>`;
}

/**
 * The pipeline view as markup, from a checker `result` (`checkConfig`'s return) and its `schema`:
 * one entry per pipeline in the verdict, receivers to exporters, `Flowing` or `Stalled` in
 * words, a stalled pipeline's reasons, the overall line and the components no pipeline uses.
 * Nothing here is known without the result; at most 20 pipelines are drawn, then a count.
 */
export function pipelinesHtml(result, schema, e) {
  const { verdict } = result;
  if (verdict === null) return '';
  const shown = verdict.pipelines.slice(0, MAX_PIPELINES).map((p) => {
    const state = p.flowing ? 'flowing' : 'stalled';
    const flow = pipelineStages(result, schema, p.name).map((s) => stageHtml(s, p.reasons, e)).join('<span aria-hidden="true"> → </span>');
    const why = p.reasons.slice(0, MAX_REASONS).map((r) => `<li>${e(describeError(r))}</li>`).join('');
    const moreWhy = p.reasons.length - MAX_REASONS;
    return (
      `<li class="configure-pipeline" data-pipeline="${e(p.name)}" data-state="${state}">` +
      `<p class="configure-pipeline-head"><b class="configure-name">${e(p.name)}</b> <span class="configure-state">${label(state)}</span></p>` +
      `<p class="configure-flow">${flow}</p>` +
      (why === '' ? '' : `<ul class="configure-reasons">${why}</ul>`) +
      (moreWhy > 0 ? `<p class="configure-more">and ${moreWhy} more</p>` : '') +
      '</li>'
    );
  });
  const more = verdict.pipelines.length - MAX_PIPELINES;
  const overall = verdict.pipelines.length === 0
    ? 'No pipelines are defined.'
    : verdict.flowing ? 'The Collector would start: every pipeline flows.' : 'The Collector would not start.';
  const inactive = verdict.inactive.length === 0
    ? ''
    : `<p class="configure-inactive">Defined but not used by any pipeline: ${verdict.inactive.map((c) => e(`${c.section}/${c.id}`)).join(', ')}</p>`;
  return (
    `<p class="configure-overall">${overall}</p>` +
    (shown.length === 0 ? '' : `<ol class="configure-list">${shown.join('')}</ol>`) +
    (more > 0 ? `<p class="configure-more">and ${count(more, 'more pipeline', 'more pipelines')}</p>` : '') +
    inactive
  );
}

/**
 * Markup for Configure it `spec` in `state`: a labelled `#<id>-input` textarea (prefilled with
 * `given`), `#<id>-check`, the optional `#<id>-hint` and `#<id>-hint-text`, the `#<id>-pipelines`
 * panel and the `#<id>-feedback` status region. With `labelledBy` (a plain token; TypeError
 * otherwise) the widget is a labelled group.
 */
export function renderConfigure(spec, state, { escapeHtml: e, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`configure "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const off = state.solved ? ' disabled' : '';
  const id = e(spec.id);
  const hint = spec.hint === undefined
    ? ''
    : `<button class="btn ghost small" id="${id}-hint"${off}>Show a hint</button>` +
      `<div class="feedback info" id="${id}-hint-text" tabindex="-1"></div>`;
  return (
    `<div class="configure" data-configure="${id}"${group}>` +
    `<label class="configure-label" for="${id}-input">Your config (YAML)</label>` +
    `<textarea class="configure-input" id="${id}-input" rows="12" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off"${off}>${e(spec.given ?? '')}</textarea>` +
    `<button class="btn" id="${id}-check"${off}>Check</button>${hint}` +
    `<div class="configure-pipelines" id="${id}-pipelines"><p class="configure-note">${PLACEHOLDER}</p></div>` +
    `<div class="feedback" id="${id}-feedback" role="status" aria-live="polite" tabindex="-1"></div>` +
    `</div>`
  );
}

/**
 * Wire Configure it `spec` (rendered by renderConfigure into ctx.ovBody) from a fresh state and
 * focus the textarea. Check: blank, "Type a config first." (free); text that is not readable
 * YAML, a mapping, safe to load, "Could not read that config as YAML. Nothing was marked
 * wrong." and the error (free); a checker that throws, "Could not check that text. Nothing was
 * marked wrong." (free); a config that would not run, or runs without the target pipelines,
 * ctx.mistake() and the WRONG message (the reference is never shown); the same failing config
 * again (whitespace aside), "Same as last time: ..." (free); a config that passes, "Right.
 * <explain>", input and Check locked, onComplete() once and its return focused if it passes
 * canFocus, else the feedback. Every Check that read the config redraws the pipeline view from
 * the checker result. Focus stays put after a Check that does not finish (the live region
 * announces it). The hint calls ctx.hint() once. `check` replaces the checker (a seam for
 * tests). Throws TypeError (naming the spec id) for an invalid spec, a missing onComplete, or a
 * spec that is not rendered.
 */
export function mountConfigure(ctx, spec, { onComplete, check } = {}) {
  const problems = validateConfigureSpec(spec);
  const fail = (msg) => {
    throw new TypeError(`configure "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-configure="${spec.id}"]`);
  const pick = (name) => box?.querySelector(`[id="${spec.id}-${name}"]`);
  const [input, checkBtn, pipelines, fb] = ['input', 'check', 'pipelines', 'feedback'].map(pick);
  if (!box || !input || !checkBtn || !pipelines || !fb) fail('not rendered (use renderConfigure with the same spec)');
  const hintBtn = pick('hint');
  const hintText = pick('hint-text');

  const e = ctx.escapeHtml;
  const schema = SCHEMAS[spec.schema];
  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };

  // Set as a property too: a textarea's markup content is parsed, its value is not.
  input.value = spec.given;
  let state = newConfigureState();

  checkBtn.onclick = () => {
    if (checkBtn.disabled) return undefined;
    const run = runConfigure(spec, state, input.value, check === undefined ? undefined : { check });
    state = run.state;
    const { outcome, result } = run;
    if (outcome === 'blank') return void say('info', 'Type a config first.');
    if (outcome === 'crash') return void say('info', 'Could not check that text. Nothing was marked wrong.');
    if (outcome === 'parse') {
      pipelines.innerHTML = `<p class="configure-note">${UNREADABLE}</p>`;
      return void say('info', `Could not read that config as YAML. Nothing was marked wrong.${errorsHtml(result.errors, e)}`);
    }
    pipelines.innerHTML = pipelinesHtml(result, schema, e);
    if (outcome === 'repeat') return void say('info', 'Same as last time: that config still does not pass.');
    if (outcome === 'right') {
      input.disabled = true;
      checkBtn.disabled = true;
      if (hintBtn) hintBtn.disabled = true;
      say('good', `Right. ${spec.explain}`);
      return void focusOn(onComplete());
    }
    ctx.mistake();
    say('info', WRONG[run.reason](run, e));
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
