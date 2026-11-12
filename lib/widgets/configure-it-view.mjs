// Configure it widget view (docs/M1-DESIGN.md §4.9): markup for a ConfigureSpec and ConfigureState,
// the pipeline view drawn from a checker result, and mountConfigure, the only home of "a config
// that would not run costs one mistake; an unreadable text, a checker failure and repeats are
// free" (I1). Everything typed or computed (key paths, component and pipeline names, messages,
// line numbers) is escaped; `explain` and `hint` are trusted authored HTML. DOM-free at import time.

import { escapeHtml as escape } from '../lesson-kit.mjs';
import { describeError, pipelineStages } from '../configure/check.mjs';
import { canFocus } from './focus.mjs';
import { editorPanel, fitEditor, lockEditor } from './editor.mjs';
import { mountHintLadder, ruleText } from './help-ladder.mjs';
import { CONFIGURE_HELPS, configureHelps, hintFor } from './configure-it-help.mjs';
import { newConfigureState, runConfigure, SCHEMAS, validateConfigureSpec } from './configure-it.mjs';
import { playSwirl } from '../swirl-render.mjs';
import { chip, eyebrow, helpChips, note, panel, setFeedback, sideColumn, split } from '../ui/index.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;


/**
 * What costs a star on a Configure it board (mountConfigure charges it), and what does not. Kept to
 * what also holds for the env checker of naming-your-service, which has the same two rules.
 */
export const PENALTY = Object.freeze({
  costs: 'a config that Check reports as wrong, a hint',
  free: 'Checking the same failing config twice in a row is free.',
});

/** The score card's rule: Configure it has failed Checks and hints. */
export const RULE = ruleText(PENALTY);

const MAX_ERRORS = 20;
const MAX_PIPELINES = 20;
const MAX_REASONS = 5;
const MAX_ITEMS = 20;

const PLACEHOLDER = 'Press Check to see which pipelines flow.';
const UNREADABLE = 'Nothing to show until the YAML can be read.';

/** `a`, `a and b`, `a, b and c`. */
const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const label = (key) => key.charAt(0).toUpperCase() + key.slice(1);

/** One checker error as a list item: its kind, then `path: message` or `line L, column C: message`. */
const errorItem = (err, e) => `<li><code>${e(err.kind)}</code> ${e(describeError(err))}</li>`;

/** A list of errors as markup (at most 20 items, then a count). */
export function errorsHtml(errors, e) {
  const more = errors.length - MAX_ERRORS;
  return (
    `<ul data-part="errors">${errors.slice(0, MAX_ERRORS).map((x) => errorItem(x, e)).join('')}</ul>` +
    (more > 0 ? `<p>and ${count(more, 'more problem', 'more problems')}</p>` : '')
  );
}

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
  forbids: (run, e) => WRONG.uses(run, e),
  // Names the section only, never which extension.
  extensions: () => 'The pipelines run, but the Collector is not enabling every extension the task asks for yet.',
};

function stageHtml({ key, items }, reasons, e) {
  const missing = (i) => reasons.some((r) => r.kind === 'unknown-ref' && r.path.endsWith(`.${key}[${i}]`));
  const shown = items.slice(0, MAX_ITEMS).map(([i, item]) =>
    missing(i) ? `<code>${e(item)}</code> (not defined)` : `<code>${e(item)}</code>`);
  const more = items.length - MAX_ITEMS;
  const body = shown.length === 0 ? 'none' : shown.join(', ') + (more > 0 ? `, and ${more} more` : '');
  return `<span><b>${e(label(key))}:</b> ${body}</span>`;
}

/**
 * The pipeline view as markup, from a checker `result` (`checkConfig`'s return) and its `schema`:
 * the overall line, then one inset kit panel per pipeline in the verdict (`[data-pipeline]` with
 * `data-state`): its name and a `Flowing` or `Stalled` chip, receivers to exporters, and a
 * stalled pipeline's reasons; then the components no pipeline uses. Nothing here is known
 * without the result; at most 20 pipelines are drawn, then a count.
 */
