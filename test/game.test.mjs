// The hub game object (app.mjs createGame) with fake storage, a fixture registry and a
// fixed clock, plus the shell markup it relies on. Spec: docs/FOUNDATION.md §5 F5 and
// §6 F5 game. No Alpine here: createGame is a plain object and these tests call its
// methods the way the bindings in index.html do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { makeDom } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { fakeStorage } from './helpers/fake-storage.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { STORAGE_KEY } from '../lib/storage.mjs';
import { THEME_KEY } from '../lib/theme.mjs';
import { sideColumn } from '../lib/ui/index.mjs';
import { mountSide } from '../lib/widgets/help-ladder.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { HELP_KEY, hideHelp } from '../lib/help-prefs.mjs';
import { createGame, liveRegistry } from '../app.mjs';
import { endSentence } from '../lib/text.mjs';
import { GAME_SUMMARY, GLOBE_LOOP } from '../hub/about.mjs';
import { litText } from '../lib/globe-ignite.mjs';
import { MAX_STARS } from '../lib/scoring.mjs';
import { createTelemetry } from '../lib/telemetry.mjs';
import { newSpotState } from '../lib/widgets/spot-it.mjs';
import { mountSpot, renderSpot } from '../lib/widgets/spot-it-view.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const NOW = 1767225600000;
const AT = '2026-01-01T00:00:00.000Z';

// Every fixture level stores its ctx here when run, so a test can drive it.
let ctxs = {};
const L = (id, no, extra = {}) => ({
  id,
  no,
  name: `Level ${id}`,
  icon: '*',
  rewardTitle: `Title ${id}`,
  mechanics: ['query'],
  run(ctx) {
    ctxs[id] = ctx;
    ctx.renderStep(`<p id="step-${id}">${id}</p>`, '<button data-finish>Finish</button>');
  },
  ...extra,
});
const CARD = { id: 'c1', front: 'Front of c1.', back: 'Back.', specUrl: 'https://example.com/', dash0Angle: null };
const REG = buildRegistry(
  [
    {
      id: 'a0',
      no: 0,
      name: 'First act',
      levels: [
        L('x', '0.1', { lights: ['checkout', 'payments'], cards: ['c1'] }),
        L('y', '0.2'),
        L('a', '0.3'),
        L('b', '0.4'),
      ],
      boss: null,
    },
    { id: 'a1', no: 1, name: 'Second act', levels: [L('z', '1.1')], boss: null },
  ],
  { deck: [CARD], nodeIds: ['checkout', 'payments'] },
);
const EMPTY = buildRegistry([], { deck: [], nodeIds: [] });
// A tiny globe: act a0 is region Zero (countries XXX, YYY and AAA, which has no level), a1 is One,
// and the coming-soon act s7 is Seven (country SSS; only fixtures that pass S7 use it).
const GLOBE_MAP = {
  ACT_REGIONS: { a0: { region: 'Zero' }, a1: { region: 'One' }, s7: { region: 'Seven' } },
  LEVEL_COUNTRY: { x: 'XXX', y: 'YYY', z: 'ZZZ' },
  COUNTRY_NAMES: { XXX: 'Xland' },
  actOf: (iso) => ({ XXX: 'a0', YYY: 'a0', AAA: 'a0', ZZZ: 'a1', SSS: 's7' })[iso] ?? null,
};
const S7 = { id: 's7', no: 7, name: 'Later', sub: 'Not yet', teaser: 'Soon.' };
const DOTS = [[10, 0, 'XXX', ''], [12, 2, 'XXX', ''], [0, 20, 'YYY', ''], [5, 10, 'AAA', ''], [-30, 120, 'ZZZ', ''], [40, -60, 'QQQ', '']];
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A fake globe renderer: records mounts, updates and disposals; `result` decides what a mount gives. */
function fakeGlobe(result = 'handle') {
  const log = { mounts: [], updates: [], disposed: 0, handles: [], ignites: [] };
  const mount = async (host, view) => {
    log.mounts.push({ host: host.className, dots: view.dots, states: [...view.states], actId: view.target?.actId ?? null, reduced: view.reduced, onFail: view.onFail });
    if (result === 'throw') throw new Error('three.js failed to load');
    if (result === null) return null;
    const handle = {
      update: (states, target) => log.updates.push({ states: [...states], actId: target?.actId ?? null }),
      ignite: (view, states) => log.ignites.push({ view, states: [...states] }),
      dispose: () => log.disposed++,
    };
    log.handles.push(handle);
    return handle;
  };
  return { mount, log };
}

function setup({ initial, throwOn, storage, registry = REG, reduceMotion = true, globe, window, debug, comingSoon = [], dots = DOTS, telemetry, fetch } = {}) {
  const dom = makeDom(read('index.html'));
  const store = fakeStorage({ initial, throwOn });
  const timers = [];
  const errors = [];
  ctxs = {};
  const game = createGame({
    registry,
    deck: [CARD],
    storage: storage ?? (() => store),
    document: dom.document,
    now: () => NOW,
    rand: () => 0,
    reduceMotion: () => reduceMotion,
    reportError: (e) => errors.push(e),
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => {},
    globe,
    globeMap: GLOBE_MAP,
    dots,
    comingSoon,
    window,
    debug,
    telemetry,
    fetch,
  });
  return { game, store, dom, timers, errors };
}
const stored = (store) => JSON.parse(store.data.get(STORAGE_KEY));
const v1 = (levels) => JSON.stringify({ v: 1, levels, cards: [] });

// ---- boot ---------------------------------------------------------------------

test('boot: fresh storage has no notice; corrupt and unavailable say so', () => {
  assert.equal(setup().game.notice, null);
  assert.equal(setup({ initial: { [STORAGE_KEY]: '{bad' } }).game.notice, 'corrupt');
  const throwing = () => {
    throw new Error('blocked');
  };
  assert.equal(setup({ storage: throwing }).game.notice, 'unavailable');
  assert.equal(setup({ initial: { [STORAGE_KEY]: '{"v":99,"levels":{}}' } }).game.notice, 'future');
  assert.equal(setup({ initial: { [STORAGE_KEY]: v1({ y: { stars: 2, at: null } }) } }).game.notice, null);
});

test('boot: stored progress is loaded as the registry view', () => {
  const { game } = setup({ initial: { [STORAGE_KEY]: v1({ y: { stars: 2, at: null }, zz: { stars: 3, at: null } }) } });
  assert.equal(game.progress.levels.y.stars, 2);
  assert.equal(Object.hasOwn(game.progress.levels, 'zz'), false, 'unknown ids stay out of memory');
  assert.equal(game.levelState('y'), 'done');
});

test('every notice has player-facing text', () => {
  for (const status of ['corrupt', 'future', 'unavailable']) {
    const { game } = setup();
    game.notice = status;
    assert.ok(game.noticeText().length > 20, status);
  }
  assert.equal(setup().game.noticeText(), '');
});

// ---- opening levels -------------------------------------------------------------

test('openLevel on a locked level is refused and nudges with the lock reason', () => {
  const { game, timers } = setup();
  assert.equal(game.levelState('z'), 'locked');
  assert.equal(game.openLevel('z'), false);
  assert.equal(game.overlayOpen, false);
  assert.equal(ctxs.z === undefined, true, 'the level never ran');
  assert.equal(game.nudgeId, 'z');
  assert.match(game.levelSub('z'), /First act/);
  assert.equal(timers.length, 1, 'the nudge clears itself');
  timers[0].fn();
  assert.equal(game.nudgeId, null);
  assert.equal(game.levelSub('z'), '');
});

test('openLevel on an unknown id is refused', () => {
  const { game } = setup();
  assert.equal(game.openLevel('nope'), false);
  assert.equal(game.overlayOpen, false);
});

test('openLevel runs the level into the x-ignore overlay elements, fetched by id', () => {
  const { game, dom } = setup();
  assert.equal(game.openLevel('x'), true);
  assert.equal(game.overlayOpen, true);
  assert.equal(game.overlayTitle, 'Level x');
  assert.ok(dom.document.querySelector('[x-ignore] #ov-body #step-x'), 'step rendered in #ov-body');
  assert.ok(dom.document.querySelector('[x-ignore] #ov-actions [data-finish]'));
  assert.equal(ctxs.x.reduceMotion, true);
});

const status = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

test('the guide status is fetched once at init and the level ctx carries it (debug included)', async () => {
  for (const debug of [false, true]) {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push([url, init.method]);
      return status({ v: 1, configured: true })();
    };
    const { game } = setup({ fetch, debug });
    game.init();
    await new Promise((r) => setImmediate(r));
    game.openLevel('x');
    game.closeOverlay();
    game.openLevel('x');
    // The account's one GET (#273) rides along outside debug; debug never asks.
    const expected = debug ? [['/api/guide', 'GET']] : [['/api/guide', 'GET'], ['/api/account', 'GET']];
    assert.deepEqual(calls, expected, 'one status request per page');
    assert.equal(ctxs.x.guide.configured, true);
    assert.equal(typeof ctxs.x.guide.ask, 'function');
  }
});

test('the guide is off when the status fails, says no, is not valid, or there is no fetch', async () => {
  const cases = [
    ['network error', async () => { throw new Error('offline'); }],
    ['http 500', status({ v: 1, configured: true }, false)],
    ['not configured', status({ v: 1, configured: false })],
    ['wrong version', status({ v: 2, configured: true })],
    ['no fetch', undefined],
  ];
  for (const [name, fetch] of cases) {
    const { game } = setup({ fetch });
    game.init();
    await new Promise((r) => setImmediate(r));
    game.openLevel('x');
    assert.ok(ctxs.x.guide === null || ctxs.x.guide.configured === false, name);
  }
});

test('a level that throws in run() is reported and the overlay still closes', () => {
  const boom = L('boom', '0.1', {
    run() {
      throw new Error('level bug');
    },
  });
  const reg = buildRegistry([{ id: 'a0', no: 0, levels: [boom], boss: null }], { deck: [], nodeIds: [] });
  const { game, errors } = setup({ registry: reg });
  game.openLevel('boom');
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /level bug/);
  game.closeOverlay();
  assert.equal(game.overlayOpen, false);
});

test('the ctx reports errors through deps.reportError', () => {
  const { game, errors } = setup();
  game.openLevel('x');
  // A throwing onFinish inside the ctx is routed to reportError; force one via a bad record.
  assert.equal(typeof ctxs.x.finish, 'function');
  game.completeLevel = () => {
    throw new Error('record failed');
  };
  ctxs.x.finish({ text: 'whatever text here' });
  assert.ok(errors.some((e) => /record failed/.test(String(e))), 'reportError received the throw');
});

// ---- closing and finishing --------------------------------------------------------

test('closeOverlay aborts the level signal and clears the level DOM', () => {
  const { game, dom } = setup();
  game.openLevel('x');
  const { signal } = ctxs.x;
  assert.equal(signal.aborted, false);
  game.closeOverlay();
  assert.equal(signal.aborted, true);
  assert.equal(game.overlayOpen, false);
  assert.equal(dom.document.getElementById('ov-body').innerHTML, '');
  assert.equal(dom.document.getElementById('ov-actions').innerHTML, '');
});

test('a stray openLevel while a level is open is refused and the run keeps going', () => {
  const { game } = setup();
  game.openLevel('x');
  assert.equal(game.openLevel('y'), false);
  assert.equal(game.openLevel('x'), false, 'not even the same level restarts');
  assert.equal(ctxs.x.signal.aborted, false);
  assert.equal(ctxs.y === undefined, true);
  assert.equal(game.currentLevelId, 'x');
  game.closeOverlay();
  assert.equal(game.openLevel('y'), true, 'once closed, another level opens');
});

test('openLevel while the reward card is open is refused', () => {
  const { game } = setup();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  assert.equal(game.rewardOpen, true);
  assert.equal(game.openLevel('y'), false);
  assert.equal(ctxs.y === undefined, true);
  game.closeReward();
  assert.equal(game.openLevel('y'), true);
});

