// lib/widgets/help-ladder.mjs: the shared help ladder and right column (score card, hint
// tools, success card), for Build it now and Sort it later (#146, #156). Asserts strings,
// numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { scoreStars } from '../lib/scoring.mjs';
import { chipsHtml, hintCost, mountSide, sideHtml, starsLabel, validateHelps } from '../lib/widgets/help-ladder.mjs';

const KEYS = ['queue', 'hints'];

test('validateHelps: absent is fine; an object of known keys with boolean values, nothing else', () => {
  assert.deepEqual(validateHelps(undefined, KEYS), []);
  assert.deepEqual(validateHelps({ queue: true, hints: false }, KEYS), []);
  assert.deepEqual(validateHelps([], KEYS), ['helps: not an object']);
  assert.deepEqual(validateHelps({ queue: 'yes', tint: true }, KEYS), [
    'helps: "queue" is not true or false',
    'helps: "tint" is not one of queue, hints',
  ]);
});

test('chipsHtml: one chip per help, saying on or off in words', () => {
  makeDom();
  document.body.innerHTML = chipsHtml('x', [
    { key: 'queue', label: 'One span at a time', on: true },
    { key: 'hints', label: 'Hints', on: false },
  ]);
  assert.equal(q('#x-helps').textContent, 'Helps: One span at a time on Hints off');
  assert.deepEqual(qa('[data-help]').map((c) => `${c.dataset.help}=${c.dataset.on}`), ['queue=true', 'hints=false']);
});

test('starsLabel: still possible before success, earned after', () => {
  assert.equal(starsLabel(4, false), '4 of 5 stars still possible');
  assert.equal(starsLabel(4, true), '4 of 5 stars');
  assert.equal(starsLabel(1, true), '1 of 5 stars');
});

test('hintCost follows the star rule: what one more penalty would cost now', () => {
  assert.equal(hintCost(5, 4), 'costs 1 star');
  assert.equal(hintCost(2, 2), 'costs no star now');
  assert.equal(hintCost(3, 1), 'costs 2 stars');
});

/** A ctx whose peekStars follows the real rule over its own counts. */
function sideSetup({ hints = true } = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, hints: 0 };
  const ctx = {
    ovBody: dom.body,
    escapeHtml,
    reduceMotion: false,
    peekStars: (extra = 0) =>
      scoreStars({ mistakes: counts.mistakes, hintsUsed: counts.hints + extra, elapsedMs: 0 }, { scored: true, scoring: { parMs: null } }),
  };
  dom.body.innerHTML = `<div id="box">${sideHtml('s1', { hints, title: 'Trace assembled' })}</div>`;
  const swirls = [];
  const side = mountSide(ctx, q('#box'), 's1', { swirl: (host, opts) => swirls.push(opts.reduced) });
  return { counts, ctx, side, swirls, focus };
}

test('the score card: counts, five stars from ctx.peekStars, muted until success, then earned', () => {
  const { counts, side } = sideSetup();
  side.score({ wrong: 0, wrongLabel: 'wrong drops', hints: 0, done: false });
  assert.equal(q('#s1-stars').getAttribute('aria-label'), '5 of 5 stars still possible');
  assert.deepEqual(qa('#s1-stars [data-star]').map((s) => s.dataset.star), ['possible', 'possible', 'possible', 'possible', 'possible']);
  counts.mistakes = 1;
  counts.hints = 1;
  side.score({ wrong: 1, wrongLabel: 'wrong drops', hints: 1, done: false });
  assert.equal(q('#s1-wrong').textContent, '1');
  assert.equal(q('#s1-wrong-label').textContent, 'wrong drops');
  assert.equal(q('#s1-hints').textContent, '1');
  assert.equal(q('#s1-stars').getAttribute('aria-label'), '3 of 5 stars still possible');
  assert.deepEqual(qa('#s1-stars [data-star]').map((s) => s.dataset.star), ['possible', 'possible', 'possible', 'lost', 'lost']);
  side.score({ wrong: 1, wrongLabel: 'failed Checks', hints: 1, done: true });
  assert.equal(q('#s1-stars').getAttribute('aria-label'), '3 of 5 stars');
  assert.deepEqual(qa('#s1-stars [data-star]').map((s) => s.dataset.star), ['earned', 'earned', 'earned', 'lost', 'lost']);
  assert.equal(q('#s1-wrong-label').textContent, 'failed Checks');
});

test('the success card is hidden until success; then it shows, focuses its heading and plays the swirl once', () => {
  const { side, swirls, focus } = sideSetup();
  assert.equal(q('#s1-win').hidden, true);
  side.succeed({ line: '5 of 5 stars: 0 wrong drops, 0 hints.', closing: '<code>GET /products</code> stays a root.' });
  assert.equal(q('#s1-win').hidden, false);
  assert.equal(q('#s1-win-title').textContent, 'Trace assembled');
  assert.equal(q('#s1-win-stars').textContent, '5 of 5 stars: 0 wrong drops, 0 hints.');
  assert.equal(q('#s1-win-closing').textContent, 'GET /products stays a root.');
  assert.equal(focus.last(), '#s1-win-title');
  assert.equal(q('[data-swirl]').getAttribute('aria-hidden'), 'true');
  assert.equal(q('[data-swirl]').hasAttribute('tabindex'), false);
  assert.deepEqual(swirls, [false]);
  side.succeed({ line: 'again', closing: '' });
  assert.deepEqual(swirls, [false], 'a second success does not replay');
  assert.deepEqual(focus.unfocusable(), []);
});

test('the swirl gets ctx.reduceMotion, and a swirl that throws leaves the card standing', () => {
  const dom = makeDom();
  recordFocus(dom.window);
  dom.body.innerHTML = `<div id="box">${sideHtml('s2', { hints: false, title: 'Every span checks out' })}</div>`;
  const ctx = { ovBody: dom.body, escapeHtml, reduceMotion: true, peekStars: () => 5 };
  const got = [];
  mountSide(ctx, q('#box'), 's2', { swirl: (host, opts) => got.push(opts.reduced) }).succeed({ line: 'x', closing: '' });
  assert.deepEqual(got, [true]);
  const side = mountSide(ctx, q('#box'), 's2', {
    swirl: () => {
      throw new Error('no WebGL');
    },
  });
  side.succeed({ line: 'y', closing: '' });
  assert.equal(q('#s2-win').hidden, false);
  assert.equal(q('#s2-hint-tier').textContent, 'No hints on this level.');
  assert.equal(qa('#s2-hint').length, 0);
});
