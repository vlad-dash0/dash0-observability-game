// app.mjs and the account (#273 P6a): GET /api/account once per page, sync on sign-in / completion /
// import, the o11y king nudge, the board and account modals' data, `?signin=`. A fake fetch routes by
// "METHOD /path"; storage is the fake that records every setItem. Contract: docs/FOUNDATION.md §2.9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { makeDom } from './helpers/dom.mjs';
import { fakeStorage } from './helpers/fake-storage.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { STORAGE_KEY } from '../lib/storage.mjs';
import { HELP_KEY } from '../lib/help-prefs.mjs';
import { createGame, SIGNIN_NOTICES } from '../app.mjs';
import { takeSignin } from '../lib/signin-param.mjs';
import { nudgeText, starsText, boardHtml, accountHtml, meText } from '../lib/account/board-view.mjs';

const INDEX = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
/** True when `el` and every ancestor's x-show gate is truthy against the game (the markup's own expressions, evaluated). */
function shownIn(game, el) {
  for (let n = el; n && n.getAttribute; n = n.parentElement) {
    const gate = n.getAttribute('x-show');
    if (gate !== null && !new Function('g', `with (g) { return (${gate.replaceAll('&amp;', '&')}); }`)(game)) return false;
  }
  return true;
}
const hubLine = (expr) => parseHTML(INDEX).document.querySelector(`[x-text="${expr}"]`);

const AT = '2026-01-01T00:00:00.000Z';
const L = (id, no) => ({
  id, no, name: `Level ${id}`, icon: '*', rewardTitle: `Title ${id}`, mechanics: ['query'],
  run(ctx) { ctx.renderStep(`<p>${id}</p>`, '<button data-finish>Finish</button>'); },
});
const REG = buildRegistry([{ id: 'a0', no: 0, name: 'First', levels: [L('x', '0.1'), L('y', '0.2'), L('z', '0.3')], boss: null }], { deck: [], nodeIds: [] });
const SHELL = '<!doctype html><html><body><div id="ov-body"></div><div id="ov-actions"></div><div id="board-body"></div><div id="account-body"></div></body></html>';
const WIN = { stars: 2, cards: [], at: AT, text: 'done' };
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const res = (status, body) => ({ status, ok: status < 300, json: async () => body });
const OUT = res(200, { v: 1, configured: true, signedIn: false });
const IN = (extra = {}) => res(200, { v: 1, configured: true, signedIn: true, nick: 'grace', listed: true, ...extra });
const board = (top = [], me = null) => res(200, { v: 1, ok: true, size: top.length, top, me });
const merged = (levels) => res(200, { v: 1, progress: { v: 1, levels, cards: [] }, stars: 4, rank: 3 });

/** routes: "GET /api/account" -> response, or a function(init) -> response, or an Error to throw. */
function setup({ routes = {}, debug, initial, signin, withFetch = true } = {}) {
  const dom = makeDom(SHELL);
  const store = fakeStorage({ initial });
  const calls = [];
  const timers = [];
  const fetch = async (url, init = {}) => {
    if (url === '/api/guide') return res(404, {}); // the guide's own status request is not this feature's
    const key = `${init.method ?? 'GET'} ${url}`;
    calls.push(key);
    const r = routes[key];
    if (r === undefined) throw new TypeError(`unrouted ${key}`);
    const out = typeof r === 'function' ? r(init) : r;
    if (out instanceof Error) throw out;
    return out;
  };
  const game = createGame({
    registry: REG, deck: [], storage: () => store, document: dom.document, now: () => 1, rand: () => 0,
    reduceMotion: () => true, reportError: () => {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 0; }, clearTimeout: () => {},
    globeMap: { ACT_REGIONS: {}, LEVEL_COUNTRY: {}, COUNTRY_NAMES: {}, actOf: () => null }, dots: [],
    debug, signin, fetch: withFetch ? fetch : undefined,
  });
  return { game, store, calls, dom, timers };
}
const initOf = async (g) => { g.init(); await settle(); };
const helpHidden = (store) => JSON.parse(store.data.get(HELP_KEY) ?? '{"hidden":[]}').hidden;

// ---- anonymous play is unchanged -------------------------------------------------------------

test('unconfigured: the setItem sequence after completeLevel equals a game with no fetch; only GET /api/account is requested; no nudge', async () => {
  const off = setup({ withFetch: false });
  await initOf(off.game);
  off.game.completeLevel('x', WIN);
  const on = setup({ routes: { 'GET /api/account': res(200, { v: 1, configured: false }) } });
  await initOf(on.game);
  on.game.completeLevel('x', WIN);
  await settle();
  assert.ok(on.store.sets.length > 0);
  assert.deepEqual(on.store.sets, off.store.sets);
  assert.deepEqual(on.calls, ['GET /api/account']);
  assert.equal(on.game.signinNudgeOpen, false);
  assert.equal(on.game.accountEnabled, false);
  on.game.closeReward();
  on.game.completeLevel('y', WIN);
  await settle();
  assert.deepEqual(on.calls, ['GET /api/account'], 'still only the one request');
});