test('Escape closes the reward, or the level unless the player is typing', () => {
  const { game, dom } = setup();
  game.openLevel('x');
  const body = dom.document.getElementById('ov-body');
  body.innerHTML =
    '<input id="in"><input id="em" type="Email"><textarea id="ta"></textarea><select id="se"></select>' +
    '<p id="ce" contenteditable="true"><b id="ceb">x</b></p>' +
    '<input id="ra" type="radio"><input id="cb" type="CHECKBOX"><input id="bt" type="button">' +
    '<p id="nce" contenteditable="false"></p>';
  for (const id of ['in', 'em', 'ta', 'se', 'ce', 'ceb']) {
    game.onEscape({ target: dom.document.getElementById(id) });
    assert.equal(game.overlayOpen, true, `Escape in #${id} keeps the level open`);
  }
  assert.equal(ctxs.x.signal.aborted, false);
  game.onEscape({ target: dom.document.body });
  assert.equal(game.overlayOpen, false);
  // Focus on a control that takes no text: Escape still closes the level.
  for (const id of ['ra', 'cb', 'bt', 'nce']) {
    game.openLevel('x');
    ctxs.x.renderStep(
      '<input id="ra" type="radio"><input id="cb" type="CHECKBOX"><input id="bt" type="button">' +
        '<p id="nce" contenteditable="false"></p>',
    );
    game.onEscape({ target: dom.document.getElementById(id) });
    assert.equal(game.overlayOpen, false, `Escape on #${id} closes the level`);
  }
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  game.onEscape({ target: dom.document.body });
  assert.equal(game.rewardOpen, false);
  game.onEscape({ target: null }); // nothing open: a no-op
});

test('an Escape a widget already handled leaves the level open; an unhandled one closes it', () => {
  const { game, dom } = setup();
  game.openLevel('x');
  ctxs.x.renderStep('<div id="wd" tabindex="0"></div><button id="pl">plain</button>');
  // A widget (Build it's pick, say) owns its Escape and marks it handled.
  dom.document.getElementById('wd').addEventListener('keydown', (ev) => ev.preventDefault());
  const press = (id) => {
    const ev = new dom.window.Event('keydown', { bubbles: true, cancelable: true });
    ev.key = 'Escape';
    dom.document.getElementById(id).dispatchEvent(ev);
    return ev;
  };
  const handled = press('wd');
  assert.equal(handled.defaultPrevented, true, 'the widget handled it');
  game.onEscape(handled);
  assert.equal(game.overlayOpen, true, 'a handled Escape keeps the level open');
  assert.equal(ctxs.x.signal.aborted, false);
  const unhandled = press('pl');
  assert.equal(unhandled.defaultPrevented, false);
  game.onEscape(unhandled);
  assert.equal(game.overlayOpen, false, 'an unhandled Escape still closes the level');
});

test('Escape on a shown hint keeps the level open: the hint handles it, the app then leaves it alone (#178)', () => {
  const { game, dom } = setup();
  game.openLevel('x');
  ctxs.x.renderStep(sideColumn({ id: 'h1', titleHtml: 'T', counts: [{ key: 'wrong', label: '' }], hints: true, ruleHtml: 'r' }));
  const body = dom.document.getElementById('ov-body');
  const side = mountSide({ ovBody: body, escapeHtml, reduceMotion: true }, body, 'h1');
  side.showHint('<p>Look at the root.</p>');
  const ev = new dom.window.Event('keydown', { bubbles: true, cancelable: true });
  ev.key = 'Escape';
  dom.document.getElementById('h1-hint-text').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  game.onEscape(ev);
  assert.equal(game.overlayOpen, true, 'the level stays open');
  assert.equal(ctxs.x.signal.aborted, false);
});

test('focus returns to the level card after closing the level and after the reward of a replay', () => {
  // y is already done, so its reward is a replay: a first completion focuses the map heading (#161).
  const { game, dom } = setup({ initial: { [STORAGE_KEY]: v1({ y: { stars: 1, at: null } }) } });
  const focused = [];
  for (const id of ['x', 'y']) {
    const card = dom.document.createElement('div');
    card.setAttribute('data-level-id', id);
    card.focus = () => focused.push(id);
    dom.document.body.appendChild(card);
  }
  game.openLevel('x');
  game.closeOverlay();
  assert.equal(focused.at(-1), 'x');
  game.openLevel('y');
  ctxs.y.finish({ text: 'y is finished now' });
  focused.length = 0;
  game.closeReward();
  assert.deepEqual(focused, ['y']);
});

test('G1 Continue reads the progress when clicked and opens what nextUp names', () => {
  const { game, store } = setup();
  assert.equal(game.continueLabel(), 'Start: 0.1 Level x');
  store.data.set(STORAGE_KEY, v1({ x: { stars: 3, at: null } }));
  game.progress = { ...game.progress, levels: { x: { stars: 3, at: null } } };
  assert.equal(game.continueLabel(), 'Continue: 0.2 Level y');
  assert.equal(game.continueNext(), true);
  assert.equal(game.overlayOpen, true);
  assert.equal(game.currentLevelId, 'y');
});

test('G2 Continue is refused behind a dialog and is absent in debug, when all is done, and with no levels', () => {
  const { game } = setup();
  game.openLevel('x');
  assert.equal(game.continueNext(), false, 'a stray click behind a dialog opens nothing');
  assert.equal(game.currentLevelId, 'x');
  const dbg = setup({ debug: true }).game;
  assert.equal(dbg.continueLabel(), '');
  assert.equal(dbg.continueNext(), false);
  const all = setup({ initial: { [STORAGE_KEY]: v1(Object.fromEntries(['x', 'y', 'a', 'b', 'z'].map((id) => [id, { stars: 3, at: null }]))) } }).game;
  assert.equal(all.continueLabel(), '');
  assert.equal(all.continueNext(), false);
  const none = setup({ registry: EMPTY }).game;
  assert.equal(none.continueLabel(), '');
  assert.equal(none.continueNext(), false);
});

test('G3 focus returns to Continue when it opened the level and is still shown, else to the card', () => {
  const { game } = setup();
  const focused = [];
  game.focusSoon = (selector) => focused.push(selector);
  game.continueNext();
  focused.length = 0; // opening a level focuses inside it
  game.closeOverlay();
  assert.deepEqual(focused, ['#hub-continue']);
  assert.equal(game.returnTarget(), '#hub-continue');
  game.openLevel('y');
  game.closeOverlay();
  assert.equal(focused.at(-1), '[data-level-id="y"]', 'a card click returns to its card');
  game.continueNext();
  game.progress = { ...game.progress, levels: Object.fromEntries(['x', 'y', 'a', 'b', 'z'].map((id) => [id, { stars: 3, at: null }])) };
  game.closeOverlay();
  assert.equal(focused.at(-1), '#act-toggle-a0', 'Continue is gone once all is done and a0 is saved and folded: its toggle is the target');
  game.toggleAct('a0');
  assert.equal(game.returnTarget(), '[data-level-id="x"]', 'unfolded, the card is the target');
  // Continue beats the fold: fold the act the player is in, open its level from Continue, close it.
  const cur = setup().game;
  const f2 = [];
  cur.focusSoon = (selector) => f2.push(selector);
  cur.toggleAct('a0');
  assert.equal(cur.actExpanded('a0'), false);
  cur.continueNext();
  f2.length = 0;
  cur.closeOverlay();
  assert.deepEqual(f2, ['#hub-continue'], 'Continue is still shown, so it wins over the folded act toggle');
});

test('G5 acts fold by progress, a toggle overrides and stores nothing, it survives progress, debug unfolds', () => {
  const done = Object.fromEntries(['x', 'y', 'a', 'b'].map((id) => [id, { stars: 3, at: null }]));
  const { game, store } = setup({ initial: { [STORAGE_KEY]: v1(done) }, comingSoon: [S7] });
  const before = JSON.stringify([...store.data]);
  assert.equal(game.actExpanded('a0'), false, 'a saved act folds');
  assert.equal(game.actExpanded('a1'), true, 'the next act is open');
  assert.equal(game.actExpanded('s7'), true, 'a coming-soon act is unfolded by default');
  assert.equal(game.actExpandedAttr('a0'), 'false');
  assert.equal(game.actExpandedAttr('a1'), 'true');
  assert.equal(game.actLine(game.acts.find((a) => a.id === 'a0')), 'Act 0: First act, saved, 4 of 4');
  assert.equal(game.actLine(game.acts.find((a) => a.id === 'a1')), 'Act 1: Second act, 0 of 1');
  assert.equal(game.actLine(game.acts.find((a) => a.id === 's7')), 'Act 7: Later, coming soon');
  assert.equal(game.toggleAct('a0'), true);
  assert.equal(game.actExpanded('a0'), true);
  assert.equal(game.toggleAct('s7'), false);
  assert.equal(game.actExpanded('s7'), false);
  game.progress = { ...game.progress, levels: { ...done, z: { stars: 3, at: null } } };
  assert.equal(game.actExpanded('a0'), true, 'the choice survives a progress change');
  assert.equal(game.actExpanded('a1'), false, 'untouched acts follow the progress');
  assert.equal(game.toggleAct('nope'), false);
  assert.equal(game.actExpanded('nope'), false);
  assert.equal(JSON.stringify([...store.data]), before, 'nothing is stored');
  const dbg = setup({ initial: { [STORAGE_KEY]: v1(done) }, debug: true }).game;
  assert.equal(dbg.actExpanded('a0'), true);
  assert.equal(dbg.actExpanded('a1'), true);
});

test('M3 each act heading is a disclosure button wired to its body', () => {
  const toggle = deepQuery(shell, 'h3.act-title > button.act-toggle');
  assert.ok(toggle, 'h3.act-title > button.act-toggle');
  assert.equal(toggle.getAttribute('type'), 'button');
  assert.equal(toggle.getAttribute(':id'), "'act-toggle-' + act.id");
  assert.equal(toggle.getAttribute(':aria-expanded'), 'actExpandedAttr(act.id)');
  assert.equal(toggle.getAttribute(':aria-controls'), "'act-body-' + act.id");
  assert.equal(toggle.getAttribute('@click'), 'toggleAct(act.id)');
  const body = deepQuery(shell, 'div.act-body');
  assert.ok(body, 'div.act-body');
  assert.equal(body.getAttribute(':id'), "'act-body-' + act.id");
  assert.equal(body.getAttribute('x-show'), 'actExpanded(act.id)');
  for (const sel of ['.act-sub', '.act-badges', '.act-soon', '.level-list']) assert.ok(body.querySelector(sel), `${sel} is inside the body`);
  assert.equal(toggle.children.length, 0, 'the toggle holds only its text');
});

test('completion: stored with its stars, done, its country lit, totals and reward updated', () => {
  const { game, store } = setup();
  assert.deepEqual(game.stars, { earned: 0, max: 25 });
  game.openLevel('x');
  ctxs.x.mistake();
  const result = ctxs.x.finish({ text: 'You lit up checkout.', cards: ['c1'] });
  assert.equal(result.stars, 4);
  assert.deepEqual(stored(store).levels.x, { stars: 4, at: AT });
  assert.deepEqual(stored(store).cards, ['c1']);
  assert.equal(game.levelState('x'), 'done');
  const map = game.mapState();
  assert.equal(map.countries.XXX.lit, true);
  assert.equal(map.countries.YYY.lit, false);
  assert.equal(map.regions.a0.done, 1);
  assert.deepEqual(game.stars, { earned: 4, max: 25 });
  assert.deepEqual(game.cards, { earned: 1, max: 1 });
  assert.equal(game.overlayOpen, false);
  assert.equal(ctxs.x.signal.aborted, true, 'finishing ends the session');
  assert.equal(game.rewardOpen, true);
  assert.equal(game.rewardTitle, 'Title x');
  assert.equal(game.rewardText, 'You lit up checkout.');
  assert.equal(game.rewardStars, 4);
  assert.equal(game.rewardStarsText(), '★★★★☆');
  assert.equal(game.rewardStarsLabel(), '4 of 5 stars');
  assert.deepEqual(game.rewardCards, ['Front of c1.']);
  game.closeReward();
  assert.equal(game.rewardOpen, false);
});

test('a save the browser refuses keeps the completion in memory and says why', () => {
  const { game } = setup({ throwOn: ['setItem'] });
  game.openLevel('x');
  ctxs.x.finish({ text: 'done in memory only' });
  assert.equal(game.levelState('x'), 'done');
  assert.equal(game.notice, 'unavailable');
});

