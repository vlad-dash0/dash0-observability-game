// Plays every registered level in a linkedom DOM the way a player would click through
// it, with the real ctx (lib/level-context.mjs). Catches a dead end, a wrong-wired
// button or a level that never finishes, before it ships. Spec: docs/FOUNDATION.md
// §6 F3 levels-play.
//
// TO ADD A LEVEL: for a run(ctx) level add DRIVERS['<id>'] below with a happy run and a
// sloppy run; the "every run-level has a driver" test fails until it exists. A declarative
// (play) level needs none: it is driven by drivers derived from its spec (derivedDriver below).
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
import { definedClasses } from './helpers/css.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { runPlay, validatePlay } from '../lib/play.mjs';
import { liveRegistry } from '../app.mjs';
import { stepsOf } from './helpers/step-drivers.mjs';
import fixtureLevel, { FIXTURE_CARD } from './fixtures/fixture-level.mjs';
import { playFixture } from './fixtures/play-level.mjs';
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
// 2.1 (trace 4bf9...): B under A, C under B, D under C; E (trace 0af7...) stays a root. With the
// arrival queue (#146) the spans arrive in this order and E must be placed too, as a root.
const SAT_TREE = [['b7ad6b7169203331', '00f067aa0ba902b7'], ['53995c3f42cd8ad8', 'b7ad6b7169203331'], ['1d5c3a2f8e4b6a90', '53995c3f42cd8ad8']];
const SAT_E = '9e1f2a3b4c5d6e7f';
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
// 2.4: checkout's SERVER span under storefront's CLIENT span 00f067aa0ba902b7 (the parent-id).
const PROP_TREE = [['6e0c63257de34c92', '00f067aa0ba902b7']];
// 2.6: payments charge (exception escaped) Error; charge with retry (handled, went through) back to Unset;
// notifications send batch links the three orders publish spans.
const EVL_STATUS = [['8f14e45fceea167a', 'ERROR'], ['45c48cce2e2d7fbd', 'UNSET']];
const EVL_SEND = 'd67d8ab4f4c10bf2';
const EVL_LINKS = [[EVL_SEND, '1679091c5a880faf'], [EVL_SEND, '8e296a067a375633'], [EVL_SEND, 'a5771bce93e200c3']];
// 2.7: what the agent covers (auto) and what only your code adds (manual).
const AVM_SORT = [['server', 'auto'], ['loyalty', 'manual'], ['redis', 'auto'], ['coupon', 'manual'], ['client', 'auto'], ['item-count', 'manual']];

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
    expect: { stars: 5, cards: [] },
    sloppy: {
      play() {
        sortAll([['cpu', 'new'], ...MVO_SORT]); // one wrong placement
        click('#mvo-next');
        click('[data-pick="rich"]');
        click('#mvo-finish');
      },
      expect: { stars: 4, cards: [] },
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
    expect: { stars: 5, cards: ['profiles-signal'] },
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
      expect: { stars: 4, cards: ['profiles-signal'] },
    },
  },
  'why-opentelemetry': {
    play() {
      sortAll(OTEL_PARTS);
      click('#otel-next');
      click('[data-pick="api"]');
      click('#otel-finish');
    },
    expect: { stars: 5, cards: ['api-vs-sdk'] },
    sloppy: {
      play() {
        sortAll([['batch', 'collector'], ...OTEL_PARTS]); // one wrong placement
        click('#otel-next');
        click('[data-pick="api"]');
        click('#otel-finish');
      },
      expect: { stars: 4, cards: ['api-vs-sdk'] },
    },
  },
  // Act 0 boss: unscored, so every run earns 0; the sloppy run takes all four looks.
  'the-pager': {
    play() {
      click('[data-look="service"]');
      click('#pager-escalate');
      for (const k of ['service', 'since', 'customers', 'trace']) click(`[data-ask="${k}"]`);
      click('#pager-finish');
    },
    expect: { stars: 0, cards: [] },
    sloppy: {
      play() {
        for (const look of ['service', 'since', 'customers', 'trace']) click(`[data-look="${look}"]`);
        for (const k of ['service', 'since', 'customers', 'trace']) click(`[data-ask="${k}"]`); // budget 0 moved on
        click('#pager-finish');
      },
      expect: { stars: 0, cards: [] },
    },
  },
  'spans-and-traces': {
    play() {
      click('[data-pick="trace-id"]');
      click('#sat-next');
      buildAll('parent', [...SAT_TREE, [SAT_E, 'none']]); // instant feedback: the last right drop completes it
      click('#sat-next');
      click('[data-pick="other-request"]');
      click('#sat-finish');
    },
    expect: { stars: 5, cards: ['no-trace-object'] },
    sloppy: {
      play() {
        click('[data-pick="trace-id"]');
        click('#sat-next');
        buildAll('parent', SAT_TREE);
        buildAll('parent', [[SAT_E, '53995c3f42cd8ad8']]); // E under C: another trace, one wrong drop
        buildAll('parent', [[SAT_E, 'none']]);
        click('#sat-next');
        click('[data-pick="other-request"]');
        click('#sat-finish');
      },
      expect: { stars: 4, cards: ['no-trace-object'] },
    },
  },
  'span-kinds': {
    play() {
      buildAll('kind', KINDS_MAP); // instant feedback: the last right kind completes it
      click('#kinds-next');
      click('[data-pick="loses-edge"]');
      click('#kinds-finish');
    },
    expect: { stars: 5, cards: ['span-kind-edges'] },
    sloppy: {
      play() {
        buildAll('kind', KINDS_MAP);
        click('#kinds-next');
        click('[data-pick="nothing"]'); // one wrong pick
        click('[data-pick="loses-edge"]');
        click('#kinds-finish');
      },
      expect: { stars: 4, cards: ['span-kind-edges'] },
    },
  },
  'status-and-errors': {
    play() {
      sortAll(STATUS_SORT);
      click('#status-next');
      click('[data-pick="stays-ok"]');
      click('#status-finish');
    },
    expect: { stars: 5, cards: ['span-status'] },
    sloppy: {
      play() {
        sortAll([['b', 'ok'], ...STATUS_SORT]); // one wrong placement: a SERVER 404 as Error
        click('#status-next');
        click('[data-pick="stays-ok"]');
        click('#status-finish');
      },
      expect: { stars: 4, cards: ['span-status'] },
    },
  },
  baggage: {
    play() {
      sortAll(BAG_SORT);
      click('#bag-next');
      click('[data-pick="only-if-copied"]');
      click('#bag-finish');
    },
    expect: { stars: 5, cards: ['baggage-leaks'] },
    sloppy: {
      play() {
        sortAll(BAG_SORT);
        click('#bag-next');
        click('[data-pick="yes-auto"]'); // one wrong pick
        click('[data-pick="only-if-copied"]');
        click('#bag-finish');
      },
      expect: { stars: 4, cards: ['baggage-leaks'] },
    },
  },
  'context-propagation': {
    play() {
      click('[data-pick="proxy"]');
      click('#prop-next');
      click('[data-pick="valid"]');
      click('#prop-next');
      buildAll('parent', PROP_TREE);
      click('#prop-tree-check');
      click('#prop-finish');
    },
    expect: { stars: 5, cards: ['broken-propagation'] },
    sloppy: {
      play() {
        click('[data-pick="proxy"]');
        click('#prop-next');
        click('[data-pick="short-parent"]'); // one wrong pick: a 15-hex parent-id
        click('[data-pick="valid"]');
        click('#prop-next');
        buildAll('parent', PROP_TREE);
        click('#prop-tree-check');
        click('#prop-finish');
      },
      expect: { stars: 4, cards: ['broken-propagation'] },
    },
  },
  'events-and-links': {
    play() {
      click('[data-pick="unset"]');
      click('#evl-next');
      buildAll('status', EVL_STATUS);
      click('#evl-errors-check');
      click('#evl-next');
      buildAll('link', EVL_LINKS);
      click('#evl-batch-check');
      click('#evl-finish');
    },
    expect: { stars: 5, cards: ['exception-no-status', 'batch-links'] },
    sloppy: {
      play() {
        click('[data-pick="unset"]');
        click('#evl-next');
        buildAll('status', EVL_STATUS.slice(0, 1));
        click('#evl-errors-check'); // one failed check: the retried charge still Error
        buildAll('status', EVL_STATUS);
        click('#evl-errors-check');
        click('#evl-next');
        buildAll('link', EVL_LINKS);
        click('#evl-batch-check');
        click('#evl-finish');
      },
      expect: { stars: 4, cards: ['exception-no-status', 'batch-links'] },
    },
  },
  'auto-vs-manual': {
    play() {
      sortAll(AVM_SORT);
      click('#avm-next');
      click('[data-pick="two-setups"]');
      click('#avm-next');
      click('[data-pick="keep-one"]');
      click('#avm-finish');
    },
    expect: { stars: 5, cards: ['double-instrumentation'] },
    sloppy: {
      play() {
        sortAll(AVM_SORT);
        click('#avm-next');
        click('[data-pick="retries"]'); // one wrong pick
        click('[data-pick="two-setups"]');
        click('#avm-next');
        click('[data-pick="keep-one"]');
        click('#avm-finish');
      },
      expect: { stars: 4, cards: ['double-instrumentation'] },
    },
  },
  // Act 2 boss: reference path is the two clues and n-plus-one (5 stars). Sloppy: a herring
  // (one mistake) and a wrong hypothesis (another) are 2 penalties, so 3 stars.
  'checkout-is-slow': {
    play() {
      click('[data-view="trace-slow"]');
      click('[data-view="triage"]');
      click('[data-hypothesis="n-plus-one"]');
      click('#cis-finish');
    },
    expect: { stars: 5, cards: [] },
    sloppy: {
      play() {
        click('[data-view="payments-errors"]');
        click('[data-view="trace-slow"]');
        click('[data-hypothesis="provider"]');
        click('[data-hypothesis="n-plus-one"]');
        click('#cis-finish');
      },
      expect: { stars: 3, cards: [] },
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
    expect: { stars: 5, cards: ['unknown-service'] },
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
      expect: { stars: 3, cards: ['unknown-service'] },
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
// While a level plays (playLevel), every class on the page after each click (T8).
let seenClasses = null;

/** Add the class names of every element in the document to `into`. */
function pageClasses(into) {
  for (const el of globalThis.document.querySelectorAll('[class]')) {
    for (const c of el.getAttribute('class').split(/\s+/)) if (c) into.add(c);
  }
}

/** dom.mjs click, recording for its duration whether it hit the Finish button. */
function click(elOrSel) {
  const el = typeof elOrSel === 'string' ? q(elOrSel) : elOrSel;
  current = { sel: String(elOrSel), finish: !!el?.matches?.('[data-finish]') };
  try {
    domClick(elOrSel);
  } finally {
    current = null;
    if (seenClasses) pageClasses(seenClasses);
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
  const classes = new Set();
  seenClasses = classes;
  try {
    level.run(ctx);
    pageClasses(classes);
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
    pageClasses(classes);
    return { calls, steps, first, injected, classes };
  } finally {
    seenClasses = null;
  }
}

// ---- T8 (#158): every class a level shows has a CSS rule --------------------------------

const DEFINED = definedClasses();
// Classes levels render that no stylesheet defines yet, each owned by a later phase of #158:
// P4 #159 (Query it, Configure it),
// P5 #160 (Trade-off). Sorted; only shrinks: a phase deletes its own, and an entry
// no level renders any more fails ("stale"). P7 asserts it is empty.
const UNDEFINED_ALLOW = [
  'configure', 'configure-flow', 'configure-name', 'configure-pipeline-head', // P4 #159
  'query', 'query-result', // P4 #159
  'tradeoff', 'tradeoff-label', 'tradeoff-model', 'tradeoff-need-head', // P5 #160
];
const undefinedSeen = new Set();

/** The classes in `steps` (renderStep strings) and `live` (seen on the page) that no stylesheet defines. */
function undefinedClasses(steps, live) {
  const all = new Set(live);
  const box = globalThis.document.createElement('div');
  for (const s of steps) {
    box.innerHTML = s;
    for (const el of box.querySelectorAll('[class]')) {
      for (const c of el.getAttribute('class').split(/\s+/)) if (c) all.add(c);
    }
  }
  return [...all].filter((c) => !DEFINED.has(c)).sort();
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
  const { calls, steps, first, injected, classes } = playLevel(level, run.play);
  assert.deepEqual(injected, [], 'the overlay holds an Alpine attribute (set outside renderStep)');
  const missing = undefinedClasses(steps, classes);
  for (const c of missing) if (UNDEFINED_ALLOW.includes(c)) undefinedSeen.add(c);
  assert.deepEqual(missing.filter((c) => !UNDEFINED_ALLOW.includes(c)), [], 'rendered classes with no CSS rule (T8)');
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

test('every registered run-level has a driver and every driver is registered', () => {
  const gaps = driverGaps(LIVE.order, DRIVERS);
  assert.deepEqual({ ...gaps, missing: gaps.missing.filter((id) => !LIVE.levels[id].play) }, { missing: [], extra: [] });
});

test('driverGaps catches a missing driver and a driver without a level', () => {
  assert.deepEqual(driverGaps(['a', 'b'], { a: {}, c: {} }), { missing: ['b'], extra: ['c'] });
  assert.deepEqual(driverGaps([], {}), { missing: [], extra: [] });
});

for (const id of LIVE.order) {
  if (!DRIVERS[id] && LIVE.levels[id].play) continue; // played with a derived driver below
  test(`level "${id}" plays through (happy and sloppy)`, () => {
    checkLevel(LIVE.levels[id], DRIVERS[id]);
  });
}

/**
 * A driver for a play level, derived from its steps (test/helpers/step-drivers.mjs): the happy
 * run solves every step; the sloppy run makes the first slip it can find, then solves.
 */
function derivedDriver(level) {
  const steps = stepsOf(level);
  const advance = (i) => `#${level.play.prefix ?? level.id}-${i === steps.length - 1 ? 'finish' : 'next'}`;
  const run = (slipAt = -1) => () =>
    steps.forEach(({ driver, spec }, i) => {
      if (i === slipAt) for (const sel of driver.slips(spec)[0].clicks) click(sel);
      for (const sel of driver.solve(spec)) click(sel);
      click(advance(i));
    });
  const expect = (stars) => ({ stars: level.scored ? stars : 0, cards: [...level.cards] });
  const slipAt = steps.findIndex(({ driver, spec }) => driver.slips(spec).length > 0);
  return { play: run(), expect: expect(5), sloppy: { play: run(slipAt), expect: expect(4) } };
}

const PLAY_LEVELS = [
  ...Object.values(LIVE.levels).filter((l) => l.play && !DRIVERS[l.id]),
  ...Object.values(
    buildRegistry([{ id: 'play-act', no: 0, levels: [playFixture()], boss: null }], {
      deck: [FIXTURE_CARD], nodeIds: [], play: { validatePlay, runPlay },
    }).levels,
  ),
];

for (const level of PLAY_LEVELS) {
  test(`play level "${level.id}" plays through (derived driver, happy and sloppy)`, () => {
    checkLevel(level, derivedDriver(level));
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
  expect: { stars: 5, cards: ['fixture-card'] },
  sloppy: {
    play() {
      click('[data-pick="metric"]');
      click('[data-pick="trace"]');
      click('#fx-next');
      click('#fx-finish');
    },
    expect: { stars: 4, cards: ['fixture-card'] },
  },
};

test('harness: the fixture level finishes once with 5 stars, sloppy with 4', () => {
  const { calls } = playLevel(FIXTURE, FIXTURE_DRIVER.play);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].result.stars, 5);
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
    () => checkRun(lvl, { play: () => click('#ff'), expect: { stars: 5, cards: [] } }),
    /first screen has no enabled Finish/,
  );
});

test('harness: finishing inside run() fails', () => {
  const lvl = FIXTURES['fx-run-finish'];
  assert.throws(
    () => checkRun(lvl, { play() {}, expect: { stars: 5, cards: [] } }),
    /run\(\) alone does not finish/,
  );
});

test('harness: finishing from a button that is not the Finish button fails', () => {
  const lvl = FIXTURES['fx-other-button'];
  assert.throws(
    () => checkRun(lvl, { play: () => click('#go'), expect: { stars: 5, cards: [] } }),
    /finished from a \[data-finish\] click/,
  );
});

test('harness: awarding a card the level does not list fails', () => {
  const lvl = FIXTURES['fx-card-outside'];
  assert.throws(
    () =>
      checkRun(lvl, {
        play: () => (click('#go'), click('#fin')),
        expect: { stars: 5, cards: ['other-card'] },
      }),
    /not in level.cards/,
  );
});

test('harness: a Finish named only in text, never rendered as an element, fails', () => {
  const lvl = FIXTURES['fx-outside-render'];
  assert.throws(
    () =>
      checkRun(lvl, { play: () => (click('#go'), click('#fin')), expect: { stars: 5, cards: [] } }),
    /some step shows a Finish button/,
  );
});

test('harness: an earlier Finish click does not cover a finish from outside a click', () => {
  const lvl = FIXTURES['fx-stale-click'];
  const expect = { stars: 5, cards: [] };
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
    assert.throws(() => checkRun(lvl, { play, expect: { stars: 5, cards: [] } }), /Alpine attribute/, attr);
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
    assert.throws(() => checkRun(lvl, { play, expect: { stars: 5, cards: [] } }), /Alpine attribute \(set outside/, id);
  }
  // The same flow with nothing injected passes, so the cases above fail only on the attribute.
  const clean = buildRegistry(
    [{ id: 'fx-act', no: 0, levels: [level('fx-clean', {})], boss: null }],
    { deck: [FIXTURE_CARD], nodeIds: [] },
  ).levels['fx-clean'];
  checkRun(clean, { play: () => (click('#go'), click('#fin')), expect: { stars: 5, cards: [] } });
});

test('harness T8: a class with no CSS rule fails, in a rendered step or added later on the page', () => {
  const REWARD = 'A long enough reward text.';
  const level = (id, { body = '<p>Go on.</p>', late = null }) => buildRegistry(
    [{ id: 'fx-act', no: 0, levels: [{ ...fixtureLevel, id, run(ctx) {
      ctx.renderStep(body, '<button id="go">Go</button>');
      ctx.ovActions.querySelector('#go').onclick = () => {
        ctx.renderStep('<p id="msg">Done.</p>', '<button id="fin" data-finish>Finish</button>');
        if (late) ctx.ovBody.querySelector('#msg').setAttribute('class', late);
        ctx.ovActions.querySelector('#fin').onclick = () => ctx.finish({ text: REWARD });
      };
    } }], boss: null }],
    { deck: [FIXTURE_CARD], nodeIds: [] },
  ).levels[id];
  const play = () => (click('#go'), click('#fin'));
  const expect = { stars: 5, cards: [] };
  assert.throws(() => checkRun(level('fx-nope', { body: '<p class="nope">Go on.</p>' }), { play, expect }), /no CSS rule/);
  assert.throws(() => checkRun(level('fx-late', { late: 'ui-lesson nope-late' }), { play, expect }), /no CSS rule/);
  // Defined classes pass: a kit class and a legacy one.
  checkRun(level('fx-ok', { body: '<p class="ui-note">Go on.</p>', late: 'visually-hidden' }), { play, expect });
});

// Runs last: every level above has played, so an allowed class no level renders is stale.
test('T8 UNDEFINED_ALLOW is sorted and has no stale entry', () => {
  assert.equal(new Set(UNDEFINED_ALLOW).size, UNDEFINED_ALLOW.length, 'no duplicates');
  assert.deepEqual([...UNDEFINED_ALLOW].sort(), UNDEFINED_ALLOW, 'sorted');
  for (const c of UNDEFINED_ALLOW) {
    assert.ok(!DEFINED.has(c), `UNDEFINED_ALLOW names "${c}", which a stylesheet now defines; delete it`);
    assert.ok(undefinedSeen.has(c), `stale UNDEFINED_ALLOW entry "${c}": no level renders it any more; delete it`);
  }
});