test('signed out: storage writes equal the no-fetch game; the sync is never called', async () => {
  const off = setup({ withFetch: false });
  off.game.completeLevel('x', WIN);
  const on = setup({ routes: { 'GET /api/account': OUT, 'GET /api/leaderboard': board() } });
  await initOf(on.game);
  on.game.completeLevel('x', WIN);
  await settle();
  assert.deepEqual(on.store.sets, off.store.sets);
  assert.ok(!on.calls.includes('POST /api/progress'));
});

test('a signed-out game never syncs, even when asked', async () => {
  const { game, calls } = setup({ routes: { 'GET /api/account': OUT } });
  await initOf(game);
  await game.syncProgress();
  assert.deepEqual(calls, ['GET /api/account']);
});

test('debug mode: no request at all, no nudge, no account UI', async () => {
  const { game, calls } = setup({ debug: true, routes: {} });
  await initOf(game);
  game.completeLevel('x', WIN);
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(game.signinNudgeOpen, false);
  assert.equal(game.accountEnabled, false);
});

// ---- the nudge -------------------------------------------------------------------------------

const nudgeRoutes = (b = board([{ rank: 1, nick: 'grace', stars: 12 }])) => ({ 'GET /api/account': OUT, 'GET /api/leaderboard': b });

test('the nudge shows after the first win and not the second (once per page session)', async () => {
  const { game, calls } = setup({ routes: nudgeRoutes() });
  await initOf(game);
  game.completeLevel('x', WIN);
  await settle();
  assert.equal(game.signinNudgeOpen, true);
  assert.equal(game.signinNudgeText, 'Save your progress and see if you can beat the o11y king, grace (12 stars)');
  game.closeReward();
  assert.equal(game.signinNudgeOpen, false);
  game.completeLevel('y', WIN);
  await settle();
  assert.equal(game.signinNudgeOpen, false);
  assert.equal(calls.filter((c) => c === 'GET /api/leaderboard').length, 1);
});

test('Not now closes it for the session without storing anything', async () => {
  const { game, store } = setup({ routes: nudgeRoutes() });
  await initOf(game);
  game.completeLevel('x', WIN);
  await settle();
  const before = store.sets.length;
  game.dismissSigninNudge();
  assert.equal(game.signinNudgeOpen, false);
  assert.equal(store.sets.length, before);
});

test("Don't ask again stores signin-nudge under hideHelp and the nudge never shows again, even after a reload", async () => {
  const a = setup({ routes: nudgeRoutes() });
  await initOf(a.game);
  a.game.completeLevel('x', WIN);
  await settle();
  a.game.hideSigninNudge();
  assert.deepEqual(helpHidden(a.store), ['signin-nudge']);
  assert.equal(a.game.signinNudgeOpen, false);
  const b = setup({ routes: nudgeRoutes(), initial: { [HELP_KEY]: a.store.data.get(HELP_KEY) } });
  await initOf(b.game);
  b.game.completeLevel('x', WIN);
  await settle();
  assert.equal(b.game.signinNudgeOpen, false);
  assert.ok(!b.calls.includes('GET /api/leaderboard'));
});

test("Don't ask again holds for the visit when storage refuses the write", async () => {
  const dom = makeDom(SHELL);
  const store = fakeStorage({ throwOn: ['setItem:oncall.help'] });
  const fetch = async (url, init = {}) => ({ 'GET /api/account': OUT, 'GET /api/leaderboard': board() })[`${init.method ?? 'GET'} ${url}`];
  const game = createGame({ registry: REG, deck: [], storage: () => store, document: dom.document, reportError: () => {}, globeMap: { ACT_REGIONS: {}, LEVEL_COUNTRY: {}, COUNTRY_NAMES: {}, actOf: () => null }, dots: [], fetch });
  await initOf(game);
  game.hideSigninNudge();
  game.completeLevel('x', WIN);
  await settle();
  assert.equal(game.signinNudgeOpen, false);
});

test('the nudge copy: the king, an empty board, an unavailable board (never a 0)', () => {
  const ok = (top) => ({ state: 'ok', size: top.length, top, me: null });
  assert.equal(nudgeText(ok([{ rank: 1, nick: 'grace', stars: 12 }])), 'Save your progress and see if you can beat the o11y king, grace (12 stars)');
  assert.match(nudgeText(ok([])), /be the first o11y king/);
  assert.equal(nudgeText({ state: 'unavailable' }), 'Sign in to save your progress');
  assert.doesNotMatch(nudgeText({ state: 'unavailable' }), /0/);
  assert.match(nudgeText(ok([{ rank: 1, nick: 'ada', stars: null }])), /\(no stars yet\)/);
  assert.doesNotMatch(nudgeText(ok([{ rank: 1, nick: 'ada', stars: 0 }])), /\b0\b/);
});

