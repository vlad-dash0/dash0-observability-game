// lib/level-context.mjs: the one ctx a level's run() receives, in the app and the
// harness. Spec: docs/FOUNDATION.md §2.6 and §6 F3 level-context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { lesson } from '../lib/ui/index.mjs';
import { mountSide } from '../lib/widgets/help-ladder.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { sideColumn } from '../lib/ui/index.mjs';

const NOW = 1767225600000; // 2026-01-01T00:00:00.000Z
const LEVEL_A = { id: 'lvl-a', scored: true, scoring: { parMs: null } };

function setup({
  level = LEVEL_A,
  now = () => NOW,
  controller = new AbortController(),
  onFinish,
  reportError,
} = {}) {
  const dom = makeDom();
  const calls = [];
  const reported = [];
  const ctx = createLevelContext({
    level,
    ovBody: dom.body,
    ovActions: dom.actions,
    now,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: onFinish ?? ((...args) => calls.push(args)),
    signal: controller.signal,
    reportError: reportError ?? ((e) => reported.push(e)),
  });
  return { dom, ctx, calls, controller, reported };
}

test('renderStep fills body and actions and scrolls the body to the top', () => {
  const { dom, ctx } = setup();
  dom.actions.innerHTML = '<button>old</button>';
  dom.body.scrollTop = 50;
  ctx.renderStep('<p>x</p>');
  assert.equal(dom.body.innerHTML, '<p>x</p>');
  assert.equal(dom.actions.innerHTML, '');
  assert.equal(dom.body.scrollTop, 0);
  ctx.renderStep('<p>y</p>', '<button id="go">Go</button>');
  assert.equal(dom.actions.innerHTML, '<button id="go">Go</button>');
  ctx.renderStep('<p>z</p>', null);
  assert.equal(dom.actions.innerHTML, '');
});

test('ctx exposes speech, escapeHtml, reduceMotion, the overlay elements and the signal', () => {
  const { dom, ctx, controller } = setup();
  // The lesson voice is the kit's glow card (#158), its API unchanged.
  assert.equal(ctx.speech('<b>hi</b>'), lesson('<b>hi</b>'));
  assert.equal(ctx.escapeHtml("<it's>"), '&lt;it&#39;s&gt;');
  assert.equal(ctx.reduceMotion, true);
  assert.equal(ctx.ovBody, dom.body);
  assert.equal(ctx.ovActions, dom.actions);
  assert.equal(ctx.signal, controller.signal);
});

test('ctx.shuffle returns a new array even when the injected shuffle is identity', () => {
  const { ctx } = setup();
  const input = Object.freeze([1, 2, 3]);
  const out = ctx.shuffle(input);
  assert.notEqual(out, input);
  assert.deepEqual(out, [1, 2, 3]);
  assert.deepEqual(input, [1, 2, 3]);
});

test('two mistakes then finish scores 3 stars and reports once to onFinish', () => {
  const { ctx, calls } = setup();
  ctx.mistake();
  ctx.mistake();
  const result = ctx.finish({ cards: ['c1'] });
  assert.deepEqual(result, { stars: 3, cards: ['c1'], text: '' });
  assert.deepEqual(calls, [
    ['lvl-a', { stars: 3, cards: ['c1'], text: '', at: '2026-01-01T00:00:00.000Z' }],
  ]);
});

test('a hint costs a star like a mistake', () => {
  const { ctx } = setup();
  ctx.hint();
  assert.equal(ctx.finish({ text: 'done' }).stars, 4);
});

test('finish with no argument is a clean 5-star run with empty text and cards', () => {
  const { ctx } = setup();
  assert.deepEqual(ctx.finish(), { stars: 5, cards: [], text: '' });
});

const PAR_60S = { id: 'lvl-a', scored: true, scoring: { parMs: 60000 } };

test('elapsed time is measured from creation: 61 s over a 60 s par costs a star', () => {
  const times = [NOW, NOW + 61000];
  const { ctx, calls } = setup({ level: PAR_60S, now: () => times.shift() });
  assert.equal(ctx.finish({ text: 'slow' }).stars, 4);
  assert.equal(calls[0][1].at, '2026-01-01T00:01:01.000Z');
});

test('59 s under a 60 s par keeps 5 stars', () => {
  const times = [NOW, NOW + 59000];
  const { ctx } = setup({ level: PAR_60S, now: () => times.shift() });
  assert.equal(ctx.finish({ text: 'quick' }).stars, 5);
});

