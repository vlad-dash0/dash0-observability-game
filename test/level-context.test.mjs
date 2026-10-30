// lib/level-context.mjs: the one ctx a level's run() receives, in the app and the
// harness. Spec: docs/FOUNDATION.md §2.6 and §6 F3 level-context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { createLevelContext } from '../lib/level-context.mjs';

const NOW = 1767225600000; // 2026-01-01T00:00:00.000Z
const LEVEL_A = { id: 'lvl-a', scored: true, scoring: { parMs: null } };

function setup({ level = LEVEL_A, now = () => NOW, controller = new AbortController() } = {}) {
  const dom = makeDom();
  const calls = [];
  const ctx = createLevelContext({
    level,
    ovBody: dom.body,
    ovActions: dom.actions,
    now,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (...args) => calls.push(args),
    signal: controller.signal,
  });
  return { dom, ctx, calls, controller };
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
  const html = ctx.speech('<b>hi</b>');
  assert.ok(html.includes('<b>hi</b>'));
  assert.ok(html.includes('class="speech"'));
  assert.ok(html.includes('class="bubble"'));
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

test('two mistakes then finish scores 2 stars and reports once to onFinish', () => {
  const { ctx, calls } = setup();
  ctx.mistake();
  ctx.mistake();
  const result = ctx.finish({ cards: ['c1'] });
  assert.deepEqual(result, { stars: 2, cards: ['c1'], text: '' });
  assert.deepEqual(calls, [
    ['lvl-a', { stars: 2, cards: ['c1'], text: '', at: '2026-01-01T00:00:00.000Z' }],
  ]);
});

test('a hint costs a star like a mistake', () => {
  const { ctx } = setup();
  ctx.hint();
  assert.equal(ctx.finish({ text: 'done' }).stars, 2);
});

test('finish with no argument is a clean 3-star run with empty text and cards', () => {
  const { ctx } = setup();
  assert.deepEqual(ctx.finish(), { stars: 3, cards: [], text: '' });
});

test('elapsed time is measured from creation: 61 s over a 60 s par costs a star', () => {
  const times = [0, 61000];
  const { ctx, calls } = setup({
    level: { id: 'lvl-a', scored: true, scoring: { parMs: 60000 } },
    now: () => times.shift(),
  });
  assert.equal(ctx.finish({ text: 'slow' }).stars, 2);
  assert.equal(calls[0][1].at, '1970-01-01T00:01:01.000Z');
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

test('createLevelContext refuses a missing onFinish or level id', () => {
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
});
