// Trade-off widget view (docs/M1-DESIGN.md §4.5): markup for a TradeoffSpec and state, and
// mountTradeoff, the only home of "a failing check costs one mistake; repeating the same plan
// is free" (I1). Everything is built from the UI kit (lib/ui, #158) off ONE typed contract,
// `tradeoffView(spec, state, ui)`: the templates only render it, and the grading stays in
// lib/widgets/trade-off.mjs. The unit and ids are escaped; labels, `whyNot` and `explain` are
// trusted authored HTML. DOM-free at import time.

import { escapeHtml as escape } from '../lesson-kit.mjs';
import { canFocus } from './focus.mjs';
import { mountHintLadder, ruleText } from './help-ladder.mjs';
import { TRADEOFF_HELPS, hintFor, tradeoffHelps } from './trade-off-help.mjs';
import { checkTradeoff, evaluatePlan, formatAmount, newTradeoffState, pickOption, validateTradeoffSpec } from './trade-off.mjs';
import { playSwirl } from '../swirl-render.mjs';
import { button, chip, feedback, helpChips, meter, note, option, options, panel, prose, radioGroup, setFeedback, sideColumn, split } from '../ui/index.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;

/** What costs a star on a Trade-off board (mountTradeoff charges it), and what does not. */
export const PENALTY = Object.freeze({
  costs: 'a failed Check (over the cap, or a need dropped), a hint',
  free: 'Picking options, an incomplete plan and checking the same failing plan again are free.',
});

/** The score card's rule: Trade-off has failed Checks and hints. */
export const RULE = ruleText(PENALTY);
const RULE_NO_HINTS = ruleText({ ...PENALTY, costs: 'a failed Check (over the cap, or a need dropped)' });

/** `n` in the spec's unit: `unitOne` for exactly 1 when the spec gives one ("1 cost unit per day"), else `unit`. */
const amount = (spec, n) => `${formatAmount(n)} ${n === 1 && spec.unitOne !== undefined ? spec.unitOne : spec.unit}`;

/**
 * The typed view of Trade-off `spec` in `state` (the templates render exactly this):
 *   {id, unit, cap, locked, total, over, complete, spare, knobs}
 *   total / over / spare: the plan's cost, how far past the cap it is (0 when within) and how
 *         far under it (0 when over), from evaluatePlan, the one pricing of a plan
 *   knobs [{id, label, options: [{id, label, cost, keeps, pressed, hinted, correct}]}] in authored
 *         order; `keeps` the labels of the needs the option keeps; `correct` an option the
 *         player picked once the board is solved (read from the picks, never from the answer)
 * `hinted` is a list of {knob, option} to outline.
 */
export function tradeoffView(spec, state, { hinted = [] } = {}) {
  const r = evaluatePlan(spec, state.picks);
  const hint = new Set(hinted.map((h) => `${h.knob}:${h.option}`));
  const needLabel = (id) => spec.needs.find((n) => n.id === id).label;
  return {
    id: spec.id,
    unit: spec.unit,
    unitOne: spec.unitOne,
    cap: spec.cap,
    locked: state.solved,
    total: r.total,
    over: r.over,
    complete: r.complete,
    spare: r.over > 0 ? 0 : Math.round((spec.cap - r.total) * 100) / 100,
    knobs: spec.knobs.map((k) => ({
      id: k.id,
      label: k.label,
      options: k.options.map((o) => {
        const pressed = state.picks[k.id] === o.id;
        return {
          id: o.id,
          label: o.label,
          cost: o.cost,
          keeps: (o.keeps ?? []).map(needLabel),
          pressed,
          hinted: hint.has(`${k.id}:${o.id}`),
          correct: state.solved && pressed,
        };
      }),
    })),
  };
}

/** The cap line under the meter (plain text): how far over the cap the plan is, or how much room is left. */
export function capText(v) {
  return v.over > 0
    ? `Over the cap by ${amount(v, v.over)}.`
    : `Within the cap, ${amount(v, v.spare)} to spare.`;
}

const meterHtml = (v) =>
  meter({ id: `${v.id}-meter`, label: 'Plan cost', value: v.total, max: v.cap, unit: v.unit, over: v.over > 0 });

const optionHtml = (v, k, o) =>
  option({
    attr: 'option',
    value: o.id,
    kind: 'radio',
    name: `${v.id}-${k.id}`,
    labelHtml: o.label,
    // What an option keeps is hidden until a Check shows it (mountTradeoff unhides): knowing what an option keeps is the lesson.
    metaHtml: `${chip({ text: amount(v, o.cost) })}<span data-keeps hidden>Keeps: ${o.keeps.length ? o.keeps.join(', ') : 'nothing you need'}</span>`,
    pressed: o.pressed,
    hinted: o.hinted,
    state: o.correct ? 'correct' : undefined,
    disabled: v.locked,
  });