test('the nudge copy reaches the game for an empty and for an unavailable board', async () => {
  const empty = setup({ routes: nudgeRoutes(board([])) });
  await initOf(empty.game);
  empty.game.completeLevel('x', WIN);
  await settle();
  assert.match(empty.game.signinNudgeText, /be the first o11y king/);
  for (const bad of [res(502, {}), res(503, {}), new TypeError('net')]) {
    const t = setup({ routes: nudgeRoutes(bad) });
    await initOf(t.game);
    t.game.completeLevel('x', WIN);
    await settle();
    assert.equal(t.game.signinNudgeText, 'Sign in to save your progress');
    assert.equal(t.game.signinNudgeOpen, true);
  }
});

// ---- sync ------------------------------------------------------------------------------------

test("sync: another device's level ends up in local storage, merged through saveProgress", async () => {
  const { game, store, calls } = setup({
    routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({ y: { stars: 3, at: AT } }) },
    initial: { [STORAGE_KEY]: JSON.stringify({ v: 1, levels: { x: { stars: 1, at: AT } }, cards: [] }) },
  });
  await initOf(game);
  assert.deepEqual(calls, ['GET /api/account', 'POST /api/progress']);
  const saved = JSON.parse(store.data.get(STORAGE_KEY));
  assert.equal(saved.levels.y.stars, 3);
  assert.equal(saved.levels.x.stars, 1, 'local progress is kept');
  assert.equal(game.progress.levels.y.stars, 3);
  assert.equal(game.accountStars, 4);
  assert.equal(game.accountRank, 3);
});

test('sync: the body is exactly {v:1, progress} with this browser\'s progress', async () => {
  let sent;
  const { game } = setup({
    routes: { 'GET /api/account': IN(), 'POST /api/progress': (init) => { sent = JSON.parse(init.body); return merged({}); } },
    initial: { [STORAGE_KEY]: JSON.stringify({ v: 1, levels: { x: { stars: 1, at: AT } }, cards: [] }) },
  });
  await initOf(game);
  assert.deepEqual(Object.keys(sent).sort(), ['progress', 'v']);
  assert.equal(sent.progress.levels.x.stars, 1);
});

test('sync: each completion syncs; a 502 still saves locally and sets accountNotice', async () => {
  const { game, store, calls } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': res(502, { error: 'store-unavailable' }) } });
  await initOf(game);
  game.completeLevel('x', WIN);
  await settle();
  assert.equal(calls.filter((c) => c === 'POST /api/progress').length, 2, 'page load and the completion');
  assert.equal(JSON.parse(store.data.get(STORAGE_KEY)).levels.x.stars, 2, 'saved locally');
  assert.match(game.accountNotice, /Account unavailable; your progress is still saved in this browser/);
  assert.equal(game.signedIn, true, 'a failed sync does not sign the player out');
});

test('sync: a 502 is not treated as ok (no stars, no rank taken from it)', async () => {
  const { game } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': res(502, { v: 1, progress: { v: 1, levels: { y: { stars: 3, at: AT } }, cards: [] }, stars: 9, rank: 1 }) } });
  await initOf(game);
  assert.equal(game.accountStars, null);
  assert.equal(Object.hasOwn(game.progress.levels, 'y'), false);
});

test('sync: a save-code import syncs', async () => {
  const { game, calls } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}) } });
  await initOf(game);
  game.commitImport({ v: 1, levels: { y: { stars: 1, at: AT } }, cards: [] });
  await settle();
  assert.equal(calls.filter((c) => c === 'POST /api/progress').length, 2);
});

test('sync: a signed-in player gets no nudge; a 401 on sync signs them out locally', async () => {
  const a = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}) } });
  await initOf(a.game);
  a.game.completeLevel('x', WIN);
  await settle();
  assert.equal(a.game.signinNudgeOpen, false);
  const b = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': res(401, {}) } });
  await initOf(b.game);
  assert.equal(b.game.account.state, 'signedOut');
});

test('GET /api/account failing shows the notice in the markup and changes nothing else', async () => {
  const { game, calls, store } = setup({ routes: { 'GET /api/account': res(502, {}) } });
  await initOf(game);
  game.completeLevel('x', WIN);
  await settle();
  assert.deepEqual(calls, ['GET /api/account']);
  assert.equal(game.accountNotice, 'Sign-in and the leaderboard are unavailable right now; your progress is still saved in this browser.');
  assert.equal(game.accountEnabled, false);
  const line = hubLine('accountNotice');
  assert.ok(line, 'the hub binds the notice');
  assert.equal(shownIn(game, line), true, 'no hidden ancestor gate: the player can read it');
  assert.equal(shownIn(setup({ routes: {} }).game, line), false, 'and it is hidden when there is nothing to say');
  assert.equal(game.signinNudgeOpen, false);
  assert.ok(store.sets.length > 0);
});

