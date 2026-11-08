// Spot it widget view (docs/M1-DESIGN.md §4.4): markup for a SpotSpec and SpotState, and
// mountSpot, the only home of "a failed Check costs one mistake; repeating the same
// selection is free" (I1). Everything is built from the UI kit (lib/ui, #158) off ONE typed
// contract, `spotView(spec, state, ui)`: the templates only render it, and the grading stays
// in lib/widgets/spot-it.mjs. Line text is plain text and escaped; `explain` and `whyNot` are
// trusted authored HTML; ids are escaped. DOM-free at import time.

import { escapeHtml as escape } from '../lesson-kit.mjs';
import { HINT_TIERS, mountSide, ruleText } from './help-ladder.mjs';
import { SPOT_HELPS, hintFor, spotHelps } from './spot-it-help.mjs';
import { checkSpot, newSpotState, toggleLine, validateSpotSpec } from './spot-it.mjs';
import { playSwirl } from '../swirl-render.mjs';
import { MAX_STARS } from '../scoring.mjs';
import { button, dots, eyebrow, feedback, helpChips, option, options, panel, setFeedback, sideColumn, split } from '../ui/index.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;

// The one instruction line, the same on every Spot it step. Plain text.
const INSTR = 'Pick every line that matches the question, then press Check. Picking is free.';

/** What costs a star on a Spot it board, and what does not. */
export const PENALTY = Object.freeze({
  costs: 'a failed Check, a hint',
  free: 'Picking lines, and checking the same picks again, are free.',
});

/** The score card's rule: Spot it has failed Checks and hints. */
export const RULE = ruleText(PENALTY);

/**
 * The typed view of Spot it `spec` in `state` (the templates render exactly this):
 *   {id, target, locked, lines}
 *   lines [{id, text, pressed, hinted, correct}] in authored order; `correct` is a line the
 *         player picked once the board is solved (read from the picks, never from the answer)
 * `hinted` is a list of line ids to outline.
 */
export function spotView(spec, state, { hinted = [] } = {}) {
  const hint = new Set(hinted);
  return {
    id: spec.id,
    target: spec.target,
    locked: state.solved,
    lines: spec.lines.map((l) => ({
      id: l.id,
      text: l.text,
      pressed: state.selected.includes(l.id),
      hinted: hint.has(l.id),
      correct: state.solved && state.selected.includes(l.id),
    })),
  };
}

const lineHtml = (l, locked, e) =>
  option({
    attr: 'line',
    value: l.id,
    kind: 'line',
    labelHtml: `<code>${e(l.text)}</code>`,
    pressed: l.pressed,
    hinted: l.hinted,
    state: l.correct ? 'correct' : undefined,
    disabled: locked,
  });

/**
 * Markup for Spot it `spec` in `state` inside a wide step (a kit split: the board, then the
 * side column): one toggle option per line (`data-line`, `aria-pressed`, the escaped text in
 * <code> as its accessible name), `#<id>-instr`, `#<id>-check` and the `#<id>-feedback` status
 * region. With `labelledBy` (a plain token; TypeError otherwise) the widget is a labelled group.
 */