test('a non-finite or out-of-range clock counts as no elapsed time and no date', () => {
  for (const bad of [NaN, 1e20]) {
    const times = [NOW, bad];
    const { ctx, calls, reported } = setup({ level: PAR_60S, now: () => times.shift() });
    assert.equal(ctx.finish({ text: 'clock' }).stars, 5);
    assert.equal(calls[0][1].at, null);
    assert.equal(reported.length, 1, 'a broken clock is reported');
  }
});

test('an onFinish that throws is reported; the player still gets the result once', () => {
  const boom = new Error('storage exploded');
  const { ctx, reported } = setup({
    onFinish: () => {
      throw boom;
    },
  });
  assert.deepEqual(ctx.finish({ text: 'done' }), { stars: 5, cards: [], text: 'done' });
  assert.deepEqual(reported, [boom]);
  assert.equal(ctx.finish({ text: 'again' }), null);
});

test('a throwing clock at finish: elapsed 0, no date, reported, one onFinish', () => {
  let n = 0;
  const now = () => {
    if (n++ > 0) throw new Error('clock gone');
    return NOW;
  };
  const { ctx, calls, reported } = setup({ level: PAR_60S, now });
  assert.equal(ctx.finish({ text: 'done' }).stars, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].at, null);
  assert.equal(reported.length, 1);
});

test('a text whose toString throws becomes empty text, reported, one onFinish', () => {
  const { ctx, calls, reported } = setup();
  const text = {
    toString() {
      throw new Error('no string');
    },
  };
  assert.equal(ctx.finish({ text }).text, '');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].text, '');
  assert.equal(reported.length, 1);
});

test('a reportError that throws is swallowed; onFinish still fires once', () => {
  const reportError = () => {
    throw new Error('logger down');
  };
  const { ctx, calls } = setup({ level: PAR_60S, now: () => NaN, reportError });
  assert.deepEqual(ctx.finish({ text: 'x' }), { stars: 5, cards: [], text: 'x' });
  assert.equal(calls.length, 1);
  const thrower = setup({
    reportError,
    onFinish: () => {
      throw new Error('store down');
    },
  });
  assert.deepEqual(thrower.ctx.finish(), { stars: 5, cards: [], text: '' });
});

test('if building the result throws, nothing is latched and finish can be retried', () => {
  const { ctx, calls } = setup();
  const cards = ['c1'];
  cards[Symbol.iterator] = () => {
    throw new Error('bad cards');
  };
  assert.throws(() => ctx.finish({ cards }), /bad cards/);
  assert.equal(calls.length, 0);
  assert.ok(ctx.finish({ text: 'retry' }));
  assert.equal(calls.length, 1);
});

test('reportError defaults to console.error', (t) => {
  const seen = t.mock.method(console, 'error', () => {});
  const dom = makeDom();
  const ctx = createLevelContext({
    level: LEVEL_A,
    ovBody: dom.body,
    ovActions: dom.actions,
    onFinish: () => {
      throw new Error('x');
    },
    signal: new AbortController().signal,
  });
  ctx.finish();
  assert.equal(seen.mock.callCount(), 1);
});

test('finish(null) is a clean finish; non-string text is stringified', () => {
  assert.deepEqual(setup().ctx.finish(null), { stars: 5, cards: [], text: '' });
  assert.equal(setup().ctx.finish({ text: 42 }).text, '42');
  assert.equal(setup().ctx.finish({ text: null }).text, '');
});

test('the caller and onFinish get separate copies of cards', () => {
  const { ctx, calls } = setup();
  const cards = ['c1'];
  const result = ctx.finish({ cards });
  assert.notEqual(result.cards, cards);
  assert.notEqual(result.cards, calls[0][1].cards);
  result.cards.push('c2');
  assert.deepEqual(calls[0][1].cards, ['c1']);
  assert.deepEqual(cards, ['c1']);
});

test('a second finish returns null and does not call onFinish again', () => {
  const { ctx, calls } = setup();
  assert.ok(ctx.finish({ text: 'first' }));
  assert.equal(ctx.finish({ text: 'second' }), null);
  assert.equal(calls.length, 1);
});

test('finish after the overlay closed (signal aborted) returns null and reports nothing', () => {
  const { ctx, calls, controller } = setup();
  controller.abort();
  assert.equal(ctx.finish({ text: 'late' }), null);
  assert.equal(calls.length, 0);
});

test('non-array cards become an empty list', () => {
  const { ctx, calls } = setup();
  assert.deepEqual(ctx.finish({ cards: 'c1' }).cards, []);
  assert.deepEqual(calls[0][1].cards, []);
});

