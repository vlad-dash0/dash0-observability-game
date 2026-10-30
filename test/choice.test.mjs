// The shared Choice widget (lib/widgets/choice.mjs; docs/M1-DESIGN.md §4.0): markup in
// ctx.shuffle order, one mistake per wrong pick, every outcome in words, and focus
// that never drops to the page. Level 1.2 runs on it (test/naming-your-service.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';

// Render order is the reverse of this (the stub shuffle reverses): d, c, b, a.
const CHOICES = [
  { key: 'a', label: 'Alpha', why: 'a is not it.' },
  { key: 'b', label: 'Bravo', right: true, why: 'b is it.' },
  { key: 'c', label: 'Charlie', why: 'c is not it.' },
  { key: 'd', label: 'Delta', why: 'd is not it.' },
];

/** A counting stub ctx on a fresh DOM; `next` is an action button for onRight. */
function setup(choices = CHOICES, id = 'q1') {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, onRight: 0 };
  const ctx = {
    ovBody: dom.body,
    ovActions: dom.actions,
    escapeHtml,
    shuffle: (arr) => [...arr].reverse(),
    mistake() {
      counts.mistakes += 1;
    },
  };
  dom.body.innerHTML = choiceHtml(ctx, choices, { id });
  dom.actions.innerHTML = '<button id="next" disabled>Next</button>';
  const onRight = () => {
    counts.onRight += 1;
    const next = dom.actions.querySelector('#next');
    next.disabled = false;
    return next;
  };
  return { ctx, dom, focus, counts, onRight };
}

const picks = () => qa('[data-pick]').map((b) => b.dataset.pick);
const enabled = () => qa('[data-pick]').filter((b) => !b.disabled).map((b) => b.dataset.pick);
const feedback = (id = 'q1') => q(`#${id}-feedback`).textContent;

test('choiceHtml renders the choices in ctx.shuffle order and a live, focusable feedback region', () => {
  setup();
  assert.equal(q('.choices').getAttribute('data-choice'), 'q1');
  assert.deepEqual(picks(), ['d', 'c', 'b', 'a']);
  assert.deepEqual(qa('[data-choice="q1"] button.choice').map((b) => b.textContent), ['Delta', 'Charlie', 'Bravo', 'Alpha']);
  const fb = q('#q1-feedback');
  assert.equal(fb.className, 'feedback');
  assert.equal(fb.getAttribute('role'), 'status');
  assert.equal(fb.getAttribute('aria-live'), 'polite');
  assert.equal(fb.getAttribute('tabindex'), '-1');
});

test('mounting focuses the first choice and changes nothing else', () => {
  const { ctx, focus, counts, onRight } = setup();
  mountChoice(ctx, CHOICES, { id: 'q1', onRight });
  assert.equal(focus.last(), 'pick:d');
  assert.deepEqual(enabled(), ['d', 'c', 'b', 'a']);
  assert.deepEqual(counts, { mistakes: 0, onRight: 0 });
  assert.equal(feedback(), '');
});

test('a wrong pick costs one mistake, is marked and disabled, and says why in words', () => {
  const { ctx, focus, counts, onRight } = setup();
  mountChoice(ctx, CHOICES, { id: 'q1', onRight });
  click('[data-pick="c"]');
  assert.equal(counts.mistakes, 1);
  assert.equal(counts.onRight, 0);
  assert.equal(q('[data-pick="c"]').disabled, true);
  assert.equal(q('[data-pick="c"]').classList.contains('wrong'), true);
  assert.equal(q('[data-pick="c"]').classList.contains('correct'), false);
  assert.deepEqual(enabled(), ['d', 'b', 'a'], 'only the wrong pick is disabled');
  assert.equal(feedback(), 'Not quite. c is not it.');
  assert.equal(q('#q1-feedback').className, 'feedback info show');
  assert.equal(focus.last(), 'pick:b', 'focus moves to the next enabled choice');
  assert.equal(q('#next').disabled, true, 'a wrong pick does not unlock Next');
});

test('the right pick locks every choice, says why, calls onRight once and focuses its return', () => {
  const { ctx, focus, counts, onRight } = setup();
  mountChoice(ctx, CHOICES, { id: 'q1', onRight });
  click('[data-pick="a"]');
  click('[data-pick="b"]');
  assert.deepEqual(counts, { mistakes: 1, onRight: 1 });
  assert.deepEqual(enabled(), [], 'every choice is disabled');
  assert.equal(q('[data-pick="b"]').classList.contains('correct'), true);
  assert.equal(q('[data-pick="b"]').classList.contains('wrong'), false);
  assert.equal(feedback(), 'Right. b is it.');
  assert.equal(q('#q1-feedback').className, 'feedback good show');
  assert.equal(focus.last(), '#next');
  assert.deepEqual(focus.unfocusable(), [], 'focused only enabled, connected elements');
});

test('after a wrong pick focus wraps around and skips disabled choices', () => {
  const { ctx, focus, onRight } = setup();
  mountChoice(ctx, CHOICES, { id: 'q1', onRight });
  // Render order d, c, b, a.
  click('[data-pick="a"]');
  assert.equal(focus.last(), 'pick:d', 'from the last choice it wraps to the first');
  click('[data-pick="c"]');
  assert.equal(focus.last(), 'pick:b');
  click('[data-pick="d"]');
  assert.equal(focus.last(), 'pick:b', 'skips c (disabled) to b');
  assert.deepEqual(focus.unfocusable(), []);
});

test('an onRight that returns nothing hands focus to the feedback region', () => {
  const { ctx, focus } = setup();
  mountChoice(ctx, CHOICES, { id: 'q1', onRight: () => undefined });
  click('[data-pick="b"]');
  assert.equal(focus.last(), '#q1-feedback');
});

test('two choices on one screen keep their own buttons and feedback', () => {
  const { ctx, dom, counts, onRight } = setup();
  const other = [
    { key: 'x', label: 'X', right: true, why: 'x is it.' },
    { key: 'y', label: 'Y', why: 'y is not it.' },
  ];
  dom.body.innerHTML += choiceHtml(ctx, other, { id: 'q2' });
  mountChoice(ctx, CHOICES, { id: 'q1', onRight });
  mountChoice(ctx, other, { id: 'q2', onRight });
  click('[data-pick="y"]');
  assert.equal(feedback('q2'), 'Not quite. y is not it.');
  assert.equal(feedback('q1'), '');
  click('[data-pick="x"]');
  assert.deepEqual(enabled(), ['d', 'c', 'b', 'a'], 'q2 being answered does not lock q1');
  assert.equal(counts.mistakes, 1);
});

test('mountChoice throws a TypeError unless exactly one choice is right', () => {
  const none = CHOICES.map(({ right, ...c }) => c);
  const two = CHOICES.map((c) => (c.key === 'a' ? { ...c, right: true } : c));
  for (const [name, choices] of [['none', none], ['two', two]]) {
    const { ctx, counts, onRight } = setup(choices);
    assert.throws(() => mountChoice(ctx, choices, { id: 'q1', onRight }), TypeError, name);
    assert.equal(typeof q('[data-pick="a"]').onclick, 'object', `${name}: nothing was wired`);
    assert.equal(counts.mistakes, 0);
  }
});
