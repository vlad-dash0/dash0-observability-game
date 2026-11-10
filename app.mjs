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
import { GAME_SUMMARY } from './hub/about.mjs';
import { badgeViews } from './hub/badges.mjs';
import { COMING_SOON } from './hub/coming-soon.mjs';
import { ACT_REGIONS, actOfCountry, COUNTRY_NAMES, islandDots, LEVEL_COUNTRY } from './hub/globe-map.mjs';
import { NODE_IDS } from './hub/map-data.mjs';
import { ACTS } from './levels/index.mjs';
import { shuffle as kitShuffle } from './lib/lesson-kit.mjs';
import { endSentence } from './lib/text.mjs';
import { globeState } from './lib/globe.mjs';
import { freshlyLit, igniteView, litText } from './lib/globe-ignite.mjs';
import { dotStates, globeLabel, globeLines, globeTarget } from './lib/globe-view.mjs';
import { hideHelp, readHiddenHelp } from './lib/help-prefs.mjs';
import { howToView } from './lib/how-to-play.mjs';
import { createGuideClient } from './lib/guide/client.mjs';
import { createAccountClient } from './lib/account/client.mjs';
import { ACCOUNT_UNAVAILABLE, accountHtml, boardHtml, nudgeText, starsText } from './lib/account/board-view.mjs';
import { NICK_RE } from './lib/account/nickname.mjs';
import { setFeedback } from './lib/ui/index.mjs';
import { escapeHtml } from './lib/lesson-kit.mjs';
import { trapTab } from './lib/modal-focus.mjs';
import { createLevelContext } from './lib/level-context.mjs';
import { cardTotals, mergeProgress, recordCompletion, registryIds, starTotals } from './lib/progress.mjs';
import { MAX_STARS } from './lib/scoring.mjs';
import { runPlay, validatePlay } from './lib/play.mjs';
import { buildRegistry } from './lib/registry.mjs';
import { createSaveDialog } from './lib/save-dialog.mjs';
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

// The wait before the one retry after a 429 is capped here.
const MAX_RETRY_S = 60;
// GET /api/account itself failed: said for everyone, including a browser that never signed in.
const ACCOUNT_LOAD_FAILED = 'Sign-in and the leaderboard are unavailable right now; your progress is still saved in this browser.';
const ACCOUNT_LIMITED = 'Too many changes just now. Wait up to an hour and try again.';
const SYNC_PAUSED = 'Saving to your account is paused for a moment; your progress is safe in this browser';

// The hideHelp key of the sign-in nudge (its own "Don't ask again").
export const NUDGE_KEY = 'signin-nudge';

// What `?signin=` says (main.mjs strips it after reading it); any other value says nothing.
export const SIGNIN_NOTICES = Object.freeze({
  failed: 'Sign-in did not work. Try again.',
  domain: 'Sign-in is for @dash0.com Google accounts only.',
  cancelled: 'Sign-in was cancelled.',
  unavailable: 'Sign-in is unavailable right now. Your progress is still saved in this browser.',
});

