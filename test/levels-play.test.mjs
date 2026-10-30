// Plays every registered level in a linkedom DOM the way a player would click through
// it, with the real ctx (lib/level-context.mjs). Catches a dead end, a wrong-wired
// button or a level that never finishes, before it ships. Spec: docs/FOUNDATION.md
// §6 F3 levels-play.
//
// TO ADD A LEVEL: add DRIVERS['<id>'] below with a happy run and a sloppy run. The
// "every level has a driver" test fails until the driver exists.
//   play()   clicks through with q / qa and the click / clickUntil below
//   expect   { stars, cards } that run must earn
//   sloppy   { play(), expect } a run with mistakes or hints that earns fewer stars
//            (optional for an unscored level; if present it must earn 0 too)
// Drivers click with this file's click / clickUntil (they record the last click).
// The Finish button carries `data-finish`: the first screen must not show it
// enabled, and finish() must come from a click on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click as domClick } from './helpers/dom.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { ACTS } from '../levels/index.mjs';
import { DECK } from '../cards/deck.mjs';
import fixtureLevel, { FIXTURE_CARD } from './fixtures/fixture-level.mjs';
import * as V from './fixtures/variant-levels.mjs';

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

// The last element clicked during a play-through, so a finish can be traced to the
// click that caused it. Drivers use these wrappers, not ./helpers/dom.mjs directly.
let lastClick = null;

/** dom.mjs click, recording whether the clicked element was the Finish button. */
function click(elOrSel) {
  const el = typeof elOrSel === 'string' ? q(elOrSel) : elOrSel;
  lastClick = { sel: String(elOrSel), finish: !!el?.matches?.('[data-finish]') };
  domClick(elOrSel);
}

/** Click `sel` then `next` each round until `until` exists (at most `max` rounds). */
function clickUntil(sel, next, until, max = 30) {
  for (let i = 0; i < max && !q(until); i++) {
    click(sel);
    click(next);
  }
  assert.ok(q(until), `never reached ${until}`);
}

/** Run a level with the real ctx, play it synchronously, return what happened. */
function playLevel(level, play) {
  const dom = makeDom();
  const calls = [];
  const steps = [];
  lastClick = null;
  const ctx = createLevelContext({
    level,
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => NOW,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (id, result) => calls.push({ id, result, via: lastClick }),
    signal: new AbortController().signal,
    reportError: (e) => {
      throw e;
    },
  });
  const render = ctx.renderStep;
  ctx.renderStep = (body, actions) => {
    steps.push(`${body}${actions ?? ''}`);
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

/** True when `html` holds a [data-finish] element (a real query, not a substring). */
function hasFinish(html) {
  const box = globalThis.document.createElement('div');
  box.innerHTML = html;
  return box.querySelector('[data-finish]') !== null;
}

/** Every check a play-through must pass; returns the stars earned. */
function checkRun(level, run) {
  const { calls, steps, first } = playLevel(level, run.play);
  assert.ok(first.rendered >= 1, 'run() renders a first step');
  assert.equal(first.finishEnabled, false, 'the first screen has no enabled Finish');
  assert.equal(first.finishedEarly, 0, 'run() alone does not finish');
  assert.equal(calls.length, 1, 'onFinish is called exactly once');
  const { id, result, via } = calls[0];
  assert.ok(via?.finish, `finished from a [data-finish] click, not from ${via?.sel ?? 'no click'}`);
  assert.equal(id, level.id);
  assert.deepEqual({ stars: result.stars, cards: result.cards }, run.expect);
  for (const c of result.cards) {
    assert.ok(level.cards.includes(c), `card ${c} is not in level.cards`);
  }
  assert.ok(result.text.length > 10, 'finish carries reward text');
  assert.ok(!result.text.includes('\u2014'), 'reward text has an em dash');
  assert.ok(steps.some(hasFinish), 'some step shows a Finish button ([data-finish])');
  for (const s of steps) {
    assert.ok(/<button|<input/.test(s), `step has nothing to click: ${s.slice(0, 80)}`);
    assert.ok(!s.includes('\u2014'), `step copy has an em dash: ${s.slice(0, 80)}`);
  }
  return result.stars;
}

/** Happy run, then sloppy: required and worse for scored levels; optional and 0 if unscored. */
function checkLevel(level, driver) {
  const happy = checkRun(level, driver);
  if (!driver.sloppy) {
    assert.ok(!level.scored, `DRIVERS["${level.id}"] needs a sloppy run`);
    return;
  }
  const sloppy = checkRun(level, driver.sloppy);
  if (!level.scored) {
    assert.equal(sloppy, 0, 'an unscored level earns 0 stars on any run');
    return;
  }
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
    checkLevel(LIVE.levels[id], DRIVERS[id]);
  });
}

