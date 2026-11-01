// Expected star totals, derived from a registry so a level PR never restates them.
// Deliberately independent of lib/progress.mjs starTotals (calling it would make the
// assertion a tautology): count the scored levels in `order`, times 3.
export const STARS_PER_LEVEL = 3;

export function scoredLevelCount(registry) {
  return registry.order.filter((id) => registry.levels[id].scored === true).length;
}

export function expectedStarMax(registry) {
  return STARS_PER_LEVEL * scoredLevelCount(registry);
}