test('a signed-in player whose sync fails sees the notice and no stale or unknown count', async () => {
  let n = 0;
  const { game } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': () => (n++ === 0 ? merged({}) : res(502, {})) } });
  await initOf(game);
  assert.equal(game.accountSummary(), '4 stars, #3');
  game.completeLevel('x', WIN);
  await settle();
  assert.match(game.accountNotice, /Account unavailable/);
  assert.equal(game.accountSummary(), '', 'the last server count is not current while sync fails');
  assert.equal(shownIn(game, hubLine('accountNotice')), true);
});

test('before the first sync answers (in flight) the hub shows no count, not "no stars yet"', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { game } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': async () => { await held; return merged({}); } } });
  game.init();
  await settle();
  assert.equal(game.signedIn, true);
  assert.equal(game.accountSummary(), '');
  release();
  await settle();
  assert.equal(game.accountSummary(), '4 stars, #3');
});

test('a failed first sync shows no count; a successful sync with no server stars says "no stars yet"', async () => {
  const bad = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': res(502, {}) } });
  await initOf(bad.game);
  assert.equal(bad.game.accountSummary(), '');
  const none = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': res(200, { v: 1, progress: { v: 1, levels: {}, cards: [] }, stars: null, rank: null }) } });
  await initOf(none.game);
  assert.equal(none.game.accountSummary(), 'no stars yet');
});

test('a sync answer that arrives after sign-out or delete is dropped: no stars, no rank, nothing written locally', async () => {
  for (const leave of ['signOut', 'deleteAccount']) {
    let release;
    const held = new Promise((r) => { release = r; });
    let first = true;
    const { game, store } = setup({
      routes: {
        'GET /api/account': IN(),
        'POST /api/progress': async () => { if (first) { first = false; await held; } return merged({ y: { stars: 3, at: AT } }); },
        'POST /api/account': res(200, { v: 1, ok: true }),
      },
    });
    game.init();
    await settle();
    await game[leave]();
    assert.equal(game.account.state, 'signedOut', leave);
    release();
    await settle();
    assert.equal(game.accountStars, null, leave);
    assert.equal(game.accountRank, null, leave);
    assert.equal(Object.hasOwn(game.progress.levels, 'y'), false, leave);
    assert.equal(store.sets.length, 0, `${leave}: nothing written to localStorage`);
    assert.equal(game.accountNotice, '', leave);
  }
});

test('a failed sync answer that arrives after sign-out does not put a notice on the signed-out hub', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { game } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': async () => { await held; return res(502, {}); }, 'POST /api/account': res(200, { v: 1, ok: true }) } });
  game.init();
  await settle();
  await game.signOut();
  release();
  await settle();
  assert.equal(game.accountNotice, '');
});

test('the reward card says, quietly, that a failed sync is saved here and will catch up', async () => {
  const line = parseHTML(INDEX).document.querySelector('.reward-card [x-text="accountNotice"], .reward-card [data-sync-note]');
  assert.ok(line, 'the reward card has the sync line');
  assert.ok(line.classList.contains('ui-note'), 'the kit note markup (lib/ui/text.mjs note)');
  assert.match(line.textContent, /saved in this browser/);
  assert.match(line.textContent, /account catches up on your next win or when you reload/);
  assert.equal(line.getAttribute('x-show'), "signedIn && accountNotice !== ''");
  const bad = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': res(502, {}) } });
  await initOf(bad.game);
  assert.equal(shownIn(bad.game, line), true);
  const good = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}) } });
  await initOf(good.game);
  assert.equal(shownIn(good.game, line), false);
});

// ---- ?signin= --------------------------------------------------------------------------------

test('?signin=: new welcomes once the account is known and promises no board place before a star; ok says nothing; the rest map to notices; unknown says nothing', async () => {
  const fresh = setup({ signin: 'new', routes: { 'GET /api/account': IN(), 'POST /api/progress': res(200, { v: 1, progress: { v: 1, levels: {}, cards: [] }, stars: null, rank: null }) } });
  assert.equal(fresh.game.signinNoticeText(), '');
  await initOf(fresh.game);
  assert.equal(fresh.game.signinNoticeText(), "You'll appear on the leaderboard as grace once you earn a star. Change your nickname or hide yourself in Account.");
  const zero = setup({ signin: 'new', routes: { 'GET /api/account': IN(), 'POST /api/progress': res(200, { v: 1, progress: { v: 1, levels: {}, cards: [] }, stars: 0, rank: null }) } });
  await initOf(zero.game);
  assert.match(zero.game.signinNoticeText(), /once you earn a star/, '0 stars is not on the board');
  const starred = setup({ signin: 'new', routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}) } });
  await initOf(starred.game);
  assert.equal(starred.game.signinNoticeText(), "You're on the leaderboard as grace. Change your nickname or hide yourself in Account.");
  const hidden = setup({ signin: 'new', routes: { 'GET /api/account': IN({ listed: false }), 'POST /api/progress': merged({}) } });
  await initOf(hidden.game);
  assert.equal(hidden.game.signinNoticeText(), 'Signed in as grace.');
  const back = setup({ signin: 'ok', routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}) } });
  await initOf(back.game);
  assert.equal(back.game.signinNoticeText(), '', 'a returning player gets no welcome');
  for (const [k, v] of Object.entries(SIGNIN_NOTICES)) assert.equal(setup({ signin: k, routes: {} }).game.signinNoticeText(), v);
  assert.equal(setup({ signin: '<img>', routes: {} }).game.signinNoticeText(), '');
  const g = setup({ signin: 'failed', routes: {} }).game;
  g.dismissSigninNotice();
  assert.equal(g.signinNoticeText(), '');
});