// Nickname refusals (POST /api/account 400 or 409).
const NICK_ERRORS = Object.freeze({
  taken: 'That nickname is taken.',
  format: 'Use 3 to 20 letters, digits, - or _, starting with a letter or digit.',
  reserved: 'That nickname is not available.',
  blocked: 'That nickname is not available.',
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
const FOCUS_FRAMES = 10; // focusSoon waits at most this many frames for its target to be shown

/**
 * The Alpine component data for the hub. deps: { registry (§2.4), storage (getter for a
 * Storage), document, window?, deck?, globe? ((host, view) → Promise of a globe handle or
 * null; lib/globe-render.mjs mountGlobe in the browser), globeMap? ({ACT_REGIONS,
 * LEVEL_COUNTRY, COUNTRY_NAMES, actOf}), dots?, comingSoon? (acts shown but not playable, hub/coming-soon.mjs), now?, rand?, reduceMotion? (() → boolean), reportError?,
 * fetch? (the page's fetch: asks GET /api/guide once at init whether the guide is on; without it there is no guide), telemetry? (lib/telemetry.mjs facade; completions emit a level.complete span), setTimeout?, clearTimeout?, debug? (boolean, ?mode=debug: every level opens, nothing is saved) }. Without `globe` the hub shows the globe's text fallback.
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
    dots = [...DOTS, ...islandDots()],
    comingSoon = COMING_SOON,
    now = Date.now,
    rand = Math.random,
    reduceMotion = () => false,
    reportError = (e) => console.error(e),
    setTimeout: later = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout,
    // Next animation frame (focusSoon's retry); falls back to a timer where there is none.
    raf = (fn) => (win && typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(fn) : later(fn, 16)),
    // Is the element laid out (not display:none)? An environment with no layout API counts as rendered.
    rendered = (el) => typeof el.getClientRects !== 'function' || el.getClientRects().length > 0,
    debug = false,
    telemetry = null,
    fetch: request = null,
    signin = null, // the `?signin=` value main.mjs read once (and stripped from the URL)
  } = deps;
  const report = (e) => {
    try {
      reportError(e);
    } catch {
      // nothing left to tell
    }
  };
  const cardFront = Object.fromEntries(deck.map((c) => [c.id, c.front]));
  // Ask the guide (#17): the status is fetched once, at init; a level opened before it arrives, or when it
  // failed, has no panel. ?mode=debug is no exception, so the panel can be tried locally.
  const guideClient = typeof request === 'function' ? createGuideClient({ fetch: request }) : null;
  // The account client (#273): without a fetch, or in debug, the game never asks and nothing changes.
  const accountClient = typeof request === 'function' && debug !== true ? createAccountClient({ fetch: request }) : null;
  let syncing = null; // the running sync chain
  let syncAgain = false; // a sync was asked for while one ran
  let nudgeShown = false; // the sign-in nudge shows at most once per page session
  let retrying = false; // a 429 retry is scheduled or running (one per pause)
  let nudgeAsked = 0; // bumps on every nudge request, so a stale leaderboard answer is dropped
  let dontAsk = false; // "Don't ask again" for this visit, even when storage refused the write
  const loaded = loadProgress(storage, registry);
  // The open level's AbortController; aborting it makes that ctx's finish a no-op.
  let session = null;
  let nudgeTimer = null;
  let saveDialog = null;
  // The drawn globe's handle, outside the component so Alpine never proxies three.js objects;
  // `mounts` counts mount requests, so a mount that resolves after a newer one (or after the
  // hub was hidden) is disposed instead of kept.
  let globe = null;
  let mounts = 0;
  // What the last completion freshly lit, until Back to the map plays it; and an ignite asked
  // for before the globe finished loading.
  let pendingLit = null;
  let queuedIgnite = null;
  // How to play cards: the widget keys whose card was closed or hidden since the page loaded.
  // Close lasts until reload; Don't show again also lands here, so a blocked or full storage
  // (or debug, which writes nothing) still hides the card for this visit.
  const seenHelp = new Set();  const NO_HOW_TO = Object.freeze({ topics: Object.freeze([]), footer: '' });

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
        title: `Act ${a.no}: ${a.name}`,
        sub: a.sub,
        ids: [...a.levelIds, ...(a.bossId ? [a.bossId] : [])],
        soon: false,
        teaser: a.teaser,
        badges: badgeViews(a.badges),
      })),
      ...comingSoon.map((a) => ({
        id: a.id,
        no: a.no,
        name: a.name,
        title: `Act ${a.no}: ${a.name}`,
        sub: a.sub,
        ids: [],
        soon: true,
        teaser: a.teaser,
        badges: [],
      })),
    ].sort((a, b) => a.no - b.no),
    overlayOpen: false,
    overlayTitle: '',
    overlayNo: '',
    currentLevelId: null,
    nudgeId: null,
    rewardOpen: false,
    aboutOpen: false,
    saveOpen: false,
    aboutSummary: GAME_SUMMARY,
    howTo: NO_HOW_TO,
    howToOpen: false,
    rewardTitle: '',
    rewardText: '',
    rewardStars: null,
    rewardCards: [],
    globeFallback: false,
    // Sign-in and saved progress (#273). account.state: 'unknown' until GET /api/account answers, then
    // 'unconfigured' | 'signedOut' | 'signedIn' | 'unavailable'. Nothing shows unless signedOut or signedIn.
    account: { state: 'unknown', nick: '', listed: false },
    accountStars: null, // the server's stars for this player; null before the first write (say "no stars yet", never 0)
    accountRank: null,
    accountKnown: false, // true only while accountStars / accountRank are the server's current answer (a sync succeeded and none failed since)
    accountEpoch: 0, // bumped when the session ends, so an answer to an older session is dropped
    accountNotice: '', // text when the account could not be reached; progress is still saved here
    signinStatus: debug !== true && (Object.hasOwn(SIGNIN_NOTICES, signin) || signin === 'new') ? signin : null,
    signinNudgeOpen: false,
    signinNudgeText: '',
    boardOpen: false,
    board: { state: 'loading', size: 0, top: [], me: null },
    accountOpen: false,
    confirmDelete: false,
    litNote: '', // "Germany is now lit: The signals.": the polite announcement and the fallback's first line

    init() {
      win?.addEventListener('storage', (e) => this.onStorage(e));
      // Leaving the page (or entering the back/forward cache) frees the WebGL context.
      win?.addEventListener('pagehide', () => this.hideGlobe());
      win?.addEventListener('pageshow', (e) => {
        if (e?.persisted) this.showGlobe();
      });
      this.showGlobe();
      guideClient?.status();
      this.loadAccount();
    },
    // Alpine calls this when the component is torn down.
    destroy() {
      this.hideGlobe();
    },

    // ---------- account (#273) ----------
    // True when the account UI shows: configured (the server said so), not debug.
    get accountEnabled() {
      return !this.debug && (this.account.state === 'signedOut' || this.account.state === 'signedIn');
    },
    get signedIn() {
      return !this.debug && this.account.state === 'signedIn';
    },
    // "Signed in as <nick>" for the hub, '' otherwise.
    signedInText() {
      return this.signedIn ? `Signed in as ${this.account.nick}` : '';
    },
    // The hub's account line: the server's stars and rank, only while known and current (nothing while the
    // first sync is in flight or after one failed); "no stars yet" when the server has none, never 0.
    accountSummary() {
      if (!this.signedIn || !this.accountKnown) return '';
      return this.accountRank === null ? starsText(this.accountStars) : `${starsText(this.accountStars)}, #${this.accountRank}`;
    },
    // The notice for `?signin=`: the welcome (`new`, a profile just made) needs the nickname, so it waits for
    // GET /api/account; `ok` (a returning player) says nothing. It claims a board place only for a known star.
    signinNoticeText() {
      if (this.signinStatus === null) return '';
      if (this.signinStatus !== 'new') return SIGNIN_NOTICES[this.signinStatus];
      if (!this.signedIn) return '';
      if (!this.account.listed) return `Signed in as ${this.account.nick}.`;
      if (!this.accountKnown) return `Signed in as ${this.account.nick}. Change your nickname or hide yourself in Account.`; // stars unknown: promise nothing
      const onBoard = this.accountKnown && Number.isInteger(this.accountStars) && this.accountStars >= 1;
      return onBoard
        ? `You're on the leaderboard as ${this.account.nick}. Change your nickname or hide yourself in Account.`
        : `You'll appear on the leaderboard as ${this.account.nick} once you earn a star. Change your nickname or hide yourself in Account.`;
    },
    dismissSigninNotice() {
      this.signinStatus = null;
      this.focusSoon('#save-open'); // the dismissed notice held focus; the hub's progress area is stable
    },
    // GET /api/account, once per page (init); the only request an anonymous or unconfigured visit makes.
    async loadAccount() {
      if (!accountClient) return;
      const res = await accountClient.account();
      if (res.state === 'unavailable') {
        this.account = { state: 'unavailable', nick: '', listed: false };
        this.accountNotice = ACCOUNT_LOAD_FAILED;
        return;
      }
      this.account = { state: res.state, nick: res.nick ?? '', listed: res.listed ?? false };
      if (res.state === 'signedIn') await this.syncProgress();
    },
    // POST this browser's progress to the account and save the merged answer locally (saveProgress).
    // One at a time; a request that arrives mid-sync runs once more after it. Never when not signed in.
    syncProgress() {
      if (!accountClient || !this.signedIn) return Promise.resolve();
      if (syncing) {
        syncAgain = true;
        return syncing;
      }
      syncing = (async () => {
        do {
          syncAgain = false;
          await this.syncOnce();
        } while (syncAgain && this.signedIn);
      })().finally(() => {
        syncing = null;
      });
      return syncing;
    },
    // True when the session an answer was asked under has ended (sign-out, delete, 401): drop that answer.
    staleAnswer(epoch) {
      return epoch !== this.accountEpoch || !this.signedIn;
    },
    async syncOnce() {
      const epoch = this.accountEpoch;
      const res = await accountClient.syncProgress(this.progress);
      if (this.staleAnswer(epoch)) return; // signed out or deleted while it was in flight
      this.accountKnown = false; // current only once this answer is ok
      if (res.state === 'signedOut') {
        this.endAccountSession();
        return;
      }
      if (res.state === 'limited') {
        this.accountNotice = SYNC_PAUSED; // the local copy is already saved; one retry after the wait
        if (!retrying) {
          retrying = true;
          later(async () => {
            try {
              await this.syncProgress();
            } finally {
              retrying = false;
            }
          }, Math.min(res.retryAfterS, MAX_RETRY_S) * 1000);
        }
        return;
      }
      if (res.state !== 'ok') {
        this.accountNotice = ACCOUNT_UNAVAILABLE; // the local copy is already saved
        return;
      }
      this.accountNotice = '';
      this.accountKnown = true;
      this.accountStars = res.stars;
      this.accountRank = res.rank;
      const saved = saveProgress(storage, res.progress, registry);
      if (saved.saved) {
        this.progress = saved.progress;
        this.refreshGlobe();
      } else this.notice = saved.reason;
    },

    // The nudge after a win: signed out, not debug, once per page session, not hidden. It waits for the
    // leaderboard so its copy is complete (debug has no account client, so it never gets here); a failed board gives the plain "Sign in to save your progress".
    async maybeSigninNudge() {
      if (!accountClient || this.account.state !== 'signedOut' || nudgeShown || dontAsk) return;
      if (readHiddenHelp(storage).hidden.has(NUDGE_KEY)) return;
      nudgeShown = true;
      const ask = ++nudgeAsked;
      const board = await accountClient.leaderboard();
      if (ask !== nudgeAsked || !this.rewardOpen || this.account.state !== 'signedOut') return;
      this.signinNudgeText = nudgeText(board);
      this.signinNudgeOpen = true;
    },
    // Not now: gone for this page session (the flag already says so).
    dismissSigninNudge() {
      nudgeAsked++;
      this.signinNudgeOpen = false;
      this.focusSoon('#reward-close'); // the nudge's own button held focus
    },
    // Don't ask again: stored under hideHelp, and always hidden for this visit.
    hideSigninNudge() {
      dontAsk = true;
      if (!this.debug) hideHelp(storage, [NUDGE_KEY]);
      this.dismissSigninNudge();
    },

    // The board modal (#board-modal draws into #board-body): the top 10 and "You: N stars, #r".
    async openBoard() {
      if (!this.accountEnabled || this.dialogOpen()) return false;
      this.board = { state: 'loading', size: 0, top: [], me: null };
      this.boardOpen = true;
      this.renderBoard();
      this.focusSoon('#board-title');
      const res = await accountClient.leaderboard();
      if (!this.boardOpen) return true;
      this.board = res;
      this.renderBoard();
      return true;
    },
    renderBoard() {
      const host = doc.getElementById('board-body');
      if (host) host.innerHTML = boardHtml(this.board);
    },
    closeBoard() {
      if (!this.boardOpen) return;
      this.boardOpen = false;
      this.focusSoon('#board-open');
    },

    // The account modal (#account-modal draws into #account-body): nickname, listing, sign out, delete.
    openAccount() {
      if (!this.signedIn || this.dialogOpen()) return false;
      this.confirmDelete = false;
      this.accountOpen = true;
      this.renderAccount();
      this.focusSoon('#account-title');
      return true;
    },
    closeAccount() {
      if (!this.accountOpen) return;
      this.accountOpen = false;
      this.confirmDelete = false;
      this.focusSoon('#account-open');
    },
    renderAccount() {
      const host = doc.getElementById('account-body');
      if (!host) return;
      host.innerHTML = accountHtml({ nick: this.account.nick, listed: this.account.listed, confirmDelete: this.confirmDelete });
      const on = (id, fn) => {
        const el = host.querySelector(`#${id}`);
        if (el) el.onclick = fn;
      };
      on('account-nick-save', () => this.saveNickname(host.querySelector('#account-nick')?.value ?? ''));
      on('account-listed', () => this.setListing(host.querySelector('#account-listed')?.checked === true));
      on('account-signout', () => this.signOut());
      on('account-delete', () => {
        this.confirmDelete = true;
        this.renderAccount();
        this.focusSoon('#account-delete-no'); // the Delete button is gone; land on the least destructive choice
      });
      on('account-delete-no', () => {
        this.confirmDelete = false;
        this.renderAccount();
        this.focusSoon('#account-delete');
      });
      on('account-delete-yes', () => this.deleteAccount());
    },
    accountSay(tone, text) {
      const el = doc.getElementById('account-feedback');
      if (el) setFeedback(el, tone, escapeHtml(text));
    },
    // A refused account action: a lost session closes the modal; anything else is said in place.
    accountRefused(res) {
      if (res.state === 'signedOut') {
        this.endAccountSession();
        return;
      }
      if (res.state === 'limited') {
        this.accountSay('error', ACCOUNT_LIMITED);
        return;
      }
      const why = res.state === 'taken' ? 'taken' : res.state === 'invalid' ? res.reason : null;
      this.accountSay('error', why === null ? ACCOUNT_UNAVAILABLE : NICK_ERRORS[why] ?? NICK_ERRORS.format);
    },
    endAccountSession() {
      this.account = { state: 'signedOut', nick: '', listed: false };
      this.accountEpoch++;
      this.accountKnown = false;
      this.accountStars = null;
      this.accountRank = null;
      this.accountNotice = '';
      // The opener (#account-open) is hidden once signed out: focus the board button, else Save code.
      if (!this.accountOpen) return;
      this.accountOpen = false;
      this.confirmDelete = false;
      this.focusSoon(this.accountEnabled ? '#board-open' : '#save-open');
    },
    async saveNickname(nick) {
      const trimmed = String(nick).trim();
      if (!NICK_RE.test(trimmed)) return this.accountSay('error', NICK_ERRORS.format); // no request; reserved and blocked names are the server's
      const epoch = this.accountEpoch;
      const res = await accountClient.setNickname(trimmed);
      if (this.staleAnswer(epoch)) return;
      if (res.state !== 'ok') return this.accountRefused(res);
      this.account = { ...this.account, nick: res.nick ?? String(nick).trim() };
      this.accountSay('success', 'Nickname saved.');
    },
    async setListing(listed) {
      const epoch = this.accountEpoch;
      const res = await accountClient.setListing(listed);
      if (this.staleAnswer(epoch)) return;
      if (res.state !== 'ok') {
        const box = doc.getElementById('account-listed');
        if (box) box.checked = this.account.listed === true; // the server did not accept the click
        return this.accountRefused(res);
      }
      this.account = { ...this.account, listed: res.listed ?? listed };
      this.accountSay('success', this.account.listed ? 'You are on the leaderboard.' : 'You are hidden from the leaderboard.');
    },
    async signOut() {
      const epoch = this.accountEpoch;
      const res = await accountClient.signOut();
      if (this.staleAnswer(epoch)) return;
      if (res.state !== 'ok') return this.accountRefused(res);
      this.endAccountSession();
    },
    async deleteAccount() {
      const epoch = this.accountEpoch;
      const res = await accountClient.deleteAccount();
      if (this.staleAnswer(epoch)) return;
      if (res.state !== 'ok') return this.accountRefused(res);
      this.endAccountSession();
    },

    // ---------- derived ----------
    // True when some act is shown as coming soon; the globe legend's "Coming soon" key hides without one.
    hasSoon() {
      return this.acts.some((a) => a.soon);
    },
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

    // ---------- dialogs ----------
    // The one answer to "is a dialog open": the hub goes inert and openLevel / openAbout
    // refuse while it is true.
    dialogOpen() {
      return this.overlayOpen || this.rewardOpen || this.aboutOpen || this.saveOpen || this.boardOpen || this.accountOpen;
    },
    hubInert() {
      return this.dialogOpen();
    },
    // The About dialog: the game summary and one entry per act (live and coming soon), from act data.
    aboutActs() {
      return this.acts.map((a) => ({ id: a.id, title: a.title, sub: a.sub, teaser: a.teaser, soon: a.soon, badges: a.badges }));
    },
    openAbout() {
      if (this.dialogOpen()) return false;
      this.aboutOpen = true;
      this.focusSoon('#about-title');
      return true;
    },
    closeAbout() {
      if (!this.aboutOpen) return;
      this.aboutOpen = false;
      this.focusSoon('#about-open');
    },

    // ---------- save codes (#18) ----------
    // The Save code dialog: lib/save-dialog.mjs draws into #save-body (kit markup, wired with
    // el.onclick). Debug mode refuses to open it, so nothing is exported or imported.
    openSave() {
      if (this.debug || this.dialogOpen()) return false;
      saveDialog ??= createSaveDialog({
        registry,
        host: doc.getElementById('save-body'),
        doc,
        debug: this.debug,
        getProgress: () => this.progress,
        commit: (merged) => this.commitImport(merged),
        copy: (text) => {
          const clip = win?.navigator?.clipboard;
          return clip?.writeText ? clip.writeText(text).then(() => true, () => false) : false;
        },
        close: () => this.closeSave(),
      });
      saveDialog.open();
      this.saveOpen = true;
      this.focusSoon('#save-title');
      return true;
    },
    closeSave() {
      if (!this.saveOpen) return;
      this.saveOpen = false;
      saveDialog?.reset();
      this.focusSoon('#save-open');
    },
    // An import's merged record: saved like a completion (merged with what storage holds), and the
    // hub shows it. A refused save keeps it in memory for this visit, as a completion does.
    commitImport(merged) {
      const saved = saveProgress(storage, merged, registry);
      this.progress = saved.progress;
      this.notice = saved.saved ? null : saved.reason;
      this.refreshGlobe();
      this.syncProgress();
      return saved;
    },

    // ---------- levels ----------
    // A locked card wiggles and names what unlocks it (R's nudge) instead of doing nothing.
    // Refused while a level or the reward is open: the hub is inert then, and a stray
    // Enter must never abort a run. Close the level first (closeOverlay).
    openLevel(id) {
      if (this.dialogOpen()) return false;
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
      this.overlayNo = level.kind === 'boss' ? 'Incident' : level.no ? `Level ${level.no}` : '';
      this.overlayOpen = true;
      // The card is decided before the level runs; stored choices are read at every open, so
      // another tab's Don't show again counts. A failed read shows the card.
      this.howTo = howToView(level);
      const hidden = readHiddenHelp(storage).hidden;
      const auto = this.howTo.topics.some((t) => !hidden.has(t.key) && !seenHelp.has(t.key));
      this.howToOpen = auto;
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
          guide: guideClient && { configured: guideClient.configured, ask: guideClient.ask },
        });
        level.run(ctx);
      } catch (e) {
        report(e);
      }
      this.focusSoon(auto ? '#ov-howto-title' : '#ov-back');
      return true;
    },

    nudge(id) {
      this.nudgeId = id;
      cancel(nudgeTimer);
      nudgeTimer = later(() => {
        this.nudgeId = null;
      }, NUDGE_MS);
    },

    // ---------- How to play modal ----------
    // A kit modal outside .overlay and the level's DOM: a step never wipes it. While it is open the
    // overlay is inert (index.html :inert="howToOpen") and Tab stays inside (trapTab). Focus returns
    // to the header's How to play button when it closes.
    howToExpanded() {
      return this.howToOpen ? 'true' : 'false';
    },
    toggleHowTo() {
      if (!this.overlayOpen || this.howTo.topics.length === 0) return false;
      if (this.howToOpen) this.closeHowTo();
      else {
        this.howToOpen = true;
        this.focusSoon('#ov-howto-title');
      }
      return true;
    },
    // Close: gone until the page reloads, nothing stored.
    closeHowTo() {
      if (!this.overlayOpen || !this.howToOpen) return;
      for (const t of this.howTo.topics) seenHelp.add(t.key);
      this.howToOpen = false;
      this.focusSoon('#ov-howto-open');
    },
    // Don't show again: every widget on the card, stored per widget (not in debug), and always
    // hidden for this visit, whether or not the write went through.
    hideHowTo() {
      if (!this.overlayOpen || !this.howToOpen) return;
      const keys = this.howTo.topics.map((t) => t.key);
      for (const k of keys) seenHelp.add(k);
      if (!this.debug) hideHelp(storage, keys);
      this.howToOpen = false;
      this.focusSoon('#ov-howto-open');
    },

    // Abort the open level (its timers stop, a stale finish is a no-op) and clear its DOM.
    endSession() {
      if (session) session.abort();
      session = null;
      this.howTo = NO_HOW_TO;
      this.howToOpen = false;
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
      this.signinNudgeOpen = false;
      if (!this.debug) {
        if (this.signedIn) this.syncProgress();
        else this.maybeSigninNudge();
      }
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
      nudgeAsked++; // a board reply still on its way must not open the nudge on a later card
      this.signinNudgeOpen = false;
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

    // The page behind an open kit modal must not scroll: a class on <html> (index.html x-effect keeps it
    // in step with the three flags; the rule is in base.css, never an inline style).
    scrollLocked() {
      return this.howToOpen || this.aboutOpen || this.saveOpen || this.boardOpen || this.accountOpen;
    },
    syncScrollLock() {
      doc.documentElement.classList.toggle('modal-open', this.scrollLocked());
    },
    // Tab (and Shift+Tab) wrap inside the open kit modal; the page behind is inert, so without this
    // focus would fall out to the browser's own controls. Not a modal (the level, the reward): untouched.
    openModalSelector() {
      if (this.howToOpen) return '#howto-modal';
      if (this.saveOpen) return '#save-modal';
      if (this.boardOpen) return '#board-modal';
      if (this.accountOpen) return '#account-modal';
      if (this.aboutOpen) return '#about-modal';
      return null;
    },
    trapTab(e) {
      const sel = this.openModalSelector();
      return sel === null ? false : trapTab(e, doc.querySelector(sel), doc);
    },

    // One window-level Escape handler: closes the reward, else the About dialog, else Save code, else the How to play modal, else the level, but never the
    // level while the player is typing in it. A widget that handled the Escape (it called
    // preventDefault, e.g. Build it cancelling a pick) owns it.
    onEscape(e) {
      if (e?.defaultPrevented) return;
      if (this.rewardOpen) {
        this.closeReward();
        return;
      }
      if (this.aboutOpen) {
        this.closeAbout();
        return;
      }
      if (this.saveOpen) {
        this.closeSave();
        return;
      }
      if (this.boardOpen) {
        this.closeBoard();
        return;
      }
      if (this.accountOpen) {
        this.closeAccount();
        return;
      }
      if (!this.overlayOpen) return;
      if (this.howToOpen) {
        this.closeHowTo();
        return;
      }
      if (!isTyping(e?.target)) this.closeOverlay();
    },

    // ---------- focus ----------
    // Put focus back on the card that opened the level (by id, not position).
    returnFocus() {
      const id = this.currentLevelId;
      if (id) this.focusSoon(`[data-level-id="${id}"]`);
    },
    // Focus after Alpine has rendered (its $nextTick when running under Alpine), and only once the
    // target is shown: an x-show effect may not have flushed yet, and focus() on a display:none
    // element does nothing. Retries on the next frame, up to FOCUS_FRAMES, then gives up silently.
    focusSoon(selector) {
      let frames = 0;
      const go = () => {
        const el = doc.querySelector(selector);
        if (!el) return;
        if (rendered(el)) {
          el.focus?.();
        } else if (frames++ < FOCUS_FRAMES) {
          raf(go);
        }
      };
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
