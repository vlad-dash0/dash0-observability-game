// "Coming soon" acts on the live data (#177 P7). The list in hub/coming-soon.mjs is empty now: Act 7
// left it with 7.1 and Act 8 with 8.1 to 8.4. It stays, never in levels/index.mjs ACTS, so a future soon act
// is invisible to the registry, unlock, progress, stars and cards; only the hub's act list and the
// globe read it. The mechanism itself, for any list, is covered by fixtures in test/game.test.mjs and
// test/globe-view.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom } from './helpers/dom.mjs';
import { fakeStorage } from './helpers/fake-storage.mjs';
import { COMING_SOON } from '../hub/coming-soon.mjs';
import { ACT_REGIONS, actOfCountry } from '../hub/globe-map.mjs';
import { COUNTRIES, DOTS } from '../hub/globe-data.mjs';
import { createGame, liveRegistry } from '../app.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { DOT, globeTarget } from '../lib/globe-view.mjs';
import { STORAGE_KEY } from '../lib/storage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const SOON_IDS = COMING_SOON.map((s) => s.id);

function liveGame(extra = {}) {
  const store = fakeStorage();
  const game = createGame({
    registry: liveRegistry(),
    storage: () => store,
    document: makeDom(HTML).document,
    now: () => 1767225600000,
    rand: () => 0,
    reportError: (e) => {
      throw e;
    },
    ...extra,
  });
  return { game, store };
}

test('COMING_SOON is empty and frozen; acts 7 and 8 are in ACTS', () => {
  assert.deepEqual([...COMING_SOON], []);
  assert.equal(Object.isFrozen(COMING_SOON), true, 'the list is frozen');
  const live = liveRegistry();
  assert.deepEqual(live.acts.filter((a) => a.no === 7 || a.no === 8).map((a) => a.id), ['act-7', 'act-8']);
});

test('Never in the registry', () => {
  const live = liveRegistry();
  for (const s of COMING_SOON) {
    assert.equal(
      live.acts.some((a) => a.id === s.id || a.no === s.no),
      false,
      `${s.id} is in ACTS and COMING_SOON: delete its COMING_SOON entry`,
    );
    assert.equal(Object.hasOwn(live.levels, s.id), false, `${s.id} is not a level id`);
  }
});

test('no two acts share a subregion', () => {
  assert.equal(ACT_REGIONS['act-7'].region, 'East Asia');
  assert.equal(ACT_REGIONS['act-8'].region, 'Southeast Asia');
  for (const id of ['act-7', 'act-8']) {
    assert.ok(DOTS.filter((d) => actOfCountry(d[2], d[3]) === id).length > 0, `${id} has dots on the globe`);
  }
  const entries = Object.entries(ACT_REGIONS);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const shared = entries[i][1].subregions.filter((s) => entries[j][1].subregions.includes(s));
      assert.deepEqual(shared, [], `${entries[i][0]} and ${entries[j][0]} share subregions`);
    }
  }
});

test('the live hub lists no soon act; acts 7 and 8 are playable, even a debug hub opens them', () => {
  const { game, store } = liveGame({ debug: true });
  assert.equal(game.acts.filter((a) => a.soon).length, 0);
  const nos = game.acts.map((a) => a.no);
  assert.equal(nos.every((n, i) => i === 0 || n > nos[i - 1]), true, `act numbers increase: ${nos}`);
  const act8 = game.acts.find((a) => a.id === 'act-8');
  assert.equal(act8.soon, false, 'act-8 is a playable act on the hub');
  assert.deepEqual([...act8.ids], ['dashboards-as-code', 'semantic-convention-versions', 'migrating-vendors', 'frontend-rum']);
  assert.deepEqual([...game.acts.find((a) => a.id === 'act-7').ids], ['good-alerts', 'slis-and-slos', 'burn-rate-alerts', 'synthetic-checks', 'everything-is-green']);
  assert.equal(game.nudgeId, null);
  assert.equal(game.overlayOpen, false);
  assert.equal(store.data.has(STORAGE_KEY), false);
  assert.equal(game.mapLabel(), `World map: 0 of ${liveRegistry().order.length} levels done.`);
});

test('no live globe dot is SOON', () => {
  const { game } = liveGame();
  const states = game.globeView().states;
  assert.equal(states.length, DOTS.length);
  assert.equal(states.every((s) => s !== DOT.SOON), true);
  const live = liveRegistry();
  const p = emptyProgress();
  for (const id of live.order) p.levels[id] = { stars: 3, at: null };
  assert.equal(globeTarget(live, p, DOTS).actId, live.acts[live.acts.length - 1].id);
});