test('stale finish: a closed level never credits itself or the level open now', () => {
  const { game, store } = setup();
  game.openLevel('a');
  const a = ctxs.a;
  game.closeOverlay();
  game.openLevel('b');
  assert.equal(a.finish({ text: 'stale finish text' }), null);
  assert.equal(game.levelState('a'), 'open');
  assert.equal(game.levelState('b'), 'open');
  assert.equal(game.rewardOpen, false);
  assert.equal(game.overlayOpen, true, 'b is still being played');
  assert.equal(store.data.has(STORAGE_KEY), false, 'storage unchanged');
  assert.equal(store.sets.length, 0);
});

test('completeLevel credits the id the ctx captured, not the level open now', () => {
  const { game } = setup();
  game.openLevel('b');
  game.completeLevel('a', { stars: 3, cards: [], text: 'from a', at: AT });
  assert.equal(game.levelState('a'), 'done');
  assert.equal(game.levelState('b'), 'open');
});

// ---- telemetry (#195) --------------------------------------------------------------

const TEL_HOST = 'ingress.eu-west-1.aws.dash0.com';
const TEL_TOKEN = 'auth_Tk9secretValue42xyz';
// A real telemetry session on a fake fetch; `answer` decides each response.
function telemetrySession(answer = () => 200) {
  const calls = [];
  let k = 0;
  const telemetry = createTelemetry({
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const status = answer(calls.length);
      return { status, text: async () => '' };
    },
    randomBytes: (n) => Uint8Array.from({ length: n }, () => (k++ * 37 + 11) & 0xff),
    now: () => NOW,
    setTimeout: () => 1,
    clearTimeout: () => {},
    hosts: [TEL_HOST],
  });
  telemetry.connect({ mode: 'live', endpoint: `https://${TEL_HOST}`, token: TEL_TOKEN, dataset: '' });
  return { telemetry, calls };
}
const spansOf = (body) => body.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
const attrsOf = (span) => Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));

test('completing a level while connected sends one level.complete span with the result\'s stars', async () => {
  const { telemetry, calls } = telemetrySession();
  assert.equal((await telemetry.sendTest()).kind, 'accepted');
  assert.equal(calls.length, 1, 'the test span');
  // Stored best 4, this run 3, MAX_STARS 5: three distinct values, so only the result's stars pass.
  const { game, store } = setup({ telemetry, initial: { [STORAGE_KEY]: v1({ x: { stars: 4, at: AT } }) } });
  assert.notEqual(3, MAX_STARS);
  game.openLevel('x');
  assert.equal(ctxs.x.telemetry, telemetry, 'the level gets the same facade');
  ctxs.x.mistake();
  ctxs.x.mistake();
  const result = ctxs.x.finish({ text: 'done', cards: ['c1'] });
  assert.equal(result.stars, 3);
  assert.equal(stored(store).levels.x.stars, 4, 'the stored best is not the run');
  await tick();
  assert.equal(calls.length, 2, 'one flush request');
  assert.equal(calls[1].url, `https://${TEL_HOST}/v1/traces`);
  const spans = spansOf(calls[1].body);
  assert.deepEqual(spans.map((s) => s.name), ['level.complete']);
  const attrs = attrsOf(spans[0]);
  assert.deepEqual(attrs['game.level.stars'], { intValue: '3' });
  assert.deepEqual(attrs['game.level.id'], { stringValue: 'x' });
  assert.deepEqual(attrs['game.act.id'], { stringValue: 'a0' });
  assert.deepEqual(attrs['game.cards.count'], { intValue: '1' });
  assert.deepEqual(attrs['game.debug'], { boolValue: false });
  assert.deepEqual(attrs['session.id'], { stringValue: telemetry.sessionId });
  assert.equal(JSON.stringify(calls[1].body).includes(TEL_TOKEN), false);
});

test('a debug completion while connected still sends its span, marked game.debug, and saves nothing', async () => {
  const { telemetry, calls } = telemetrySession();
  assert.equal((await telemetry.sendTest()).kind, 'accepted');
  const initial = { [STORAGE_KEY]: v1({ x: { stars: 4, at: AT } }) };
  const { game, store } = setup({ telemetry, debug: true, initial });
  const before = JSON.stringify(stored(store));
  game.openLevel('x');
  ctxs.x.mistake();
  ctxs.x.mistake();
  const result = ctxs.x.finish({ text: 'done' });
  assert.equal(result.stars, 3);
  await tick();
  assert.equal(calls.length, 2, 'one flush request');
  const attrs = attrsOf(spansOf(calls[1].body)[0]);
  assert.deepEqual(attrs['game.debug'], { boolValue: true });
  assert.deepEqual(attrs['game.level.stars'], { intValue: '3' });
  assert.equal(JSON.stringify(stored(store)), before, 'a debug run saves nothing');
});

test('not connected: completion makes no request', async () => {
  const { telemetry, calls } = telemetrySession(() => 401);
  assert.equal((await telemetry.sendTest()).kind, 'rejected');
  assert.equal(telemetry.status().state, 'configured');
  const { game, errors } = setup({ telemetry });
  game.openLevel('x');
  ctxs.x.finish({ text: 'done' });
  await tick();
  assert.equal(calls.length, 1, 'only the test span ever went out');
  assert.equal(game.rewardOpen, true);
  assert.deepEqual(errors, []);
});

test('a throwing telemetry never breaks completion: progress saved, reward open, error reported', async () => {
  const emitError = new Error('emit broke');
  const flushError = new Error('flush broke');
  const throwing = { emit: () => { throw emitError; }, flush: () => Promise.resolve() };
  {
    const { game, store, errors } = setup({ telemetry: throwing });
    game.openLevel('x');
    assert.doesNotThrow(() => game.completeLevel('x', { stars: 3, cards: ['c1'], text: 'saved', at: AT }));
    assert.deepEqual(stored(store).levels.x, { stars: 3, at: AT });
    assert.equal(game.levelState('x'), 'done');
    assert.equal(game.rewardOpen, true);
    assert.equal(game.rewardStars, 3);
    assert.deepEqual(errors, [emitError]);
  }
  {
    const rejecting = { emit: () => {}, flush: () => Promise.reject(flushError) };
    const { game, store, errors } = setup({ telemetry: rejecting });
    game.openLevel('x');
    const result = ctxs.x.finish({ text: 'saved' });
    assert.equal(result.stars, 5);
    assert.equal(stored(store).levels.x.stars, 5);
    assert.equal(game.rewardOpen, true);
    await tick();
    assert.deepEqual(errors, [flushError], 'a rejected flush is reported, never unhandled');
  }
});

// ---- other tabs ------------------------------------------------------------------

test('a storage event merges another tab\'s progress into memory', () => {
  const { game, store } = setup();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x finished here' });
  // Another tab writes a record that lacks x (e.g. it never saw this tab's write).
  store.data.set(STORAGE_KEY, v1({ y: { stars: 3, at: AT } }));
  game.onStorage({ key: STORAGE_KEY });
  assert.equal(game.progress.levels.y.stars, 3);
  assert.equal(game.progress.levels.x.stars, 5, 'memory keeps its own completions');
  store.data.set(STORAGE_KEY, v1({ y: { stars: 1, at: AT } }));
  game.onStorage({ key: STORAGE_KEY });
  assert.equal(game.progress.levels.y.stars, 3, 'never downgrades');
});

test('a storage event carrying a newer version sets the future notice', () => {
  const { game, store } = setup();
  assert.equal(game.notice, null);
  store.data.set(STORAGE_KEY, JSON.stringify({ v: 99, levels: { y: { stars: 3, at: AT } }, cards: [] }));
  game.onStorage({ key: STORAGE_KEY });
  assert.equal(game.notice, 'future');
});

test('a successful save clears the corrupt and unavailable notices', () => {
  const corrupt = setup({ initial: { [STORAGE_KEY]: '{bad' } });
  assert.equal(corrupt.game.notice, 'corrupt');
  corrupt.game.openLevel('x');
  ctxs.x.finish({ text: 'saved over the corrupt value' });
  assert.equal(corrupt.store.data.get('oncall.progress.corrupt'), '{bad', 'backup exists');
  assert.equal(corrupt.game.notice, null);

  const store = fakeStorage();
  let blocked = true;
  const flaky = setup({
    storage: () => {
      if (blocked) throw new Error('blocked');
      return store;
    },
  });
  assert.equal(flaky.game.notice, 'unavailable');
  blocked = false;
  flaky.game.openLevel('x');
  ctxs.x.finish({ text: 'storage came back' });
  assert.equal(flaky.game.notice, null);
  assert.equal(stored(store).levels.x.stars, 5);
});

test('storage events for other keys are ignored; a corrupt write changes nothing', () => {
  const { game, store } = setup();
  store.data.set(STORAGE_KEY, v1({ y: { stars: 3, at: AT } }));
  game.onStorage({ key: THEME_KEY });
  assert.equal(Object.hasOwn(game.progress.levels, 'y'), false);
  store.data.set(STORAGE_KEY, '{bad');
  game.onStorage({ key: STORAGE_KEY });
  assert.deepEqual(Object.keys(game.progress.levels), []);
});

test('init listens for storage events on the injected window', () => {
  const dom = makeDom(read('index.html'));
  const store = fakeStorage();
  const listeners = {};
  const game = createGame({
    registry: REG,
    storage: () => store,
    document: dom.document,
    window: { addEventListener: (type, fn) => (listeners[type] = fn) },
  });
  game.init();
  store.data.set(STORAGE_KEY, v1({ y: { stars: 3, at: AT } }));
  listeners.storage({ key: STORAGE_KEY });
  assert.equal(game.progress.levels.y.stars, 3);
});

// ---- view helpers ------------------------------------------------------------------

test('acts list every level and boss in order; the empty registry says levels are coming', () => {
  const { game } = setup();
  assert.deepEqual(game.acts.map((a) => a.ids), [['x', 'y', 'a', 'b'], ['z']]);
  assert.equal(game.hasLevels, true);
  const empty = setup({ registry: EMPTY }).game;
  assert.deepEqual(empty.acts, []);
  assert.equal(empty.hasLevels, false);
  assert.deepEqual(empty.stars, { earned: 0, max: 0 });
  assert.equal(empty.mapLabel(), 'World map: 0 of 0 levels done.', 'the globe still has a name');
  assert.deepEqual(empty.globeLines(), []);
});

test('level labels and classes cover every state and exactly one card is next up', () => {
  const { game } = setup({ initial: { [STORAGE_KEY]: v1({ y: { stars: 2, at: null } }) } });
  assert.match(game.levelLabel('x'), /^0\.1: Level x\. .*ready to play, next up$/);
  assert.match(game.levelLabel('a'), /ready to play$/);
  assert.match(game.levelLabel('y'), /done, play again$/);
  assert.match(game.levelLabel('z'), /locked$/);
  assert.equal(game.levelClasses('x'), 'open next');
  assert.equal(game.levelClasses('a'), 'open');
  assert.equal(game.levelClasses('y'), 'done');
  assert.equal(game.levelClasses('z'), 'locked');
  assert.deepEqual(['x', 'y', 'a', 'b', 'z'].filter((id) => game.isNextUp(id)), ['x']);
  game.openLevel('z');
  assert.equal(game.levelClasses('z'), 'locked nudge');
  assert.equal(game.starText('y'), '★★☆☆☆', 'a saved 2 shows two filled of five');
  assert.equal(game.starSummary(), '2 of 25 stars');
  const debug = setup({ debug: true }).game;
  assert.deepEqual(['x', 'y', 'a', 'b', 'z'].filter((id) => debug.isNextUp(id)), [], 'debug has no next up');
  assert.equal(debug.levelClasses('x'), 'open');
});

test('endSentence adds a full stop only when the text does not already end a sentence', () => {
  assert.equal(endSentence('a'), 'a.');
  assert.equal(endSentence('a?'), 'a?');
  assert.equal(endSentence('a!'), 'a!');
  assert.equal(endSentence('a.'), 'a.');
  assert.equal(endSentence('a? b'), 'a? b.', 'only the last character counts');
});