// ---- board and account -----------------------------------------------------------------------

test('the board modal: top 10 and me; unavailable is not an empty board; empty says no one yet', async () => {
  const top = [{ rank: 1, nick: 'grace', stars: 12 }, { rank: 2, nick: 'ada', stars: 7 }];
  const { game, dom } = setup({ routes: { 'GET /api/account': OUT, 'GET /api/leaderboard': board(top, { stars: 3, rank: 5, listed: true }) } });
  await initOf(game);
  await game.openBoard();
  const html = dom.document.getElementById('board-body').innerHTML;
  assert.match(html, /grace/);
  assert.match(html, /12 stars/);
  assert.match(html, /You: 3 stars, #5/);
  assert.equal(game.boardOpen, true);
  assert.equal(game.hubInert(), true);
  game.onEscape({});
  assert.equal(game.boardOpen, false);
  const bad = setup({ routes: { 'GET /api/account': OUT, 'GET /api/leaderboard': res(502, {}) } });
  await initOf(bad.game);
  await bad.game.openBoard();
  const badHtml = bad.dom.document.getElementById('board-body').innerHTML;
  assert.match(badHtml, /Leaderboard unavailable/);
  assert.doesNotMatch(badHtml, /No one on the board yet/);
});

test('board view: empty, not on the board, no stars', () => {
  assert.match(boardHtml({ state: 'ok', size: 0, top: [], me: null }), /No one on the board yet/);
  assert.match(boardHtml({ state: 'ok', size: 1, top: [{ rank: 1, nick: 'a<b', stars: 1 }], me: { stars: null, rank: null, listed: false } }), /You&#39;re not on the board|You're not on the board/);
  assert.match(boardHtml({ state: 'ok', size: 1, top: [{ rank: 1, nick: 'a<b', stars: 1 }], me: null }), /a&lt;b/);
  assert.equal(meText({ stars: null, rank: null, listed: true }), "You're not on the board");
  assert.equal(starsText(null), 'no stars yet');
  assert.equal(starsText(0), 'no stars yet');
  assert.equal(starsText(1), '1 star');
});

test('the account panel: nickname, listing, sign out, a two-step delete', async () => {
  const bodies = [];
  const { game, dom } = setup({
    routes: {
      'GET /api/account': IN(), 'POST /api/progress': merged({}),
      'POST /api/account': (init) => { bodies.push(JSON.parse(init.body)); return res(200, { v: 1, ok: true, nick: 'neo', listed: false }); },
    },
  });
  await initOf(game);
  assert.equal(game.openAccount(), true);
  const q = (s) => dom.document.querySelector(s);
  assert.equal(q('#account-nick').value, 'grace');
  q('#account-nick').value = 'neo';
  q('#account-nick-save').onclick();
  await settle();
  assert.equal(game.account.nick, 'neo');
  q('#account-listed').checked = false;
  q('#account-listed').onclick();
  await settle();
  assert.equal(game.account.listed, false);
  q('#account-delete').onclick();
  assert.equal(game.confirmDelete, true);
  assert.ok(q('#account-delete-yes'));
  q('#account-delete-no').onclick();
  assert.ok(q('#account-delete'), 'cancel returns to the first step');
  q('#account-delete').onclick();
  assert.equal(bodies.some((b) => b.action === 'delete'), false, 'not deleted before the second step');
  q('#account-delete-yes').onclick();
  await settle();
  assert.deepEqual(bodies.map((b) => b.action), ['nickname', 'listing', 'delete']);
  assert.equal(game.account.state, 'signedOut');
  assert.equal(game.accountOpen, false);
});

test('nickname refusals are said in place; sign out ends the session', async () => {
  const answers = [res(409, {}), res(400, { ok: false, field: 'nick', reason: 'blocked' }), res(502, {}), res(200, { v: 1, ok: true })];
  const { game, dom } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}), 'POST /api/account': () => answers.shift() } });
  await initOf(game);
  game.openAccount();
  const say = () => dom.document.querySelector('#account-feedback [data-feedback-text]').innerHTML;
  await game.saveNickname('ada');
  assert.match(say(), /taken/);
  await game.saveNickname('ada');
  assert.match(say(), /not available/);
  await game.saveNickname('ada');
  assert.match(say(), /Account unavailable/);
  assert.equal(game.account.nick, 'grace');
  await game.signOut();
  assert.equal(game.account.state, 'signedOut');
  assert.equal(game.signedIn, false);
});

