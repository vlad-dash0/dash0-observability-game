// Blind-strategy probe for Trade-off boards (#265): which plans pass, and which cost or
// Keeps heuristics (no reading of the concept) would pass. Pure; uses the real evaluatePlan.
// A strategy picks a set of options per knob (cost ties keep every tied option); it "passes"
// when ANY of the plans it can produce passes, so a tie never hides a win.
import { allPlans, evaluatePlan } from '../../lib/widgets/trade-off.mjs';

const passes = (spec, picks) => {
  const r = evaluatePlan(spec, picks);
  return r.over === 0 && r.lost.length === 0;
};
const by = (options, score, best) => {
  const top = options.map(score).reduce((a, b) => (best(a, b) ? a : b));
  return options.filter((o) => score(o) === top);
};
const lowest = (a, b) => a <= b;
const highest = (a, b) => a >= b;
const nKeeps = (o) => (o.keeps ?? []).length;
const cheapestOf = (opts) => by(opts, (o) => o.cost, lowest);

/** Per-knob rules: options -> the picked options (a list when ties). */
export const RULES = {
  cheapest: (opts) => cheapestOf(opts),
  priciest: (opts) => by(opts, (o) => o.cost, highest),
  middle: (opts) => {
    const s = [...opts].sort((a, b) => a.cost - b.cost);
    return [...new Set([s[Math.floor((s.length - 1) / 2)], s[Math.ceil((s.length - 1) / 2)]])];
  },
  'cheapest-keeper': (opts) => {
    const k = opts.filter((o) => nKeeps(o) > 0);
    return cheapestOf(k.length ? k : opts);
  },
  'most-keeps-then-cheapest': (opts) => cheapestOf(by(opts, nKeeps, highest)),
  'most-keeps': (opts) => by(opts, nKeeps, highest),
  first: (opts) => [opts[0]],
  last: (opts) => [opts[opts.length - 1]],
};

const product = (lists) => lists.reduce((acc, l) => acc.flatMap((p) => l.map((o) => [...p, o])), [[]]);
const toPicks = (spec, opts) => Object.fromEntries(spec.knobs.map((k, i) => [k.id, opts[i].id]));

/** Does the rule, applied to every knob, produce a passing plan? Also its plans. */
export function strategyPlans(spec, rule) {
  return product(spec.knobs.map((k) => RULES[rule](k.options))).map((o) => toPicks(spec, o));
}

/** { passing: picks[], strategies: {rule: boolean}, singleKnob: {knob: {rule: boolean}} } */
export function probe(spec) {
  const passing = allPlans(spec).filter((p) => passes(spec, p));
  const strategies = {};
  for (const rule of Object.keys(RULES)) strategies[rule] = strategyPlans(spec, rule).some((p) => passes(spec, p));
  // Single-knob rule: the rule decides one knob; the others are searched exhaustively. True when
  // that rule's pick on that knob is the answer's, i.e. the rule alone would not mislead there.
  const singleKnob = {};
  for (const k of spec.knobs) {
    singleKnob[k.id] = {};
    for (const rule of Object.keys(RULES)) singleKnob[k.id][rule] = RULES[rule](k.options).some((o) => o.id === spec.answer[k.id]);
  }
  return { passing, strategies, singleKnob };
}
