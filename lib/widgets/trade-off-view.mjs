// Trade-off widget view (docs/M1-DESIGN.md §4.5): markup for a TradeoffSpec and state, and
// mountTradeoff, the only home of "a failing check costs one mistake; repeating the same plan
// is free" (I1). The unit and ids are escaped; labels, `whyNot` and `explain` are trusted
// authored HTML. DOM-free at import time.

import { canFocus } from './focus.mjs';
import { checkTradeoff, evaluatePlan, formatAmount, newTradeoffState, pickOption, validateTradeoffSpec } from './trade-off.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;
const amount = (spec, n) => `${formatAmount(n)} ${spec.unit}`;

/** The live cost line (plain text): `Plan cost: 11 of 12 GB/day`, plus the overshoot when over the cap. */
export function totalText(spec, picks) {
  const { total, over } = evaluatePlan(spec, picks);
  const head = `Plan cost: ${formatAmount(total)} of ${amount(spec, spec.cap)}`;
  return over > 0 ? `${head}, over the cap by ${amount(spec, over)}` : head;
}

/**
 * Markup for Trade-off `spec` in `state`: the cost model (sum of picked options, the cap, the
 * needs), one fieldset per knob with a radio per option (`data-knob`, `data-option`, its cost
 * and what it keeps shown in the label), the live `#<id>-total`, `#<id>-check` and the
 * `#<id>-feedback` status region. With `labelledBy` (a plain token; TypeError otherwise) the
 * widget is a labelled group.
 */
export function renderTradeoff(spec, state, { escapeHtml: e, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`tradeoff "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const off = state.solved ? ' disabled' : '';
  const needLabel = (id) => spec.needs.find((n) => n.id === id).label;
  const knobs = spec.knobs
    .map((k) => {
      const options = k.options
        .map((o) => {
          const keeps = o.keeps?.length ? o.keeps.map(needLabel).join(', ') : 'nothing you need';
          return (
            `<label class="tradeoff-option"><input type="radio" name="${e(spec.id)}-${e(k.id)}" value="${e(o.id)}" ` +
            `data-knob="${e(k.id)}" data-option="${e(o.id)}"${state.picks[k.id] === o.id ? ' checked' : ''}${off}> ` +
            `<span class="tradeoff-label">${o.label}</span> ` +
            `<span class="tradeoff-cost">${e(amount(spec, o.cost))}</span> ` +
            `<span class="tradeoff-keeps">Keeps: ${keeps}</span></label>`
          );
        })
        .join('');
      return `<fieldset class="tradeoff-knob"><legend>${k.label}</legend>${options}</fieldset>`;
    })
    .join('');
  return (
    `<div class="tradeoff" data-tradeoff="${e(spec.id)}"${group}>` +
    `<p class="tradeoff-model">The cost of your plan is the sum of the options you pick. Cap: ${e(amount(spec, spec.cap))}.</p>` +
    `<p class="tradeoff-need-head">Your plan must keep:</p>` +
    `<ul class="tradeoff-needs">${spec.needs.map((n) => `<li>${n.label}</li>`).join('')}</ul>` +
    knobs +
    `<p class="tradeoff-total" id="${e(spec.id)}-total" aria-live="polite">${e(totalText(spec, state.picks))}</p>` +
    `<button class="btn" id="${e(spec.id)}-check"${off}>Check</button>` +
    `<div class="feedback" id="${e(spec.id)}-feedback" role="status" aria-live="polite" tabindex="-1"></div>` +
    `</div>`
  );
}

/**
 * Wire Trade-off `spec` (rendered by renderTradeoff into ctx.ovBody) from a fresh state and
 * focus its first radio. Picking is free, updates the live total in place and keeps focus.
 * Check: a knob unpicked, "Pick an option for every knob first." (free); a plan over the cap
 * or dropping a need, ctx.mistake() and "Not quite. ..." naming the overshoot and/or the lost
 * needs, plus the `whyNot` of each picked option that has one (the right plan is never
 * named); the same failing plan again, "Same as last time: ..." (free); a passing plan,
 * "Right. ..." with its cost and `explain`, radios and Check locked, onComplete() once and its
 * return focused if it passes canFocus, else the feedback. Throws TypeError (naming the spec
 * id) for an invalid spec, a missing onComplete, or a spec that is not rendered.
 */
export function mountTradeoff(ctx, spec, { onComplete } = {}) {
  const problems = validateTradeoffSpec(spec);
  const fail = (msg) => {
    throw new TypeError(`tradeoff "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-tradeoff="${spec.id}"]`);
  const checkBtn = box?.querySelector(`[id="${spec.id}-check"]`);
  const fb = box?.querySelector(`[id="${spec.id}-feedback"]`);
  const totalEl = box?.querySelector(`[id="${spec.id}-total"]`);
  if (!box || !checkBtn || !fb || !totalEl) fail('not rendered (use renderTradeoff with the same spec)');

  const radios = [...box.querySelectorAll('[data-option]')];
  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };

  let state = newTradeoffState(spec);

  for (const radio of radios) {
    radio.onclick = () => {
      if (radio.disabled) return;
      state = pickOption(spec, state, radio.dataset.knob, radio.dataset.option).state;
      for (const r of radios) if (r.dataset.knob === radio.dataset.knob) r.checked = r === radio;
      totalEl.textContent = totalText(spec, state.picks);
    };
  }

  checkBtn.onclick = () => {
    if (checkBtn.disabled) return;
    const result = checkTradeoff(spec, state);
    state = result.state;
    const money = (n) => ctx.escapeHtml(`${formatAmount(n)} ${spec.unit}`);
    if (result.outcome === 'right') {
      for (const r of radios) r.disabled = true;
      checkBtn.disabled = true;
      say('good', `Right. This plan costs ${formatAmount(result.total)} of ${money(spec.cap)} and keeps everything you need. ${spec.explain}`);
      focusOn(onComplete());
      return;
    }
    if (result.outcome === 'incomplete') {
      say('info', 'Pick an option for every knob first.');
    } else if (result.outcome === 'repeat') {
      say('info', 'Same as last time: that plan still fails.');
    } else {
      ctx.mistake();
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
      say('info', ['Not quite.', verdict, ...why].join(' '));
    }
    fb.focus();
  };

  focusOn(radios[0]);
}