test('accountHtml carries the privacy copy and no style or on* attributes', () => {
  const html = accountHtml({ nick: 'grace', listed: true });
  assert.match(html, /listed on the leaderboard by default/);
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/);
  assert.match(html, /checked/);
});

// ---- review fixes: serialization, stale nudge, 401, 429, ?signin=, checkbox -------------------

/** A route whose responses are held until released, counting how many are in flight. */
function held() {
  const state = { inFlight: 0, maxInFlight: 0, bodies: [], waiting: [] };
  state.route = (init) => {
    state.bodies.push(JSON.parse(init.body));
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    return new Promise((resolve) => state.waiting.push((r) => { state.inFlight--; resolve(r); }));
  };
  return state;
}

test('sync is serialized: a completion then an import mid-flight makes 2 POSTs, never 2 in flight, and the second carries both levels', async () => {
  const hold = held();
  const { game, store } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': hold.route } });
  game.init();
  await settle();
  hold.waiting.shift()(merged({})); // the page-load sync
  await settle();
  hold.bodies.length = 0;
  hold.maxInFlight = 0;
  game.completeLevel('x', WIN);
  game.commitImport({ v: 1, levels: { y: { stars: 1, at: AT } }, cards: [] });
  await settle();
  assert.equal(hold.bodies.length, 1, 'the second ask waits for the first');
  hold.waiting.shift()(merged({}));
  await settle();
  assert.equal(hold.bodies.length, 2, 'exactly two POSTs');
  assert.equal(hold.maxInFlight, 1);
  assert.deepEqual(Object.keys(hold.bodies[1].progress.levels).sort(), ['x', 'y']);
  hold.waiting.shift()(merged({})); // a reply that lacks y
  await settle();
  assert.equal(JSON.parse(store.data.get(STORAGE_KEY)).levels.y.stars, 1, 'a reply without y never removes it');
  assert.equal(game.progress.levels.y.stars, 1);
});

test('a board reply that arrives after the reward card closed leaves the nudge closed, even on a later card', async () => {
  let release;
  const routes = { 'GET /api/account': OUT, 'GET /api/leaderboard': () => new Promise((r) => { release = r; }) };
  const { game } = setup({ routes });
  await initOf(game);
  game.completeLevel('x', WIN);
  await settle();
  game.closeReward();
  release(board([{ rank: 1, nick: 'grace', stars: 12 }]));
  await settle();
  assert.equal(game.signinNudgeOpen, false);
  const later = setup({ routes });
  await initOf(later.game);
  later.game.completeLevel('x', WIN);
  await settle();
  later.game.closeReward();
  later.game.completeLevel('y', WIN); // a later reward card is open when the old reply lands
  release(board([{ rank: 1, nick: 'grace', stars: 12 }]));
  await settle();
  assert.equal(later.game.rewardOpen, true);
  assert.equal(later.game.signinNudgeOpen, false);
});

test('a 401 during sync ends the account session: stars and rank cleared, the account modal closed', async () => {
  let n = 0;
  const { game } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': () => (++n === 1 ? merged({}) : res(401, {})) } });
  await initOf(game);
  assert.equal(game.accountStars, 4);
  game.openAccount();
  assert.equal(game.accountOpen, true);
  game.completeLevel('x', WIN);
  await settle();
  assert.equal(game.account.state, 'signedOut');
  assert.equal(game.accountStars, null);
  assert.equal(game.accountRank, null);
  assert.equal(game.accountOpen, false);
});

test('a 429 on sync says saving is paused (not unavailable) and retries once after retryAfterS, capped', async () => {
  let n = 0;
  const limited = (s) => res(429, { error: 'rate-limited', retryAfterS: s });
  const { game, timers, calls } = setup({
    routes: { 'GET /api/account': IN(), 'POST /api/progress': () => (++n === 1 ? limited(30) : n === 2 ? limited(30) : merged({})) },
  });
  await initOf(game);
  assert.match(game.accountNotice, /Saving to your account is paused for a moment; your progress is safe in this browser/);
  assert.doesNotMatch(game.accountNotice, /unavailable/);
  const retries = timers.filter((t) => t.ms === 30000);
  assert.equal(retries.length, 1);
  retries[0].fn();
  await settle();
  assert.equal(calls.filter((c) => c === 'POST /api/progress').length, 2, 'one retry');
  assert.equal(timers.filter((t) => t.ms === 30000).length, 1, 'a second 429 during the retry schedules nothing more');
  const capped = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': limited(86400) } });
  await initOf(capped.game);
  assert.equal(capped.timers.some((t) => t.ms === 60000), true);
  assert.equal(capped.timers.some((t) => t.ms > 60000), false);
});

test('a 429 retry that succeeds clears the notice', async () => {
  let n = 0;
  const { game, timers } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': () => (++n === 1 ? res(429, { retryAfterS: 5 }) : merged({})) } });
  await initOf(game);
  timers.find((t) => t.ms === 5000).fn();
  await settle();
  assert.equal(game.accountNotice, '');
});

