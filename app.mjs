// The hub game: progress, the system map, level cards, the level overlay and the reward
// card (adapted from R's app.mjs; docs/FOUNDATION.md §5 F5). A plain object, no Alpine
// import: main.mjs registers it as Alpine.data('game') and tests call it directly.
// Everything from the browser (storage, document, window, clock, timers) comes in `deps`.
//
// Level HTML is rendered into #ov-body / #ov-actions, which index.html keeps inside an
// x-ignore wrapper so Alpine never walks or re-renders a level's markup.
import { DECK } from './cards/deck.mjs';
import { EDGES, NODES } from './hub/map-data.mjs';
import { ACTS } from './levels/index.mjs';
import { shuffle as kitShuffle } from './lib/lesson-kit.mjs';
import { createLevelContext } from './lib/level-context.mjs';
import { nodeStates, renderMap } from './lib/map.mjs';
import { cardTotals, mergeProgress, recordCompletion, registryIds, starTotals } from './lib/progress.mjs';
import { buildRegistry } from './lib/registry.mjs';
import { loadProgress, saveProgress, STORAGE_KEY } from './lib/storage.mjs';
import { readTheme, writeTheme } from './lib/theme.mjs';
import { levelState, lockReason } from './lib/unlock.mjs';

/** The shipped registry: levels/index.mjs checked against the deck and the map's node ids. */
export function liveRegistry() {
  return buildRegistry(ACTS, { deck: DECK, nodeIds: NODES.map((n) => n.id) });
}

// Player-facing text for every non-null game.notice (§4 Absence).
export const NOTICES = Object.freeze({
  corrupt:
    'Your saved progress could not be read, so this is a fresh start. The old data is kept as a backup the next time you finish a level.',
  future:
    'Your progress was saved by a newer version of the game. Reload the page to get it; nothing is saved from this tab until then.',
  unavailable:
    'This browser is not letting the game save (private mode or full storage). Progress lasts until you close the tab.',
});

// Screen-reader wording for each levelState.
const STATE_LABELS = Object.freeze({
  locked: 'locked',
  open: 'ready to play',
  done: 'done, play again',
});

const NUDGE_MS = 2600;
const CONFETTI = 40;

/**
 * The Alpine component data for the hub. deps: { registry (§2.4), storage (getter for a
 * Storage), document, window?, deck?, nodes?, edges?, now?, rand?, reduceMotion? (() →
 * boolean), reportError?, setTimeout?, clearTimeout? }.
 */
