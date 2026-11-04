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
import { fakeStorage } from './helpers/fake-storage.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { STORAGE_KEY } from '../lib/storage.mjs';
import { THEME_KEY } from '../lib/theme.mjs';
import { createGame } from '../app.mjs';

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
// A tiny globe: act a0 is region Zero (countries XXX, YYY and AAA, which has no level), a1 is One.
const GLOBE_MAP = {
  ACT_REGIONS: { a0: { region: 'Zero' }, a1: { region: 'One' } },
  LEVEL_COUNTRY: { x: 'XXX', y: 'YYY', z: 'ZZZ' },
  actOf: (iso) => ({ XXX: 'a0', YYY: 'a0', AAA: 'a0', ZZZ: 'a1' })[iso] ?? null,
};
const DOTS = [[10, 0, 'XXX', ''], [12, 2, 'XXX', ''], [0, 20, 'YYY', ''], [5, 10, 'AAA', ''], [-30, 120, 'ZZZ', ''], [40, -60, 'QQQ', '']];
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A fake globe renderer: records mounts, updates and disposals; `result` decides what a mount gives. */
function fakeGlobe(result = 'handle') {
  const log = { mounts: [], updates: [], disposed: 0, handles: [] };
  const mount = async (host, view) => {
    log.mounts.push({ host: host.className, dots: view.dots, states: [...view.states], actId: view.target?.actId ?? null, reduced: view.reduced, onFail: view.onFail });
    if (result === 'throw') throw new Error('three.js failed to load');
    if (result === null) return null;
    const handle = {
      update: (states, target) => log.updates.push({ states: [...states], actId: target?.actId ?? null }),
      dispose: () => log.disposed++,
    };
    log.handles.push(handle);
    return handle;
  };
  return { mount, log };
}

function setup({ initial, throwOn, storage, registry = REG, reduceMotion = true, globe, window } = {}) {
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
    dots: DOTS,
    window,
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

test('focus returns to the level card after closing the level and after the reward', () => {
  const { game, dom } = setup();
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

test('completion: stored with its stars, done, its country lit, totals and reward updated', () => {
  const { game, store } = setup();
  assert.deepEqual(game.stars, { earned: 0, max: 15 });
  game.openLevel('x');
  ctxs.x.mistake();
  const result = ctxs.x.finish({ text: 'You lit up checkout.', cards: ['c1'] });
  assert.equal(result.stars, 2);
  assert.deepEqual(stored(store).levels.x, { stars: 2, at: AT });
  assert.deepEqual(stored(store).cards, ['c1']);
  assert.equal(game.levelState('x'), 'done');
  const map = game.mapState();
  assert.equal(map.countries.XXX.lit, true);
  assert.equal(map.countries.YYY.lit, false);
  assert.equal(map.regions.a0.done, 1);
  assert.deepEqual(game.stars, { earned: 2, max: 15 });
  assert.deepEqual(game.cards, { earned: 1, max: 1 });
  assert.equal(game.overlayOpen, false);
  assert.equal(ctxs.x.signal.aborted, true, 'finishing ends the session');
  assert.equal(game.rewardOpen, true);
  assert.equal(game.rewardTitle, 'Title x');
  assert.equal(game.rewardText, 'You lit up checkout.');
  assert.equal(game.rewardStars, 2);
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

// ---- other tabs ------------------------------------------------------------------

test('a storage event merges another tab\'s progress into memory', () => {
  const { game, store } = setup();
  game.openLevel('x');
  ctxs.x.finish({ text: 'x finished here' });
  // Another tab writes a record that lacks x (e.g. it never saw this tab's write).
  store.data.set(STORAGE_KEY, v1({ y: { stars: 3, at: AT } }));
  game.onStorage({ key: STORAGE_KEY });
  assert.equal(game.progress.levels.y.stars, 3);
  assert.equal(game.progress.levels.x.stars, 3, 'memory keeps its own completions');
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
  assert.equal(stored(store).levels.x.stars, 3);
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

test('level labels and classes cover every state', () => {
  const { game } = setup({ initial: { [STORAGE_KEY]: v1({ y: { stars: 2, at: null } }) } });
  assert.match(game.levelLabel('x'), /^0\.1: Level x\. .*ready to play$/);
  assert.match(game.levelLabel('y'), /done, play again$/);
  assert.match(game.levelLabel('z'), /locked$/);
  assert.equal(game.levelClasses('x'), 'open');
  assert.equal(game.levelClasses('y'), 'done');
  assert.equal(game.levelClasses('z'), 'locked');
  game.openLevel('z');
  assert.equal(game.levelClasses('z'), 'locked nudge');
  assert.equal(game.starText('y'), '★★☆');
});

test('the globe text alternative counts levels done and names the lit regions', () => {
  const { game } = setup();
  assert.equal(game.mapLabel(), 'World map: 0 of 5 levels done.');
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished now' });
  assert.equal(game.mapLabel(), 'World map: 1 of 5 levels done. Lit: Zero 1 of 4.');
  assert.deepEqual(game.globeLines(), ['Act 0, First act (Zero): 1 of 4 done', 'Act 1, Second act (One): 0 of 1 done']);
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

test('index.html: the level overlay elements live inside an x-ignore wrapper', () => {
  for (const id of ['ov-body', 'ov-actions']) {
    const el = shell.getElementById(id);
    assert.ok(el, `#${id} exists`);
    assert.ok(el.closest('[x-ignore]'), `#${id} is inside [x-ignore]`);
  }
});

test('index.html: the globe stage is a named image, with a legend and a text fallback, and no style', () => {
  assert.equal(shell.querySelector('svg.system-map') === null, true, 'the SVG system map is gone');
  const stage = shell.querySelector('.globe .globe-stage');
  assert.ok(stage, '.globe-stage inside .globe');
  assert.equal(stage.getAttribute('role'), 'img');
  assert.equal(stage.getAttribute(':aria-label'), 'mapLabel()');
  assert.equal(shell.querySelector('.globe').getAttribute('x-show'), '!globeFallback');
  const legend = shell.querySelector('.globe-legend').textContent.replace(/\s+/g, ' ').trim();
  assert.equal(legend, 'Lit: level completed Pulsing: incident open Not reached');
  const fallback = shell.querySelector('ul.globe-fallback');
  assert.equal(fallback.getAttribute('x-show'), 'globeFallback');
  assert.equal(fallback.querySelector('template').getAttribute('x-for'), 'line in globeLines()');
  for (const el of [shell.querySelector('.map-panel'), ...shell.querySelectorAll('.map-panel *')]) {
    assert.ok(!el.hasAttribute('style') && !el.hasAttribute(':style'), 'no style on the map panel');
  }
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
  const hub = shell.querySelector('.hub');
  assert.ok(hub, '.hub wrapper exists');
  assert.equal(hub.getAttribute(':inert'), 'overlayOpen || rewardOpen');
  for (const sel of ['.hub-header', '.globe-stage', '.globe-fallback', '.levels']) {
    assert.ok(hub.querySelector(sel), `${sel} is inside .hub`);
  }
  for (const sel of ['.overlay', '.reward']) {
    assert.equal(shell.querySelector(sel).closest('.hub') === null, true, `${sel} is outside .hub`);
  }
  assert.equal(shell.querySelector('.app').getAttribute('@keydown.escape.window'), 'onEscape($event)');
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