test('a name or sub ending in "?" gets no extra full stop: the level label and the lit announcement', () => {
  const ASK = buildRegistry([{ id: 'a0', no: 0, name: 'First act', levels: [L('q', '0.1', { name: 'Why not?', sub: 'Does it hold?' }), L('p', '0.2', { sub: 'Plain sub' })], boss: null }], { deck: [CARD], nodeIds: [] });
  const { game } = setup({ registry: ASK });
  assert.equal(game.levelLabel('q').startsWith('0.1: Why not? Does it hold? '), true, game.levelLabel('q'));
  assert.equal(game.levelLabel('p').startsWith('0.2: Level p. Plain sub. '), true, game.levelLabel('p'));
  for (const id of ['q', 'p']) assert.equal(game.levelLabel(id).includes('?.'), false, id);
  const live = setup({ registry: liveRegistry() }).game;
  const label92 = live.levelLabel('the-34-percent-error-rate');
  assert.equal(label92.startsWith('9.2: The 34% error rate. Does that answer hold? '), true, label92);
  assert.equal(label92.includes('?.'), false, label92);
  const map = { ACT_REGIONS: { a0: { region: 'Zero' } }, LEVEL_COUNTRY: {}, COUNTRY_NAMES: { CCC: 'C' } };
  assert.equal(litText({ countryIds: ['CCC'], regionIds: [] }, { name: 'X?' }, map), 'C is now lit: X?');
  assert.equal(litText({ countryIds: ['CCC'], regionIds: ['a0'] }, { name: 'X?' }, map), 'C is now lit: X? Zero is complete.');
  assert.equal(litText({ countryIds: [], regionIds: ['a0'] }, { name: 'X?' }, map), 'Zero is now lit: X?', 'a boss names its region');
  assert.equal(litText({ countryIds: ['CCC'], regionIds: [] }, { name: 'X' }, map), 'C is now lit: X.');
});

test('the globe text alternative counts levels done and names the lit regions', () => {
  const { game } = setup();
  assert.equal(game.mapLabel(), 'World map: 0 of 5 levels done.');
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  assert.equal(game.mapLabel(), 'World map: 1 of 5 levels done. Lit: Zero 1 of 4.');
  assert.deepEqual(game.globeLines(), ['Act 0, First act (Zero): 1 of 4 done', 'Act 1, Second act (One): 0 of 1 done']);
});

test('acts list registry and soon acts in act order; a soon act has no level ids', () => {
  const REG9 = buildRegistry(
    [
      { id: 'a0', no: 0, name: 'First act', sub: 'Begin', teaser: 'Learn x.', badges: ['dash0'], levels: [L('x', '0.1')], boss: null },
      { id: 'a9', no: 9, name: 'Last act', badges: ['customer-calls'], levels: [L('n', '9.1')], boss: null },
    ],
    { deck: [], nodeIds: [] },
  );
  assert.deepEqual(setup({ registry: REG9, comingSoon: [S7] }).game.acts, [
    { id: 'a0', no: 0, name: 'First act', title: 'Act 0: First act', sub: 'Begin', ids: ['x'], soon: false, teaser: 'Learn x.', badges: [{ id: 'dash0', label: 'Dash0', tone: 'hint' }] },
    { id: 's7', no: 7, name: 'Later', title: 'Act 7: Later', sub: 'Not yet', ids: [], soon: true, teaser: 'Soon.', badges: [] },
    { id: 'a9', no: 9, name: 'Last act', title: 'Act 9: Last act', sub: '', ids: ['n'], soon: false, teaser: '', badges: [{ id: 'customer-calls', label: 'From customer calls', tone: 'attention' }] },
  ]);
});

test('aboutActs: every act in act order, live and coming soon, the same titles the hub shows', () => {
  const REG9 = buildRegistry(
    [
      { id: 'a0', no: 0, name: 'First act', sub: 'Begin', teaser: 'Learn x.', badges: ['dash0'], levels: [L('x', '0.1')], boss: null },
      { id: 'a9', no: 9, name: 'Last act', badges: ['customer-calls'], levels: [L('n', '9.1')], boss: null },
    ],
    { deck: [], nodeIds: [] },
  );
  const { game } = setup({ registry: REG9, comingSoon: [S7] });
  assert.deepEqual(game.aboutActs(), [
    { id: 'a0', title: 'Act 0: First act', sub: 'Begin', teaser: 'Learn x.', soon: false, badges: [{ id: 'dash0', label: 'Dash0', tone: 'hint' }] },
    { id: 's7', title: 'Act 7: Later', sub: 'Not yet', teaser: 'Soon.', soon: true, badges: [] },
    { id: 'a9', title: 'Act 9: Last act', sub: '', teaser: '', soon: false, badges: [{ id: 'customer-calls', label: 'From customer calls', tone: 'attention' }] },
  ]);
  assert.deepEqual(game.aboutActs().map((a) => a.title), game.acts.map((a) => a.title));
});

test('the About dialog: opens on the heading, Close returns focus to ?', () => {
  const { game } = setup();
  const focused = [];
  game.focusSoon = (selector) => focused.push(selector);
  assert.equal(game.hubInert(), false);
  assert.equal(game.openAbout(), true);
  assert.equal(game.aboutOpen, true);
  assert.deepEqual(focused, ['#about-title']);
  assert.equal(game.hubInert(), true);
  game.closeAbout();
  assert.equal(game.aboutOpen, false);
  assert.equal(focused.at(-1), '#about-open');
  assert.equal(game.hubInert(), false);
  assert.equal(game.aboutSummary, GAME_SUMMARY);
  assert.equal(game.aboutLoop, GLOBE_LOOP);
});

test('closeAbout is a no-op when About is not open (stale call)', () => {
  const { game } = setup();
  const focused = [];
  game.focusSoon = (selector) => focused.push(selector);
  game.closeAbout();
  assert.deepEqual(focused, []);
  assert.equal(game.aboutOpen, false);
  game.openLevel('x');
  assert.equal(game.overlayOpen, true);
  const before = focused.length;
  game.closeAbout();
  assert.equal(game.overlayOpen, true);
  assert.equal(focused.length, before, 'no focus call from the stale closeAbout');
});

test('Escape closes the About dialog; no level opens behind it', () => {
  const { game, dom } = setup();
  game.openAbout();
  assert.equal(game.openLevel('x'), false);
  assert.equal(game.overlayOpen, false);
  game.onEscape({ defaultPrevented: true, target: dom.document.body });
  assert.equal(game.aboutOpen, true, 'a handled Escape leaves it open');
  game.onEscape({ target: dom.document.body });
  assert.equal(game.aboutOpen, false);
});

test('openAbout is refused while a level or the reward is open', () => {
  const { game } = setup();
  game.openLevel('x');
  assert.equal(game.openAbout(), false);
  assert.equal(game.aboutOpen, false);
  ctxs.x.finish({ text: 'x is finished now' });
  assert.equal(game.rewardOpen, true);
  assert.equal(game.openAbout(), false);
  assert.equal(game.aboutOpen, false);
});

test('hubInert is true while any dialog is open', () => {
  const { game } = setup();
  assert.equal(game.hubInert(), false);
  game.overlayOpen = true;
  assert.equal(game.hubInert(), true);
  game.overlayOpen = false;
  game.rewardOpen = true;
  assert.equal(game.hubInert(), true);
  game.rewardOpen = false;
  game.aboutOpen = true;
  assert.equal(game.hubInert(), true);
});

test('acts carry their display title and the hub toggle renders the act line that starts with it', () => {
  const { game } = setup();
  assert.equal(game.acts[0].title, 'Act 0: First act');
  const toggle = deepQuery(shell, 'h3.act-title > button.act-toggle');
  assert.equal(toggle.getAttribute('x-text'), 'actLine(act)', 'the hub renders actLine(act)');
  for (const act of game.acts) assert.ok(game.actLine(act).startsWith(act.title), act.id);
});

test('a soon act changes nothing: not playable, not counted, nothing saved', () => {
  for (const debug of [false, true]) {
    const g = setup({ comingSoon: [S7], debug });
    assert.equal(g.game.levelState('s7'), 'locked', `debug ${debug}`);
    assert.equal(g.game.openLevel('s7'), false, `debug ${debug}`);
    assert.equal(g.game.nudgeId, null);
    assert.equal(g.game.overlayOpen, false);
    assert.deepEqual(g.errors, [], 'nothing thrown');
    const plain = setup({ debug }).game;
    assert.deepEqual(g.game.stars, plain.stars);
    assert.deepEqual(g.game.cards, plain.cards);
    assert.equal(g.store.data.has(STORAGE_KEY), false, 'nothing saved');
  }
});

test('the globe draws a soon region dimmed and names it', () => {
  const { game } = setup({ comingSoon: [S7], dots: [...DOTS, [20, 100, 'SSS', '']] });
  const view = game.globeView();
  assert.deepEqual([...view.states], [0, 0, 0, 0, 0, 0, 3]);
  assert.equal(view.target.actId, 'a0', 'the globe never turns to a soon act');
  assert.equal(game.mapLabel(), 'World map: 0 of 5 levels done. Coming soon: Seven.');
  assert.deepEqual(game.globeLines(), [
    'Act 0, First act (Zero): 0 of 4 done',
    'Act 1, Second act (One): 0 of 1 done',
    'Act 7, Later (Seven): coming soon',
  ]);
});

test('the globe mounts on init with the dot states, the current act and the motion preference', async () => {
  const { mount, log } = fakeGlobe();
  const { game } = setup({ globe: mount, reduceMotion: false });
  game.init();
  await tick();
  assert.equal(log.mounts.length, 1);
  assert.equal(log.mounts[0].host, 'globe-stage');
  assert.equal(log.mounts[0].dots === DOTS, true, 'the renderer gets the dots it draws');
  assert.deepEqual(log.mounts[0].states, [0, 0, 0, 0, 0, 0]);
  assert.equal(log.mounts[0].actId, 'a0');
  assert.equal(log.mounts[0].reduced, false);
  assert.equal(game.globeFallback, false);
  assert.equal(setup({ globe: fakeGlobe().mount, reduceMotion: true }).game.globeView().states.length, DOTS.length);
});

test('opening a level disposes the globe; finishing it mounts it again with the new country lit', async () => {
  const { mount, log } = fakeGlobe();
  const { game } = setup({ globe: mount });
  game.init();
  await tick();
  game.openLevel('x');
  assert.equal(log.disposed, 1, 'the hub is covered: the loop stops and the context is freed');
  ctxs.x.finish({ text: 'x is finished now' });
  await tick();
  assert.equal(log.mounts.length, 2);
  assert.deepEqual(log.mounts[1].states, [1, 1, 0, 0, 0, 0], "x's country XXX is lit");
  assert.equal(log.mounts[1].reduced, true);
  game.closeReward();
  await tick();
  assert.equal(log.mounts.length, 2, 'closing the reward keeps the same globe');
});

/** Spies for the hub's scroll and focus: what scrollIntoView and the map heading's focus were given. */
function spyHub(dom) {
  const spy = { scrolls: [], focuses: [] };
  dom.document.querySelector('.map-panel').scrollIntoView = (o) => spy.scrolls.push(o);
  dom.document.getElementById('map-title').focus = (o) => spy.focuses.push(o);
  return spy;
}

test('Back to the map after a first completion turns the globe to the new country and ignites it', async () => {
  const { mount, log } = fakeGlobe();
  const { game, dom } = setup({ globe: mount, reduceMotion: false });
  const spy = spyHub(dom);
  game.init();
  await tick();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  await tick();
  assert.equal(log.ignites.length, 0, 'nothing plays behind the reward card');
  game.closeReward();
  assert.equal(log.ignites.length, 1);
  const { view, states } = log.ignites[0];
  assert.deepEqual([...view.flare], [1, 1, 0, 0, 0, 0], "x's country XXX flares");
  assert.equal(view.target.key, 'country:XXX', 'the globe turns to the country, not the act');
  assert.deepEqual(states, [1, 1, 0, 0, 0, 0]);
  assert.deepEqual(spy.scrolls, [{ behavior: 'smooth', block: 'start' }]);
  assert.deepEqual(spy.focuses, [{ preventScroll: true }], 'focus goes to the map heading without a second scroll');
  assert.equal(game.litNote, 'Xland is now lit: Level x.');
});

test('under reduced motion Back to the map scrolls without animation, and the globe is still told', async () => {
  const { mount, log } = fakeGlobe();
  const { game, dom } = setup({ globe: mount, reduceMotion: true });
  const spy = spyHub(dom);
  game.init();
  await tick();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  await tick();
  game.closeReward();
  assert.deepEqual(spy.scrolls, [{ behavior: 'auto', block: 'start' }]);
  assert.equal(log.ignites.length, 1, 'the renderer decides to skip the effect');
  assert.equal(log.mounts[0].reduced, true);
});

