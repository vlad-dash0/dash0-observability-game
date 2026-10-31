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
import { liveRegistry } from '../app.mjs';
import fixtureLevel, { FIXTURE_CARD } from './fixtures/fixture-level.mjs';
import * as V from './fixtures/variant-levels.mjs';

const NOW = 1767225600000;

/** Type `text` into the textarea `sel` (what the player sees is its value). */
function type(sel, text) {
  const el = q(sel);
  assert.ok(el, `expected an element for ${sel}`);
  assert.ok(!el.disabled, `${sel} is disabled`);
  el.value = text;
}

const FIXED_ENV = [
  'OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318',
  'OTEL_SERVICE_NAME=checkout',
  'OTEL_RESOURCE_ATTRIBUTES=service.version=1.4.2,deployment.environment.name=production',
].join('\n');

/** Sort every `[item, bucket]` pair with this file's click (item, then bucket). */
function sortAll(pairs) {
  for (const [item, bucket] of pairs) {
    click(`[data-item="${item}"]`);
    click(`[data-bucket="${bucket}"]`);
  }
}

// Act 0 answers (docs/M1-DESIGN.md §6), spelled out here so a wrong key in a level fails.
const MVO_SORT = [['cpu', 'known'], ['5xx', 'known'], ['disk', 'known'], ['ios', 'new'], ['cust', 'new'], ['coupon', 'new']];
const SIG_DATA = [['duration', 'metric'], ['cpu-time', 'metric'], ['declined', 'log'], ['checkout-span', 'trace'], ['stacks', 'profile']];
const SIG_ASK = [['rps', 'metric'], ['slow-call', 'trace'], ['provider', 'log'], ['cpu-fn', 'profile']];
const OTEL_PARTS = [['start-span', 'api'], ['batch', 'sdk'], ['wire', 'otlp'], ['pipeline', 'collector'], ['method', 'semconv']];

// Act 2 answers (docs/M1-DESIGN.md §6), span ids spelled out here so a wrong id in a level fails.
// 2.1 (trace 4bf9...): B under A, C under B, D under C; E (trace 0af7...) stays a root.
const SAT_TREE = [['b7ad6b7169203331', '00f067aa0ba902b7'], ['53995c3f42cd8ad8', 'b7ad6b7169203331'], ['1d5c3a2f8e4b6a90', '53995c3f42cd8ad8']];
// 2.2: checkout POST /checkout, POST payments; payments POST /charge, POST provider/charges;
// orders publish; shipping orders process. checkout compute totals stays INTERNAL.
const KINDS_MAP = [
  ['3a7f5c9e1b2d4f60', 'SERVER'], ['6c2d8e0f4a1b3957', 'CLIENT'], ['b5f3a1c7e9d20486', 'SERVER'],
  ['0d9e7c5b3a1f8264', 'CLIENT'], ['f1e2d3c4b5a69788', 'PRODUCER'], ['2b4d6f8091a3c5e7', 'CONSUMER'],
];

// 2.3: a storefront CLIENT 404 Error ok; b catalog SERVER 404 Error wrong; c checkout SERVER
// 500 Unset wrong; d inventory SERVER 200 Unset ok. 2.5: what may ride in baggage.
const STATUS_SORT = [['a', 'ok'], ['b', 'wrong'], ['c', 'wrong'], ['d', 'ok']];
const BAG_SORT = [['variant', 'ok'], ['tier', 'ok'], ['email', 'never'], ['token', 'never'], ['last4', 'never']];

/** Pick each span, then its `attr` value (Build it), with this file's click. */
function buildAll(attr, pairs) {
  for (const [span, value] of pairs) {
    click(`[data-span="${span}"]`);
    click(`[data-${attr}="${value}"]`);
  }
}

