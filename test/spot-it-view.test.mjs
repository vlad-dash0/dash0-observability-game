// lib/widgets/spot-it-view.mjs on the kit (#160): the Spot it view model (spotView), its markup
// (a wide split: the board, then the kit side column with the score card and the success card),
// the mount (the one penalty, tones, focus, the hint ladder). Spec: docs/M1-DESIGN.md §4.4.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newSpotState } from '../lib/widgets/spot-it.mjs';
import { mountSpot, renderSpot, spotView } from '../lib/widgets/spot-it-view.mjs';
import { SPOT_RULE } from '../lib/widgets/spot-it-help.mjs';

// Deliberately not fault-first: s1 is a decoy before the fault s2.
function fixture() {
  return {
    id: 'bomb',
    target: 'metric',
    lines: [
      { id: 's1', text: 'http_requests_total{route="/cart"}' },
      { id: 's2', text: 'http_requests_total{user_id="8841"}' },
      { id: 's3', text: 'http_requests_total{method="GET"}' },
      { id: 's4', text: 'http_requests_total{trace_id="4bf9"}' },
    ],
    faults: ['s2', 's4'],
    whyNot: { s1: 'A route is a small, fixed set.' },
    explain: '<code>user_id</code> and <code>trace_id</code> explode cardinality.',
  };
}
const withHints = (extra = {}) => ({ ...fixture(), helps: { hints: true }, ...extra });

/**
 * A counting stub ctx on a fresh DOM with the widget rendered; `finish` is onComplete's target.
 * `shuffle` is ctx.shuffle (identity unless a test needs another draw). The swirl is injected
 * and records the `reduced` flag of each call.
 */
function setup(spec = fixture(), { shuffle = (a) => [...a], ...opts } = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, hints: 0, done: 0 };
  const swirls = [];
  const ctx = {
    ovBody: dom.body,
    ovActions: dom.actions,
    escapeHtml,
    signal: new AbortController().signal,
    shuffle,
    mistake() {
      counts.mistakes += 1;
    },
    hint() {
      counts.hints += 1;
    },
  };
  dom.body.innerHTML = renderSpot(spec, newSpotState(spec), { escapeHtml, ...opts });
  dom.actions.innerHTML = '<button id="finish" disabled>Finish</button>';
  const onComplete = () => {
    counts.done += 1;
    const fin = dom.actions.querySelector('#finish');
    fin.disabled = false;
    return fin;
  };
  const swirl = (host, o) => {
    swirls.push(o.reduced);
  };
  return { ctx, dom, focus, counts, swirls, mount: (extra = {}) => mountSpot(ctx, spec, { onComplete, swirl, ...extra }) };
}

const pressed = () => qa('[data-line]').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.line);
const hintedLines = () => qa('[data-line][data-hinted]').map((b) => b.dataset.line);
const correctLines = () => qa('[data-line][data-state="correct"]').map((b) => b.dataset.line);
const feedback = () => q('#bomb-feedback [data-feedback-text]').textContent;
const tone = () => q('#bomb-feedback').getAttribute('data-tone');
const text = (sel) => q(sel).textContent.replace(/\s+/g, ' ').trim();
const pickAll = (...ids) => ids.forEach((id) => click(`[data-line="${id}"]`));
const check = () => click('#bomb-check');

// test/design-system.test.mjs RETIRED, the ones the old Spot it markup used.
const RETIRED = ['btn', 'feedback', 'good', 'info', 'show', 'spot-line'];

// ---- spotView: the board as data --------------------------------------------------------