test('?signin= is ignored in debug mode', () => {
  assert.equal(setup({ debug: true, signin: 'failed' }).game.signinNoticeText(), '');
  assert.equal(setup({ debug: true, signin: 'ok' }).game.signinStatus, null);
});

test('takeSignin reads the value, strips it, and survives a throwing replaceState', () => {
  const seen = [];
  const win = (href, throws = false) => ({
    location: { href },
    history: { state: null, replaceState: (...a) => { if (throws) throw new Error('sandboxed'); seen.push(a); } },
  });
  assert.equal(takeSignin(win('https://x.test/play?signin=ok&mode=debug#top')), 'ok');
  assert.equal(seen[0][2], '/play?mode=debug#top');
  assert.equal(takeSignin(win('https://x.test/?signin=failed', true)), 'failed', 'the value still returns');
  assert.equal(takeSignin(win('https://x.test/')), null);
  assert.equal(seen.length, 1, 'nothing to strip, no replaceState');
});

test('accountHtml: the listing checkbox is checked only when listed', () => {
  assert.doesNotMatch(accountHtml({ nick: 'grace', listed: false }), /checked/);
  assert.match(accountHtml({ nick: 'grace', listed: true }), /checked/);
});

// ---- focus stays in place; a bad nickname format makes no request (#273 P6b review) ---------

const focusLog = (game) => { const f = []; game.focusSoon = (s) => f.push(s); return f; };

test('Not now and Don\'t ask again put focus back on the reward card\'s main button (Next, else Back to the map)', async () => {
  const { game } = setup({ routes: { 'GET /api/account': OUT } });
  await initOf(game);
  const f = focusLog(game);
  game.dismissSigninNudge();
  game.hideSigninNudge();
  assert.deepEqual(f, ['#reward-next', '#reward-next'], 'a level is next in this fixture, so Next is the main button');
});

test('dismissing the sign-in notice focuses Save code, a target that stays visible', async () => {
  const { game } = setup({ routes: { 'GET /api/account': OUT }, signin: 'failed' });
  await initOf(game);
  const f = focusLog(game);
  game.dismissSigninNotice();
  assert.deepEqual(f, ['#save-open']);
});

test('a session that ends in the account modal (sign out, delete, 401) focuses the board button, never the hidden #account-open', async () => {
  for (const act of ['signout', 'delete', '401']) {
    const route = act === '401' ? res(401, {}) : res(200, { v: 1, ok: true });
    const { game } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}), 'POST /api/account': route } });
    await initOf(game);
    game.openAccount();
    const f = focusLog(game);
    if (act === 'signout') await game.signOut(); else if (act === 'delete') await game.deleteAccount(); else await game.saveNickname('ada');
    assert.equal(game.accountOpen, false, act);
    assert.deepEqual(f, ['#board-open'], act);
  }
});

test('Close in the account modal still returns focus to #account-open', async () => {
  const { game } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}) } });
  await initOf(game);
  game.openAccount();
  const f = focusLog(game);
  game.closeAccount();
  assert.deepEqual(f, ['#account-open']);
});

test('a nickname with a bad format is refused in place and makes no POST; a good one still goes to the server', async () => {
  const { game, dom, calls } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}), 'POST /api/account': res(200, { v: 1, ok: true, nick: 'neo' }) } });
  await initOf(game);
  game.openAccount();
  const before = calls.length;
  for (const bad of ['', 'ab', '-abc', 'has space', 'x'.repeat(21)]) await game.saveNickname(bad);
  assert.equal(calls.length, before, 'no request for a bad format');
  assert.match(dom.document.querySelector('#account-feedback [data-feedback-text]').innerHTML, /3 to 20 letters/);
  await game.saveNickname('neo');
  assert.equal(calls.length, before + 1);
  assert.equal(game.account.nick, 'neo');
});

test('the account body has no second "Account" eyebrow (the modal head has it)', () => {
  assert.doesNotMatch(accountHtml({ nick: 'grace', listed: true }), /ui-eyebrow/);
});

// ---- the account modal's refusals and focus (#299) -------------------------------------------

test('a refused listing toggle puts the checkbox back to what the server has', async () => {
  const { game, dom } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}), 'POST /api/account': res(502, {}) } });
  await initOf(game);
  game.openAccount();
  const box = dom.document.querySelector('#account-listed');
  box.checked = false; // what the click did
  box.onclick();
  await settle();
  assert.equal(game.account.listed, true);
  assert.equal(dom.document.querySelector('#account-listed').checked, true, 'reset to account.listed');
  assert.match(dom.document.querySelector('#account-feedback [data-feedback-text]').innerHTML, /Account unavailable/);
});

test('a rate-limited account change says to wait, not "Account unavailable"', async () => {
  const { game, dom } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}), 'POST /api/account': res(429, {}) } });
  await initOf(game);
  game.openAccount();
  await game.saveNickname('neo');
  const said = dom.document.querySelector('#account-feedback [data-feedback-text]').innerHTML;
  assert.match(said, /Wait up to an hour and try again/);
  assert.doesNotMatch(said, /unavailable/i);
  assert.equal(game.account.nick, 'grace');
  assert.equal(game.account.state, 'signedIn');
});