export function pipelinesHtml(result, schema, e) {
  const { verdict } = result;
  if (verdict === null) return '';
  const shown = verdict.pipelines.slice(0, MAX_PIPELINES).map((p) => {
    const state = p.flowing ? 'flowing' : 'stalled';
    const flow = pipelineStages(result, schema, p.name).map((s) => stageHtml(s, p.reasons, e)).join('<span aria-hidden="true"> → </span>');
    const why = p.reasons.slice(0, MAX_REASONS).map((r) => `<li>${e(describeError(r))}</li>`).join('');
    const moreWhy = p.reasons.length - MAX_REASONS;
    const sections = [`<p data-part="flow">${flow}</p>`];
    if (why !== '') sections.push(`<ul data-part="reasons">${why}</ul>${moreWhy > 0 ? note(`and ${moreWhy} more`) : ''}`);
    const head = `<b>${e(p.name)}</b> ${chip({ text: label(state), tone: p.flowing ? 'neutral' : 'error', dot: true })}`;
    return `<div data-pipeline="${e(p.name)}" data-state="${state}">${panel({ variant: 'inset', headHtml: head, sections })}</div>`;
  });
  const more = verdict.pipelines.length - MAX_PIPELINES;
  const overall = verdict.pipelines.length === 0
    ? 'No pipelines are defined.'
    : verdict.flowing ? 'The Collector would start: every pipeline flows.' : 'The Collector would not start.';
  const inPipelines = new Set(verdict.pipelines.flatMap((p) => p.reasons));
  const outside = verdict.pipelines.length > 0 && result.errors.some((x) => !inPipelines.has(x))
    ? note('The problem is outside the pipelines: see the list above.')
    : '';
  const inactive = verdict.inactive.length === 0
    ? ''
    : `<div data-part="inactive">${note(`Defined but not used by any pipeline: ${verdict.inactive.map((c) => e(`${c.section}/${c.id}`)).join(', ')}`)}</div>`;
  return (
    `<p data-part="overall">${overall}</p>` +
    shown.join('') +
    outside +
    (more > 0 ? note(`and ${count(more, 'more pipeline', 'more pipelines')}`) : '') +
    inactive
  );
}

/**
 * Markup for Configure it `spec` in `state` inside a wide step (a kit split: the board, then the
 * side column). The board is an editor panel (a labelled `#<id>-input` textarea prefilled with
 * `given`, `#<id>-check`, the `#<id>-feedback` kit region) and a Pipelines panel
 * (`#<id>-pipelines`); the column is the kit sideColumn, whose ids include `#<id>-hint` and
 * `#<id>-hint-text` when the step has `helps.hints`. With `labelledBy` (a plain token;
 * TypeError otherwise) the widget is a labelled group.
 */