test('spotView: lines in authored order with pressed and hinted from the inputs; correct only once solved', () => {
  const spec = fixture();
  const v = spotView(spec, { selected: ['s1', 's3'], tried: [], solved: false }, { hinted: ['s2'] });
  assert.equal(v.id, 'bomb');
  assert.equal(v.target, 'metric');
  assert.equal(v.locked, false);
  assert.deepEqual(v.lines.map((l) => l.id), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(v.lines.map((l) => l.text), spec.lines.map((l) => l.text));
  assert.deepEqual(v.lines.map((l) => l.pressed), [true, false, true, false]);
  assert.deepEqual(v.lines.map((l) => l.hinted), [false, true, false, false]);
  assert.deepEqual(v.lines.map((l) => l.correct), [false, false, false, false], 'nothing is correct before success');
  const solved = spotView(spec, { selected: ['s2', 's4'], tried: [], solved: true });
  assert.equal(solved.locked, true);
  assert.deepEqual(solved.lines.map((l) => l.correct), [false, true, false, true]);
  assert.deepEqual(solved.lines.map((l) => l.hinted), [false, false, false, false], 'no hinted list, nothing outlined');
});

test('spotView: correct marks the picks of a solved state, never reads the answer', () => {
  // A solved state whose picks are not the fault set: a view reading spec.faults marks s2 and s4.
  const v = spotView(fixture(), { selected: ['s1'], tried: [], solved: true });
  assert.deepEqual(v.lines.map((l) => l.correct), [true, false, false, false]);
});

// ---- kit markup ------------------------------------------------------------------------------

test('renderSpot: kit markup in one split; the side column with a hidden success card and zeroed score; no retired class', () => {
  setup();
  assert.equal(qa('[data-spot="bomb"] .ui-split').length, 1, 'one board-and-side split');
  assert.equal(qa('.ui-split-side [id="bomb-win"]').length, 1, 'the success card is in the side column');
  assert.equal(q('#bomb-win').hasAttribute('hidden'), true, 'hidden until success');
  assert.equal(q('#bomb-wrong').textContent, '0');
  assert.equal(q('#bomb-hints').textContent, '0');
  const group = q('[data-line="s1"]').closest('[role="group"]');
  assert.ok(group, 'the lines are in a group');
  assert.equal(group.getAttribute('aria-describedby'), 'bomb-instr');
  assert.equal(qa('[id="bomb-instr"]').length, 1, 'one instruction line');
  assert.equal(q('#bomb-feedback').hasAttribute('hidden'), true, 'hidden until something happens');
  assert.equal(q('#bomb-check').localName, 'button');
  const classes = qa('[data-spot], [data-spot] *').flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean);
  assert.deepEqual(classes.filter((c) => RETIRED.includes(c)), [], 'no retired class');
});

test('renderSpot: hints off (and no helps key) has no Hint button, the tier line says so, the chips say hints off; hints on has one Hint button', () => {
  for (const spec of [fixture(), { ...fixture(), helps: { hints: false } }]) {
    setup(spec);
    assert.equal(qa('[id="bomb-hint"]').length, 0, JSON.stringify(spec.helps));
    assert.equal(text('#bomb-hint-tier'), 'No hints on this level.');
    assert.equal(text('#bomb-helps'), 'Helps: Hints off');
  }
  setup(withHints());
  assert.equal(qa('[id="bomb-hint"]').length, 1);
  assert.equal(q('#bomb-hint').localName, 'button');
  assert.equal(text('#bomb-helps'), 'Helps: Hints on');
});

