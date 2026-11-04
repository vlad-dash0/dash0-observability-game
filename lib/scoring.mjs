// The one star rule (docs/FOUNDATION.md §2.6). Levels never pass stars; ctx counts
// mistakes and hints and this turns the counts into 0..MAX_STARS stars. MAX_STARS is
// the only place the maximum is written; progress, totals and every display derive it.

export const MAX_STARS = 5;

/**
 * Stars for a run: penalties = mistakes + hints + one for going over par.
 * 0 -> 5, 1 -> 4, 2 -> 3, 3 or 4 -> 2, 5 or more -> 1; 0 if unscored.
 */
export function scoreStars({ mistakes, hintsUsed, elapsedMs }, { scored, scoring }) {
  if (!scored) return 0;
  const { parMs } = scoring;
  const overPar = parMs != null && elapsedMs > parMs ? 1 : 0;
  const p = mistakes + hintsUsed + overPar;
  if (p <= 2) return MAX_STARS - p;
  if (p <= 4) return 2;
  return 1;
}