export function renderConfigure(spec, state, { escapeHtml: e = escape, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`configure "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const id = e(spec.id);
  const helps = configureHelps(spec);
  const chips = helpChips(spec.id, [
    { key: 'instant', label: 'Instant feedback', on: true },
    ...CONFIGURE_HELPS.map(([key, text]) => ({ key, label: text, on: helps[key] })),
  ]);
  const editor = editorPanel({
    inputId: `${spec.id}-input`,
    label: 'Your config (YAML)',
    rows: 12,
    value: spec.given ?? '',
    readonly: state.solved === true,
    actionId: `${spec.id}-check`,
    actionLabel: 'Check',
    feedbackId: `${spec.id}-feedback`,
  });
  const pipelines = panel({
    headHtml: eyebrow('Pipelines'),
    sections: [`<div id="${id}-pipelines" data-region="pipelines">${note(PLACEHOLDER)}</div>`],
  });
  const side = sideColumn({ id: spec.id, titleHtml: 'Config solved', counts: [{ key: 'wrong', label: '' }], hints: helps.hints, ruleHtml: RULE });
  return `<div data-configure="${id}"${group}>${split({ mainHtml: `${chips}${editor}${pipelines}`, sideHtml: side })}</div>`;
}

/**
 * Wire Configure it `spec` (rendered by renderConfigure into ctx.ovBody) from a fresh state and
 * focus the textarea. Mount focus applies to a later step; on a level's first screen the app moves focus to Back (docs/DESIGN-SYSTEM.md, Focus).
 * Check: blank, a neutral "Type a config first." (free); text that is not readable
 * YAML, a mapping, safe to load, a neutral "Could not read that config as YAML. Nothing was
 * marked wrong." and the error (free); a checker that throws, a neutral "Could not check that
 * text. Nothing was marked wrong." (free); a config that would not run, or runs without the
 * target pipelines, ctx.mistake(), the score card's tally and the WRONG message in the error
 * tone (the reference is never shown); the same failing config again (whitespace aside), a
 * neutral "You already checked ..." (free); a config that passes, a success "Right.
 * <explain>", the input read-only (never disabled) and Check disabled, onComplete() once, the
 * success card (swirl once, `swirl` replaces it in tests) with its heading focused. Every Check
 * that read the config redraws the pipeline view from the checker result. Focus stays put after
 * a Check that does not finish (the live region announces it). With `helps.hints` each Hint
 * click is one ctx.hint() and one hint on the score card, three tiers in order: the step's
 * authored hint or the default rule, the answer's shape set against the player's config, then
 * tier 3 fills the reference in and runs Check (never a mistake; a neutral "Filled in for you.
 * <explain>"). `check` replaces the checker (a seam for tests). Throws TypeError (naming the
 * spec id) for an invalid spec, a missing onComplete, or a spec that is not rendered.
 */
export function mountConfigure(ctx, spec, { onComplete, check, swirl = playSwirl } = {}) {
  ctx.widget?.('configure'); // the How to play modal follows the step on screen (#316)
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
  if (!box || !input || !checkBtn || !pipelines || !fb || !pick('win')) fail('not rendered (use renderConfigure with the same spec)');

  const e = ctx.escapeHtml ?? escape;
  const schema = SCHEMAS[spec.schema];
  const focusOn = (el, opts) => (canFocus(el) ? el : fb).focus(opts);
  const say = (tone, html) => setFeedback(fb, tone, html);

  // Set as a property too: a textarea's markup content is parsed, its value is not.
  input.value = spec.given;
  const fit = fitEditor(input, { max: 40, signal: ctx.signal });
  let state = newConfigureState();
  const ladder = mountHintLadder(ctx, box, spec.id, {
    swirl,
    fallback: () => input,
    wrongNouns: ['failed Check', 'failed Checks'],
    hint: (tier) => hintFor(spec, state, input.value, tier, { e }),
    fill: (text) => {
      input.value = text;
      fit();
      run({ hinted: true });
    },
  });

  /** Check `input.value`. `hinted` marks the tier 3 run: the right answer is then not earned. */
  function run({ hinted = false } = {}) {
    if (ladder.done) return;
    const res = runConfigure(spec, state, input.value, check === undefined ? undefined : { check });
    state = res.state;
    const { outcome, result } = res;
    if (outcome === 'blank') return void say('neutral', 'Type a config first.');
    if (outcome === 'crash') return void say('neutral', 'Could not check that text. Nothing was marked wrong.');
    if (outcome === 'parse') {
      pipelines.innerHTML = note(UNREADABLE);
      return void say('neutral', `Could not read that config as YAML. Nothing was marked wrong.${errorsHtml(result.errors, e)}`);
    }
    pipelines.innerHTML = pipelinesHtml(result, schema, e);
    if (outcome === 'repeat') return void say('neutral', 'You already checked this config. Nothing new was counted.');
    if (outcome === 'right') {
      ladder.complete();
      lockEditor(input, checkBtn);
      say(hinted ? 'neutral' : 'success', `${hinted ? 'Filled in for you.' : 'Right.'} ${spec.explain}`);
      onComplete();
      ladder.succeed();
      return;
    }
    ladder.miss();
    say('error', WRONG[res.reason](res, e));
  }

  checkBtn.onclick = () => {
    if (checkBtn.disabled) return;
    run();
  };

  focusOn(input, { preventScroll: true }); // a new step opens at its top (#331)
}