test('renderSpot: one unpressed button per line with its text as the name, a Check button, a live feedback region', () => {
  setup();
  assert.deepEqual(qa('[data-line]').map((b) => b.dataset.line), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(qa('[data-line]').map((b) => b.textContent), fixture().lines.map((l) => l.text));
  assert.deepEqual(pressed(), []);
  assert.equal(qa('[data-line]').every((b) => b.localName === 'button'), true);
  assert.equal(q('#bomb-check').textContent, 'Check');
  const fb = q('#bomb-feedback');
  assert.equal(fb.getAttribute('role'), 'status');
  assert.equal(fb.getAttribute('aria-live'), 'polite');
  assert.equal(fb.getAttribute('tabindex'), '-1');
  assert.equal(q('[data-spot]').hasAttribute('role'), false);
  assert.equal(q('[data-spot]').getAttribute('data-target'), 'metric');
});

test('renderSpot: line text is escaped plain text; labelledBy makes a group; a bad labelledBy or a non-token id is a TypeError', () => {
  const spec = fixture();
  spec.lines[0].text = 'x{a="<img src=x onerror=alert(1)>"}';
  const dom = makeDom();
  dom.body.innerHTML = renderSpot(spec, newSpotState(spec), { escapeHtml, labelledBy: 'spot-q' });
  assert.equal(qa('img').length, 0);
  assert.equal(q('[data-line="s1"]').textContent, spec.lines[0].text);
  assert.equal(q('[data-spot]').getAttribute('data-spot'), 'bomb');
  assert.equal(q('[data-spot]').getAttribute('role'), 'group');
  assert.equal(q('[data-spot]').getAttribute('aria-labelledby'), 'spot-q');
  for (const bad of ['', 'a"b', 'two words']) {
    assert.throws(() => renderSpot(spec, newSpotState(spec), { escapeHtml, labelledBy: bad }), { name: 'TypeError', message: /labelledBy/ }, JSON.stringify(bad));
  }
  assert.throws(() => renderSpot({ ...spec, id: 'a"b' }, newSpotState(spec), { escapeHtml }), { name: 'TypeError' });
});

test('no Alpine attributes, no style= and no on*= attributes, before and during play', () => {
  const { dom, mount } = setup(withHints());
  const bad = (when) => {
    const html = dom.body.innerHTML;
    assert.equal(/\s(?:x-[\w.:-]+|@[\w.:-]+|:[\w.:-]+)=/.test(html), false, `${when}: Alpine`);
    assert.equal(/\sstyle=/.test(html), false, `${when}: style=`);
    assert.equal(/\son\w+=/.test(html), false, `${when}: on*=`);
  };
  bad('rendered');
  mount();
  pickAll('s1');
  check();
  bad('wrong');
  click('#bomb-hint');
  click('#bomb-hint');
  bad('hinted');
  click('[data-line="s1"]');
  pickAll('s2', 's4');
  check();
  bad('right');
});

// ---- the mount: picks, Check, tones, the one penalty -----------------------------------------

test('mounting focuses the first line and changes nothing else', () => {
  const { focus, counts, mount } = setup();
  mount();
  assert.equal(focus.last(), 'line:s1');
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 0 });
  assert.equal(feedback(), '');
});

test('clicking a line toggles it, in place, and keeps focus there; line order stays as authored', () => {
  const { focus, counts, mount } = setup(fixture(), { shuffle: (a) => [...a].reverse() });
  mount();
  assert.deepEqual(qa('[data-line]').map((b) => b.dataset.line), ['s1', 's2', 's3', 's4'], 'a reversing shuffle reorders nothing');
  const before = focus.names().length;
  click('[data-line="s3"]');
  assert.deepEqual(pressed(), ['s3']);
  click('[data-line="s1"]');
  assert.deepEqual(pressed(), ['s1', 's3']);
  click('[data-line="s3"]');
  assert.deepEqual(pressed(), ['s1']);
  assert.equal(counts.mistakes, 0, 'selecting is free');
  assert.equal(q('#bomb-wrong').textContent, '0');
  assert.deepEqual(focus.names().slice(before), [], 'no focus jumps while selecting');
});

test('Check with nothing selected is free, neutral, and asks for a pick', () => {
  const { counts, focus, mount } = setup();
  mount();
  check();
  assert.equal(counts.mistakes, 0);
  assert.equal(q('#bomb-wrong').textContent, '0');
  assert.equal(feedback(), 'Pick at least one line first.');
  assert.equal(tone(), 'neutral');
  assert.equal(q('#bomb-feedback').hasAttribute('hidden'), false);
  assert.equal(focus.last(), '#bomb-feedback');
});