// ---- harness teeth: fixture levels prove the checks above can fail ------------

const FIXTURES = buildRegistry(
  [
    {
      id: 'fixture-act',
      no: 0,
      levels: [
        fixtureLevel,
        V.UNSCORED,
        V.FINISH_ON_FIRST_SCREEN,
        V.FINISH_FROM_OTHER,
        V.FINISH_IN_RUN,
        V.CARD_OUTSIDE,
        V.FINISH_OUTSIDE_RENDER,
      ],
      boss: null,
    },
  ],
  { deck: [FIXTURE_CARD], nodeIds: [] },
).levels;
const FIXTURE = FIXTURES['fixture-level'];

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
  assert.equal(calls[0].result.stars, 3);
  checkLevel(FIXTURE, FIXTURE_DRIVER);
});

test('harness: an unscored level passes without a sloppy run, or with one that earns 0', () => {
  const lvl = FIXTURES['fx-unscored'];
  const zero = { stars: 0, cards: ['fixture-card'] };
  const happy = { play: FIXTURE_DRIVER.play, expect: zero };
  checkLevel(lvl, happy);
  checkLevel(lvl, { ...happy, sloppy: { play: FIXTURE_DRIVER.sloppy.play, expect: zero } });
});

test('harness: clicking a missing element throws naming the selector', () => {
  assert.throws(() => playLevel(FIXTURE, () => click('#missing')), /#missing/);
});

test('harness: clicking a disabled button throws "disabled"', () => {
  assert.throws(() => playLevel(FIXTURE, () => click('#fx-next')), /disabled/);
});

test('harness: clickUntil clicks through to its target and records the clicks', () => {
  playLevel(FIXTURE, () => {
    clickUntil('[data-pick="trace"]', '#fx-next', '#fx-finish', 3);
    click('#fx-finish');
  });
  assert.throws(
    () => playLevel(FIXTURE, () => clickUntil('[data-pick="metric"]', '#fx-feedback', '#nope', 2)),
    /no click handler|never reached/,
  );
});

test('harness: a driver that never finishes fails the run', () => {
  assert.throws(
    () => checkRun(FIXTURE, { play() {}, expect: FIXTURE_DRIVER.expect }),
    /exactly once/,
  );
});

test('harness: a first screen with an enabled Finish fails', () => {
  const lvl = FIXTURES['fx-first-finish'];
  assert.throws(
    () => checkRun(lvl, { play: () => click('#ff'), expect: { stars: 3, cards: [] } }),
    /first screen has no enabled Finish/,
  );
});

test('harness: finishing inside run() fails', () => {
  const lvl = FIXTURES['fx-run-finish'];
  assert.throws(
    () => checkRun(lvl, { play() {}, expect: { stars: 3, cards: [] } }),
    /run\(\) alone does not finish/,
  );
});

test('harness: finishing from a button that is not the Finish button fails', () => {
  const lvl = FIXTURES['fx-other-button'];
  assert.throws(
    () => checkRun(lvl, { play: () => click('#go'), expect: { stars: 3, cards: [] } }),
    /finished from a \[data-finish\] click/,
  );
});

test('harness: awarding a card the level does not list fails', () => {
  const lvl = FIXTURES['fx-card-outside'];
  assert.throws(
    () =>
      checkRun(lvl, {
        play: () => (click('#go'), click('#fin')),
        expect: { stars: 3, cards: ['other-card'] },
      }),
    /not in level.cards/,
  );
});

test('harness: a Finish named only in text, never rendered as an element, fails', () => {
  const lvl = FIXTURES['fx-outside-render'];
  assert.throws(
    () =>
      checkRun(lvl, { play: () => (click('#go'), click('#fin')), expect: { stars: 3, cards: [] } }),
    /some step shows a Finish button/,
  );
});

test('harness: a wrong expectation, a missing sloppy run or an equal sloppy run fails', () => {
  const wrong = { stars: 2, cards: ['fixture-card'] };
  assert.throws(() => checkRun(FIXTURE, { ...FIXTURE_DRIVER, expect: wrong }));
  const noSloppy = { play: FIXTURE_DRIVER.play, expect: FIXTURE_DRIVER.expect };
  assert.throws(() => checkLevel(FIXTURE, noSloppy), /needs a sloppy run/);
  assert.throws(
    () => checkLevel(FIXTURE, { ...FIXTURE_DRIVER, sloppy: FIXTURE_DRIVER }),
    /fewer stars/,
  );
});
