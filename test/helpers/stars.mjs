// Expected star totals, derived from a registry so a level PR never restates them.
// Deliberately independent of lib/progress.mjs starTotals (calling it would make the
// assertion a tautology): count the scored levels in `order`, times the one star maximum.
import { MAX_STARS } from '../../lib/scoring.mjs';
export const STARS_PER_LEVEL = MAX_STARS;

export function scoredLevelCount(registry) {
  return registry.order.filter((id) => registry.levels[id].scored === true).length;
}

export function expectedStarMax(registry) {
  return STARS_PER_LEVEL * scoredLevelCount(registry);
}