export function createGame(deps) {
  const {
    registry,
    storage,
    document: doc,
    window: win = null,
    deck = DECK,
    nodes = NODES,
    edges = EDGES,
    now = Date.now,
    rand = Math.random,
    reduceMotion = () => false,
    reportError = (e) => console.error(e),
    setTimeout: later = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout,
  } = deps;
  const report = (e) => {
    try {
      reportError(e);
    } catch {
      // nothing left to tell
    }
  };
  const cardFront = Object.fromEntries(deck.map((c) => [c.id, c.front]));
  const loaded = loadProgress(storage, registry);
  // The open level's AbortController; aborting it makes that ctx's finish a no-op.
  let session = null;
  let nudgeTimer = null;

  return {
    progress: loaded.progress,
    notice: loaded.status === 'fresh' || loaded.status === 'ok' ? null : loaded.status,
    theme: readTheme(storage),
    acts: registry.acts.map((a) => ({
      id: a.id,
      no: a.no,
      name: a.name,
      sub: a.sub,
      ids: [...a.levelIds, ...(a.bossId ? [a.bossId] : [])],
    })),
    overlayOpen: false,
    overlayTitle: '',
    currentLevelId: null,
    nudgeId: null,
    rewardOpen: false,
    rewardTitle: '',
    rewardText: '',
    rewardStars: null,
    rewardCards: [],

    init() {
      win?.addEventListener('storage', (e) => this.onStorage(e));
    },

    // ---------- derived ----------
    get hasLevels() {
      return registry.order.length > 0;
    },
    get stars() {
      return starTotals(this.progress, registry);
    },
    get cards() {
      return cardTotals(this.progress, registry);
    },
    noticeText() {
      return this.notice ? NOTICES[this.notice] ?? '' : '';
    },
    level(id) {
      return registry.levels[id];
    },
    levelState(id) {
      return levelState(id, this.progress, registry);
    },
    // A class string, never a mixed :class array (Alpine renders "[object Object]").
    levelClasses(id) {
      return this.levelState(id) + (this.nudgeId === id ? ' nudge' : '');
    },
    levelLabel(id) {
      const l = registry.levels[id];
      const head = l.kind === 'boss' ? 'Incident' : l.no;
      const sub = l.sub ? ` ${l.sub}.` : '';
      return `${head}: ${l.name}.${sub} ${STATE_LABELS[this.levelState(id)]}`;
    },
    // The card subtitle: the lock reason while nudged, else the level's sub.
    levelSub(id) {
      return this.nudgeId === id ? this.lockText(id) : registry.levels[id].sub;
    },
    lockText(id) {
      const why = lockReason(id, this.progress, registry);
      if (why === null) return '';
      if (why.kind === 'act') {
        const act = registry.acts.find((a) => a.id === why.actId);
        return `Finish "${act.name || act.id}" first to unlock this act.`;
      }
      if (why.kind === 'boss') {
        const names = why.remaining.map((r) => `"${registry.levels[r].name}"`).join(', ');
        return `Finish ${names} first to take on this incident.`;
      }
      return 'This level is not available in this version.';
    },
    starText(id) {
      const s = this.progress.levels[id]?.stars ?? 0;
      return '★'.repeat(s) + '☆'.repeat(3 - s);
    },
    starSummary() {
      const { earned, max } = this.stars;
      return `${earned} of ${max} stars`;
    },
    mapState() {
      return nodeStates(registry, this.progress, nodes, edges);
    },
    mapSvg() {
      return renderMap(this.mapState(), nodes, edges);
    },
    mapLabel() {
      const lit = Object.values(this.mapState().nodes).filter((n) => n.lit).length;
      return `System map: ${lit} of ${nodes.length} components lit.`;
    },

    // ---------- theme ----------
    toggleTheme() {
      this.theme = this.theme === 'light' ? 'dark' : 'light';
      doc.documentElement.dataset.theme = this.theme;
      writeTheme(storage, this.theme);
    },
    themeLabel() {
      return this.theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme';
    },

    // ---------- levels ----------
    // A locked card wiggles and names what unlocks it (R's nudge) instead of doing nothing.
    openLevel(id) {
      if (this.levelState(id) === 'locked') {
        if (Object.hasOwn(registry.levels, id)) this.nudge(id);
        return false;
      }
      this.endSession();
      this.nudgeId = null;
      const level = registry.levels[id];
      const controller = new AbortController();
      session = controller;
      this.currentLevelId = id;
      this.overlayTitle = level.name;
      this.overlayOpen = true;
      try {
        const ctx = createLevelContext({
          level,
          ovBody: doc.getElementById('ov-body'),
          ovActions: doc.getElementById('ov-actions'),
          now,
          shuffle: (arr) => kitShuffle(arr, rand),
          reduceMotion: !!reduceMotion(),
          onFinish: (levelId, result) => this.completeLevel(levelId, result),
          signal: controller.signal,
          reportError: report,
        });
        level.run(ctx);
      } catch (e) {
        report(e);
      }
      this.focusSoon('.overlay .back-btn');
      return true;
    },

    nudge(id) {
      this.nudgeId = id;
      cancel(nudgeTimer);
      nudgeTimer = later(() => {
        this.nudgeId = null;
      }, NUDGE_MS);
    },

    // Abort the open level (its timers stop, a stale finish is a no-op) and clear its DOM.
    endSession() {
      if (session) session.abort();
      session = null;
      for (const id of ['ov-body', 'ov-actions']) {
        const el = doc.getElementById(id);
        if (el) el.innerHTML = '';
      }
    },

    closeOverlay() {
      this.endSession();
      this.overlayOpen = false;
      this.returnFocus();
    },

    // Called by the ctx with the id it captured at creation, never the level open now.
    completeLevel(levelId, result) {
      const level = registry.levels[levelId];
      const rec = recordCompletion(this.progress, levelId, result, registry);
      const saved = saveProgress(storage, rec.progress, registry);
      this.progress = saved.progress;
      if (!saved.saved) this.notice = saved.reason;
      this.endSession();
      this.overlayOpen = false;
      this.fireConfetti();
      this.rewardTitle = level?.rewardTitle ?? 'Level complete';
      this.rewardText = result.text;
      this.rewardStars = level?.scored ? result.stars : null; // this run's stars
      this.rewardCards = rec.newCards.map((c) => cardFront[c] ?? c);
      this.rewardOpen = true;
      this.focusSoon('.reward .btn');
    },

    closeReward() {
      this.rewardOpen = false;
      this.returnFocus();
    },
    rewardStarsText() {
      return this.rewardStars == null ? '' : '★'.repeat(this.rewardStars) + '☆'.repeat(3 - this.rewardStars);
    },
    rewardStarsLabel() {
      return this.rewardStars == null ? 'Not scored' : `${this.rewardStars} of 3 stars`;
    },

    // Another tab saved: merge its progress in (progress only goes up, never replaced).
    onStorage(e) {
      if (e && e.key !== STORAGE_KEY && e.key !== null) return;
      const other = loadProgress(storage, registry).progress;
      this.progress = mergeProgress(this.progress, other, { keep: registryIds(registry) });
    },

    // ---------- focus ----------
    // Put focus back on the card that opened the level (by id, not position).
    returnFocus() {
      const id = this.currentLevelId;
      if (id) this.focusSoon(`[data-level-id="${id}"]`);
    },
    // Focus after Alpine has rendered (its $nextTick when running under Alpine).
    focusSoon(selector) {
      const go = () => doc.querySelector(selector)?.focus?.();
      if (typeof this.$nextTick === 'function') this.$nextTick(go);
      else go();
    },

    // Celebration bits: class colours (.c1-.c6) and Web Animations only, no style writes.
    // Skipped under reduced motion; the reward card still celebrates.
    fireConfetti() {
      if (reduceMotion()) return;
      const view = doc.defaultView;
      const height = (view && view.innerHeight) || 800;
      for (let i = 0; i < CONFETTI; i++) {
        const c = doc.createElement('div');
        c.className = `confetti c${(i % 6) + 1}`;
        c.setAttribute('aria-hidden', 'true');
        doc.body.appendChild(c);
        const x = Math.round(rand() * 100);
        const spin = Math.round(rand() * 720);
        const fall = 2000 + Math.round(rand() * 700);
        try {
          const anim = c.animate(
            [
              { transform: `translate(${x}vw, 0) rotate(0deg)`, opacity: 1 },
              { transform: `translate(${x}vw, ${height + 40}px) rotate(${spin}deg)`, opacity: 0.2 },
            ],
            { duration: fall, easing: 'cubic-bezier(.3,.6,.5,1)' },
          );
          anim.onfinish = () => c.remove();
        } catch {
          c.remove();
        }
      }
    },
  };
}