/**
 * Markup for Trade-off `spec` in `state` inside a wide step (a kit split: the board, then the
 * side column): the cost model and the needs, the cost meter against the cap (`#<id>-meter`) and
 * `#<id>-total` (the live cap line), one labelled group per knob (`data-knob`) of radio option
 * cards (`data-option`, the cost in the card, and what each keeps in a hidden `data-keeps` span a
 * Check unhides), `#<id>-check` and the
 * `#<id>-feedback` status region. With `labelledBy` (a plain token; TypeError otherwise) the
 * widget is a labelled group.
 */
export function renderTradeoff(spec, state, { escapeHtml: e = escape, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`tradeoff "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const v = tradeoffView(spec, state);
  const id = e(spec.id);
  const chips = helpChips(spec.id, TRADEOFF_HELPS.map(([key, label]) => ({ key, label, on: tradeoffHelps(spec)[key] })));
  const knobs = v.knobs
    .map((k) =>
      radioGroup({
        legendHtml: k.label,
        itemsHtml: `<div data-knob="${e(k.id)}">${options({ layout: 'list', itemsHtml: k.options.map((o) => optionHtml(v, k, o)).join('') })}</div>`,
      }))
    .join('');
  const board = panel({
    sections: [
      note(`The cost of your plan is the sum of the options you pick. Cap: ${e(amount(spec, spec.cap))}. What an option keeps is shown when you Check.`) +
        prose(`<p>Your plan must keep:</p><ul>${spec.needs.map((n) => `<li>${n.label}</li>`).join('')}</ul>`),
      `<div id="${id}-meterbox">${meterHtml(v)}</div><div id="${id}-total" aria-live="polite">${note(e(capText(v)))}</div>`,
      knobs,
      button({ id: `${spec.id}-check`, label: 'Check', variant: 'primary', disabled: v.locked }) + feedback({ id: `${spec.id}-feedback` }),
    ],
  });
  const side = sideColumn({ id: spec.id, titleHtml: 'Plan fits', counts: [{ key: 'wrong', label: '' }], hints: tradeoffHelps(spec).hints, ruleHtml: tradeoffHelps(spec).hints ? RULE : RULE_NO_HINTS });
  return `<div data-tradeoff="${id}"${group}>${split({ mainHtml: `${chips}${board}`, sideHtml: side })}</div>`;
}

/**
 * Wire Trade-off `spec` (rendered by renderTradeoff into ctx.ovBody) from a fresh state and
 * focus its first radio. Mount focus applies to a later step; on a level's first screen the app moves focus to Back (docs/DESIGN-SYSTEM.md, Focus).
 * Picking is free, redraws the meter and the cap line in place and keeps focus.
 * Check: a knob unpicked, a neutral "Pick an option for every knob first." (free); a plan over
 * the cap or dropping a need, ctx.mistake(), the score card's tally and an error "Not quite. ..."
 * naming the overshoot and/or the lost needs, unhiding the Keeps line of the picked cards (all
 * cards once solved), plus the `whyNot` of each picked option that has
 * one (the right plan is never named); the same failing plan again, a neutral "You already
 * checked ..." (free); a passing plan, a success "Right. ..." with its cost and `explain`, the
 * cards and Check locked (the picked cards marked correct), onComplete() once, the success card
 * (swirl once, `swirl` replaces it in tests) with its heading focused. With `helps.hints` each
 * Hint click is one ctx.hint() and one hint on the score card, three tiers in order: the rule,
 * two outlined options of one knob (see hintFor), then tier 3 picks the answer and runs Check
 * (never a mistake; a neutral "Picked for you. ..."). Throws TypeError (naming the spec id) for an
 * invalid spec, a missing onComplete, or a spec that is not rendered.
 */
export function mountTradeoff(ctx, spec, { onComplete, swirl = playSwirl } = {}) {
  const problems = validateTradeoffSpec(spec);
  const fail = (msg) => {
    throw new TypeError(`tradeoff "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-tradeoff="${spec.id}"]`);
  const pick = (name) => box?.querySelector(`[id="${spec.id}-${name}"]`);
  const [checkBtn, fb, totalEl, meterBox] = ['check', 'feedback', 'total', 'meterbox'].map(pick);
  if (!box || !checkBtn || !fb || !totalEl || !meterBox || !pick('win')) fail('not rendered (use renderTradeoff with the same spec)');

  const e = ctx.escapeHtml ?? escape;
  const inputs = [...box.querySelectorAll('[data-option] input')];
  const cardOf = (input) => input.closest('[data-option]');
  const knobOf = (input) => input.closest('[data-knob]').dataset.knob;
  const optionOf = (input) => cardOf(input).dataset.option;
  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (tone, html) => setFeedback(fb, tone, html);

  let state = newTradeoffState(spec);
  let hinted = [];
  const revealed = new Set(); // "knob:option" of the cards whose Keeps line a Check has shown
  const revealAll = () => spec.knobs.forEach((k) => k.options.forEach((o) => revealed.add(`${k.id}:${o.id}`)));
  let tier2Shown = false; // the last hint shown was tier 2, whose outline and text name a knob by the picks it saw
  const ladder = mountHintLadder(ctx, box, spec.id, {
    swirl,
    fallback: () => [checkBtn, inputs[0]],
    wrongNouns: ['failed Check', 'failed Checks'],
    hint: (tier) => {
      const h = hintFor(spec, state.picks, tier, { shuffle: (list) => (typeof ctx.shuffle === 'function' ? ctx.shuffle(list) : list) });
      hinted = h.hinted;
      tier2Shown = tier === 2;
      paint();
      return h.apply === null ? { html: h.html } : { html: h.html, apply: h.apply };
    },
    fill: (picks) => {
      for (const k of spec.knobs) state = pickOption(spec, state, k.id, picks[k.id]).state;
      paint();
      run({ hinted: true });
    },
  });

  /** Bring the cards, the meter and the cap line in line with the view, in place (focus stays put). */
  function paint() {
    const v = tradeoffView(spec, state, { hinted: ladder.done ? [] : hinted });
    for (const input of inputs) {
      const o = v.knobs.find((k) => k.id === knobOf(input)).options.find((x) => x.id === optionOf(input));
      input.checked = o.pressed;
      input.disabled = v.locked;
      const keeps = cardOf(input).querySelector('[data-keeps]');
      if (keeps) keeps.hidden = !revealed.has(`${knobOf(input)}:${o.id}`);
      cardOf(input).toggleAttribute('data-picked', o.pressed);
      cardOf(input).toggleAttribute('data-hinted', o.hinted);
      if (o.correct) cardOf(input).setAttribute('data-state', 'correct');
      else cardOf(input).removeAttribute('data-state');
    }
    checkBtn.disabled = v.locked;
    meterBox.innerHTML = meterHtml(v);
    totalEl.innerHTML = note(e(capText(v)));
  }

  /** Check the plan. `hinted` marks the tier 3 run: the right plan is then not earned. */
  function run({ hinted: viaHint = false } = {}) {
    if (ladder.done) return;
    const result = checkTradeoff(spec, state);
    state = result.state;
    const money = (n) => e(amount(spec, n));
    if (result.outcome === 'right') {
      revealAll();
      ladder.complete();
      paint();
      say(viaHint ? 'neutral' : 'success', `${viaHint ? 'Picked for you.' : 'Right.'} This plan costs ${formatAmount(result.total)} of ${money(spec.cap)} and keeps everything you need. ${spec.explain}`);
      onComplete();
      ladder.succeed();
      return;
    }
    if (result.outcome === 'incomplete') {
      say('neutral', 'Pick an option for every knob first.');
    } else if (result.outcome === 'repeat') {
      say('neutral', 'You already checked this plan. Nothing new was counted.');
    } else {
      ladder.miss();
      for (const k of spec.knobs) revealed.add(`${k.id}:${state.picks[k.id]}`);
      paint();
      const lost = result.lost.map((id) => spec.needs.find((n) => n.id === id).label).join(', ');
      const why = spec.knobs
        .map((k) => `${k.id}:${state.picks[k.id]}`)
        .filter((key) => Object.hasOwn(spec.whyNot ?? {}, key))
        .map((key) => spec.whyNot[key]);
      let verdict;
      if (result.over > 0) {
        verdict = `Over the cap by ${money(result.over)}${lost ? `, and it drops what you need: ${lost}` : ''}.`;
      } else {
        verdict = `It is within the cap but drops what you need: ${lost}.`;
      }
      say('error', ['Not quite.', verdict, ...why].join(' '));
    }
    fb.focus();
  }

  for (const input of inputs) {
    input.onclick = () => {
      if (input.disabled || ladder.done) return;
      state = pickOption(spec, state, knobOf(input), optionOf(input)).state;
      if (tier2Shown) {
        // The tier 2 pointer was about the old picks: drop it rather than leave it pointing at a fixed knob.
        tier2Shown = false;
        hinted = [];
        pick('hint-text').innerHTML = '';
      }
      paint();
    };
  }
  checkBtn.onclick = () => {
    if (checkBtn.disabled) return;
    run();
  };

  paint();
  focusOn(inputs[0]);
}
