// Trade-off widget core (docs/M1-DESIGN.md §4.5): validate a TradeoffSpec, pick one option
// per knob, price the plan and check it against the cap and the needed signals. Pure and
// DOM-free; state is never mutated. The view and its penalty live in `trade-off-view.mjs`.
//
// TradeoffSpec = { id, unit, cap, knobs: [{id, label, options: [{id, label, cost, keeps?}]}],
//                  needs: [{id, label}], answer: {[knobId]: optionId},
//                  whyNot?: {['knobId:optionId']: html}, explain }
// TradeoffState = { picks: {[knobId]: optionId}, tried: string[] (wrong plans), solved }
// A plan costs the sum of its picked options' costs; it passes when that is <= cap and every
// need is in the `keeps` of at least one picked option.

import { isId } from '../registry.mjs';

const LIMITS = { knobs: [1, 5], options: [2, 5], needs: [1, 4] };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const show = (v) => (typeof v === 'string' ? `"${v}"` : String(v));
const cents = (n) => Math.round(n * 100) / 100;
const isMoney = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && cents(v) === v;

/** `n` as the widget always shows it: en-US grouping, at most 2 decimals ("1,250.5"). */
export const formatAmount = (n) => cents(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Every plan (one option per knob) as a picks object. At most 5^5 of them for a valid spec. */
export function allPlans(spec) {
  return spec.knobs.reduce(
    (plans, k) => plans.flatMap((p) => k.options.map((o) => ({ ...p, [k.id]: o.id }))),
    [{}],
  );
}

/**
 * Price `picks`: `{complete, total, over, lost}`. `total` sums the picked options (unknown
 * picks count nothing), `over` is how far past the cap it is (0 when within), `lost` the
 * needs no picked option keeps, in spec order. `complete` means every knob has a pick.
 */
export function evaluatePlan(spec, picks) {
  const chosen = spec.knobs.map((k) => k.options.find((o) => o.id === picks[k.id])).filter(Boolean);
  const total = cents(chosen.reduce((sum, o) => sum + o.cost, 0));
  const kept = new Set(chosen.flatMap((o) => o.keeps ?? []));
  return {
    complete: chosen.length === spec.knobs.length,
    total,
    over: total > spec.cap ? cents(total - spec.cap) : 0,
    lost: spec.needs.map((n) => n.id).filter((id) => !kept.has(id)),
  };
}

const passes = (spec, picks) => {
  const r = evaluatePlan(spec, picks);
  return r.over === 0 && r.lost.length === 0;
};

function checkShape(spec, problems) {
  const dupes = (what, ids) => {
    const seen = new Set();
    for (const id of ids) {
      if (!isId(id)) problems.push(`${what} id ${show(id)} is not kebab-case`);
      else if (seen.has(id)) problems.push(`duplicate ${what} id ${show(id)}`);
      seen.add(id);
    }
  };
  const size = (what, list, [min, max]) => {
    if (!Array.isArray(list) || list.length < min || list.length > max) {
      problems.push(`${what}: ${Array.isArray(list) ? list.length : 'not a list'}, expected ${min}..${max}`);
      return [];
    }
    return list;
  };
  const needs = size('needs', spec.needs, LIMITS.needs).filter((n, i) => isObject(n) || void problems.push(`need ${i}: not an object`));
  dupes('need', needs.map((n) => n.id));
  for (const n of needs) if (!isText(n.label)) problems.push(`need ${show(n.id)}: label is not non-empty text`);
  const needIds = new Set(needs.map((n) => n.id));
  const knobs = size('knobs', spec.knobs, LIMITS.knobs).filter((k, i) => isObject(k) || void problems.push(`knob ${i}: not an object`));
  dupes('knob', knobs.map((k) => k.id));
  for (const k of knobs) {
    if (!isText(k.label)) problems.push(`knob ${show(k.id)}: label is not non-empty text`);
    const options = size(`knob ${show(k.id)} options`, k.options, LIMITS.options).filter(
      (o, i) => isObject(o) || void problems.push(`knob ${show(k.id)} option ${i}: not an object`),
    );
    dupes(`option of knob ${show(k.id)}`, options.map((o) => o.id));
    for (const o of options) {
      const at = `option ${show(o.id)} of knob ${show(k.id)}`;
      if (!isText(o.label)) problems.push(`${at}: label is not non-empty text`);
      if (!isMoney(o.cost)) problems.push(`${at}: cost ${show(o.cost)} is not a number >= 0 with at most 2 decimals`);
      if (o.keeps !== undefined && !Array.isArray(o.keeps)) problems.push(`${at}: keeps is not a list`);
      else for (const n of o.keeps ?? []) if (!needIds.has(n)) problems.push(`${at}: keeps unknown need ${show(n)}`);
    }
  }
}

function checkAnswer(spec, problems) {
  const knobs = spec.knobs;
  if (!isObject(spec.answer)) return void problems.push('answer is not an object');
  let sound = true;
  for (const key of Object.keys(spec.answer)) {
    if (!knobs.some((k) => k.id === key)) problems.push(`answer: unknown knob ${show(key)}`), (sound = false);
  }
  for (const k of knobs) {
    if (!Object.hasOwn(spec.answer, k.id)) problems.push(`answer: knob ${show(k.id)} has no pick`), (sound = false);
    else if (!k.options.some((o) => o.id === spec.answer[k.id])) {
      problems.push(`answer: unknown option ${show(spec.answer[k.id])} for knob ${show(k.id)}`);
      sound = false;
    }
  }
  if (!sound) return;
  const r = evaluatePlan(spec, spec.answer);
  if (r.over > 0) problems.push(`answer: the reference plan is over the cap by ${formatAmount(r.over)}`);
  if (r.lost.length) problems.push(`answer: the reference plan drops ${r.lost.map(show).join(', ')}`);
  const plans = allPlans(spec).map((p) => evaluatePlan(spec, p));
  if (!plans.some((p) => p.over === 0 && p.lost.length > 0)) {
    problems.push('trade-off: every plan within the cap keeps every need, so no signal is ever at stake');
  }
  if (!plans.some((p) => p.over > 0 && p.lost.length === 0)) {
    problems.push('trade-off: every plan that keeps every need fits the cap, so the cap never bites');
  }
}

/** Every problem with `spec` (empty when valid). Never throws, never stops at the first. */
export function validateTradeoffSpec(spec) {
  if (!isObject(spec)) return ['spec: not an object'];
  const problems = [];
  if (!isId(spec.id) || !/^[A-Za-z]/.test(spec.id)) problems.push(`spec id ${show(spec.id)} is not kebab-case`);
  if (!isText(spec.unit)) problems.push('unit is not non-empty text');
  if (!(typeof spec.cap === 'number' && Number.isFinite(spec.cap) && spec.cap > 0 && cents(spec.cap) === spec.cap)) {
    problems.push(`cap ${show(spec.cap)} is not a number > 0 with at most 2 decimals`);
  }
  if (!isText(spec.explain)) problems.push('explain is not non-empty text');
  const shape = [];
  checkShape(spec, shape);
  problems.push(...shape);
  if (shape.length === 0 && problems.length === 0) checkAnswer(spec, problems);
  if (spec.whyNot !== undefined) {
    if (!isObject(spec.whyNot)) problems.push('whyNot is not an object');
    else if (shape.length === 0) {
      const options = new Set(spec.knobs.flatMap((k) => k.options.map((o) => `${k.id}:${o.id}`)));
      const right = new Set(isObject(spec.answer) ? Object.entries(spec.answer).map(([k, o]) => `${k}:${o}`) : []);
      for (const [key, text] of Object.entries(spec.whyNot)) {
        if (!options.has(key)) problems.push(`whyNot: unknown option ${show(key)} (write knobId:optionId)`);
        else if (right.has(key)) problems.push(`whyNot: option ${show(key)} is in the answer (never shown)`);
        if (!isText(text)) problems.push(`whyNot ${show(key)} is not non-empty text`);
      }
    }
  }
  return problems;
}

/** A fresh state: nothing picked, nothing tried. */
export function newTradeoffState(_spec) {
  return { picks: {}, tried: [], solved: false };
}

/**
 * Pick option `optionId` for knob `knobId`: `{state, outcome}`. Outcome: 'picked', 'unknown'
 * (no such knob or option) or 'solved' (locked). Never mutates; unknown/solved return `state`.
 */
export function pickOption(spec, state, knobId, optionId) {
  const knob = spec.knobs.find((k) => k.id === knobId);
  if (!knob || !knob.options.some((o) => o.id === optionId)) return { state, outcome: 'unknown' };
  if (state.solved) return { state, outcome: 'solved' };
  return { state: { ...state, picks: { ...state.picks, [knobId]: optionId } }, outcome: 'picked' };
}

const planKey = (spec, picks) => spec.knobs.map((k) => picks[k.id]).join(',');

/**
 * Check the plan: `{state, outcome, total, over, lost}`. Outcome: 'solved' (already),
 * 'incomplete' (a knob has no pick), 'right' (within the cap, every need kept; state.solved),
 * 'repeat' (this failing plan was tried before) or 'wrong'. `over` and `lost` as evaluatePlan.
 */
export function checkTradeoff(spec, state) {
  const r = evaluatePlan(spec, state.picks);
  const out = (s, outcome) => ({ state: s, outcome, total: r.total, over: r.over, lost: r.lost });
  if (state.solved) return out(state, 'solved');
  if (!r.complete) return out(state, 'incomplete');
  if (passes(spec, state.picks)) return out({ ...state, solved: true }, 'right');
  const k = planKey(spec, state.picks);
  if (state.tried.includes(k)) return out(state, 'repeat');
  return out({ ...state, tried: [...state.tried, k] }, 'wrong');
}
