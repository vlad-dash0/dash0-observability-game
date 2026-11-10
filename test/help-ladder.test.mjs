// lib/widgets/help-ladder.mjs: the shared help ladder's behaviour around the right column
// (score card, hint tools, success card), for Build it and Sort it (#146, #156).
// The markup is the kit's (lib/ui/side.mjs helpChips, sideColumn, stars; #158). Asserts
// strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { withGuide } from './helpers/guide-ctx.mjs';
import { helpChips, sideColumn } from '../lib/ui/index.mjs';
import * as ladder from '../lib/widgets/help-ladder.mjs';
import { hintCost, ladderRungs, ladderText, LADDER, LADDER_RUNGS, mountHintLadder, mountSide, PENALTY, RULE, ruleText, starsLabel, validateHelps } from '../lib/widgets/help-ladder.mjs';
import { RULE as SORT_RULE, PENALTY as SORT_PENALTY } from '../lib/widgets/sort-it-view.mjs';
import { RULE as SPOT_RULE, PENALTY as SPOT_PENALTY } from '../lib/widgets/spot-it-view.mjs';
import { RULE as INCIDENT_RULE, PENALTY as INCIDENT_PENALTY } from '../lib/widgets/incident-view.mjs';

/** The column as Build it renders it: one count (`wrong`, labelled by score()), the star rule. */
const sideHtml = (id, { hints, title }) =>
  sideColumn({ id, titleHtml: title, counts: [{ key: 'wrong', label: '' }], hints, ruleHtml: RULE });

test('help-ladder keeps the behaviour; the markup lives in the kit (lib/ui/side.mjs)', () => {
  assert.deepEqual(Object.keys(ladder).sort(), ['HINT_TIERS', 'LADDER', 'LADDER_RUNGS', 'PENALTY', 'RULE', 'boardStars', 'hintCost', 'ladderRungs', 'ladderText', 'mountHintLadder', 'mountSide', 'ruleText', 'starsLabel', 'validateHelps']);
});

test('LADDER_RUNGS is the same ladder as rungs, from the same rule', () => {
  assert.deepEqual(ladderRungs((p) => (p <= 1 ? 5 - p : 1)).map(({ from, stars }) => [from, stars]), [[0, 5], [1, 4], [2, 1]]);
  assert.equal(LADDER_RUNGS.length, 5);
  assert.deepEqual(LADDER_RUNGS.map((r) => r.stars), [5, 4, 3, 2, 1]);
});

test('LADDER is generated from scoreStars', () => {
  assert.equal(LADDER, '0 penalties give 5 stars, 1 gives 4, 2 gives 3, 3 or 4 give 2, more give 1.');
  // A different rule: the generator reads the rule it is given.
  assert.equal(ladderText((p) => (p <= 1 ? 5 - p : 1)), '0 penalties give 5 stars, 1 gives 4, more give 1.');
});

// Pinned verbatim: these are what the player reads beside the board today.
const LADDER_TEXT = '0 penalties give 5 stars, 1 gives 4, 2 gives 3, 3 or 4 give 2, more give 1.';
test('the side-column RULEs are unchanged and composed from PENALTY and LADDER', () => {
  assert.equal(
    RULE,
    `Stars count this board only: a wrong drop, a failed Check, a wrong pick, a hint. ${LADDER_TEXT} Retrying is free.`,
  );
  assert.equal(SORT_RULE, `Stars count this board only: a wrong placement, a hint. ${LADDER_TEXT} Retrying is free.`);
  assert.equal(
    SPOT_RULE,
    `Stars count this board only: a failed Check, a hint. ${LADDER_TEXT} Picking lines, and checking the same picks again, are free.`,
  );
  assert.equal(
    INCIDENT_RULE,
    `Stars count this board only: a misleading view, running out of error budget, a wrong pick, a hint. ${LADDER_TEXT} Retrying is free.`,
  );
  for (const [rule, penalty] of [[RULE, PENALTY], [SORT_RULE, SORT_PENALTY], [SPOT_RULE, SPOT_PENALTY], [INCIDENT_RULE, INCIDENT_PENALTY]]) {
    assert.equal(rule, ruleText(penalty));
    assert.equal(Object.isFrozen(penalty), true);
  }
});

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

