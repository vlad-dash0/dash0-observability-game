// Acts 7 and 8 as "coming soon" on the live data (epic #177 P7). They live in hub/coming-soon.mjs,
// never in levels/index.mjs ACTS, so the registry, unlock, progress, stars and cards cannot see
// them; only the hub's act list and the globe read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom } from './helpers/dom.mjs';
import { fakeStorage } from './helpers/fake-storage.mjs';
import { COMING_SOON } from '../hub/coming-soon.mjs';
import { ACT_REGIONS, LEVEL_COUNTRY, actOfCountry } from '../hub/globe-map.mjs';
import { COUNTRIES, DOTS } from '../hub/globe-data.mjs';
import { createGame, liveRegistry } from '../app.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { DOT, globeTarget } from '../lib/globe-view.mjs';
import { STORAGE_KEY } from '../lib/storage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const SOON_IDS = ['act-7', 'act-8'];

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

test('Acts 7 and 8 from the outline, data only', () => {
  assert.deepEqual(COMING_SOON, [
    {
      id: 'act-7',
      no: 7,
      name: 'Alerting and SLOs',
      sub: 'Wake me only when it matters',
      teaser: 'Good alerts, SLOs and error budgets, burn-rate alerts and synthetic checks.',
    },
    {
      id: 'act-8',
      no: 8,
      name: 'Operating at scale',
      sub: 'As code',
      teaser:
        'Dashboards as code, semantic convention upgrades, migrating vendors, browser telemetry and AI-assisted debugging.',
    },
  ]);
  assert.equal(Object.isFrozen(COMING_SOON), true, 'the list is frozen');
  for (const s of COMING_SOON) {
    assert.equal(Object.isFrozen(s), true, `${s.id} is frozen`);
    assert.deepEqual(Object.keys(s), ['id', 'no', 'name', 'sub', 'teaser'], `${s.id} has no levels or boss`);
  }
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

test('Each has its own region with dots and no level country', () => {
  assert.equal(ACT_REGIONS['act-7'].region, 'East Asia');
  assert.equal(ACT_REGIONS['act-8'].region, 'Southeast Asia');
  for (const id of SOON_IDS) {
    assert.ok(DOTS.filter((d) => actOfCountry(d[2], d[3]) === id).length > 0, `${id} has dots on the globe`);
  }
  const subregionOf = Object.fromEntries(COUNTRIES);
  for (const [level, iso] of Object.entries(LEVEL_COUNTRY)) {
    assert.equal(SOON_IDS.includes(actOfCountry(iso, subregionOf[iso])), false, `${level} (${iso}) is in a soon region`);
  }
  const entries = Object.entries(ACT_REGIONS);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const shared = entries[i][1].subregions.filter((s) => entries[j][1].subregions.includes(s));
      assert.deepEqual(shared, [], `${entries[i][0]} and ${entries[j][0]} share subregions`);
    }
  }
});

test('The live hub lists them in act order, unplayable even in debug, changing no total', () => {
  const { game, store } = liveGame({ debug: true });
  for (const s of COMING_SOON) {
    const act = game.acts.find((a) => a.id === s.id);
    assert.ok(act, `${s.id} is listed`);
    assert.equal(act.soon, true);
    assert.deepEqual(act.ids, []);
    assert.equal(act.teaser, s.teaser);
  }
  assert.equal(game.acts.filter((a) => a.soon).length, COMING_SOON.length, 'no registry act is soon');
  const nos = game.acts.map((a) => a.no);
  assert.equal(nos.every((n, i) => i === 0 || n > nos[i - 1]), true, `act numbers increase: ${nos}`);
  assert.equal(game.levelState('act-7'), 'locked');
  assert.equal(game.openLevel('act-7'), false);
  assert.equal(game.nudgeId, null);
  assert.equal(game.overlayOpen, false);
  assert.equal(store.data.has(STORAGE_KEY), false);
  const without = liveGame({ debug: true, comingSoon: [] }).game;
  assert.deepEqual(game.stars, without.stars);
  assert.deepEqual(game.cards, without.cards);
  assert.equal(without.acts.some((a) => a.soon), false, 'an empty list adds no act');
});

test('Live globe: soon regions dimmed, not counted, not targeted', () => {
  const live = liveRegistry();
  const { game } = liveGame();
  const states = game.globeView().states;
  assert.equal(states.length, DOTS.length);
  let soonDots = 0;
  DOTS.forEach((d, k) => {
    const isSoon = SOON_IDS.includes(actOfCountry(d[2], d[3]));
    if (isSoon) soonDots++;
    assert.equal(states[k] === DOT.SOON, isSoon, `dot ${k} (${d[2]}, ${d[3]})`);
  });
  assert.ok(soonDots > 0);
  const label = game.mapLabel();
  assert.equal(label, `World map: 0 of ${live.order.length} levels done. Coming soon: East Asia, Southeast Asia.`);
  const p = emptyProgress();
  for (const id of live.order) p.levels[id] = { stars: 3, at: null };
  assert.equal(globeTarget(live, p, DOTS).actId, live.acts[live.acts.length - 1].id);
});
