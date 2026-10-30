// The ctx a level's run() receives (docs/FOUNDATION.md §2.6). One implementation,
// used by the app and the play-through harness alike.
import { escapeHtml, shuffle as kitShuffle, speech } from './lesson-kit.mjs';
import { scoreStars } from './scoring.mjs';

/**
 * Create the ctx for one open level. `level.id` is captured now, so a stale finish
 * can never credit another level; `finish` is a no-op once done or once `signal`
 * aborts (the overlay closed).
 */
export function createLevelContext({
  level,
  ovBody,
  ovActions,
  now = Date.now,
  shuffle = kitShuffle,
  reduceMotion = false,
  onFinish,
  signal,
}) {
  if (!level || typeof level.id !== 'string') throw new TypeError('level.id is required');
  if (typeof onFinish !== 'function') throw new TypeError('onFinish must be a function');
  if (!signal || typeof signal.aborted !== 'boolean') throw new TypeError('signal is required');

  const levelId = level.id;
  const startedAt = now();
  let mistakes = 0;
  let hintsUsed = 0;
  let finished = false;

  return {
    renderStep(bodyHtml, actionsHtml) {
      ovBody.innerHTML = bodyHtml;
      ovActions.innerHTML = actionsHtml || '';
      ovBody.scrollTop = 0;
    },
    speech,
    escapeHtml,
    shuffle: (arr) => shuffle([...arr]),
    mistake() {
      mistakes += 1;
    },
    hint() {
      hintsUsed += 1;
    },
    finish({ text = '', cards = [] } = {}) {
      if (finished || signal.aborted) return null;
      finished = true;
      const t = now();
      const result = {
        stars: scoreStars({ mistakes, hintsUsed, elapsedMs: t - startedAt }, level),
        cards: Array.isArray(cards) ? [...cards] : [],
        text,
      };
      onFinish(levelId, { ...result, at: new Date(t).toISOString() });
      return result;
    },
    reduceMotion: !!reduceMotion,
    ovBody,
    ovActions,
    signal,
  };
}