test('replaying a completed level scrolls and ignites nothing and sends focus back to the card', async () => {
  const { mount, log } = fakeGlobe();
  const { game, dom } = setup({ globe: mount, initial: { [STORAGE_KEY]: v1({ x: { stars: 2, at: null } }) } });
  const spy = spyHub(dom);
  game.init();
  await tick();
  game.openLevel('x');
  ctxs.x.finish({ text: 'again' });
  await tick();
  game.closeReward();
  assert.equal(log.ignites.length, 0);
  assert.deepEqual(spy.scrolls, []);
  assert.deepEqual(spy.focuses, []);
  assert.equal(game.litNote, '');
});

test('closing a level without finishing it does not scroll or ignite', async () => {
  const { mount, log } = fakeGlobe();
  const { game, dom } = setup({ globe: mount });
  const spy = spyHub(dom);
  game.init();
  await tick();
  game.openLevel('x');
  game.closeOverlay();
  await tick();
  assert.equal(log.ignites.length, 0);
  assert.deepEqual(spy.scrolls, []);
});

test('opening a level mid-effect disposes the globe, clears the note and plays nothing more', async () => {
  const { mount, log } = fakeGlobe();
  const { game } = setup({ globe: mount });
  game.init();
  await tick();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  await tick();
  game.closeReward();
  assert.equal(log.ignites.length, 1);
  const live = log.disposed;
  game.openLevel('y');
  assert.equal(log.disposed, live + 1, 'the globe, and with it the effect, is released');
  assert.equal(game.litNote, '');
  await tick();
  assert.equal(log.ignites.length, 1);
});

test('Back to the map before the globe has loaded plays the ignite once it arrives', async () => {
  const { mount, log } = fakeGlobe();
  const { game } = setup({ globe: mount });
  game.init();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  game.closeReward();
  assert.equal(log.ignites.length, 0, 'no handle yet');
  await tick();
  await tick();
  assert.equal(log.ignites.length, 1);
  assert.equal(log.ignites[0].view.target.key, 'country:XXX');
});

test('debug: the globe shows everything finished, and nothing else changes', async () => {
  const { mount, log } = fakeGlobe();
  const { game, store } = setup({ globe: mount, debug: true });
  game.init();
  await tick();
  assert.deepEqual(log.mounts[0].states, [4, 4, 4, 4, 4, 0], 'every mapped region is resolved; the unmapped dot stays unlit');
  assert.equal(log.mounts[0].actId, 'a1', 'the globe turns to the last act, as when every act is complete');
  assert.equal(game.mapLabel(), 'World map: 5 of 5 levels done. Saved: Zero, One.');
  assert.equal(game.levelState('x'), 'open', 'the card state is the real one');
  assert.equal(game.progress.levels.x, undefined, 'progress itself is untouched');
  assert.equal(store.data.size, 0, 'nothing is stored');
});

test('a debug run lights nothing: no ignite, no note, no scroll, and focus goes back to the card', async () => {
  const { mount, log } = fakeGlobe();
  const { game, dom } = setup({ globe: mount, debug: true, reduceMotion: false });
  const spy = spyHub(dom);
  const focused = [];
  const card = dom.document.createElement('div');
  card.setAttribute('data-level-id', 'x');
  card.focus = () => focused.push('x');
  dom.document.body.appendChild(card);
  game.init();
  await tick();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  await tick();
  game.closeReward();
  assert.equal(log.ignites.length, 0, 'nothing was saved, so nothing is fresh');
  assert.equal(game.litNote, '');
  assert.deepEqual(spy.scrolls, []);
  assert.deepEqual(spy.focuses, []);
  assert.deepEqual(focused, ['x']);
});

test('an ignite queued before the globe loaded is dropped when the hub hides: the next mount plays nothing', async () => {
  const { mount, log } = fakeGlobe();
  const { game } = setup({ globe: mount });
  game.init();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  game.closeReward(); // queued: the first mount has not resolved yet
  game.openLevel('y'); // hides the globe; the stale mount is disposed on arrival
  await tick();
  await tick();
  game.closeOverlay(); // without finishing: a fresh mount
  await tick();
  await tick();
  assert.equal(log.handles.length - log.disposed, 1, 'one live globe, mounted after the level closed');
  assert.equal(log.ignites.length, 0, 'no stale ignite on that globe');
});

test('without WebGL the text fallback names the newly lit country', () => {
  const { game } = setup({});
  game.init();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  game.closeReward();
  assert.equal(game.globeFallback, true);
  assert.equal(game.globeLines()[0], 'Xland is now lit: Level x.');
  assert.equal(game.globeLines().length, 3, 'the act lines follow');
});

test('closing a level without finishing it mounts the globe again', async () => {
  const { mount, log } = fakeGlobe();
  const { game } = setup({ globe: mount });
  game.init();
  await tick();
  game.openLevel('x');
  game.closeOverlay();
  await tick();
  assert.equal(log.disposed, 1);
  assert.equal(log.mounts.length, 2);
});

test('a mount that resolves after the hub was hidden is disposed, not kept', async () => {
  const { mount, log } = fakeGlobe();
  const listeners = {};
  const { game, store } = setup({ globe: mount, window: { addEventListener: (type, fn) => (listeners[type] = fn) } });
  game.init();
  game.openLevel('x'); // before the mount resolves
  await tick();
  assert.equal(log.disposed, 1, 'the late handle is disposed');
  store.data.set(STORAGE_KEY, v1({ y: { stars: 3, at: AT } }));
  listeners.storage({ key: STORAGE_KEY });
  assert.equal(log.updates.length, 0, 'a disposed handle is never updated');
});

test('progress from another tab updates the drawn globe; pagehide disposes it', async () => {
  const { mount, log } = fakeGlobe();
  const listeners = {};
  const { game, store } = setup({ globe: mount, window: { addEventListener: (type, fn) => (listeners[type] = fn) } });
  game.init();
  await tick();
  store.data.set(STORAGE_KEY, v1({ y: { stars: 3, at: AT } }));
  listeners.storage({ key: STORAGE_KEY });
  assert.deepEqual(log.updates, [{ states: [0, 0, 1, 0, 0, 0], actId: 'a0' }]);
  listeners.pagehide();
  assert.equal(log.disposed, 1);
  listeners.pageshow({ persisted: true });
  await tick();
  assert.equal(log.mounts.length, 2, 'back from the back/forward cache: drawn again');
});

test('a back/forward cache restore with a level open does not mount behind it; closing the level does, once', async () => {
  const { mount, log } = fakeGlobe();
  const listeners = {};
  const { game } = setup({ globe: mount, window: { addEventListener: (type, fn) => (listeners[type] = fn) } });
  game.init();
  await tick();
  game.openLevel('x');
  listeners.pagehide();
  listeners.pageshow({ persisted: true });
  await tick();
  assert.equal(log.mounts.length, 1, 'no mount while the level covers the hub');
  assert.equal(log.mounts.length - log.disposed, 0, 'no live globe');
  game.closeOverlay();
  await tick();
  assert.equal(log.mounts.length, 2);
  assert.equal(log.mounts.length - log.disposed, 1, 'exactly one live globe');
});

test('no renderer, no WebGL, a failed load or a lost context: the text fallback shows', async () => {
  const none = setup().game;
  none.init();
  assert.equal(none.globeFallback, true, 'no renderer given');
  for (const result of [null, 'throw']) {
    const { mount } = fakeGlobe(result);
    const { game, errors } = setup({ globe: mount });
    game.init();
    assert.equal(game.globeFallback, false, 'the globe panel shows while it loads');
    await tick();
    assert.equal(game.globeFallback, true, `mount gave ${result}`);
    assert.equal(errors.length, result === 'throw' ? 1 : 0, 'a load failure is reported');
  }
  const { mount, log } = fakeGlobe();
  const { game } = setup({ globe: mount });
  game.init();
  await tick();
  log.mounts[0].onFail();
  assert.equal(game.globeFallback, true, 'context lost');
  assert.equal(log.disposed, 1);
  game.openLevel('x');
  game.closeOverlay();
  await tick();
  assert.equal(log.mounts.length, 1, 'once on the fallback, the globe is not mounted again');
});

test('the theme toggle flips, applies and stores the theme', () => {
  const { game, dom, store } = setup();
  assert.equal(game.theme, 'dark');
  game.toggleTheme();
  assert.equal(game.theme, 'light');
  assert.equal(dom.document.documentElement.dataset.theme, 'light');
  assert.equal(store.data.get(THEME_KEY), 'light');
  game.toggleTheme();
  assert.equal(dom.document.documentElement.dataset.theme, 'dark');
});

test('confetti is skipped under reduced motion and uses class colours, never style', () => {
  const calm = setup();
  calm.game.openLevel('x');
  ctxs.x.finish({ text: 'finished calmly' });
  assert.equal(calm.dom.document.querySelectorAll('.confetti').length, 0);
  const lively = setup({ reduceMotion: false });
  lively.game.openLevel('x');
  ctxs.x.finish({ text: 'finished with a party' });
  const bits = [...lively.dom.document.querySelectorAll('.confetti')];
  assert.ok(bits.length > 0);
  assert.ok(bits.every((b) => !b.hasAttribute('style') && /\bc[1-6]\b/.test(b.className)));
});

// ---- the How to play card (#199) ---------------------------------------------------

// Level x declares no widgets (no card); w and v declare theirs; the-pager style: none.
const REG_CARD = buildRegistry(
  [
    {
      id: 'a0',
      no: 0,
      name: 'First act',
      levels: [
        L('x', '0.1'),
        L('w', '0.2', { mechanics: ['sort'], widgets: ['choice', 'sort'] }),
        L('v', '0.3', { mechanics: ['build'], widgets: ['choice', 'build'] }),
      ],
      boss: null,
    },
  ],
  { deck: [], nodeIds: [] },
);
const cardGame = (opts = {}) => {
  const s = setup({ registry: REG_CARD, ...opts });
  s.focused = [];
  s.game.focusSoon = (selector) => s.focused.push(selector);
  return s;
};
const escapeOn = (s, target = s.dom.document.body) => s.game.onEscape({ target, defaultPrevented: false });

test('a level with widgets opens its card the first time, focused; one without has none', () => {
  const s = cardGame();
  assert.equal(s.game.openLevel('w'), true);
  assert.equal(s.game.howToOpen, true);
  assert.deepEqual(s.game.howTo.topics.map((t) => t.key), ['choice', 'sort']);
  assert.deepEqual(s.game.howToTopics().map((t) => t.key), ['choice'], 'the modal shows one guide: the first step\'s type');
  assert.deepEqual(s.focused, ['#ov-howto-title']);
  s.game.closeOverlay();
  s.focused.length = 0;
  const none = cardGame();
  assert.equal(none.game.openLevel('x'), true);
  assert.equal(none.game.howToOpen, false);
  assert.deepEqual(none.game.howTo.topics, []);
  assert.deepEqual(none.focused, ['#ov-back']);
  assert.equal(none.game.toggleHowTo(), false, 'no card to toggle');
  assert.equal(none.game.howToOpen, false);
});

test('howToExpanded mirrors the card as the aria-expanded string', () => {
  const s = cardGame();
  s.game.openLevel('w');
  assert.equal(s.game.howToExpanded(), 'true');
  s.game.closeHowTo();
  assert.equal(s.game.howToExpanded(), 'false');
});

test('Close dismisses for this visit only', () => {
  const s = cardGame();
  s.game.openLevel('w');
  s.game.closeHowTo();
  assert.equal(s.game.howToOpen, false);
  assert.equal(s.focused.at(-1), '#ov-howto-open');
  assert.equal(s.store.data.has(HELP_KEY), false, 'Close stores nothing');
  s.game.closeOverlay();
  s.game.openLevel('w');
  assert.equal(s.game.howToOpen, false, 'seen this visit: no auto-open');
  assert.equal(s.game.howTo.topics.length, 2, 'the topics are still there');
  s.focused.length = 0;
  s.game.toggleHowTo();
  assert.equal(s.game.howToOpen, true, 'the reopen button opens it');
  assert.deepEqual(s.focused, ['#ov-howto-title']);
  s.game.toggleHowTo();
  assert.equal(s.game.howToOpen, false, 'and closes it');
  assert.equal(s.focused.at(-1), '#ov-howto-open');
  const fresh = cardGame({ storage: () => s.store });
  fresh.game.openLevel('w');
  assert.equal(fresh.game.howToOpen, true, 'a reload opens it again');
});