export function renderSpot(spec, state, { escapeHtml: e = escape, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`spot "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const v = spotView(spec, state);
  const itemsHtml = v.lines.map((l) => lineHtml(l, v.locked, e)).join('');
  const chips = helpChips(spec.id, SPOT_HELPS.map(([key, label]) => ({ key, label, on: spotHelps(spec)[key] })));
  const board = panel({
    sections: [
      `<p class="spot-instr" id="${e(spec.id)}-instr">${INSTR}</p>`,
      `<div role="group" aria-label="Lines" aria-describedby="${e(spec.id)}-instr">${options({ layout: 'list', itemsHtml })}</div>` +
        button({ id: `${spec.id}-check`, label: 'Check', variant: 'primary', disabled: v.locked }) +
        feedback({ id: `${spec.id}-feedback` }),
    ],
  });
  const side = sideColumn({ id: spec.id, titleHtml: 'Spotted', counts: [{ key: 'wrong', label: '' }], hints: spotHelps(spec).hints, ruleHtml: RULE });
  return `<div data-spot="${e(spec.id)}" data-target="${e(spec.target)}"${group}>${split({ mainHtml: `${chips}${board}`, sideHtml: side })}</div>`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Wire Spot it `spec` (rendered by renderSpot into ctx.ovBody) from a fresh state and focus
 * its first line. Mount focus applies to a later step; on a level's first screen the app moves focus to Back (docs/DESIGN-SYSTEM.md, Focus).
 * Lines toggle in place (free, focus stays). Check: nothing selected, a neutral
 * "Pick at least one line first."; a wrong selection, ctx.mistake() and the score card's tally
 * together, an error "Not quite. ..." with the `whyNot` of each picked non-fault (the faults are
 * never revealed); the same wrong selection again, a neutral "You already checked ..." (free);
 * exactly the fault set, a success "Right. <explain>", lines and Check locked, the picked lines
 * marked correct, onComplete() once, the success card (swirl once, `swirl` replaces it in tests)
 * and its heading focused. Nothing counts after that. With `helps.hints` each Hint click is one
 * ctx.hint() and one hint on the score card: tier 1 the rule, tier 2 two outlined lines (see
 * hintFor), tier 3 picks exactly the fault set and runs the same Check (never a mistake; neutral
 * "Picked for you."). Throws TypeError (naming the spec id) for an invalid spec, a missing
 * onComplete, or a spec that is not rendered.
 */
export function mountSpot(ctx, spec, { onComplete, swirl = playSwirl } = {}) {
  const problems = validateSpotSpec(spec);
  const fail = (msg) => {
    throw new TypeError(`spot "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-spot="${spec.id}"]`);
  const checkBtn = box?.querySelector(`[id="${spec.id}-check"]`);
  const fb = box?.querySelector(`[id="${spec.id}-feedback"]`);
  if (!box || !checkBtn || !fb || !box.querySelector(`[id="${spec.id}-win"]`)) fail('not rendered (use renderSpot with the same spec)');

  const lineBtn = (id) => box.querySelector(`[data-line="${id}"]`);
  // A spent hint button hands Escape to Check, else the first line.
  const side = mountSide(ctx, box, spec.id, { swirl, fallback: () => [checkBtn, lineBtn(spec.lines[0].id)] });
  const focusOn = (el) => (el ?? fb).focus();
  const say = (tone, html) => setFeedback(fb, tone, html);
  const hintBtn = box.querySelector(`[id="${spec.id}-hint"]`);

  let state = newSpotState(spec);
  let wrong = 0;
  let hintsUsed = 0;
  let hinted = [];
  let done = false;

  /** The one place a penalty is paid: ctx.mistake() and the tally the score card shows. */
  function penalise() {
    ctx.mistake();
    wrong += 1;
  }

  function drawSide() {
    return side.score({ wrong, wrongLabel: wrong === 1 ? 'failed Check' : 'failed Checks', hints: hintsUsed, done });
  }

  function drawHint() {
    if (!hintBtn) return;
    const spent = done || hintsUsed >= HINT_TIERS;
    const pips = dots({ total: HINT_TIERS, on: hintsUsed, decorative: true, tone: 'hint' });
    side.hintUi({
      label: done ? 'Hint' : spent ? 'No more hints' : `Hint ${hintsUsed + 1} of ${HINT_TIERS}`,
      disabled: spent,
      tierHtml: done ? 'Nothing to hint right now.' : `${hintsUsed} of ${HINT_TIERS} used ${pips}`,
    });
  }

  /** Bring every line button in line with the view, in place (focus stays on the toggled line). */
  function paint() {
    const v = spotView(spec, state, { hinted: done ? [] : hinted });
    for (const l of v.lines) {
      const b = lineBtn(l.id);
      b.setAttribute('aria-pressed', String(l.pressed));
      b.toggleAttribute('data-hinted', l.hinted);
      b.disabled = v.locked;
      if (l.correct) b.setAttribute('data-state', 'correct');
      else b.removeAttribute('data-state');
    }
    checkBtn.disabled = v.locked;
    drawSide();
    drawHint();
  }

  function check({ viaHint = false } = {}) {
    if (done) return;
    const result = checkSpot(spec, state);
    state = result.state;
    if (result.outcome === 'right') {
      done = true;
      say(viaHint ? 'neutral' : 'success', viaHint ? 'Picked for you.' : `Right. ${spec.explain}`);
      if (!viaHint && hintBtn) side.showHint('', { focus: false }); // the panel's "not picked yet" no longer matches the board
      paint();
      onComplete();
      const n = drawSide();
      side.succeed({ line: `${n} of ${MAX_STARS} stars: ${plural(wrong, 'failed Check')}, ${plural(side.hintsShown(hintsUsed), 'hint')}.` });
      return;
    }
    if (result.outcome === 'empty') {
      say('neutral', 'Pick at least one line first.');
    } else if (result.outcome === 'repeat') {
      say('neutral', 'You already checked these lines. Nothing new was counted.');
    } else {
      penalise();
      // Own keys only: a line id like "constructor" must not read Object.prototype.
      const why = result.extra.filter((id) => Object.hasOwn(spec.whyNot ?? {}, id)).map((id) => spec.whyNot[id]);
      const head = result.extra.length
        ? `${result.extra.length} of your picks ${result.extra.length === 1 ? 'does not match' : 'do not match'} the question.`
        : 'Everything you picked matches the question, but there is more.';
      say('error', ['Not quite.', head, ...why].join(' '));
    }
    paint();
    fb.focus();
  }

  for (const btn of box.querySelectorAll('[data-line]')) {
    btn.onclick = () => {
      if (done || btn.disabled) return;
      state = toggleLine(spec, state, btn.dataset.line).state;
      paint();
    };
  }
  checkBtn.onclick = () => {
    if (checkBtn.disabled) return;
    check();
  };

  if (hintBtn) {
    hintBtn.onclick = () => {
      if (hintBtn.disabled || done || hintsUsed >= HINT_TIERS) return;
      const tier = hintsUsed + 1;
      ctx.hint();
      hintsUsed += 1;
      const h = hintFor(spec, state, tier, {
        shuffle: (list) => (typeof ctx.shuffle === 'function' ? ctx.shuffle(list) : list),
        e: escape,
      });
      const html = `${eyebrow(`Hint ${tier} of ${HINT_TIERS}`)}${h.html}`;
      hinted = h.hinted;
      if (h.apply === null) {
        paint();
        side.showHint(html);
        return;
      }
      for (const l of spec.lines) {
        if (state.selected.includes(l.id) !== h.apply.includes(l.id)) state = toggleLine(spec, state, l.id).state;
      }
      side.showHint(html, { focus: false });
      check({ viaHint: true });
    };
  }

  paint();
  focusOn(lineBtn(spec.lines[0].id));
}
