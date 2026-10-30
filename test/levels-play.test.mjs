// Plays every registered level in a linkedom DOM the way a player would click through
// it, with the real ctx (lib/level-context.mjs). Catches a dead end, a wrong-wired
// button or a level that never finishes, before it ships. Spec: docs/FOUNDATION.md
// §6 F3 levels-play.
//
// TO ADD A LEVEL: add DRIVERS['<id>'] below with a happy run and a sloppy run. The
// "every level has a driver" test fails until the driver exists.
//   play()   clicks through with q / qa / click / clickUntil from ./helpers/dom.mjs
//   expect   { stars, cards } that run must earn
//   sloppy   { play(), expect } a run with mistakes or hints that earns fewer stars
// The Finish button carries a `data-finish` attribute; the first screen must not
// show it enabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, qa, click } from './helpers/dom.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { ACTS } from '../levels/index.mjs';
import { DECK } from '../cards/deck.mjs';
import fixtureLevel, { FIXTURE_CARD } from './fixtures/fixture-level.mjs';

const NOW = 1767225600000;

/** One driver per registered level id. */
const DRIVERS = {};

// nodeIds is empty until F5 adds hub/map-data.mjs; then pass the real node ids here.
const LIVE = buildRegistry(ACTS, { deck: DECK, nodeIds: [] });

/** Ids registered without a driver, and drivers for ids that are not registered. */
function driverGaps(order, drivers) {
  const ids = new Set(order);
  const keys = Object.keys(drivers);
  return {
    missing: order.filter((id) => !Object.hasOwn(drivers, id)),
    extra: keys.filter((id) => !ids.has(id)),
  };
}

/** Run a level with the real ctx, play it synchronously, return what happened. */
function playLevel(level, play) {
  const dom = makeDom();
  const calls = [];
  const steps = [];
  const ctx = createLevelContext({
    level,
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => NOW,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (...args) => calls.push(args),
    signal: new AbortController().signal,
  });
  const render = ctx.renderStep;
  ctx.renderStep = (body, actions = '') => {
    steps.push(body + actions);
    render(body, actions);
  };
  level.run(ctx);
  const first = {
    rendered: steps.length,
    finishEnabled: qa('[data-finish]').some((b) => !b.disabled),
    finishedEarly: calls.length,
  };
  play();
  return { calls, steps, first };
}

/** Every check a play-through must pass; returns the stars earned. */
function checkRun(level, run) {
  const { calls, steps, first } = playLevel(level, run.play);
  assert.ok(first.rendered >= 1, 'run() renders a first step');
  assert.equal(first.finishEnabled, false, 'the first screen has no enabled Finish');
  assert.equal(first.finishedEarly, 0, 'run() alone does not finish');
  assert.equal(calls.length, 1, 'onFinish is called exactly once');
  const [id, result] = calls[0];
  assert.equal(id, level.id);
  assert.deepEqual({ stars: result.stars, cards: result.cards }, run.expect);
  for (const c of result.cards) {
    assert.ok(level.cards.includes(c), `card ${c} is not in level.cards`);
  }
  assert.ok(result.text.length > 10, 'finish carries reward text');
  assert.ok(!result.text.includes('\u2014'), 'reward text has an em dash');
  assert.ok(
    steps.some((s) => s.includes('data-finish')),
    'some step shows a Finish button (data-finish)',
  );
  for (const s of steps) {
    assert.ok(/<button|<input/.test(s), `step has nothing to click: ${s.slice(0, 80)}`);
    assert.ok(!s.includes('\u2014'), `step copy has an em dash: ${s.slice(0, 80)}`);
  }
  return result.stars;
}

function checkLevel(level, driver, { requireSloppy }) {
  const happy = checkRun(level, driver);
  if (!driver.sloppy) {
    assert.ok(!requireSloppy, `DRIVERS["${level.id}"] needs a sloppy run`);
    return;
  }
  const sloppy = checkRun(level, driver.sloppy);
  assert.ok(sloppy < happy, `sloppy run (${sloppy}) must score fewer stars than happy (${happy})`);
}

test('every registered level has a driver and every driver is registered', () => {
  assert.deepEqual(driverGaps(LIVE.order, DRIVERS), { missing: [], extra: [] });
});

test('driverGaps catches a missing driver and a driver without a level', () => {
  assert.deepEqual(driverGaps(['a', 'b'], { a: {}, c: {} }), { missing: ['b'], extra: ['c'] });
  assert.deepEqual(driverGaps([], {}), { missing: [], extra: [] });
});

for (const id of LIVE.order) {
  test(`level "${id}" plays through (happy and sloppy)`, () => {
    checkLevel(LIVE.levels[id], DRIVERS[id], { requireSloppy: true });
  });
}

// ---- harness teeth: a fixture level proves the checks above can fail ----------

const FIXTURE = buildRegistry(
  [{ id: 'fixture-act', no: 0, levels: [fixtureLevel], boss: null }],
  { deck: [FIXTURE_CARD], nodeIds: [] },
).levels['fixture-level'];

const FIXTURE_DRIVER = {
  play() {
    click('[data-pick="trace"]');
    click('#fx-next');
    click('#fx-finish');
  },
  expect: { stars: 3, cards: ['fixture-card'] },
  sloppy: {
    play() {
      click('[data-pick="metric"]');
      click('[data-pick="trace"]');
      click('#fx-next');
      click('#fx-finish');
    },
    expect: { stars: 2, cards: ['fixture-card'] },
  },
};

test('harness: the fixture level finishes once with 3 stars, sloppy with 2', () => {
  const { calls } = playLevel(FIXTURE, FIXTURE_DRIVER.play);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].stars, 3);
  checkLevel(FIXTURE, FIXTURE_DRIVER, { requireSloppy: true });
});

test('harness: clicking a missing element throws naming the selector', () => {
  assert.throws(() => playLevel(FIXTURE, () => click('#missing')), /#missing/);
});

test('harness: clicking a disabled button throws "disabled"', () => {
  assert.throws(() => playLevel(FIXTURE, () => click('#fx-next')), /disabled/);
});

test('harness: a driver that never finishes fails the run', () => {
  assert.throws(
    () => checkRun(FIXTURE, { play() {}, expect: FIXTURE_DRIVER.expect }),
    /exactly once/,
  );
});

test('harness: a wrong expectation or a missing sloppy run fails', () => {
  const wrong = { stars: 2, cards: ['fixture-card'] };
  assert.throws(() => checkRun(FIXTURE, { ...FIXTURE_DRIVER, expect: wrong }));
  const noSloppy = { play: FIXTURE_DRIVER.play, expect: FIXTURE_DRIVER.expect };
  assert.throws(
    () => checkLevel(FIXTURE, noSloppy, { requireSloppy: true }),
    /sloppy/,
  );
  assert.throws(
    () => checkLevel(FIXTURE, { ...FIXTURE_DRIVER, sloppy: FIXTURE_DRIVER }, {
      requireSloppy: true,
    }),
    /fewer stars/,
  );
});
