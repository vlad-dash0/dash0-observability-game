// The hub game: progress, the globe, level cards, the level overlay and the reward
// card (adapted from R's app.mjs; docs/FOUNDATION.md §5 F5). A plain object, no Alpine
// import: main.mjs registers it as Alpine.data('game') and tests call it directly.
// Everything from the browser (storage, document, window, clock, timers) comes in `deps`.
//
// Level HTML is rendered into #ov-body / #ov-actions inside an x-ignore wrapper. x-ignore
// only stops Alpine walking the initial markup: Alpine 3.14.1's mutation observer still
// initialises nodes a level adds later (it never checks ancestors for x-ignore), so level
// markup must not use Alpine attributes (x-*, @*, :*). test/levels-play.test.mjs checks.
import { DECK } from './cards/deck.mjs';
import { DOTS } from './hub/globe-data.mjs';
import { COMING_SOON } from './hub/coming-soon.mjs';
import { ACT_REGIONS, actOfCountry, COUNTRY_NAMES, LEVEL_COUNTRY } from './hub/globe-map.mjs';
import { NODE_IDS } from './hub/map-data.mjs';
import { ACTS } from './levels/index.mjs';
import { shuffle as kitShuffle } from './lib/lesson-kit.mjs';
import { endSentence } from './lib/text.mjs';
import { globeState } from './lib/globe.mjs';
import { freshlyLit, igniteView, litText } from './lib/globe-ignite.mjs';
import { dotStates, globeLabel, globeLines, globeTarget } from './lib/globe-view.mjs';
import { createLevelContext } from './lib/level-context.mjs';
import { cardTotals, mergeProgress, recordCompletion, registryIds, starTotals } from './lib/progress.mjs';
import { MAX_STARS } from './lib/scoring.mjs';
import { runPlay, validatePlay } from './lib/play.mjs';
import { buildRegistry } from './lib/registry.mjs';
import { loadProgress, saveProgress, STORAGE_KEY } from './lib/storage.mjs';
import { readTheme, writeTheme } from './lib/theme.mjs';
import { levelState, lockReason } from './lib/unlock.mjs';

// A star row always shows MAX_STARS glyphs: `n` filled, the rest empty.
const starGlyphs = (n) => '★'.repeat(n) + '☆'.repeat(MAX_STARS - n);

/**
 * The shipped registry: levels/index.mjs checked against the deck and the `lights` ids.
 * `acts` / `deck` default to the real ones; tests pass fixtures through the same checks.
 */
