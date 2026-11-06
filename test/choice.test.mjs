// The shared Choice widget (lib/widgets/choice.mjs; docs/M1-DESIGN.md §4.0): markup in
// ctx.shuffle order, one mistake per wrong pick, every outcome in words, and focus
// that never drops to the page. Level 1.2 runs on it (test/naming-your-service.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { choiceHtml, mountChoice, validateChoiceSpec } from '../lib/widgets/choice.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import nys from '../levels/naming-your-service.mjs';

// Render order is the reverse of this (the stub shuffle reverses): d, c, b, a.
const CHOICES = [
  { key: 'a', label: 'Alpha', why: 'a is not it.' },
  { key: 'b', label: 'Bravo', right: true, why: 'b is it.' },
  { key: 'c', label: 'Charlie', why: 'c is not it.' },
  { key: 'd', label: 'Delta', why: 'd is not it.' },
];

/** A counting stub ctx on a fresh DOM; `next` is an action button for onRight. */
function setup(choices = CHOICES, id = 'q1', extra = {}) {
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
  dom.body.innerHTML = choiceHtml(ctx, choices, { id, ...extra });
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

test('choiceHtml renders the choices in ctx.shuffle order and a live, focusable feedback region, hidden until set', () => {
  setup();
  assert.deepEqual(picks(), ['d', 'c', 'b', 'a']);
  assert.deepEqual(qa('#q1-choices [data-pick]').map((b) => b.textContent), ['Delta', 'Charlie', 'Bravo', 'Alpha']);
  assert.deepEqual(qa('[data-pick]').map((b) => b.getAttribute('type')), ['button', 'button', 'button', 'button']);
  assert.deepEqual(qa('[data-pick]').map((b) => b.hasAttribute('data-state')), [false, false, false, false]);
  const fb = q('#q1-feedback');
  assert.equal(fb.hidden, true);
  assert.equal(fb.hasAttribute('data-tone'), false);
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
  assert.equal(q('[data-pick="c"]').getAttribute('data-state'), 'wrong');
  assert.deepEqual(enabled(), ['d', 'b', 'a'], 'only the wrong pick is disabled');
  assert.equal(feedback(), 'Not quite. c is not it.');
  // D7: a wrong answer costs a star, so it is the error tone, not neutral information.
  assert.equal(q('#q1-feedback').getAttribute('data-tone'), 'error');
  assert.equal(q('#q1-feedback').hidden, false);
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
  assert.deepEqual(qa('[data-pick]').map((b) => `${b.dataset.pick}:${b.getAttribute('data-state') ?? ''}`), ['d:', 'c:', 'b:correct', 'a:wrong']);
  assert.equal(feedback(), 'Right. b is it.');
  assert.equal(q('#q1-feedback').getAttribute('data-tone'), 'success');
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

test('an id that is not a plain token is refused before it reaches a selector', () => {
  const { ctx, onRight } = setup();
  assert.throws(() => mountChoice(ctx, CHOICES, { id: 'a"b', onRight }), { name: 'TypeError', message: /plain token/ });
});

test('a key with quotes and markup characters round-trips through data-pick and still plays', () => {
  const key = `x"y'z<&>`;
  const choices = [
    { key, label: 'Odd', right: true, why: 'odd is it.' },
    { key: 'plain', label: 'Plain', why: 'plain is not it.' },
  ];
  const { ctx, counts, onRight } = setup(choices);
  assert.equal(qa('[data-pick]').length, 2, 'one button per choice');
  assert.deepEqual(picks(), ['plain', key]);
  mountChoice(ctx, choices, { id: 'q1', onRight });
  click(qa('[data-pick]').find((b) => b.dataset.pick === key));
  assert.equal(feedback(), 'Right. odd is it.');
  assert.equal(counts.onRight, 1);
});

test('a disabled choice ignores a click that gets through anyway', () => {
  const { ctx, counts, onRight } = setup();
  mountChoice(ctx, CHOICES, { id: 'q1', onRight });
  click('[data-pick="b"]');
  q('[data-pick="a"]').onclick({});
  q('[data-pick="b"]').onclick({});
  assert.deepEqual(counts, { mistakes: 0, onRight: 1 });
  assert.equal(feedback(), 'Right. b is it.');
});

test('mountChoice refuses an id that is not a string', () => {
  const { ctx, onRight } = setup(CHOICES, 'nys');
  assert.throws(() => mountChoice(ctx, CHOICES, { id: ['nys'], onRight }), { name: 'TypeError', message: /string/ });
});

test('mountChoice refuses duplicate keys', () => {
  const dup = [...CHOICES, { key: 'a', label: 'Again', why: 'again.' }];
  const { ctx, onRight } = setup(dup);
  assert.throws(() => mountChoice(ctx, dup, { id: 'q1', onRight }), { name: 'TypeError', message: /unique/ });
});

test('mountChoice refuses a choice without a string why', () => {
  const noWhy = CHOICES.map((c) => (c.key === 'c' ? { key: 'c', label: 'Charlie' } : c));
  const { ctx, onRight } = setup(noWhy);
  assert.throws(() => mountChoice(ctx, noWhy, { id: 'q1', onRight }), { name: 'TypeError', message: /why/ });
});

test('mountChoice refuses choices that differ from the rendered buttons', () => {
  const fewer = CHOICES.filter((c) => c.key !== 'd');
  const more = [...CHOICES, { key: 'e', label: 'Echo', why: 'e is not it.' }];
  for (const [name, choices] of [['fewer', fewer], ['more', more]]) {
    const { ctx, onRight } = setup();
    assert.throws(() => mountChoice(ctx, choices, { id: 'q1', onRight }), { name: 'TypeError', message: /rendered/ }, name);
  }
});

test('focus goes to the feedback when onRight returns a disabled, detached or non-element target', () => {
  const targets = {
    disabled: () => q('#next'),
    detached: () => globalThis.document.createElement('button'),
    false: () => false,
  };
  for (const [name, target] of Object.entries(targets)) {
    const { ctx, focus } = setup();
    mountChoice(ctx, CHOICES, { id: 'q1', onRight: target });
    click('[data-pick="b"]');
    assert.equal(focus.last(), '#q1-feedback', name);
    assert.deepEqual(focus.unfocusable(), [], name);
  }
});

test('labelledBy names the choices as a group; without it there is no group role', () => {
  setup(CHOICES, 'q1', { labelledBy: 'q1-question' });
  assert.equal(q('#q1-choices').getAttribute('role'), 'group');
  assert.equal(q('#q1-choices').getAttribute('aria-labelledby'), 'q1-question');
  setup();
  assert.equal(q('#q1-choices').hasAttribute('role'), false);
  assert.equal(q('#q1-choices').hasAttribute('aria-labelledby'), false);
});

test('level 1.2 labels both of its choice groups with their question', () => {
  const dom = makeDom();
  const ctx = createLevelContext({
    level: { ...nys, scored: true, scoring: { parMs: null } },
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => 0,
    shuffle: (a) => a,
    onFinish: () => {},
    signal: new AbortController().signal,
  });
  nys.run(ctx);
  const question = () => q(`#${q('#nys-choices').getAttribute('aria-labelledby')}`)?.textContent;
  assert.equal(question(), 'What service name does its telemetry show up under?');
  click('[data-pick="fallback"]');
  click('#nys-next');
  q('#nys-env').value = 'OTEL_SERVICE_NAME=checkout\nOTEL_RESOURCE_ATTRIBUTES=service.version=1.4.2,deployment.environment.name=production';
  click('#nys-check');
  click('#nys-next');
  assert.equal(question(), 'Which service name does the SDK report?');
});

test('choiceHtml and mountChoice refuse a key that is not a non-empty string', () => {
  for (const [name, bad] of [['number', 1], ['empty', '']]) {
    const choices = CHOICES.map((c) => (c.key === 'c' ? { ...c, key: bad } : c));
    const { ctx, onRight } = setup();
    assert.throws(() => choiceHtml(ctx, choices, { id: 'q1' }), { name: 'TypeError', message: /^choice "q1": .*non-empty string/ }, name);
    assert.throws(() => mountChoice(ctx, choices, { id: 'q1', onRight }), { name: 'TypeError', message: /non-empty string/ }, name);
  }
});

test('the rendered keys are compared one by one, so a key holding a newline cannot pose as two', () => {
  const two = [
    { key: 'a', label: 'A', why: 'a.' },
    { key: 'b', label: 'B', right: true, why: 'b.' },
  ];
  const { ctx, onRight } = setup(two);
  const one = [{ key: 'a\nb', label: 'AB', right: true, why: 'ab.' }];
  assert.throws(() => mountChoice(ctx, one, { id: 'q1', onRight }), { name: 'TypeError', message: /rendered/ });
});

test('choiceHtml refuses a labelledBy that is not a plain token', () => {
  const { ctx } = setup();
  for (const bad of ['', 'a"b', 'two words']) {
    assert.throws(() => choiceHtml(ctx, CHOICES, { id: 'q1', labelledBy: bad }), { name: 'TypeError', message: /labelledBy/ }, JSON.stringify(bad));
  }
});

test('focus goes to the feedback when onRight returns an element that cannot take focus', () => {
  const { ctx, dom, focus } = setup();
  dom.actions.innerHTML += '<div id="plain">not focusable</div>';
  mountChoice(ctx, CHOICES, { id: 'q1', onRight: () => dom.actions.querySelector('#plain') });
  click('[data-pick="b"]');
  assert.equal(focus.last(), '#q1-feedback');
});

test('mountChoice refuses choices that are not an array, naming the question', () => {
  const { ctx, onRight } = setup();
  assert.throws(() => mountChoice(ctx, { a: CHOICES[0] }, { id: 'q1', onRight }), { name: 'TypeError', message: /^choice "q1": choices must be an array/ });
});

test('mountChoice refuses a null choice, naming the question', () => {
  const { ctx, onRight } = setup();
  assert.throws(() => mountChoice(ctx, [...CHOICES, null], { id: 'q1', onRight }), { name: 'TypeError', message: /^choice "q1": choice 4 is not an object/ });
});

test('validateChoiceSpec: a valid spec has no problems', () => {
  assert.deepEqual(validateChoiceSpec(CHOICES), []);
});

test('validateChoiceSpec: zero or two right answers is a problem', () => {
  for (const [n, choices] of [
    [0, CHOICES.map((c) => ({ ...c, right: false }))],
    [2, CHOICES.map((c) => (c.key === 'a' ? { ...c, right: true } : c))],
  ]) {
    assert.deepEqual(validateChoiceSpec(choices), [`needs exactly one right answer, has ${n}`]);
  }
});

test('validateChoiceSpec: a duplicate key and a non-string why are problems', () => {
  assert.deepEqual(validateChoiceSpec(CHOICES.map((c) => (c.key === 'c' ? { ...c, key: 'a' } : c))), ['choice keys must be unique']);
  assert.deepEqual(validateChoiceSpec(CHOICES.map((c) => (c.key === 'c' ? { ...c, why: 3 } : c))), ['choice "c" needs a string why']);
});

test('validateChoiceSpec: null and non-arrays give a problem and never throw', () => {
  assert.deepEqual(validateChoiceSpec(null), ['choices must be an array']);
  assert.deepEqual(validateChoiceSpec([...CHOICES, null]), ['choice 4 is not an object']);
});

test('validateChoiceSpec collects every problem', () => {
  assert.deepEqual(validateChoiceSpec([null, { key: 'a', why: 1 }]), ['choice 0 is not an object', 'choice "a" needs a string why']);
  assert.deepEqual(validateChoiceSpec([null]), ['choice 0 is not an object']);
});

test('choiceHtml refuses choices that are not an array or hold a non-object, naming the question (#57)', () => {
  const { ctx } = setup();
  assert.throws(() => choiceHtml(ctx, { a: CHOICES[0] }, { id: 'q1' }), { name: 'TypeError', message: 'choice "q1": choices must be an array' });
  assert.throws(() => choiceHtml(ctx, undefined, { id: 'q1' }), { name: 'TypeError', message: 'choice "q1": choices must be an array' });
  for (const bad of [null, 'x', 7]) {
    assert.throws(() => choiceHtml(ctx, [CHOICES[0], bad], { id: 'q1' }), { name: 'TypeError', message: 'choice "q1": choice 1 is not an object' }, String(bad));
  }
});

test('labelledBy null means not given, like undefined (#57)', () => {
  setup(CHOICES, 'q1', { labelledBy: null });
  assert.equal(q('#q1-choices').hasAttribute('role'), false);
  assert.equal(q('#q1-choices').hasAttribute('aria-labelledby'), false);
});
