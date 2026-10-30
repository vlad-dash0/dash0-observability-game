// The ctx a level's run() receives (docs/FOUNDATION.md §2.6). One implementation,
// used by the app and the play-through harness alike.
import { escapeHtml, shuffle as kitShuffle, speech } from './lesson-kit.mjs';
import { scoreStars } from './scoring.mjs';

/**
 * Create the ctx for one open level. `level.id` is captured now, so a stale finish
 * can never credit another level; `finish` is a no-op once done or once `signal`
 * aborts (the overlay closed). A throwing `onFinish` or a broken clock goes to
 * `reportError` and never strands the player.
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
  reportError = console.error,
}) {
  if (!level || typeof level.id !== 'string') throw new TypeError('level.id is required');
  if (!ovBody || !ovActions) throw new TypeError('ovBody and ovActions are required');
  if (typeof onFinish !== 'function') throw new TypeError('onFinish must be a function');
  if (typeof reportError !== 'function') throw new TypeError('reportError must be a function');
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
    finish(opts) {
      if (finished || signal.aborted) return null;
      finished = true;
      const { text, cards } = opts ?? {};
      const t = now();
      const date = new Date(t);
      const clockOk = Number.isFinite(t - startedAt) && !Number.isNaN(date.getTime());
      if (!clockOk) reportError(new Error(`level "${levelId}": clock gave ${startedAt}, ${t}`));
      const kept = Array.isArray(cards) ? cards : [];
      const result = {
        stars: scoreStars(
          { mistakes, hintsUsed, elapsedMs: clockOk ? t - startedAt : 0 },
          level,
        ),
        cards: [...kept],
        text: text == null ? '' : String(text),
      };
      const at = clockOk ? date.toISOString() : null;
      try {
        onFinish(levelId, { ...result, cards: [...kept], at });
      } catch (e) {
        reportError(e);
      }
      return result;
    },
    reduceMotion: !!reduceMotion,
    ovBody,
    ovActions,
    signal,
  };
}
