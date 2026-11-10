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
  telemetry = null,
  guide = null,
  onWidget = null,
}) {
  if (!level || typeof level.id !== 'string') throw new TypeError('level.id is required');
  if (!ovBody || !ovActions) throw new TypeError('ovBody and ovActions are required');
  if (typeof onFinish !== 'function') throw new TypeError('onFinish must be a function');
  if (typeof reportError !== 'function') throw new TypeError('reportError must be a function');
  if (onWidget !== null && typeof onWidget !== 'function') throw new TypeError('onWidget must be a function');
  if (!signal || typeof signal.aborted !== 'boolean') throw new TypeError('signal is required');

  const levelId = level.id;
  // reportError must never strand the player, even if it throws itself.
  const report = (e) => {
    try {
      reportError(e);
    } catch {
      // nothing left to tell
    }
  };
  // A clock reading that throws, is not finite or is out of Date's range is reported
  // and becomes NaN, which counts as no elapsed time and no date.
  const readClock = () => {
    try {
      const t = now();
      if (Number.isFinite(t) && !Number.isNaN(new Date(t).getTime())) return t;
      report(new Error(`level "${levelId}": clock gave a non-finite or out-of-range time`));
    } catch (e) {
      report(e);
    }
    return NaN;
  };
  const startedAt = readClock();
  let mistakes = 0;
  let hintsUsed = 0;
  let finished = false;
  const guideListeners = new Set();
  signal.addEventListener?.('abort', () => guideListeners.clear(), { once: true });

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
    // One answered guide question costs one hint (owner choice, #17): the same accounting as
    // hint(), then the boards are told so they show it.
    askedGuide() {
      if (finished) return;
      hintsUsed += 1;
      for (const fn of [...guideListeners]) {
        try {
          fn();
        } catch (e) {
          report(e);
        }
      }
    },
    /**
     * Say which widget the step on screen shows ('choice', 'sort', ...; the How to play modal follows
     * it, #316). Each widget's mount calls it. Nothing after the signal aborts; a throwing onWidget is reported.
     */
    widget(key) {
      if (signal.aborted || onWidget === null) return;
      try {
        onWidget(key);
      } catch (e) {
        report(e);
      }
    },
    /** Listen for answered guide questions; returns the function that stops listening. */
    onGuideHint(fn) {
      if (signal.aborted || typeof fn !== 'function') return () => {};
      guideListeners.add(fn);
      return () => guideListeners.delete(fn);
    },
    // Build the result first; latch only once nothing else can throw, so an
    // unexpected throw leaves finish retryable instead of stranding the player.
    finish(opts) {
      if (finished || signal.aborted) return null;
      const { text: rawText, cards } = opts ?? {};
      const kept = Array.isArray(cards) ? [...cards] : [];
      let text = '';
      try { text = rawText == null ? '' : String(rawText); } catch (e) { report(e); }
      const t = readClock();
      const elapsedMs = Number.isFinite(t - startedAt) ? t - startedAt : 0;
      const stars = scoreStars({ mistakes, hintsUsed, elapsedMs }, level);
      const result = { stars, cards: kept, text };
      const at = Number.isFinite(t) ? new Date(t).toISOString() : null;
      finished = true;
      try {
        onFinish(levelId, { ...result, cards: [...kept], at });
      } catch (e) {
        report(e);
      }
      return result;
    },
    reduceMotion: !!reduceMotion,
    // The telemetry facade (docs/FOUNDATION.md §2.6), or null when the app has none.
    telemetry: telemetry ?? null,
    // The guide status the app passes (docs/FOUNDATION.md §2.6), or null; unused until the panel.
    guide: guide ?? null,
    ovBody,
    ovActions,
    signal,
  };
}
