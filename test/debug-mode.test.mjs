// ?mode=debug (#162): every level opens, nothing is saved, the reward says so. Normal play
// (no parameter) keeps its locks and its saves. app.mjs createGame takes `debug` as a dep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom } from './helpers/dom.mjs';
import { fakeStorage } from './helpers/fake-storage.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { STORAGE_KEY } from '../lib/storage.mjs';
import { createGame } from '../app.mjs';
import { isDebugMode } from '../lib/debug-mode.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

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
    ctx.renderStep(`<p>${id}</p>`, '<button data-finish>Finish</button>');
  },
  ...extra,
});
const BOSS = L('boss', null);
const REG = buildRegistry(
  [
    { id: 'a0', no: 0, name: 'First act', levels: [L('x', '0.1'), L('y', '0.2')], boss: BOSS },
    { id: 'a1', no: 1, name: 'Second act', levels: [L('z', '1.1')], boss: null },
  ],
  { deck: [], nodeIds: [] },
);

function setup({ debug, initial } = {}) {
  const dom = makeDom(html);
  const store = fakeStorage({ initial });
  ctxs = {};
  const game = createGame({
    registry: REG,
    deck: [],
    storage: () => store,
    document: dom.document,
    now: () => 1767225600000,
    rand: () => 0,
    reduceMotion: () => true,
    reportError: (e) => assert.fail(e),
    setTimeout: () => {},
    clearTimeout: () => {},
    debug,
  });
  return { game, store, dom };
}

test('isDebugMode is true only for mode=debug exactly', () => {
  assert.equal(isDebugMode('?mode=debug'), true);
  assert.equal(isDebugMode('?a=1&mode=debug'), true);
  for (const s of ['', '?', '?mode=', '?mode=Debug', '?mode=debug2', '?mode=debugger', '?mode=off', '?debug', '?debug=1', '?xmode=debug', '?mode=%20debug']) {
    assert.equal(isDebugMode(s), false, s);
  }
  assert.equal(isDebugMode(undefined), false);
  assert.equal(isDebugMode(null), false);
});

test('without debug a locked level and a locked boss stay locked', () => {
  const { game } = setup({ debug: false });
  assert.equal(game.levelState('z'), 'locked');
  assert.equal(game.levelState('boss'), 'locked');
  assert.equal(game.openLevel('z'), false);
  assert.equal(game.openLevel('boss'), false);
  assert.equal(game.overlayOpen, false);
  assert.equal(game.debug, false);
});

test('with debug a locked level and a locked boss open', () => {
  const { game } = setup({ debug: true });
  assert.equal(game.levelState('z'), 'open');
  assert.equal(game.openLevel('z'), true);
  assert.equal(game.overlayOpen, true);
  assert.ok(ctxs.z, 'the level ran');
  game.closeOverlay();
  assert.equal(game.openLevel('boss'), true);
  assert.ok(ctxs.boss);
});

test('debug keeps saved state: a completed level is still done, an unknown id stays locked', () => {
  const initial = { [STORAGE_KEY]: JSON.stringify({ v: 1, levels: { x: { stars: 3, at: '2026-01-01T00:00:00.000Z' } }, cards: [] }) };
  const { game } = setup({ debug: true, initial });
  assert.equal(game.levelState('x'), 'done');
  assert.equal(game.levelState('nope'), 'locked');
  assert.equal(game.openLevel('nope'), false);
});

test('a debug finish writes nothing, shows the reward and says it is not saved', () => {
  const { game, store } = setup({ debug: true });
  game.openLevel('boss');
  ctxs.boss.finish({ text: 'You beat the boss.' });
  assert.equal(store.sets.length, 0, 'no write at all');
  assert.equal(store.data.has(STORAGE_KEY), false);
  assert.equal(game.levelState('boss'), 'open', 'no completion recorded');
  assert.deepEqual(game.stars, { earned: 0, max: game.stars.max });
  assert.equal(game.rewardOpen, true);
  assert.equal(game.rewardTitle, 'Title boss');
  assert.equal(game.rewardText, 'You beat the boss.');
  assert.equal(game.rewardNote(), 'Debug run: not saved.');
});

test('a debug finish leaves already-saved progress exactly as it was', () => {
  const saved = JSON.stringify({ v: 1, levels: { x: { stars: 3, at: '2026-01-01T00:00:00.000Z' } }, cards: [] });
  const { game, store } = setup({ debug: true, initial: { [STORAGE_KEY]: saved } });
  game.openLevel('y');
  ctxs.y.finish({ text: 'y is finished here' });
  assert.equal(store.data.get(STORAGE_KEY), saved);
  assert.equal(store.sets.length, 0);
});

test('a normal finish still saves and carries no debug note', () => {
  const { game, store } = setup({ debug: false });
  game.openLevel('x');
  ctxs.x.finish({ text: 'x is finished here' });
  assert.ok(JSON.parse(store.data.get(STORAGE_KEY)).levels.x);
  assert.equal(game.levelState('x'), 'done');
  assert.equal(game.rewardNote(), '');
});

test('debug defaults to off when the dep is absent', () => {
  const { game } = setup();
  assert.equal(game.debug, false);
  assert.equal(game.levelState('z'), 'locked');
});