test('helpChips: one chip per help, saying on or off in words', () => {
  makeDom();
  document.body.innerHTML = helpChips('x', [
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

/** The right column on a fresh DOM; its stars come from the board's own counts passed to score(). */
function sideSetup({ hints = true } = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const ctx = { ovBody: dom.body, escapeHtml, reduceMotion: false };
  dom.body.innerHTML = `<div id="box">${sideHtml('s1', { hints, title: 'Trace assembled' })}</div>`;
  const swirls = [];
  const side = mountSide(ctx, q('#box'), 's1', { swirl: (host, opts) => swirls.push(opts.reduced) });
  return { ctx, side, swirls, focus };
}

test('the score card: counts, five stars from this board\'s own wrong count and hints (boardStars), muted until success, then earned', () => {
  const { side } = sideSetup();
  side.score({ wrong: 0, wrongLabel: 'wrong drops', hints: 0, done: false });
  assert.equal(q('#s1-stars').getAttribute('aria-label'), '5 of 5 stars still possible');
  assert.deepEqual(qa('#s1-stars [data-star]').map((s) => s.dataset.star), ['possible', 'possible', 'possible', 'possible', 'possible']);
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
  const ctx = { ovBody: dom.body, escapeHtml, reduceMotion: true };
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

test('S1 score takes more counts (the incident board\'s misleading views and budget run out): shown, folded into the stars and into the hint cost', () => {
  makeDom();
  document.body.innerHTML = `<div id="box">${sideColumn({
    id: 'x',
    titleHtml: 'Incident resolved',
    counts: [{ key: 'wrong', label: '' }, { key: 'misleading', label: 'misleading views' }, { key: 'budget', label: 'budget run out' }],
    hints: true,
    ruleHtml: RULE,
  })}</div>`;
  const side = mountSide({ ovBody: document.body, escapeHtml }, q('#box'), 'x');
  const n = side.score({ wrong: 1, wrongLabel: 'wrong picks', hints: 0, more: { misleading: 1, budget: 1 }, done: false });
  assert.equal(n, 2, 'three penalties: 2 stars');
  assert.equal(q('#x-wrong').textContent, '1');
  assert.equal(q('#x-misleading').textContent, '1');
  assert.equal(q('#x-budget').textContent, '1');
  assert.equal(q('#x-hints').textContent, '0');
  assert.equal(q('#x-stars').getAttribute('aria-label'), '2 of 5 stars still possible');
  side.hintUi({ label: 'Hint 1 of 3', disabled: false, tierHtml: '0 of 3 used' });
  assert.equal(q('#x-hint-cost').textContent, 'costs no star now', 'a fourth penalty still gives 2 stars');
  side.score({ wrong: 0, wrongLabel: 'wrong picks', hints: 0, more: { misleading: 1, budget: 0 }, done: false });
  assert.equal(q('#x-misleading').textContent, '1');
  assert.equal(q('#x-budget').textContent, '0');
  assert.equal(q('#x-stars').getAttribute('aria-label'), '4 of 5 stars still possible');
  side.hintUi({ label: 'Hint 1 of 3', disabled: false, tierHtml: '0 of 3 used' });
  assert.equal(q('#x-hint-cost').textContent, 'costs 1 star');
  assert.equal(side.score({ wrong: 0, wrongLabel: 'wrong picks', hints: 0, done: false }), 5, 'without more: no extra penalty');
});

test('ladderText: a rung three or more counts wide reads "from to to"; two read "from or to"', () => {
  assert.equal(ladderText((p) => (p <= 1 ? 5 - p : p <= 5 ? 3 : 1)), '0 penalties give 5 stars, 1 gives 4, 2 to 5 give 3, more give 1.');
  assert.equal(ladderText((p) => (p <= 2 ? 5 : p <= 4 ? 3 : 1)), '0 to 2 penalties give 5 stars, 3 or 4 give 3, more give 1.');
});

test('ladderText: a rule that never changes says any number of penalties; a late change is not cut off', () => {
  assert.equal(ladderText(() => 3), 'any number of penalties give 3 stars.');
  assert.equal(ladderText((p) => (p < 60 ? 5 : 1)), '0 to 59 penalties give 5 stars, more give 1.');
});

test('ladderText: a rung wider than the margin is read as the last rung (the documented limit)', () => {
  assert.equal(ladderText((p) => (p < 4899 ? 5 : 1)), 'any number of penalties give 5 stars.');
});

test('ladderText: a rule that never settles is refused, not printed', () => {
  assert.throws(() => ladderText((p) => p % 2), /still changing/);
});

test('mountHintLadder: succeed() alone leaves the Hint button disabled and the stars final', () => {
  const dom = makeDom();
  recordFocus(dom.window);
  dom.body.innerHTML = `<div id="box">${sideHtml('s3', { hints: true, title: 'Done' })}</div>`;
  const ctx = { ovBody: dom.body, escapeHtml, mistake() {}, hint() {} };
  const lad = mountHintLadder(ctx, q('#box'), 's3', { wrongNouns: ['failed Check', 'failed Checks'], hint: () => ({ html: '' }), fill() {} });
  assert.equal(q('#s3-hint').disabled, false);
  lad.succeed();
  assert.equal(lad.done, true);
  assert.equal(q('#s3-hint').disabled, true);
  assert.equal(q('#s3-stars').getAttribute('aria-label'), '5 of 5 stars');
});

test('#17 P3 mountSide counts a guide ask in the hints shown, the stars and the hint cost, and keeps it across score()', () => {
  const { ctx, side } = sideSetup();
  ctx.hint = () => {};
  withGuide(ctx);
  const side2 = mountSide(ctx, q('#box'), 's1', {});
  side2.score({ wrong: 2, wrongLabel: 'wrong drops', hints: 0, done: false });
  side2.hintUi({ label: 'Hint 1 of 3', disabled: false, tierHtml: '' });
  assert.equal(q('#s1-hint-cost').textContent, 'costs 1 star', 'two penalties: 3 stars, one more gives 2');
  ctx.askedGuide();
  assert.equal(q('#s1-hints').textContent, '1', 'the card shows the ask at once');
  assert.equal(q('#s1-stars').getAttribute('aria-label'), '2 of 5 stars still possible');
  assert.equal(q('#s1-hint-cost').textContent, 'costs no star now', 'three penalties: 2 stars, a fourth still gives 2');
  assert.equal(side2.hintsShown(2), 3);
  side2.score({ wrong: 2, wrongLabel: 'wrong drops', hints: 0, done: false });
  side2.hintUi({ label: 'Hint 1 of 3', disabled: false, tierHtml: '' });
  assert.equal(q('#s1-hint-cost').textContent, 'costs no star now', 'the ask survives a later score() and hintUi()');
  const n = side2.score({ wrong: 1, wrongLabel: 'wrong drops', hints: 1, done: false });
  assert.equal(n, 2, 'one wrong, one hint and one ask: three penalties');
  assert.equal(q('#s1-hints').textContent, '2', 'the ask survives a later score()');
  assert.equal(side2.hintsShown(1), 2);
  assert.equal(side.hintsShown(0), 0, 'a column that was never asked adds nothing');
});

test('#17 P3 mountHintLadder (Query it, Configure it) states the asks in its success line', () => {
  const dom = makeDom();
  recordFocus(dom.window);
  dom.body.innerHTML = `<div id="box">${sideHtml('s4', { hints: true, title: 'Done' })}</div>`;
  const ctx = withGuide({ ovBody: dom.body, escapeHtml, mistake() {}, hint() {} });
  const lad = mountHintLadder(ctx, q('#box'), 's4', { wrongNouns: ['failed Check', 'failed Checks'], hint: () => ({ html: '' }), fill() {} });
  ctx.askedGuide();
  lad.succeed();
  assert.equal(q('#s4-win-stars').textContent, '4 of 5 stars: 0 failed Checks, 1 hint.');
});

test('#17 P3 a solved board ignores later asks, and an earlier step\'s board never reacts to the next step\'s asks', () => {
  const dom = makeDom();
  recordFocus(dom.window);
  dom.body.innerHTML = `<div id="b1">${sideHtml('one', { hints: true, title: 'A' })}</div><div id="b2">${sideHtml('two', { hints: true, title: 'B' })}</div>`;
  const ctx = withGuide({ ovBody: dom.body, escapeHtml, mistake() {}, hint() {} });
  const first = mountSide(ctx, q('#b1'), 'one', {});
  first.score({ wrong: 0, wrongLabel: 'wrong', hints: 0, done: false });
  first.succeed({ line: 'done' });
  first.score({ wrong: 0, wrongLabel: 'wrong', hints: 0, done: true });
  const second = mountSide(ctx, q('#b2'), 'two', {});
  second.score({ wrong: 0, wrongLabel: 'wrong', hints: 0, done: false });
  ctx.askedGuide();
  assert.equal(q('#one-hints').textContent, '0', 'the solved board did not repaint');
  assert.equal(first.hintsShown(0), 0, 'and did not count the ask');
  assert.equal(q('#two-hints').textContent, '1', 'the live board did');
});