test('a wrong pick costs one mistake, counts on the score card, is an error, and names why not without the answer', () => {
  const { counts, mount } = setup();
  mount();
  pickAll('s1', 's2');
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#bomb-wrong').textContent, '1');
  assert.equal(q('#bomb-wrong-label').textContent, 'failed Check');
  assert.equal(q('#bomb-stars').getAttribute('aria-label'), '4 of 5 stars still possible');
  assert.equal(feedback(), 'Not quite. 1 of your picks does not match the question. A route is a small, fixed set.');
  assert.equal(tone(), 'error', 'a wrong answer is an error (D7), not information');
  assert.equal(counts.done, 0);
});

test('a wrong pick without whyNot gets only the generic line; missing faults are named as incomplete; two failed Checks count two', () => {
  const { counts, mount } = setup();
  mount();
  pickAll('s3');
  check();
  assert.equal(feedback(), 'Not quite. 1 of your picks does not match the question.');
  click('[data-line="s3"]');
  pickAll('s2');
  check();
  assert.equal(counts.mistakes, 2);
  assert.equal(q('#bomb-wrong').textContent, '2');
  assert.equal(q('#bomb-wrong-label').textContent, 'failed Checks');
  assert.equal(q('#bomb-stars').getAttribute('aria-label'), '3 of 5 stars still possible');
  assert.equal(feedback(), 'Not quite. Everything you picked matches the question, but there is more.');
  assert.equal(tone(), 'error');
});

test('repeating the same wrong selection is free, neutral, and says so; a changed one costs again', () => {
  const { counts, mount } = setup();
  mount();
  pickAll('s1', 's2');
  check();
  check();
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(q('#bomb-wrong').textContent, '1');
  assert.equal(feedback(), 'You already checked these lines. Nothing new was counted.');
  assert.equal(tone(), 'neutral');
  pickAll('s3');
  check();
  assert.equal(counts.mistakes, 2);
  assert.equal(q('#bomb-wrong').textContent, '2');
  assert.equal(tone(), 'error');
});

test('a wrong selection checked again after a different wrong one is a repeat: the new copy, nothing new counted', () => {
  const { counts, mount } = setup();
  mount();
  pickAll('s1', 's2');
  check();
  click('[data-line="s2"]');
  check();
  assert.equal(counts.mistakes, 2);
  pickAll('s2');
  check();
  assert.equal(feedback(), 'You already checked these lines. Nothing new was counted.');
  assert.equal(tone(), 'neutral');
  assert.equal(counts.mistakes, 2);
  assert.equal(q('#bomb-wrong').textContent, '2');
});

test('exactly the fault set is right: explains, marks the picks correct, locks, completes once, shows the success card and focuses its heading', () => {
  const { counts, focus, swirls, mount } = setup();
  mount();
  pickAll('s1', 's2');
  check();
  click('[data-line="s1"]');
  pickAll('s4');
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Right. user_id and trace_id explode cardinality.');
  assert.equal(tone(), 'success');
  assert.equal(q('#bomb-feedback code') === null, false, 'explain is trusted HTML');
  assert.equal(qa('[data-line]').every((b) => b.disabled), true);
  assert.deepEqual(correctLines(), ['s2', 's4']);
  assert.equal(q('[data-line="s1"]').hasAttribute('data-state'), false);
  assert.equal(q('[data-line="s3"]').hasAttribute('data-state'), false);
  assert.equal(q('#bomb-check').disabled, true);
  assert.equal(counts.done, 1);
  assert.equal(q('#finish').disabled, false);
  assert.equal(focus.last(), '#bomb-win-title');
  assert.equal(q('#bomb-win').hasAttribute('hidden'), false, 'the success card is shown');
  assert.equal(text('#bomb-win-stars'), '4 of 5 stars: 1 failed Check, 0 hints.');
  assert.equal(q('#bomb-stars').getAttribute('aria-label'), '4 of 5 stars');
  assert.deepEqual(swirls, [false], 'the swirl plays once, motion allowed');
  assert.deepEqual(focus.unfocusable(), []);
  // Nothing counts after done, even a click that gets through anyway.
  q('#bomb-check').onclick?.({});
  q('[data-line="s1"]').onclick?.({});
  q('[data-line="s2"]').onclick?.({});
  assert.deepEqual(counts, { mistakes: 1, hints: 0, done: 1 }, 'nothing after completion counts');
  assert.deepEqual(pressed(), ['s2', 's4'], 'nothing after completion toggles');
  assert.deepEqual(swirls, [false]);
  assert.equal(feedback(), 'Right. user_id and trace_id explode cardinality.', 'nothing after done says anything');
  assert.equal(focus.last(), '#bomb-win-title');
});