test('Delete account moves focus to Keep my account (the least destructive choice); Keep my account moves it back to Delete', async () => {
  const { game, dom } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}) } });
  await initOf(game);
  game.openAccount();
  const f = focusLog(game);
  dom.document.querySelector('#account-delete').onclick();
  dom.document.querySelector('#account-delete-no').onclick();
  assert.deepEqual(f, ['#account-delete-no', '#account-delete']);
});

// ---- review of #301 ---------------------------------------------------------------------------

test('an anonymous visitor whose GET /api/account fails never sees the reward card sync line', async () => {
  const line = parseHTML(INDEX).document.querySelector('[data-sync-note]');
  const { game } = setup({ routes: { 'GET /api/account': res(502, {}) } });
  await initOf(game);
  game.completeLevel('x', WIN);
  await settle();
  assert.match(game.accountNotice, /Sign-in and the leaderboard are unavailable/);
  assert.doesNotMatch(game.accountNotice, /Account unavailable/);
  assert.equal(shownIn(game, line), false);
});

test('?signin=new with the count unknown (sync in flight or failed) promises nothing about stars', async () => {
  const want = 'Signed in as grace. Change your nickname or hide yourself in Account.';
  const bad = setup({ signin: 'new', routes: { 'GET /api/account': IN(), 'POST /api/progress': res(502, {}) } });
  await initOf(bad.game);
  assert.equal(bad.game.signinNoticeText(), want);
  let release;
  const held = new Promise((r) => { release = r; });
  const slow = setup({ signin: 'new', routes: { 'GET /api/account': IN(), 'POST /api/progress': async () => { await held; return merged({}); } } });
  slow.game.init();
  await settle();
  assert.equal(slow.game.signinNoticeText(), want);
  release();
  await settle();
});

test('a nickname or listing answer that arrives after sign-out or delete changes nothing', async () => {
  for (const [act, run] of [['nickname', (g) => g.saveNickname('neo')], ['listing', (g) => g.setListing(false)]]) {
    for (const leave of ['signOut', 'deleteAccount']) {
      let release;
      const held = new Promise((r) => { release = r; });
      let n = 0;
      const { game, dom } = setup({
        routes: {
          'GET /api/account': IN(), 'POST /api/progress': merged({}),
          'POST /api/account': async () => { if (n++ === 0) await held; return res(200, { v: 1, ok: true, nick: 'neo', listed: true }); },
        },
      });
      await initOf(game);
      game.openAccount();
      const pending = run(game);
      await game[leave]();
      release();
      await pending;
      assert.equal(game.account.state, 'signedOut', `${act} ${leave}`);
      assert.equal(game.account.nick, '', `${act} ${leave}: nick not written`);
      assert.equal(game.account.listed, false, `${act} ${leave}: the held listed: true is not written`);
      assert.doesNotMatch(dom.document.getElementById('account-body').innerHTML, /saved|hidden from/i, `${act} ${leave}`);
    }
  }
});

test('the hub count line is hidden while it has nothing to say', async () => {
  const line = hubLine('accountSummary()');
  const { game } = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': res(502, {}) } });
  await initOf(game);
  assert.equal(game.signedIn, true);
  assert.equal(shownIn(game, line), false);
  const ok = setup({ routes: { 'GET /api/account': IN(), 'POST /api/progress': merged({}) } });
  await initOf(ok.game);
  assert.equal(shownIn(ok.game, line), true);
});

test('a delete answer that fails after Sign out ended the session is dropped, not written into the closed modal', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { game, dom } = setup({
    routes: {
      'GET /api/account': IN(), 'POST /api/progress': merged({}),
      'POST /api/account': async (init) => { if (JSON.parse(init.body).action === 'delete') { await held; return res(502, {}); } return res(200, { v: 1, ok: true }); },
    },
  });
  await initOf(game);
  game.openAccount();
  const pending = game.deleteAccount();
  await game.signOut();
  assert.equal(game.account.state, 'signedOut');
  release();
  await pending;
  await settle();
  assert.doesNotMatch(dom.document.getElementById('account-feedback')?.textContent ?? '', /unavailable/i);
});

test('a sign-out answer that arrives after the session ended is dropped too', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { game, dom } = setup({
    routes: {
      'GET /api/account': IN(), 'POST /api/progress': merged({}),
      'POST /api/account': async (init) => { if (JSON.parse(init.body).action === 'signout') { await held; return res(502, {}); } return res(200, { v: 1, ok: true }); },
    },
  });
  await initOf(game);
  game.openAccount();
  const pending = game.signOut();
  await game.deleteAccount();
  release();
  await pending;
  await settle();
  assert.doesNotMatch(dom.document.getElementById('account-feedback')?.textContent ?? '', /unavailable/i);
});