test("Don't show again is stored per widget and respected later", () => {
  const s = cardGame();
  s.game.openLevel('w');
  s.game.hideHowTo();
  assert.equal(s.game.howToOpen, false);
  assert.equal(s.focused.at(-1), '#ov-howto-open');
  assert.equal(s.store.data.get(HELP_KEY), '{"v":1,"hidden":["choice"]}', 'only the guide on show');
  const later = cardGame({ storage: () => s.store });
  later.game.openLevel('w');
  assert.equal(later.game.howToOpen, false);
  assert.deepEqual(later.game.howTo.topics.map((t) => t.key), ['choice', 'sort'], 'still listed');
  later.game.closeOverlay();
  later.game.openLevel('v');
  assert.equal(later.game.howToOpen, false, 'its first step is choice, hidden');
  ctxs.v.widget('build');
  assert.equal(later.game.howToOpen, true, 'build is new to this player');
});

test('a level opens its card unless every widget is seen or hidden', () => {
  const s = cardGame({ initial: { [HELP_KEY]: '{"v":1,"hidden":["choice"]}' } });
  s.game.openLevel('v');
  assert.equal(s.game.howToOpen, false, 'the first step is choice, which is hidden');
  s.game.closeOverlay();
  s.game.openLevel('w');
  s.game.hideHowTo();
  assert.deepEqual(JSON.parse(s.store.data.get(HELP_KEY)).hidden, ['choice'], 'choice was already hidden; the guide on show is choice');
});

// ---- one guide per step type (#316) ----

test('the guide follows the step: a new type opens its own guide, once, focused', () => {
  const s = cardGame();
  s.game.openLevel('w');
  s.game.closeHowTo();
  s.focused.length = 0;
  ctxs.w.widget('choice');
  assert.equal(s.game.howToOpen, false, 'same type, nothing new');
  ctxs.w.widget('sort');
  assert.equal(s.game.howToOpen, true);
  assert.deepEqual(s.game.howToTopics().map((t) => t.key), ['sort']);
  assert.match(s.game.howToTitle(), /Sort it/);
  assert.deepEqual(s.focused, ['#ov-howto-title']);
  s.game.closeHowTo();
  ctxs.w.widget('sort');
  assert.equal(s.game.howToOpen, false, 'seen: it does not reopen');
  ctxs.w.widget('choice');
  assert.equal(s.game.howToOpen, false);
  assert.deepEqual(s.game.howToTopics().map((t) => t.key), ['choice'], 'the header button now opens choice');
  s.game.toggleHowTo();
  assert.equal(s.game.howToOpen, true);
  assert.deepEqual(s.game.howToTopics().map((t) => t.key), ['choice']);
});

test("Close and Don't show again apply to the guide on show only", () => {
  const s = cardGame();
  s.game.openLevel('w');
  ctxs.w.widget('sort');
  s.game.hideHowTo();
  assert.equal(s.store.data.get(HELP_KEY), '{"v":1,"hidden":["sort"]}');
  ctxs.w.widget('choice');
  assert.equal(s.game.howToOpen, true, 'choice was never closed or hidden');
  s.game.closeHowTo();
  assert.equal(s.store.data.get(HELP_KEY), '{"v":1,"hidden":["sort"]}', 'Close stores nothing');
});

test('a hidden type does not auto-open mid-level, but the header button still shows it', () => {
  const s = cardGame({ initial: { [HELP_KEY]: '{"v":1,"hidden":["choice","sort"]}' } });
  s.game.openLevel('w');
  ctxs.w.widget('sort');
  assert.equal(s.game.howToOpen, false);
  s.game.toggleHowTo();
  assert.deepEqual(s.game.howToTopics().map((t) => t.key), ['sort']);
  assert.equal(s.game.howToOpen, true);
});

test('a first step that reports a different type than the first declared one decides the opening card', () => {
  const REG = buildRegistry(
    [{ id: 'a0', no: 0, name: 'A', levels: [L('r', '0.1', {
      mechanics: ['sort'], widgets: ['choice', 'sort'],
      run(ctx) { ctxs.r = ctx; ctx.widget('sort'); ctx.renderStep('<p>r</p>', ''); },
    })], boss: null }],
    { deck: [], nodeIds: [] },
  );
  const s = setup({ registry: REG });
  s.focused = [];
  s.game.focusSoon = (sel) => s.focused.push(sel);
  s.game.openLevel('r');
  assert.deepEqual(s.game.howToTopics().map((t) => t.key), ['sort']);
  assert.equal(s.game.howToOpen, true);
  assert.deepEqual(s.focused, ['#ov-howto-title']);
});

test('a first step on a hidden type leaves the guide closed, focus on Back, the topic still its own', () => {
  const REG = buildRegistry(
    [{ id: 'a0', no: 0, name: 'A', levels: [L('r', '0.1', {
      mechanics: ['sort'], widgets: ['choice', 'sort'],
      run(ctx) { ctxs.r = ctx; ctx.widget('sort'); ctx.renderStep('<p>r</p>', ''); },
    })], boss: null }],
    { deck: [], nodeIds: [] },
  );
  const s = setup({ registry: REG, initial: { [HELP_KEY]: '{"v":1,"hidden":["sort"]}' } });
  s.focused = [];
  s.game.focusSoon = (sel) => s.focused.push(sel);
  s.game.openLevel('r');
  assert.equal(s.game.howToOpen, false, 'choice (the first declared) is new, but the first step is the hidden sort');
  assert.deepEqual(s.game.howToTopics().map((t) => t.key), ['sort']);
  assert.deepEqual(s.focused, ['#ov-back']);
});

test('a stale or unknown widget report changes nothing', () => {
  const s = cardGame();
  s.game.openLevel('w');
  s.game.closeHowTo();
  const stale = ctxs.w;
  ctxs.w.widget('quiz');
  assert.equal(s.game.howToOpen, false, 'a type the level does not list is ignored');
  s.game.closeOverlay();
  stale.widget('sort');
  assert.equal(s.game.howToOpen, false);
  assert.deepEqual(s.game.howToTopics(), []);
  s.game.openLevel('v');
  s.game.closeHowTo();
  stale.widget('build');
  assert.equal(s.game.howToOpen, false, 'the old level cannot drive the new one');
  assert.deepEqual(s.game.howToTopics().map((t) => t.key), ['choice']);
});

test('Escape with the card open closes the card, not the level', () => {
  const s = cardGame();
  s.game.openLevel('w');
  escapeOn(s);
  assert.equal(s.game.howToOpen, false);
  assert.equal(s.game.overlayOpen, true);
  assert.equal(ctxs.w.signal.aborted, false);
  escapeOn(s);
  assert.equal(s.game.overlayOpen, false, 'the second Escape closes the level');
  const typing = cardGame();
  typing.game.openLevel('w');
  const area = typing.dom.document.createElement('textarea');
  typing.dom.document.body.appendChild(area);
  escapeOn(typing, area);
  assert.equal(typing.game.howToOpen, false, 'typing: the card still closes');
  assert.equal(typing.game.overlayOpen, true);
});

test('the open How to play modal traps Tab; with none open nothing is trapped', () => {
  const s = cardGame();
  s.game.openLevel('w');
  assert.equal(s.game.openModalSelector(), '#howto-modal');
  const modal = s.dom.document.querySelector('#howto-modal');
  const key = (shiftKey) => ({ key: 'Tab', shiftKey, preventDefault() {} });
  assert.equal(s.game.trapTab(key(true)), true, 'focus is outside the modal here, so it is pulled in');
  s.game.closeHowTo();
  assert.equal(s.game.openModalSelector(), null);
  assert.equal(s.game.trapTab(key(false)), false);
  assert.ok(modal);
});

test('the page scroll is locked while How to play, About or Save code is open, and only then', () => {
  const s = cardGame();
  const root = s.dom.document.documentElement;
  s.game.syncScrollLock();
  assert.equal(root.classList.contains('modal-open'), false);
  s.game.openLevel('w');
  s.game.syncScrollLock();
  assert.equal(root.classList.contains('modal-open'), true, 'How to play');
  s.game.closeHowTo();
  s.game.syncScrollLock();
  assert.equal(root.classList.contains('modal-open'), false, 'the level alone does not lock the page');
  s.game.closeOverlay();
  s.game.aboutOpen = true;
  s.game.syncScrollLock();
  assert.equal(root.classList.contains('modal-open'), true, 'About');
  s.game.aboutOpen = false;
  s.game.saveOpen = true;
  s.game.syncScrollLock();
  assert.equal(root.classList.contains('modal-open'), true, 'Save code');
  assert.equal(shell.querySelector('.app').getAttribute('x-effect'), 'syncScrollLock()', 'index.html keeps it in step');
  assert.match(read('styles/base.css'), /html\.modal-open, html\.modal-open body \{ overflow: hidden; \}/);
});