export function liveRegistry(acts = ACTS, deck = DECK) {
  return buildRegistry(acts, { deck, nodeIds: NODE_IDS, play: { validatePlay, runPlay } });
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

// <input> types that take no text: Escape on them still closes the level.
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

/** True when `el` is (inside) a text-entry control: textarea, select, contenteditable or a text-like input. */
function isTyping(el) {
  if (!el || typeof el.closest !== 'function') return false;
  const field = el.closest('input, textarea, select, [contenteditable]');
  if (field === null) return false;
  const tag = field.localName;
  if (tag === 'input') return !NON_TEXT_INPUTS.has((field.getAttribute('type') || 'text').toLowerCase());
  if (tag === 'textarea' || tag === 'select') return true;
  return field.getAttribute('contenteditable').toLowerCase() !== 'false';
}

const NUDGE_MS = 2600;
const CONFETTI = 40;

/**
 * The Alpine component data for the hub. deps: { registry (§2.4), storage (getter for a
 * Storage), document, window?, deck?, globe? ((host, view) → Promise of a globe handle or
 * null; lib/globe-render.mjs mountGlobe in the browser), globeMap? ({ACT_REGIONS,
 * LEVEL_COUNTRY, COUNTRY_NAMES, actOf}), dots?, comingSoon? (acts shown but not playable, hub/coming-soon.mjs), now?, rand?, reduceMotion? (() → boolean), reportError?,
 * telemetry? (lib/telemetry.mjs facade; completions emit a level.complete span), setTimeout?, clearTimeout?, debug? (boolean, ?mode=debug: every level opens, nothing is saved) }. Without `globe` the hub shows the globe's text fallback.
 */
export function createGame(deps) {
  const {
    registry,
    storage,
    document: doc,
    window: win = null,
    deck = DECK,
    globe: mountGlobe = null,
    globeMap = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES, actOf: actOfCountry },
    dots = DOTS,
    comingSoon = COMING_SOON,
    now = Date.now,
    rand = Math.random,
    reduceMotion = () => false,
    reportError = (e) => console.error(e),
    setTimeout: later = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout,
    debug = false,
    telemetry = null,
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
  // The drawn globe's handle, outside the component so Alpine never proxies three.js objects;
  // `mounts` counts mount requests, so a mount that resolves after a newer one (or after the
  // hub was hidden) is disposed instead of kept.
  let globe = null;
  let mounts = 0;
  // What the last completion freshly lit, until Back to the map plays it; and an ignite asked
  // for before the globe finished loading.
  let pendingLit = null;
  let queuedIgnite = null;

  return {
    debug: debug === true,
    rewardDebug: false,
    progress: loaded.progress,
    notice: loaded.status === 'fresh' || loaded.status === 'ok' ? null : loaded.status,
    theme: readTheme(storage),
    acts: [
      ...registry.acts.map((a) => ({
        id: a.id,
        no: a.no,
        name: a.name,
        sub: a.sub,
        ids: [...a.levelIds, ...(a.bossId ? [a.bossId] : [])],
        soon: false,
        teaser: '',
      })),
      ...comingSoon.map((a) => ({
        id: a.id,
        no: a.no,
        name: a.name,
        sub: a.sub,
        ids: [],
        soon: true,
        teaser: a.teaser,
      })),
    ].sort((a, b) => a.no - b.no),
    overlayOpen: false,
    overlayTitle: '',
    currentLevelId: null,
    nudgeId: null,
    rewardOpen: false,
    rewardTitle: '',
    rewardText: '',
    rewardStars: null,
    rewardCards: [],
    globeFallback: false,
    litNote: '', // "Germany is now lit: The signals.": the polite announcement and the fallback's first line

    init() {
      win?.addEventListener('storage', (e) => this.onStorage(e));
      // Leaving the page (or entering the back/forward cache) frees the WebGL context.
      win?.addEventListener('pagehide', () => this.hideGlobe());
      win?.addEventListener('pageshow', (e) => {
        if (e?.persisted) this.showGlobe();
      });
      this.showGlobe();
    },
    // Alpine calls this when the component is torn down.
    destroy() {
      this.hideGlobe();
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
    // The one debug override: a known level the rules lock is open (lib/unlock.mjs is untouched).
    levelState(id) {
      const state = levelState(id, this.progress, registry);
      return this.debug && state === 'locked' && Object.hasOwn(registry.levels, id) ? 'open' : state;
    },
    // A class string, never a mixed :class array (Alpine renders "[object Object]").
    levelClasses(id) {
      return this.levelState(id) + (this.nudgeId === id ? ' nudge' : '');
    },
    levelLabel(id) {
      const l = registry.levels[id];
      const head = l.kind === 'boss' ? 'Incident' : l.no;
      const sub = l.sub ? ` ${endSentence(l.sub)}` : '';
      return `${head}: ${endSentence(l.name)}${sub} ${STATE_LABELS[this.levelState(id)]}`;
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
      return starGlyphs(this.progress.levels[id]?.stars ?? 0);
    },
    starSummary() {
      const { earned, max } = this.stars;
      return `${earned} of ${max} stars`;
    },
    // ---------- globe ----------
    mapState() {
      return globeState(registry, this.progress, globeMap, comingSoon);
    },
    // The globe's accessible name: levels done, regions lit, any open incident.
    mapLabel() {
      return globeLabel(this.mapState());
    },
    // The text fallback (no WebGL): one line per act with its region and progress.
    globeLines() {
      const lines = globeLines(registry, this.mapState());
      return this.litNote ? [this.litNote, ...lines] : lines;
    },
    // What the renderer draws: a DOT state per dot and the rotation facing the current act.
    globeView() {
      return {
        states: dotStates(this.mapState(), dots, globeMap.actOf),
        target: globeTarget(registry, this.progress, dots, globeMap.actOf),
      };
    },
    // Draw the globe into .globe-stage (once; the fallback stays once shown). Never while a
    // level covers the hub (a back/forward cache restore can ask then); closing it mounts.
    showGlobe() {
      if (globe || this.globeFallback || this.overlayOpen) return;
      const host = doc.querySelector('.globe-stage');
      if (!mountGlobe || !host) {
        this.globeFallback = true;
        return;
      }
      const token = ++mounts;
      const failed = (e) => {
        if (e) report(e);
        this.hideGlobe();
        this.globeFallback = true;
      };
      Promise.resolve()
        .then(() => mountGlobe(host, { ...this.globeView(), dots, reduced: !!reduceMotion(), onFail: () => failed() }))
        .then(
          (handle) => {
            if (token !== mounts) handle?.dispose();
            else if (handle) {
              globe = handle;
              if (queuedIgnite) handle.ignite(queuedIgnite.view, queuedIgnite.states);
              queuedIgnite = null;
            }
            else failed();
          },
          (e) => (token === mounts ? failed(e) : report(e)),
        );
    },
    // Stop the loop and free the WebGL context (a level covers the hub, or the page goes).
    hideGlobe() {
      mounts++;
      queuedIgnite = null;
      globe?.dispose();
      globe = null;
    },
    refreshGlobe() {
      if (!globe) return;
      const view = this.globeView();
      globe.update(view.states, view.target);
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
    // Refused while a level or the reward is open: the hub is inert then, and a stray
    // Enter must never abort a run. Close the level first (closeOverlay).
    openLevel(id) {
      if (this.overlayOpen || this.rewardOpen) return false;
      if (this.levelState(id) === 'locked') {
        if (Object.hasOwn(registry.levels, id)) this.nudge(id);
        return false;
      }
      this.endSession();
      this.hideGlobe();
      pendingLit = null;
      this.litNote = '';
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
          telemetry,
        });
        level.run(ctx);
      } catch (e) {
        report(e);
      }
      this.focusSoon('#ov-back');
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
      this.showGlobe();
      this.returnFocus();
    },

    // Called by the ctx with the id it captured at creation, never the level open now.
    completeLevel(levelId, result) {
      const level = registry.levels[levelId];
      const rec = recordCompletion(this.progress, levelId, result, registry);
      this.rewardDebug = this.debug;
      const before = this.progress;
      if (!this.debug) {
        const saved = saveProgress(storage, rec.progress, registry);
        this.progress = saved.progress;
        // A save that went through clears corrupt (the backup now exists) and unavailable.
        this.notice = saved.saved ? null : saved.reason;
      }
      // A debug run saves nothing, so nothing is freshly lit and no ignite plays.
      const fresh = this.debug ? null : freshlyLit(before, this.progress, registry, globeMap);
      const text = fresh ? litText(fresh, level, globeMap) : null;
      pendingLit = text ? { fresh, text } : null;
      this.endSession();
      this.overlayOpen = false;
      this.showGlobe();
      this.fireConfetti();
      this.rewardTitle = level?.rewardTitle ?? 'Level complete';
      this.rewardText = result.text;
      this.rewardStars = level?.scored ? result.stars : null; // this run's stars
      this.rewardCards = rec.newCards.map((c) => cardFront[c] ?? c);
      this.rewardOpen = true;
      this.focusSoon('#reward-close');
      this.recordTelemetry(levelId, level, result);
    },

    // Telemetry never blocks play (docs/DASH0-LAB.md, Telemetry session): a span for the completion, then a
    // flush that is not awaited. Any failure is reported and nothing else happens.
    recordTelemetry(levelId, level, result) {
      try {
        if (!telemetry) return;
        telemetry.emit({
          name: 'level.complete',
          attributes: {
            'game.level.id': levelId,
            'game.act.id': level?.actId ?? 'unknown',
            'game.level.stars': result.stars, // the result's stars, never recomputed
            'game.cards.count': Array.isArray(result.cards) ? result.cards.length : 0,
            'game.debug': this.debug,
          },
        });
        Promise.resolve(telemetry.flush()).catch(report);
      } catch (e) {
        report(e);
      }
    },

    closeReward() {
      this.rewardOpen = false;
      if (pendingLit) this.revealLit();
      else this.returnFocus();
    },
    // Back to the map after a first completion: scroll to the globe (smooth unless reduced
    // motion), focus the map heading, announce the country and turn the globe to it with the
    // ignite effect (the renderer skips the effect under reduced motion).
    revealLit() {
      const { fresh, text } = pendingLit;
      pendingLit = null;
      const reduced = !!reduceMotion();
      this.litNote = text;
      const go = () => {
        doc.querySelector('.map-panel')?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        doc.getElementById('map-title')?.focus?.({ preventScroll: true });
      };
      if (typeof this.$nextTick === 'function') this.$nextTick(go);
      else go();
      const view = igniteView(fresh, dots, globeMap.actOf);
      if (view === null) return;
      const states = dotStates(this.mapState(), dots, globeMap.actOf);
      if (globe) globe.ignite(view, states);
      else if (mounts > 0 && !this.globeFallback) queuedIgnite = { view, states };
    },
    rewardNote() {
      return this.rewardDebug ? 'Debug run: not saved.' : '';
    },
    rewardStarsText() {
      return this.rewardStars == null ? '' : starGlyphs(this.rewardStars);
    },
    rewardStarsLabel() {
      return this.rewardStars == null ? 'Not scored' : `${this.rewardStars} of ${MAX_STARS} stars`;
    },

    // Another tab saved: merge its progress in (progress only goes up, never replaced).
    onStorage(e) {
      if (e && e.key !== STORAGE_KEY && e.key !== null) return;
      const { status, progress: other } = loadProgress(storage, registry);
      if (status === 'future') this.notice = 'future';
      this.progress = mergeProgress(this.progress, other, { keep: registryIds(registry) });
      this.refreshGlobe();
    },

    // One window-level Escape handler: closes the reward, else the level, but never the
    // level while the player is typing in it. A widget that handled the Escape (it called
    // preventDefault, e.g. Build it cancelling a pick) owns it.
    onEscape(e) {
      if (e?.defaultPrevented) return;
      if (this.rewardOpen) {
        this.closeReward();
        return;
      }
      if (!this.overlayOpen) return;
      if (!isTyping(e?.target)) this.closeOverlay();
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