/** One driver per registered level id. */
const DRIVERS = {
  'monitoring-vs-observability': {
    play() {
      sortAll(MVO_SORT);
      click('#mvo-next');
      click('[data-pick="rich"]');
      click('#mvo-finish');
    },
    expect: { stars: 3, cards: [] },
    sloppy: {
      play() {
        sortAll([['cpu', 'new'], ...MVO_SORT]); // one wrong placement
        click('#mvo-next');
        click('[data-pick="rich"]');
        click('#mvo-finish');
      },
      expect: { stars: 2, cards: [] },
    },
  },
  'the-signals': {
    play() {
      sortAll(SIG_DATA);
      click('#sig-next');
      sortAll(SIG_ASK);
      click('#sig-next');
      click('[data-pick="profiles"]');
      click('#sig-finish');
    },
    expect: { stars: 3, cards: ['profiles-signal'] },
    sloppy: {
      play() {
        sortAll(SIG_DATA);
        click('#sig-next');
        sortAll(SIG_ASK);
        click('#sig-next');
        click('[data-pick="logs"]'); // one wrong pick
        click('[data-pick="profiles"]');
        click('#sig-finish');
      },
      expect: { stars: 2, cards: ['profiles-signal'] },
    },
  },
  'why-opentelemetry': {
    play() {
      sortAll(OTEL_PARTS);
      click('#otel-next');
      click('[data-pick="api"]');
      click('#otel-finish');
    },
    expect: { stars: 3, cards: ['api-vs-sdk'] },
    sloppy: {
      play() {
        sortAll([['batch', 'collector'], ...OTEL_PARTS]); // one wrong placement
        click('#otel-next');
        click('[data-pick="api"]');
        click('#otel-finish');
      },
      expect: { stars: 2, cards: ['api-vs-sdk'] },
    },
  },
  // Act 0 boss: unscored, so every run earns 0; the sloppy run takes all four looks.
  'the-pager': {
    play() {
      click('[data-look="service"]');
      click('#pager-escalate');
    },
    expect: { stars: 0, cards: [] },
    sloppy: {
      play() {
        for (const look of ['service', 'since', 'customers', 'trace']) click(`[data-look="${look}"]`);
        click('#pager-escalate');
      },
      expect: { stars: 0, cards: [] },
    },
  },
  'spans-and-traces': {
    play() {
      click('[data-pick="trace-id"]');
      click('#sat-next');
      buildAll('parent', SAT_TREE);
      click('#sat-tree-check');
      click('#sat-next');
      click('[data-pick="other-request"]');
      click('#sat-finish');
    },
    expect: { stars: 3, cards: ['no-trace-object'] },
    sloppy: {
      play() {
        click('[data-pick="trace-id"]');
        click('#sat-next');
        buildAll('parent', [['9e1f2a3b4c5d6e7f', '53995c3f42cd8ad8']]); // E under C: another trace
        click('#sat-tree-check'); // one failed check
        click('[data-parent="none"]');
        buildAll('parent', SAT_TREE);
        click('#sat-tree-check');
        click('#sat-next');
        click('[data-pick="other-request"]');
        click('#sat-finish');
      },
      expect: { stars: 2, cards: ['no-trace-object'] },
    },
  },
  'span-kinds': {
    play() {
      buildAll('kind', KINDS_MAP);
      click('#kinds-map-check');
      click('#kinds-next');
      click('[data-pick="loses-edge"]');
      click('#kinds-finish');
    },
    expect: { stars: 3, cards: ['span-kind-edges'] },
    sloppy: {
      play() {
        buildAll('kind', KINDS_MAP);
        click('#kinds-map-check');
        click('#kinds-next');
        click('[data-pick="nothing"]'); // one wrong pick
        click('[data-pick="loses-edge"]');
        click('#kinds-finish');
      },
      expect: { stars: 2, cards: ['span-kind-edges'] },
    },
  },
  'status-and-errors': {
    play() {
      sortAll(STATUS_SORT);
      click('#status-next');
      click('[data-pick="stays-ok"]');
      click('#status-finish');
    },
    expect: { stars: 3, cards: ['span-status'] },
    sloppy: {
      play() {
        sortAll([['b', 'ok'], ...STATUS_SORT]); // one wrong placement: a SERVER 404 as Error
        click('#status-next');
        click('[data-pick="stays-ok"]');
        click('#status-finish');
      },
      expect: { stars: 2, cards: ['span-status'] },
    },
  },
  baggage: {
    play() {
      sortAll(BAG_SORT);
      click('#bag-next');
      click('[data-pick="only-if-copied"]');
      click('#bag-finish');
    },
    expect: { stars: 3, cards: ['baggage-leaks'] },
    sloppy: {
      play() {
        sortAll(BAG_SORT);
        click('#bag-next');
        click('[data-pick="yes-auto"]'); // one wrong pick
        click('[data-pick="only-if-copied"]');
        click('#bag-finish');
      },
      expect: { stars: 2, cards: ['baggage-leaks'] },
    },
  },
  'naming-your-service': {
    play() {
      click('[data-pick="fallback"]');
      click('#nys-next');
      type('#nys-env', FIXED_ENV);
      click('#nys-check');
      click('#nys-next');
      click('[data-pick="env-var"]');
      click('#nys-finish');
    },
    expect: { stars: 3, cards: ['unknown-service'] },
    sloppy: {
      play() {
        click('[data-pick="name"]');
        click('[data-pick="fallback"]');
        click('#nys-next');
        click('#nys-check'); // the given config, unfixed: one failed check
        type('#nys-env', FIXED_ENV);
        click('#nys-check');
        click('#nys-next');
        click('[data-pick="env-var"]');
        click('#nys-finish');
      },
      expect: { stars: 2, cards: ['unknown-service'] },
    },
  },
};