test('the How to play header button stays on one line at 320px', () => {
  assert.match(read('styles/hub.css'), /#ov-howto-open \{[^}]*white-space: nowrap/);
});

test('the level header names the level number, and Incident for a boss', () => {
  const s = cardGame();
  s.game.openLevel('w');
  assert.equal(s.game.overlayNo, 'Level 0.2');
  s.game.closeOverlay();
  s.game.openLevel('x');
  assert.equal(s.game.overlayNo, 'Level 0.1');
});

test('Escape that a widget already handled leaves the card alone', () => {
  const s = cardGame();
  s.game.openLevel('w');
  s.game.onEscape({ target: s.dom.document.body, defaultPrevented: true });
  assert.equal(s.game.howToOpen, true);
});

test('the card never blocks finishing and is not level DOM', () => {
  const s = cardGame();
  s.game.openLevel('w');
  assert.equal(s.game.howToOpen, true);
  assert.equal(s.dom.document.querySelector('#ov-body #ov-howto') === null, true);
  assert.equal(s.dom.document.querySelector('.overlay #ov-howto') === null, true, 'the modal is not rendered in the level overlay');
  assert.ok(s.dom.document.querySelector('.app > #howto-modal #ov-howto'), 'it is a modal beside the overlay');
  assert.equal(s.dom.document.querySelector('[data-finish]').disabled, false);
  ctxs.w.finish({ text: 'finished with the card open' });
  assert.equal(s.game.rewardOpen, true);
  assert.equal(s.game.howToOpen, false);
  assert.deepEqual(s.game.howTo.topics, []);
});

test('closing the level resets the card; stale Close and Hide are no-ops', () => {
  const s = cardGame();
  s.game.openLevel('w');
  s.game.closeOverlay();
  assert.equal(s.game.howToOpen, false);
  assert.deepEqual(s.game.howTo, { topics: [] });
  s.focused.length = 0;
  s.game.closeHowTo();
  s.game.hideHowTo();
  s.game.toggleHowTo();
  assert.deepEqual(s.focused, []);
  assert.equal(s.store.data.has(HELP_KEY), false);
});

test("debug: the card shows, Don't show again writes nothing", () => {
  const s = cardGame({ debug: true });
  s.game.openLevel('w');
  assert.equal(s.game.howToOpen, true);
  s.game.hideHowTo();
  assert.equal(s.store.data.has(HELP_KEY), false);
  assert.equal(s.store.sets.length, 0);
  s.game.closeOverlay();
  s.game.openLevel('w');
  assert.equal(s.game.howToOpen, false, 'hidden for this visit');
});

test("storage unavailable: Don't show again still hides for this visit, nothing throws", () => {
  const s = cardGame({ throwOn: ['setItem'] });
  s.game.openLevel('w');
  s.game.hideHowTo();
  assert.equal(s.game.howToOpen, false);
  assert.equal(s.store.data.has(HELP_KEY), false);
  s.game.closeOverlay();
  s.game.openLevel('w');
  assert.equal(s.game.howToOpen, false);
  assert.deepEqual(s.errors, []);
  const blocked = cardGame({
    storage: () => {
      throw new Error('blocked');
    },
  });
  blocked.game.openLevel('w');
  assert.equal(blocked.game.howToOpen, true, 'an unreadable preference shows the card');
  blocked.game.hideHowTo();
  assert.equal(blocked.game.howToOpen, false);
});

test("another tab's hide is picked up at the next open", () => {
  const a = cardGame();
  const b = cardGame({ storage: () => a.store });
  hideHelp(() => a.store, ['choice', 'sort']);
  b.game.openLevel('w');
  assert.equal(b.game.howToOpen, false);
});

// ---- shell markup -------------------------------------------------------------------

const shell = parseHTML(read('index.html')).document;
// querySelector that also searches <template> content (Alpine x-for bodies).
function deepQuery(root, sel) {
  const hit = root.querySelector(sel);
  if (hit) return hit;
  for (const t of root.querySelectorAll('template')) {
    const inner = t.content && deepQuery(t.content, sel);
    if (inner) return inner;
  }
  return null;
}

test('index.html: each element the game focuses on opening a level and the reward is in the shell exactly once', () => {
  const { game } = setup();
  const focused = [];
  game.focusSoon = (selector) => focused.push(selector);
  assert.equal(game.openLevel('x'), true);
  ctxs.x.finish({ text: 'whatever text here' });
  assert.equal(game.rewardOpen, true);
  assert.deepEqual(focused, ['#ov-back', '#reward-close'], 'the back button on open, the reward close on finish');
  for (const sel of [...focused, '#ov-howto-title', '#ov-howto-open']) {
    assert.equal(shell.querySelectorAll(sel).length, 1, `${sel} matches one element in index.html`);
  }
});

test('opening a level with no help card puts focus on Back, even when its widget focuses its first line on mount', () => {
  const spec = {
    id: 'sp',
    target: 'metric',
    lines: [
      { id: 's1', text: 'http_requests_total{route="/cart"}' },
      { id: 's2', text: 'http_requests_total{user_id="8841"}' },
    ],
    faults: ['s2'],
    whyNot: {},
    explain: 'user_id explodes cardinality.',
  };
  const spotLevel = L('sp', '0.9', {
    run(ctx) {
      ctx.renderStep(renderSpot(spec, newSpotState(spec), { escapeHtml: ctx.escapeHtml }), '<button data-finish disabled>Finish</button>');
      mountSpot(ctx, spec, { onComplete: () => {}, swirl: () => {} });
    },
  });
  const registry = buildRegistry([{ id: 'a0', no: 0, name: 'Act', levels: [spotLevel], boss: null }], { deck: [], nodeIds: [] });
  const { game, dom } = setup({ registry });
  const focus = recordFocus(dom.window);
  assert.equal(game.openLevel('sp'), true);
  assert.deepEqual(focus.names(), ['line:s1', '#ov-back'], 'the widget focuses its first line on mount, then the app moves focus to Back');
  assert.equal(focus.last(), '#ov-back', 'Back holds focus, not the first Spot line');
  assert.equal(dom.document.querySelectorAll('[data-line]').length, 2, 'the Spot board did mount');
});

test('index.html: the level overlay elements live inside an x-ignore wrapper', () => {
  for (const id of ['ov-body', 'ov-actions']) {
    const el = shell.getElementById(id);
    assert.ok(el, `#${id} exists`);
    assert.ok(el.closest('[x-ignore]'), `#${id} is inside [x-ignore]`);
  }
});

test('index.html: the globe stage is a named image, with a legend and a text fallback, and no style (the caption sits in .map-head)', () => {
  assert.equal(shell.querySelector('svg.system-map') === null, true, 'the SVG system map is gone');
  const stage = shell.querySelector('.globe .globe-stage');
  assert.ok(stage, '.globe-stage inside .globe');
  assert.equal(stage.getAttribute('role'), 'img');
  assert.equal(stage.getAttribute(':aria-label'), 'mapLabel()');
  assert.equal(shell.querySelector('.globe').getAttribute('x-show'), '!globeFallback');
  assert.equal(shell.querySelector('.globe').firstElementChild === stage, true, 'the stage comes first in .globe; the caption lives in .map-head');
  assert.equal(shell.querySelector('.globe p.globe-caption') === null, true, 'the caption is not inside .globe');
  const legend = shell.querySelector('ul.globe-legend');
  assert.ok(legend, 'the legend is a list');
  assert.equal(legend.getAttribute('aria-label'), 'Map key');
  const each = legend.querySelector('template');
  assert.equal(each.getAttribute('x-for'), 'e in globeLegend()');
  assert.equal(each.getAttribute(':key'), 'e.key');
  const swatch = each.content.querySelector('li > i');
  assert.equal(swatch.getAttribute(':class'), 'legendKeyClass(e)');
  assert.equal(swatch.getAttribute('aria-hidden'), 'true');
  assert.equal(each.content.querySelector('li [x-text="e.text"]') !== null, true, 'the words come from the entry');
  const fallback = shell.querySelector('ul.globe-fallback');
  assert.equal(fallback.getAttribute('x-show'), 'globeFallback');
  assert.equal(fallback.querySelector('template').getAttribute('x-for'), 'line in globeLines()');
  for (const el of [shell.querySelector('.map-panel'), ...shell.querySelectorAll('.map-panel *')]) {
    assert.ok(!el.hasAttribute('style') && !el.hasAttribute(':style'), 'no style on the map panel');
  }
});

test('index.html: a soon act shows the kit chip and teaser', () => {
  const soon = deepQuery(shell, '.act-soon');
  assert.ok(soon, '.act-soon in the act template');
  assert.equal(soon.getAttribute('x-show'), 'act.soon');
  const chip = soon.querySelector('span.ui-chip[data-tone="neutral"]');
  assert.ok(chip, 'a neutral kit chip');
  assert.equal(chip.textContent.trim(), 'Coming soon');
  assert.ok(soon.querySelector('[x-text="act.teaser"]'), 'the teaser, escaped by x-text');
  assert.equal(deepQuery(shell, '.act').getAttribute(':class'), "act.soon ? 'soon' : ''");
});

test('index.html: the hub act card and the About list render act.badges as kit chips with x-text', () => {
  const lists = [];
  const collect = (root) => {
    lists.push(...root.querySelectorAll('.act-badges'));
    for (const t of root.querySelectorAll('template')) if (t.content) collect(t.content);
  };
  collect(shell);
  assert.equal(lists.length, 2, 'one badges row on the hub card, one in the About list');
  for (const list of lists) {
    assert.equal(list.getAttribute('x-show'), 'act.badges.length > 0');
    const loop = list.querySelector('template[x-for="b in act.badges"]');
    assert.ok(loop, 'loops act.badges');
    const chip = loop.content.querySelector('span.ui-chip');
    assert.ok(chip, 'a kit chip');
    assert.equal(chip.getAttribute(':data-tone'), 'b.tone');
    assert.equal(chip.getAttribute('x-text'), 'b.label');
    assert.equal(chip.hasAttribute('x-html'), false);
  }
});

test('index.html: the map heading can take focus and a polite live region carries the lit note', () => {
  const heading = shell.getElementById('map-title');
  assert.equal(heading.getAttribute('tabindex'), '-1');
  const note = shell.querySelector('.map-panel [x-text="litNote"]');
  assert.ok(note, 'a region shows litNote');
  assert.equal(note.getAttribute('role'), 'status');
  assert.ok(!note.hasAttribute('style'));
});

test('index.html: level cards keep the keyboard and screen-reader wiring', () => {
  const card = deepQuery(shell, '.level-card');
  assert.ok(card);
  assert.equal(card.getAttribute('role'), 'button');
  assert.equal(card.getAttribute('tabindex'), '0');
  for (const a of [':aria-disabled', ':aria-label', ':data-level-id', '@keydown.enter.prevent', '@keydown.space.prevent']) {
    assert.ok(card.hasAttribute(a), `level card has ${a}`);
  }
  for (const sel of ['.overlay', '.reward']) {
    const d = shell.querySelector(sel);
    assert.equal(d.getAttribute('role'), 'dialog', sel);
    assert.equal(d.getAttribute('aria-modal'), 'true', sel);
  }
  assert.ok(shell.querySelector('[x-show="!hasLevels"]'), 'empty state is wired');
});

test('index.html: the hub goes inert while a dialog is open; dialogs stay outside it', () => {
  // An id, not a class: the wrapper has no styles (test/static.test.mjs T9).
  const hub = shell.querySelector('#hub');
  assert.ok(hub, '#hub wrapper exists');
  assert.equal(hub.getAttribute(':inert'), 'hubInert()');
  for (const sel of ['.hub-header', '.globe-stage', '.globe-fallback', '.levels']) {
    assert.ok(hub.querySelector(sel), `${sel} is inside #hub`);
  }
  for (const sel of ['.overlay', '.reward']) {
    assert.equal(shell.querySelector(sel).closest('#hub') === null, true, `${sel} is outside #hub`);
  }
  assert.equal(shell.querySelector('.app').getAttribute('@keydown.escape.window'), 'onEscape($event)');
});

test('index.html: ? is a kit icon button with a name; the About dialog is outside #hub', () => {
  const open = shell.querySelector('#about-open');
  assert.ok(open, '#about-open exists');
  assert.deepEqual(open.getAttribute('class').split(' '), ['ui-btn', 'ui-btn--icon']);
  assert.equal(open.getAttribute('type'), 'button');
  assert.equal(open.getAttribute('aria-label'), 'How this game works');
  assert.equal(open.getAttribute('@click'), 'openAbout()');
  assert.ok(open.closest('.hub-header'), '? is in the header');
  const about = shell.querySelector('#about-modal.ui-modal');
  assert.equal(about.getAttribute('role'), 'dialog');
  assert.equal(about.getAttribute('aria-modal'), 'true');
  assert.equal(about.getAttribute('aria-labelledby'), 'about-title');
  assert.equal(about.closest('#hub') === null, true);
  assert.equal(shell.querySelector('#about-title').getAttribute('tabindex'), '-1');
  assert.ok(deepQuery(shell, '[x-for="act in aboutActs()"]'), 'the acts list iterates aboutActs()');
  assert.ok(about.querySelector('#about-close'), 'Close exists');
  assert.equal(read('index.html').includes('x-html'), false, 'no x-html');
});

test('index.html: the How to play control and modal', () => {
  const open = shell.querySelector('#ov-howto-open');
  assert.ok(open.closest('.lesson-top'), 'the reopen button is in the level header');
  assert.deepEqual(open.getAttribute('class').split(' '), ['ui-btn', 'ui-btn--ghost']);
  assert.equal(open.getAttribute('type'), 'button');
  assert.equal(open.getAttribute('x-show'), 'howTo.topics.length > 0');
  assert.equal(open.getAttribute(':aria-expanded'), 'howToExpanded()');
  assert.equal(open.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(open.getAttribute('aria-controls'), 'ov-howto');
  assert.equal(open.getAttribute('@click'), 'toggleHowTo()');
  const modal = shell.querySelector('#howto-modal');
  const card = shell.querySelector('#ov-howto');
  assert.ok(modal.classList.contains('ui-modal') && modal.contains(card));
  assert.equal(modal.closest('.overlay') === null, true, 'a sibling of the overlay: the overlay can go inert');
  assert.equal(modal.closest('#hub') === null, true);
  assert.equal(modal.closest('[x-ignore]') === null, true, 'Alpine renders it');
  assert.equal(modal.getAttribute('role'), 'dialog');
  assert.equal(modal.getAttribute('aria-modal'), 'true', 'modal');
  assert.equal(modal.getAttribute('aria-labelledby'), 'ov-howto-title');
  assert.equal(modal.getAttribute('x-show'), 'howToOpen');
  assert.equal(shell.querySelector('.overlay').getAttribute(':inert'), 'howToOpen', 'the level is inert while it is open');
  assert.equal(shell.querySelector('#ov-howto-title').getAttribute('tabindex'), '-1');
  const x = card.querySelector('#ov-howto-x');
  assert.deepEqual(x.getAttribute('class').split(' '), ['ui-btn', 'ui-btn--icon']);
  assert.equal(x.getAttribute('@click'), 'closeHowTo()');
  assert.ok(x.getAttribute('aria-label'));
  for (const [id, click] of [['ov-howto-close', 'closeHowTo()'], ['ov-howto-hide', 'hideHowTo()']]) {
    const b = card.querySelector(`#${id}`);
    assert.deepEqual(b.getAttribute('class').split(' '), ['ui-btn', 'ui-btn--ghost'], `${id} is ghost: one primary per screen`);
    assert.equal(b.getAttribute('@click'), click);
  }
  assert.equal(card.querySelector('#ov-howto-hide').textContent.trim(), "Don't show again");
  assert.equal(card.querySelector('#ov-howto-close').textContent.trim(), 'Close');
  assert.equal(card.querySelector('.ui-btn--primary') === null, true);
  const loop = card.querySelector('template[x-for="topic in howToTopics()"]');
  assert.ok(loop, 'one guide: the step on screen');
  const parts = loop.content.querySelector('template[x-for="part in topic.parts"]');
  assert.ok(parts, 'its labelled parts');
  for (const field of ['label', 'text', 'note']) {
    assert.ok(parts.content.querySelector(`[x-text="part.${field}"]`), `part.${field} by x-text`);
  }
  const items = parts.content.querySelector('template[x-for="item in part.items"]');
  assert.ok(items?.content.querySelector('[x-text="item"]'), 'the list items by x-text');
  assert.equal(card.querySelector('#ov-howto-title').getAttribute('x-text'), 'howToTitle()', 'the title names the type');
  assert.equal(card.innerHTML.includes('x-html'), false);
});

test('index.html: the notice and star live regions stay rendered and carry text', () => {
  const notice = shell.querySelector('.notice');
  assert.equal(notice.getAttribute('role'), 'status');
  assert.equal(notice.hasAttribute('x-show'), false, 'x-show would hide the live region');
  assert.equal(notice.getAttribute(':class'), "notice ? 'show' : ''");
  assert.equal(notice.getAttribute('x-text'), 'noticeText()');
  const stars = shell.querySelector('.star-count');
  assert.equal(stars.getAttribute('role'), 'status');
  const spoken = stars.querySelector('.visually-hidden');
  assert.ok(spoken, 'the star status holds visually hidden text');
  assert.equal(spoken.getAttribute('x-text'), 'starSummary()');
  assert.match(read('styles/hub.css'), /\.visually-hidden\s*\{[^}]*clip-path/);
  assert.match(read('styles/hub.css'), /\.notice:not\(\.show\)/);
});

test('main.mjs applies the stored theme before anything else runs', () => {
  const statements = read('main.mjs')
    .replace(/\/\/.*$/gm, '')
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('import '));
  assert.match(statements[0], /^document\.documentElement\.dataset\.theme\s*=\s*readTheme\(/);
});

test('every star display shows five: filled then empty, for each value 0 to 5 and an old 3', () => {
  const { game } = setup({ initial: { [STORAGE_KEY]: v1({ y: { stars: 3, at: null } }) } });
  assert.equal(game.starText('y'), '★★★☆☆', 'a saved three-star value still shows 3 of 5');
  assert.equal(game.starText('x'), '☆☆☆☆☆', 'no entry shows five empty');
  for (let n = 0; n <= 5; n++) {
    game.rewardStars = n;
    assert.equal(game.rewardStarsText(), '★'.repeat(n) + '☆'.repeat(5 - n), `reward ${n}`);
    assert.equal(game.rewardStarsLabel(), `${n} of 5 stars`);
  }
  game.rewardStars = null;
  assert.equal(game.rewardStarsText(), '');
  assert.equal(game.rewardStarsLabel(), 'Not scored');
});

// ---- focusSoon waits for its target to be shown (#199) ---------------------------

/** A game over a fake document whose one element is hidden for `hiddenFrames` frames; frames run by hand. */
function focusRig(hiddenFrames) {
  const rig = { focuses: 0, frames: 0, queue: [], at: 0 };
  const el = {
    getClientRects: () => (rig.frames >= hiddenFrames ? [{}] : []),
    focus: () => { rig.focuses++; },
  };
  rig.game = createGame({
    registry: REG,
    storage: () => fakeStorage({}),
    document: { querySelector: () => el },
    raf: (fn) => rig.queue.push(fn),
  });
  rig.frame = () => {
    rig.frames++;
    const run = rig.queue.splice(0);
    for (const fn of run) fn();
  };
  return rig;
}

test('focusSoon: a target hidden for 2 frames is focused once, after it is shown', () => {
  const rig = focusRig(2);
  rig.game.focusSoon('#x');
  assert.equal(rig.focuses, 0, 'hidden: nothing focused yet');
  rig.frame();
  assert.equal(rig.focuses, 0, 'still hidden after one frame');
  rig.frame();
  assert.equal(rig.focuses, 1, 'focused once rendered');
  rig.frame();
  rig.frame();
  assert.equal(rig.focuses, 1, 'and only once');
});

test('focusSoon: a target that never renders is given up on silently after the bound', () => {
  const rig = focusRig(Infinity);
  assert.doesNotThrow(() => {
    rig.game.focusSoon('#x');
    for (let i = 0; i < 30; i++) rig.frame();
  });
  assert.equal(rig.focuses, 0);
  assert.equal(rig.queue.length, 0, 'no frame left scheduled');
  assert.equal(rig.frames, 30);
});

test('focusSoon: a target that is already shown is focused at once, with no frame wait', () => {
  const rig = focusRig(0);
  rig.game.focusSoon('#x');
  assert.equal(rig.focuses, 1);
  assert.equal(rig.queue.length, 0);
});

test('the legend lists what the globe draws now', () => {
  const keys = (o) => setup(o).game.globeLegend().map((e) => e.key);
  assert.deepEqual(keys({}), ['dark']);
  assert.deepEqual(keys({ initial: { [STORAGE_KEY]: v1({ x: { stars: 3, at: AT } }) } }), ['lit', 'dark']);
  assert.deepEqual(keys({ debug: true }), ['resolved'], 'debug draws every mapped region resolved');
  const withSoon = setup({ comingSoon: [S7], dots: [...DOTS, [20, 100, 'SSS', '']] }).game;
  assert.deepEqual(withSoon.globeLegend().map((e) => e.key), ['dark', 'soon']);
  assert.deepEqual(withSoon.globeLegend()[1], { key: 'soon', text: 'Coming soon' });
  assert.equal(setup().game.hasSoon, undefined, 'nothing reads hasSoon any more');
  assert.equal(setup().game.legendKeyClass({ key: 'incident' }), 'globe-key pulse');
  assert.equal(setup().game.legendKeyClass({ key: 'dark' }), 'globe-key');
  for (const k of ['lit', 'resolved', 'soon']) assert.equal(setup().game.legendKeyClass({ key: k }), `globe-key ${k}`);
});

test('the caption text follows the progress, and is empty when no region is mapped', () => {
  assert.equal(setup().game.captionText(), 'The planet is dark. Shine the o11y light on your world.');
  const after = setup({ initial: { [STORAGE_KEY]: v1({ x: { stars: 3, at: AT } }) } }).game;
  assert.equal(after.captionText(), "You're building! Zero: 1 of 4 done.");
  assert.equal(setup({ debug: true }).game.captionText(), 'Every region is calm. You saved the day.');
  assert.equal(setup({ registry: EMPTY }).game.captionText(), '');
  assert.deepEqual(setup({ registry: EMPTY }).game.globeLegend(), [], 'no caption, no key');
});

test('About: the map topic renders GLOBE_LOOP after the summary, and the summary does not promise a whole region', () => {
  assert.equal(GLOBE_LOOP.title, 'The map');
  assert.match(GLOBE_LOOP.text, /production goes down there/);
  assert.equal(GAME_SUMMARY.includes('whole region'), false);
  assert.ok(GAME_SUMMARY.endsWith('lights up a country on the globe.'));
  const body = shell.querySelector('#about-modal .ui-modal-body');
  const topic = body.querySelector('.about-map');
  assert.ok(topic, 'a map topic in the About body');
  assert.equal(topic.querySelector('h3').getAttribute('x-text'), 'aboutLoop.title');
  assert.equal(topic.querySelector('p').getAttribute('x-text'), 'aboutLoop.text');
  const order = [...body.children];
  assert.ok(order.indexOf(topic) > order.indexOf(body.querySelector('[x-text="aboutSummary"]')), 'after the summary');
  assert.ok(order.indexOf(topic) < order.indexOf(body.querySelector('ol.about-acts')), 'before the act list');
});

test('index.html: the progress strip sits under the header, the map and levels share .hub-body (M4)', () => {
  const hub = shell.getElementById('hub');
  const order = ['header.hub-header', 'section.save-entry', 'section.map-panel', 'section.levels'];
  const at = order.map((sel) => {
    const el = hub.querySelector(sel);
    assert.ok(el, sel);
    return [...hub.querySelectorAll('*')].indexOf(el);
  });
  assert.deepEqual(at, [...at].sort((a, b) => a - b), 'document order: header, strip, map, levels');
  const strip = hub.querySelector('section.save-entry');
  assert.equal(strip.previousElementSibling.matches('header.hub-header'), true, 'the strip follows the header directly');
  const body = hub.querySelector('div.hub-body');
  assert.ok(body && body.parentElement === hub);
  assert.deepEqual([...body.children].map((c) => c.className), ['map-panel', 'levels']);
  for (const id of ['account-entry', 'save-open', 'board-open', 'account-open']) {
    assert.ok(strip.querySelector(`#${id}`), `#${id} stays in the strip`);
  }
  assert.ok(strip.querySelector('a[href="/api/auth-start"]'), 'the sign-in anchor stays in the strip');
  const title = strip.querySelector('#save-entry-title');
  assert.equal(title.classList.contains('visually-hidden'), true, 'the heading is spoken, not shown');
  assert.equal(strip.getAttribute('aria-labelledby'), 'save-entry-title');
  assert.equal(strip.textContent.includes('Copy it to another browser'), false, 'the old sentence is gone');
});

test('M1 .map-head holds the caption and the Continue button, outside the globe, the only primary button on the hub', () => {
  const head = shell.querySelector('.map-panel > .map-head');
  assert.ok(head, '.map-head is a child of .map-panel');
  const caption = head.firstElementChild;
  assert.equal(caption.tagName, 'P');
  assert.equal(caption.classList.contains('globe-caption'), true);
  assert.equal(caption.getAttribute('x-text'), 'captionText()');
  assert.equal(caption.getAttribute('x-show'), "captionText() !== ''");
  for (const a of ['role', 'aria-live', 'aria-atomic']) assert.equal(caption.hasAttribute(a), false, `the caption is not a live region (${a})`);
  const btn = shell.querySelector('#hub-continue');
  assert.ok(btn);
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.deepEqual(btn.getAttribute('class').split(' '), ['ui-btn', 'ui-btn--primary']);
  assert.equal(btn.previousElementSibling === caption, true);
  assert.equal(btn.parentElement === head, true);
  assert.equal(btn.closest('.globe') === null, true, 'Continue stays when the globe falls back to text');
  assert.equal(btn.getAttribute('x-show'), "continueLabel() !== ''");
  assert.equal(btn.getAttribute('x-text'), 'continueLabel()');
  assert.equal(btn.getAttribute('@click'), 'continueNext()');
  assert.equal(btn.hasAttribute('x-cloak'), true);
  assert.equal(shell.querySelectorAll('#hub .ui-btn--primary').length, 1, 'Continue is the one primary button on the hub');
});

test('M2 the Next up chip is a kit attention chip inside the hidden status column', () => {
  const status = deepQuery(shell, '.level-status[aria-hidden="true"]');
  const chip = status.querySelector('span.ui-chip[data-tone="attention"]');
  assert.ok(chip, 'the chip sits in .level-status');
  assert.equal(chip.getAttribute('x-show'), 'isNextUp(id)');
  assert.equal(chip.textContent.trim(), 'Next up');
});

test('M5 every name the Continue and Next up markup binds exists on the game', () => {
  const { game } = setup();
  const status = deepQuery(shell, '.level-status');
  const act = deepQuery(shell, 'h3.act-title');
  const body = deepQuery(shell, 'div.act-body');
  const els = [shell.querySelector('#hub-continue'), status, ...status.querySelectorAll('*'), ...act.querySelectorAll('*'), body];
  const seen = new Set();
  for (const el of els) for (const a of ['x-show', 'x-text', '@click', ':aria-expanded']) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    for (const m of v.matchAll(/[A-Za-z]+\(/g)) {
      const name = m[0].slice(0, -1);
      seen.add(name);
      assert.equal(typeof game[name], 'function', `${a}="${v}": game.${name}`);
    }
  }
  for (const k of ['continueLabel', 'continueNext', 'isNextUp', 'actLine', 'toggleAct', 'actExpandedAttr', 'actExpanded']) assert.ok(seen.has(k), `the markup binds ${k}`);
});