test('a clean solve is 5 stars and says so', () => {
  const { counts, mount } = setup();
  mount();
  pickAll('s4', 's2');
  check();
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 1 });
  assert.equal(text('#bomb-win-stars'), '5 of 5 stars: 0 failed Checks, 0 hints.');
});

test('mounting throws a TypeError naming the spec for a bad spec, no onComplete, or no render', () => {
  const bad = fixture();
  bad.faults = [];
  const a = setup({ ...fixture() });
  a.dom.body.innerHTML = renderSpot(fixture(), newSpotState(fixture()), { escapeHtml });
  assert.throws(() => mountSpot(a.ctx, bad, { onComplete() {} }), { name: 'TypeError', message: /spot "bomb": invalid spec: .*faults/ });
  const b = setup();
  assert.throws(() => b.mount({ onComplete: undefined }), { name: 'TypeError', message: /onComplete/ });
  const c = setup();
  c.dom.body.innerHTML = '';
  assert.throws(() => c.mount(), { name: 'TypeError', message: /not rendered/ });
});

// ---- the hint ladder on the board -----------------------------------------------------------

const hintText = () => text('#bomb-hint-text');

test('three hint tiers after picking a decoy: the rule, two outlined lines, then the answer picked for you; hints, never mistakes', () => {
  const { counts, focus, swirls, mount } = setup(withHints(), { shuffle: (a) => [...a].reverse() });
  mount();
  pickAll('s1'); // a decoy, not checked
  assert.equal(text('#bomb-hint'), 'Hint 1 of 3');
  assert.equal(text('#bomb-hint-cost'), 'costs 1 star');
  assert.equal(q('#bomb-hint').disabled, false);

  click('#bomb-hint'); // tier 1: the rule
  assert.deepEqual(counts, { mistakes: 0, hints: 1, done: 0 });
  assert.equal(q('#bomb-hints').textContent, '1');
  assert.equal(hintText().startsWith('Hint 1 of 3'), true, hintText());
  assert.equal(hintText().includes(SPOT_RULE), true, 'no authored hint: the rule');
  assert.equal(text('#bomb-hint-tier').startsWith('1 of 3 used'), true);
  assert.deepEqual(hintedLines(), [], 'tier 1 outlines nothing');
  assert.deepEqual(pressed(), ['s1'], 'a hint changes no pick');

  click('#bomb-hint'); // tier 2: reverse draw, fault s4 and decoy s3 (s1 is picked, never the decoy)
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 });
  assert.deepEqual(hintedLines(), ['s3', 's4']);
  assert.deepEqual(pressed(), ['s1']);
  const tier2 = hintText();
  assert.equal(tier2.startsWith('Hint 2 of 3'), true, tier2);
  // Picking or unpicking an outlined line keeps the outlines and the paid text.
  click('[data-line="s3"]');
  assert.deepEqual(hintedLines(), ['s3', 's4']);
  click('[data-line="s3"]');
  assert.deepEqual(hintedLines(), ['s3', 's4']);
  assert.equal(hintText(), tier2, 'the paid tier-2 text stays');
  assert.equal(q('#bomb-wrong').textContent, '0');

  click('#bomb-hint'); // tier 3: picked for you
  assert.deepEqual(pressed(), ['s2', 's4'], 'exactly the answer: the decoy s1 is unpicked');
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 1 }, 'a hint solve costs hints, never a mistake, and completes once');
  assert.equal(q('#bomb-hints').textContent, '3');
  assert.equal(q('#bomb-wrong').textContent, '0');
  assert.equal(text('#bomb-win-stars'), '2 of 5 stars: 0 failed Checks, 3 hints.');
  assert.equal(tone(), 'neutral', 'a hint solve is not earned');
  assert.equal(feedback(), 'Picked for you.');
  assert.equal(feedback().includes('Right.'), false);
  assert.deepEqual(hintedLines(), [], 'the outlines clear on success');
  assert.deepEqual(correctLines(), ['s2', 's4']);
  assert.equal(q('#bomb-hint').disabled, true);
  assert.equal(text('#bomb-hint-tier'), 'Nothing to hint right now.');
  assert.equal(focus.last(), '#bomb-win-title');
  assert.deepEqual(swirls, [false]);
  q('#bomb-hint').onclick?.({});
  q('#bomb-check').onclick?.({});
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 1 }, 'nothing after done');
});