test('finish credits the level the ctx was created for, not whichever opened last', () => {
  const shared = new AbortController();
  const calls = [];
  const dom = makeDom();
  const make = (id) =>
    createLevelContext({
      level: { id, scored: true, scoring: { parMs: null } },
      ovBody: dom.body,
      ovActions: dom.actions,
      now: () => NOW,
      shuffle: (a) => a,
      reduceMotion: true,
      onFinish: (...args) => calls.push(args),
      signal: shared.signal,
    });
  const a = make('lvl-a');
  make('lvl-b');
  a.finish();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'lvl-a');
});

test('createLevelContext refuses missing deps', () => {
  const dom = makeDom();
  const base = {
    level: LEVEL_A,
    ovBody: dom.body,
    ovActions: dom.actions,
    signal: new AbortController().signal,
    onFinish: () => {},
  };
  assert.throws(() => createLevelContext({ ...base, onFinish: undefined }), TypeError);
  assert.throws(() => createLevelContext({ ...base, level: {} }), TypeError);
  assert.throws(() => createLevelContext({ ...base, signal: undefined }), TypeError);
  assert.throws(() => createLevelContext({ ...base, ovBody: undefined }), TypeError);
  assert.throws(() => createLevelContext({ ...base, ovActions: null }), TypeError);
  assert.throws(() => createLevelContext({ ...base, reportError: 'log' }), TypeError);
});

test('ctx.telemetry is the injected facade, null when absent', () => {
  const facade = { sessionId: 's-1', status: () => ({ state: 'off', mode: null, host: null }) };
  const dom = makeDom();
  const base = {
    level: LEVEL_A,
    ovBody: dom.body,
    ovActions: dom.actions,
    signal: new AbortController().signal,
    onFinish: () => {},
  };
  assert.equal(createLevelContext({ ...base, telemetry: facade }).telemetry, facade);
  assert.equal(createLevelContext(base).telemetry, null);
  assert.equal(createLevelContext({ ...base, telemetry: undefined }).telemetry, null);
});

test('#17 P3 askedGuide costs one hint at finish and notifies once; off and abort stop it', () => {
  const { ctx, controller } = setup();
  let heard = 0;
  const off = ctx.onGuideHint(() => { heard += 1; });
  ctx.askedGuide();
  assert.equal(heard, 1);
  off();
  ctx.askedGuide();
  assert.equal(heard, 1, 'off stops the listener');
  assert.equal(ctx.finish().stars, 3, 'two answered questions are two hints');
  const second = setup();
  let late = 0;
  second.ctx.onGuideHint(() => { late += 1; });
  second.controller.abort();
  second.ctx.askedGuide();
  assert.equal(late, 0, 'abort drops the listeners');
  assert.equal(controller.signal.aborted, false);
});

test('#17 P3 a listener that throws is reported and does not stop the ask', () => {
  const { ctx, reported } = setup();
  let heard = 0;
  ctx.onGuideHint(() => { throw new Error('boom'); });
  ctx.onGuideHint(() => { heard += 1; });
  ctx.askedGuide();
  assert.equal(reported.length, 1);
  assert.equal(heard, 1);
  assert.equal(ctx.finish().stars, 4);
});

test('#17 P3 the optional guide dep is passed through, null when absent', () => {
  assert.equal(setup().ctx.guide, null);
  const guide = { configured: true };
  const dom = makeDom();
  const ctx = createLevelContext({ level: LEVEL_A, ovBody: dom.body, ovActions: dom.actions, onFinish() {}, signal: new AbortController().signal, guide });
  assert.equal(ctx.guide, guide);
});

test('#17 P3 board stars equal level stars after one guide ask and one hint', () => {
  const { ctx, dom } = setup();
  dom.body.innerHTML = `<div id="box">${sideColumn({ id: 'g1', titleHtml: 'Done', counts: [{ key: 'wrong', label: '' }], hints: true, ruleHtml: '' })}</div>`;
  const side = mountSide(ctx, dom.body.querySelector('#box'), 'g1', {});
  const draw = (hints) => side.score({ wrong: 0, wrongLabel: 'wrong', hints, done: false });
  draw(0);
  ctx.askedGuide();
  ctx.hint();
  const board = draw(1);
  assert.equal(board, ctx.finish().stars);
  assert.equal(board, 3);
});

test('#17 P3 an ask after finish is no charge and tells nobody', () => {
  const { ctx, calls } = setup();
  let heard = 0;
  ctx.onGuideHint(() => { heard += 1; });
  const result = ctx.finish();
  ctx.askedGuide();
  assert.equal(heard, 0);
  assert.equal(result.stars, 5);
  assert.equal(calls.length, 1);
});