// The same registry the app boots with (levels/index.mjs, the deck and the map's node ids),
// so a level the app accepts is a level this file plays, and vice versa.
const LIVE = liveRegistry();

/** Ids registered without a driver, and drivers for ids that are not registered. */
function driverGaps(order, drivers) {
  const ids = new Set(order);
  const keys = Object.keys(drivers);
  return {
    missing: order.filter((id) => !Object.hasOwn(drivers, id)),
    extra: keys.filter((id) => !ids.has(id)),
  };
}

// The click in progress, set only while its handler runs, so a finish can be traced
// to the click that caused it; a finish outside a wrapper click sees null. Drivers
// use these wrappers, not ./helpers/dom.mjs directly.
let current = null;

/** dom.mjs click, recording for its duration whether it hit the Finish button. */
function click(elOrSel) {
  const el = typeof elOrSel === 'string' ? q(elOrSel) : elOrSel;
  current = { sel: String(elOrSel), finish: !!el?.matches?.('[data-finish]') };
  try {
    domClick(elOrSel);
  } finally {
    current = null;
  }
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
  current = null;
  const ctx = createLevelContext({
    level,
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => NOW,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (id, result) => calls.push({ id, result, via: current }),
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
  // The live overlay, not just renderStep's strings: setAttribute, innerHTML and
  // insertAdjacentHTML can add Alpine attributes too.
  const injected = [...liveAlpineAttrs(dom.body, dom.actions)];
  play();
  injected.push(...liveAlpineAttrs(dom.body, dom.actions));
  return { calls, steps, first, injected };
}

/** Alpine attribute names (see alpineAttrs) on `roots` and everything under them. */
function liveAlpineAttrs(...roots) {
  return roots.flatMap((root) => [root, ...root.querySelectorAll('*')]).flatMap((el) =>
    el.getAttributeNames().filter((n) => ALPINE_ATTR.test(n)).map((n) => `<${el.localName} ${n}>`));
}

/** True when `html` holds a [data-finish] element (a real query, not a substring). */
function hasFinish(html) {
  const box = globalThis.document.createElement('div');
  box.innerHTML = html;
  return box.querySelector('[data-finish]') !== null;
}

const ALPINE_ATTR = /^(x-|@|:)/;

/**
 * Alpine attribute names (x-*, @*, :*) in `html`. Level HTML must have none: Alpine's
 * mutation observer initialises nodes added under x-ignore too (it never checks
 * ancestors), so such an attribute would run as an Alpine expression.
 */
function alpineAttrs(html) {
  const box = globalThis.document.createElement('div');
  box.innerHTML = html;
  return [...box.querySelectorAll('*')].flatMap((el) =>
    el.getAttributeNames().filter((n) => ALPINE_ATTR.test(n)).map((n) => `<${el.localName} ${n}>`));
}

/** Every check a play-through must pass; returns the stars earned. */
function checkRun(level, run) {
  const { calls, steps, first, injected } = playLevel(level, run.play);
  assert.deepEqual(injected, [], 'the overlay holds an Alpine attribute (set outside renderStep)');
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
    assert.deepEqual(alpineAttrs(s), [], `step uses an Alpine attribute: ${s.slice(0, 80)}`);
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
        V.STALE_FINISH_CLICK,
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

test('harness: an earlier Finish click does not cover a finish from outside a click', () => {
  const lvl = FIXTURES['fx-stale-click'];
  const expect = { stars: 3, cards: [] };
  const bypasses = [
    () => domClick('#real'), // the F1 helper, which does not record
    () => q('#real').onclick(), // calling the handler directly
  ];
  for (const bypass of bypasses) {
    assert.throws(
      () => checkRun(lvl, { play: () => (click('#go'), click('#fin'), bypass()), expect }),
      /finished from a \[data-finish\] click, not from no click/,
    );
  }
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

test('harness: a step with an Alpine attribute (x-, @ or :) fails', () => {
  const tags = ['x-on:click="go()"', '@click="go()"', ':disabled="false"'];
  for (const attr of tags) {
    const [lvl] = Object.values(
      buildRegistry(
        [{ id: 'fx-act', no: 0, levels: [{ ...fixtureLevel, id: 'fx-alpine', run(ctx) {
          ctx.renderStep('<p>Go on.</p>', `<button id="fin" data-finish ${attr}>Finish</button>`);
          ctx.ovActions.querySelector('#fin').disabled = true;
          ctx.ovActions.querySelector('#fin').onclick = () => ctx.finish({ text: 'A long enough reward text.' });
        } }], boss: null }],
        { deck: [FIXTURE_CARD], nodeIds: [] },
      ).levels,
    );
    const play = () => {
      q('#fin').disabled = false;
      click('#fin');
    };
    assert.throws(() => checkRun(lvl, { play, expect: { stars: 3, cards: [] } }), /Alpine attribute/, attr);
  }
  assert.deepEqual(alpineAttrs('<p data-x="1" class="x-y" aria-label=":)">ok</p>'), []);
});

test('the live registry checks levels against the real map nodes', () => {
  const act = (lights) => [{ id: 'fx-act', no: 0, levels: [{ ...fixtureLevel, lights }], boss: null }];
  const reg = liveRegistry(act(['checkout', 'payments']), [FIXTURE_CARD]);
  assert.deepEqual(reg.levels['fixture-level'].lights, ['checkout', 'payments']);
  assert.throws(() => liveRegistry(act(['nowhere']), [FIXTURE_CARD]), /unknown node "nowhere"/);
});

test('harness: an Alpine attribute added outside renderStep, after run() or during play, fails', () => {
  const REWARD = 'A long enough reward text.';
  const level = (id, inject) => ({
    ...fixtureLevel,
    id,
    run(ctx) {
      ctx.renderStep('<p id="msg">Go on.</p>', '<button id="go">Go</button>');
      inject.atRun?.(ctx);
      ctx.ovActions.querySelector('#go').onclick = () => {
        inject.atPlay?.(ctx);
        ctx.renderStep('<p>Done.</p>', '<button id="fin" data-finish>Finish</button>');
        inject.afterFinishRender?.(ctx);
        ctx.ovActions.querySelector('#fin').onclick = () => ctx.finish({ text: REWARD });
      };
    },
  });
  const cases = {
    'fx-set-attr': { atRun: (ctx) => ctx.ovBody.querySelector('#msg').setAttribute('@click', 'go()') },
    'fx-set-attr-late': {
      afterFinishRender: (ctx) => ctx.ovActions.querySelector('#fin').setAttribute('x-on:click', 'go()'),
    },
    'fx-adjacent': {
      afterFinishRender: (ctx) => ctx.ovBody.insertAdjacentHTML('beforeend', '<span :class="c">!</span>'),
    },
    'fx-root-attr': { atRun: (ctx) => ctx.ovBody.setAttribute('x-data', '{}') },
  };
  for (const [id, inject] of Object.entries(cases)) {
    const lvl = buildRegistry(
      [{ id: 'fx-act', no: 0, levels: [level(id, inject)], boss: null }],
      { deck: [FIXTURE_CARD], nodeIds: [] },
    ).levels[id];
    const play = () => (click('#go'), click('#fin'));
    assert.throws(() => checkRun(lvl, { play, expect: { stars: 3, cards: [] } }), /Alpine attribute \(set outside/, id);
  }
  // The same flow with nothing injected passes, so the cases above fail only on the attribute.
  const clean = buildRegistry(
    [{ id: 'fx-act', no: 0, levels: [level('fx-clean', {})], boss: null }],
    { deck: [FIXTURE_CARD], nodeIds: [] },
  ).levels['fx-clean'];
  checkRun(clean, { play: () => (click('#go'), click('#fin')), expect: { stars: 3, cards: [] } });
});