test('the Hint button stays enabled when the picks are already right, so it never tells the answer for free', () => {
  const { counts, mount } = setup(withHints());
  mount();
  pickAll('s2', 's4');
  assert.equal(q('#bomb-hint').disabled, false);
  assert.equal(text('#bomb-hint'), 'Hint 1 of 3');
  pickAll('s1');
  assert.equal(q('#bomb-hint').disabled, false);
  assert.equal(text('#bomb-hint'), 'Hint 1 of 3');
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 0 });
});

test('an authored hint is tier 1 on the board; the identity draw outlines s1 and s2 at tier 2', () => {
  const { counts, mount } = setup(withHints({ hint: 'Ask whether the value set is <b>bounded</b>.' }));
  mount();
  click('#bomb-hint');
  assert.equal(q('#bomb-hint-text b')?.textContent, 'bounded', 'authored html kept');
  assert.equal(hintText().includes(SPOT_RULE), false);
  click('#bomb-hint');
  assert.deepEqual(hintedLines(), ['s1', 's2']);
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 });
  // The player then solves it: the outlines clear and the win line counts the hints.
  pickAll('s2', 's4');
  check();
  assert.deepEqual(hintedLines(), []);
  assert.equal(tone(), 'success');
  assert.equal(text('#bomb-win-stars'), '3 of 5 stars: 0 failed Checks, 2 hints.');
});

test('no line carries its answer: before success, a line has only type, class, data-line, aria-pressed, data-hinted and disabled', () => {
  const { mount } = setup(withHints());
  const ALLOWED = new Set(['type', 'class', 'data-line', 'aria-pressed', 'data-hinted', 'disabled']);
  const look = (when) => {
    for (const b of qa('[data-line]')) {
      const extra = [...b.getAttributeNames()].filter((n) => !ALLOWED.has(n));
      assert.deepEqual(extra, [], `${when} ${b.dataset.line}`);
    }
  };
  look('rendered');
  mount();
  look('mounted');
  pickAll('s1', 's2');
  check();
  look('wrong');
  click('#bomb-hint');
  click('#bomb-hint');
  look('hinted');
});

// ---- the copy says "matches the question", never "fault" or "belong" (#160 review) --------
// "belongs" read as the correct set on boards that ask for the wrong lines (3.2, 3.5, 5.2, 5.5, 6.2).
const WORDS = /fault|belong/i;

