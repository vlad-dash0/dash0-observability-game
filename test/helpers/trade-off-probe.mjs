// Blind-strategy probe for Trade-off boards (#265): which plans pass, and which per-knob rules
// applied to EVERY knob (no reading of the concept) would pass. Pure; uses the real evaluatePlan.
// A rule picks a set of options per knob (every option tied on the rule is kept); it "passes"
// when ANY plan it can produce passes, so a tie never hides a win.
//
// Two families. BLIND rules know only what the cards show before a Check (cost, position, label
// length): the Keeps line is hidden until a Check (trade-off-view.mjs), so these are the rules a
// player has without knowing the concept. KEEPS rules also read `keeps`; they model a player who
// has learned the Keeps (from a failed Check) and are pinned where the board's structure allows.
import { allPlans, evaluatePlan } from '../../lib/widgets/trade-off.mjs';

const passes = (spec, picks) => {
  const r = evaluatePlan(spec, picks);
  return r.over === 0 && r.lost.length === 0;
};
const nKeeps = (o) => (o.keeps ?? []).length;
const plainLen = (o) => o.label.replace(/<[^>]+>/g, '').length;
const atScore = (opts, score, pickBest) => {
  const best = opts.map(score).reduce((a, b) => (pickBest(a, b) ? a : b));
  return opts.filter((o) => score(o) === best);
};
const low = (a, b) => a <= b;
const high = (a, b) => a >= b;
/** The options at the `k`th distinct cost from the cheapest (clamped to the dearest). */
const costRank = (opts, k) => {
  const costs = [...new Set(opts.map((o) => o.cost))].sort((a, b) => a - b);
  return opts.filter((o) => o.cost === costs[Math.min(k, costs.length - 1)]);
};
const cheapestOf = (opts) => atScore(opts, (o) => o.cost, low);
const middleOf = (list) => [...new Set([list[Math.floor((list.length - 1) / 2)], list[Math.ceil((list.length - 1) / 2)]])];
const keepers = (opts) => {
  const k = opts.filter((o) => nKeeps(o) > 0);
  return k.length ? k : opts;
};

/** Per-knob rules: options -> the picked options (a list when ties). */
export const BLIND_RULES = {
  cheapest: (opts) => costRank(opts, 0),
  'second-cheapest': (opts) => costRank(opts, 1),
  'middle-cost': (opts) => {
    const costs = [...new Set(opts.map((o) => o.cost))].sort((a, b) => a - b);
    return opts.filter((o) => middleOf(costs).includes(o.cost));
  },
  priciest: (opts) => costRank(opts, Infinity),
  first: (opts) => [opts[0]],
  last: (opts) => [opts[opts.length - 1]],
  'middle-position': (opts) => middleOf(opts),
  'longest-label': (opts) => atScore(opts, plainLen, high),
  'shortest-label': (opts) => atScore(opts, plainLen, low),
};
export const KEEPS_RULES = {
  'cheapest-keeper': (opts) => cheapestOf(keepers(opts)),
  'second-cheapest-keeper': (opts) => costRank(keepers(opts), 1),
  'most-keeps-then-cheapest': (opts) => cheapestOf(atScore(opts, nKeeps, high)),
  'most-keeps': (opts) => atScore(opts, nKeeps, high),
};
export const RULES = { ...BLIND_RULES, ...KEEPS_RULES };

const product = (lists) => lists.reduce((acc, l) => acc.flatMap((p) => l.map((o) => [...p, o])), [[]]);
const toPicks = (spec, opts) => Object.fromEntries(spec.knobs.map((k, i) => [k.id, opts[i].id]));

/** The plans rule `rule` can produce on `spec`. */
export function strategyPlans(spec, rule) {
  return product(spec.knobs.map((k) => RULES[rule](k.options))).map((o) => toPicks(spec, o));
}

/** { passing: picks[], strategies: {rule: boolean} } */
export function probe(spec) {
  const passing = allPlans(spec).filter((p) => passes(spec, p));
  const strategies = {};
  for (const rule of Object.keys(RULES)) strategies[rule] = strategyPlans(spec, rule).some((p) => passes(spec, p));
  return { passing, strategies };
}
