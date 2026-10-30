// The one star rule (docs/FOUNDATION.md §2.6). Levels never pass stars; ctx counts
// mistakes and hints and this turns the counts into 0-3 stars.

/** Stars for a run: 3 clean, 2 for one or two penalties, 1 beyond; 0 if unscored. */
export function scoreStars({ mistakes, hintsUsed, elapsedMs }, { scored, scoring }) {
  if (!scored) return 0;
  const { parMs } = scoring;
  const overPar = parMs != null && elapsedMs > parMs ? 1 : 0;
  const p = mistakes + hintsUsed + overPar;
  if (p === 0) return 3;
  if (p <= 2) return 2;
  return 1;
}