test('no player-facing Spot string says "fault" or "belong"; the instruction, the Check feedback and the hints say "matches the question"', () => {
  const { mount } = setup(withHints());
  const board = () => q('[data-spot="bomb"]').textContent;
  assert.equal(text('#bomb-instr'), 'Pick every line that matches the question, then press Check. Picking is free.');
  mount();
  assert.doesNotMatch(board(), WORDS, 'rendered board');
  pickAll('s1', 's2');
  check(); // wrong: one pick does not match the question
  assert.equal(feedback(), 'Not quite. 1 of your picks does not match the question. A route is a small, fixed set.');
  assert.doesNotMatch(board(), WORDS, 'after a wrong Check');
  click('[data-line="s1"]');
  check(); // partial: s2 only
  assert.equal(feedback(), 'Not quite. Everything you picked matches the question, but there is more.');
  assert.doesNotMatch(board(), WORDS, 'after a partial Check');
  click('#bomb-hint');
  assert.doesNotMatch(board(), WORDS, 'after the tier 1 hint (the rule)');
  click('#bomb-hint');
  assert.match(hintText(), /matches the question and is not picked yet/);
  assert.doesNotMatch(board(), WORDS, 'after the tier 2 hint, a line missing');

  // The other tier 2 branch (nothing missing, a wrong pick) and tier 3, on a fresh board.
  const other = setup(withHints());
  other.mount();
  pickAll('s1', 's2', 's4');
  click('#bomb-hint');
  click('#bomb-hint');
  assert.match(hintText(), /does not match the question/);
  assert.doesNotMatch(board(), WORDS, 'after the tier 2 hint, a wrong pick');
  click('#bomb-hint');
  assert.match(hintText(), /every line that matches the question, and nothing else/);
  assert.doesNotMatch(board(), WORDS, 'after the tier 3 hint');

  // The plural wrong Check and the single-line tier 2 (no decoy left), on a third board.
  const third = setup(withHints());
  third.mount();
  pickAll('s1', 's3'); // both non-faults
  check();
  assert.equal(feedback(), 'Not quite. 2 of your picks do not match the question. A route is a small, fixed set.');
  assert.doesNotMatch(board(), WORDS, 'after a wrong Check with two wrong picks');
  click('[data-line="s2"]'); // every non-fault picked, s4 the one fault left: no decoy to pair it with
  click('#bomb-hint');
  click('#bomb-hint');
  assert.equal(qa('#bomb-hint-text p').at(-1)?.textContent,'http_requests_total{trace_id="4bf9"} matches the question and is not picked yet.');
  assert.deepEqual(hintedLines(), ['s4']);
  assert.doesNotMatch(board(), WORDS, 'after the tier 2 hint, one line missing and no decoy left');
});


// ---- the hint panel on success (#160 review) ---------------------------------------------

test('after the player\'s own win the hint panel is emptied; after a tier-3 solve it keeps "Picked for you."', () => {
  const own = setup(withHints());
  own.mount();
  click('#bomb-hint');
  click('#bomb-hint'); // tier 2: "s1 or s2 ... not picked yet"
  assert.match(hintText(), /not picked yet/);
  pickAll('s2', 's4');
  check();
  assert.equal(tone(), 'success');
  assert.equal(hintText(), '', 'a stale "not picked yet" no longer matches the solved board');

  const via = setup(withHints());
  via.mount();
  click('#bomb-hint');
  click('#bomb-hint');
  click('#bomb-hint'); // tier 3: picked for you
  assert.equal(feedback(), 'Picked for you.');
  assert.equal(hintText().startsWith('Hint 3 of 3'), true, hintText());
  assert.match(hintText(), /Picked for you: every line that matches the question, and nothing else\./);
});

test('Escape on a shown hint is handled, focuses the hint button and leaves the level open (#178)', () => {
  const { focus, mount } = setup(withHints());
  mount();
  pickAll('s1');
  click('#bomb-hint');
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#bomb-hint-text').onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), '#bomb-hint');
});
