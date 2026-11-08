// lib/widgets/trade-off-view.mjs on the kit (#160): the Trade-off view model (tradeoffView), its
// markup (a wide split: the board, then the kit side column with the score card and the success
// card), the mount (the one penalty, tones, focus, the hint ladder) and the pure hint tiers
// (trade-off-help.mjs). Spec: docs/M1-DESIGN.md §4.5. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newTradeoffState } from '../lib/widgets/trade-off.mjs';
import { capText, mountTradeoff, renderTradeoff, tradeoffView } from '../lib/widgets/trade-off-view.mjs';
import { TRADEOFF_RULE, hintFor, validateTradeoffHelps } from '../lib/widgets/trade-off-help.mjs';
import { spec as base } from './fixtures/trade-off-spec.mjs';

const fixture = () => base();
const withHints = (extra = {}) => ({ ...fixture(), helps: { hints: true }, ...extra });

/**
 * A counting stub ctx on a fresh DOM with the widget rendered; `onComplete` is the step's Next.
 * `shuffle` is ctx.shuffle (a copy unless a test needs another draw). The swirl is injected.
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
  dom.body.innerHTML = renderTradeoff(spec, newTradeoffState(spec), { escapeHtml, ...opts });
  const onComplete = () => {
    counts.done += 1;
  };
  const swirl = (host, o) => {
    swirls.push(o.reduced);
  };
  return { ctx, dom, focus, counts, swirls, mount: (extra = {}) => mountTradeoff(ctx, spec, { onComplete, swirl, ...extra }) };
}

const pick = (knob, option) => click(`[data-knob="${knob}"] [data-option="${option}"] input`);
const plan = (sampling, attrs) => { pick('sampling', sampling); pick('attrs', attrs); };
const cardName = (c) => `${c.closest('[data-knob]').dataset.knob}:${c.dataset.option}`;
const picked = () => qa('[data-option] input').filter((r) => r.checked).map((r) => cardName(r.closest('[data-option]')));
const marked = () => qa('[data-option][data-picked]').map(cardName);
const hintedCards = () => qa('[data-option][data-hinted]').map(cardName);
const correctCards = () => qa('[data-option][data-state="correct"]').map(cardName);
const text = (sel) => q(sel).textContent.replace(/\s+/g, ' ').trim();
const feedback = () => q('#bill-feedback [data-feedback-text]').textContent;
const tone = () => q('#bill-feedback').getAttribute('data-tone');
const check = () => click('#bill-check');
const meterCells = () => qa('#bill-meter [data-cell]').map((c) => c.getAttribute('data-cell')[0]).join('');

// test/design-system.test.mjs RETIRED, the ones the old Trade-off markup used.
const RETIRED = ['btn', 'feedback', 'good', 'info', 'show', 'tradeoff-keeps', 'tradeoff-option'];

// ---- tradeoffView: the board as data --------------------------------------------------------

test('tradeoffView: cost against the cap from the picks; keeps as need labels; hinted and correct from the inputs', () => {
  const s = fixture();
  const none = tradeoffView(s, newTradeoffState(s));
  assert.deepEqual([none.total, none.over, none.spare, none.complete, none.locked], [0, 0, 12, false, false]);
  const v = tradeoffView(s, { picks: { sampling: 'tail', attrs: 'user' }, tried: [], solved: false }, { hinted: [{ knob: 'attrs', option: 'tier' }] });
  assert.deepEqual([v.total, v.over, v.spare, v.complete], [17, 5, 0, true]);
  assert.deepEqual(v.knobs.map((k) => k.id), ['sampling', 'attrs']);
  assert.deepEqual(v.knobs[0].options.map((o) => o.keeps), [[], ['every error trace'], ['every error trace']]);
  assert.deepEqual(v.knobs[1].options.map((o) => [o.id, o.pressed, o.hinted]), [['none', false, false], ['tier', false, true], ['user', true, false]]);
  assert.deepEqual(v.knobs.flatMap((k) => k.options).map((o) => o.correct), [false, false, false, false, false, false], 'correct only once solved');
  const done = tradeoffView(s, { picks: { sampling: 'tail', attrs: 'tier' }, tried: [], solved: true });
  assert.deepEqual(done.knobs.flatMap((k) => k.options.filter((o) => o.correct).map((o) => o.id)), ['tail', 'tier']);
  assert.deepEqual([done.total, done.over, done.spare, done.locked], [11, 0, 1, true]);
  assert.equal(tradeoffView(s, { picks: { sampling: 'tail', attrs: 'tier' }, tried: [], solved: false }).knobs[0].options.every((o) => o.hinted === false), true, 'no hinted list, nothing outlined');
});

test('capText: the overshoot or the room left, numbers formatted the same way as the cards', () => {
  const s = fixture();
  const at = (picks) => capText(tradeoffView(s, { picks, tried: [], solved: false }));
  assert.equal(at({}), 'Within the cap, 12 GB/day to spare.');
  assert.equal(at({ sampling: 'tail', attrs: 'tier' }), 'Within the cap, 1 GB/day to spare.');
  assert.equal(at({ sampling: 'tail', attrs: 'user' }), 'Over the cap by 5 GB/day.');
  s.cap = 1250.5;
  s.knobs[0].options[0].cost = 1300.25;
  assert.equal(at({ sampling: 'head' }), 'Over the cap by 49.75 GB/day.');
});

// ---- the markup ------------------------------------------------------------------------------

test('renderTradeoff: the cost model, the cap, the needs, and the cost and what each card keeps', () => {
  setup();
  const board = text('[data-tradeoff]');
  assert.match(board, /cost of your plan is the sum of the options you pick/i);
  assert.match(board, /Cap: 12 GB\/day/);
  assert.equal(qa('[data-tradeoff] .ui-prose li').map((li) => li.textContent).join('|'), 'every error trace|a per-user view');
  assert.equal(qa('[data-option]').map((c) => c.querySelector('.ui-chip').textContent).join('|'), '2 GB/day|8 GB/day|18 GB/day|1 GB/day|3 GB/day|9 GB/day');
  assert.equal(q('[data-option="tail"] .ui-option-meta span:not(.ui-chip)').textContent, 'Keeps: every error trace');
  assert.equal(q('[data-option="head"] .ui-option-meta span:not(.ui-chip)').textContent, 'Keeps: nothing you need');
});

test('renderTradeoff: one labelled group per knob (legend keeps authored HTML), one radio card per option, none chosen, one name per knob', () => {
  const s = fixture();
  s.knobs[0].label = 'Sampling of <code>checkout</code>';
  setup(s);
  assert.deepEqual(qa('fieldset').map((f) => f.querySelector('legend').textContent), ['Sampling of checkout', 'User attribute']);
  assert.equal(q('legend code').textContent, 'checkout');
  assert.equal(qa('[data-option]').length, 6);
  assert.equal(qa('[data-option]').every((c) => c.localName === 'label' && c.querySelector('input').getAttribute('type') === 'radio'), true);
  assert.deepEqual(picked(), []);
  assert.deepEqual(marked(), []);
  assert.equal(qa('[data-knob="sampling"] input').every((r) => r.getAttribute('name') === 'bill-sampling'), true);
  assert.equal(qa('[data-knob="attrs"] input').every((r) => r.getAttribute('name') === 'bill-attrs'), true);
});

test('renderTradeoff: the meter shows the cost against the cap; the cap line and the Check region are there; labelledBy makes a group', () => {
  setup();
  assert.equal(text('#bill-meter-value'), '0 of 12 GB/day');
  assert.equal(qa('#bill-meter [data-cell]').length, 20);
  assert.equal(text('#bill-total'), 'Within the cap, 12 GB/day to spare.');
  assert.equal(q('#bill-total').getAttribute('aria-live'), 'polite');
  const fb = q('#bill-feedback');
  assert.deepEqual([fb.getAttribute('role'), fb.getAttribute('aria-live'), fb.getAttribute('tabindex'), fb.hasAttribute('hidden')], ['status', 'polite', '-1', true]);
  assert.equal(q('#bill-check').textContent, 'Check');
  assert.equal(q('[data-tradeoff]').hasAttribute('role'), false);
  setup(fixture(), { labelledBy: 'bill-q' });
  assert.equal(q('[data-tradeoff]').getAttribute('role'), 'group');
  assert.equal(q('[data-tradeoff]').getAttribute('aria-labelledby'), 'bill-q');
  const spec = fixture();
  for (const bad of ['', 'a"b', 'two words']) {
    assert.throws(() => renderTradeoff(spec, newTradeoffState(spec), { escapeHtml, labelledBy: bad }), { name: 'TypeError', message: /labelledBy/ }, JSON.stringify(bad));
  }
});

test('renderTradeoff: the side column and the helps chips; hints off (and no helps key) has no Hint button, hints on has one', () => {
  for (const spec of [fixture(), { ...fixture(), helps: { hints: false } }]) {
    setup(spec);
    assert.equal(qa('[id="bill-hint"]').length, 0, JSON.stringify(spec.helps));
    assert.equal(text('#bill-hint-tier'), 'No hints on this level.');
    assert.equal(q('[data-help="hints"]').getAttribute('data-on'), 'false');
  }
  setup(withHints());
  assert.equal(qa('[id="bill-hint"]').length, 1);
  assert.equal(q('[data-help="hints"]').getAttribute('data-on'), 'true');
  assert.equal(q('#bill-win').hasAttribute('hidden'), true);
  assert.equal(text('#bill-wrong'), '0');
  assert.match(text('.ui-score-rule'), /a failed Check \(over the cap, or a need dropped\), a hint/);
});

test('renderTradeoff: the unit is escaped, labels are trusted authored HTML, an id that is not a token throws', () => {
  const spec = fixture();
  spec.unit = '<img src=x onerror=alert(1)>/day';
  spec.knobs[0].options[0].label = 'Head <code>5%</code>';
  setup(spec);
  assert.equal(qa('img').length, 0);
  assert.equal(q('[data-option="head"] .ui-chip').textContent, '2 <img src=x onerror=alert(1)>/day');
  assert.equal(q('[data-option="head"] code').textContent, '5%');
  assert.throws(() => renderTradeoff({ ...fixture(), id: 'a"b' }, newTradeoffState(fixture()), { escapeHtml }), { name: 'TypeError' });
});

test('the markup is built by the kit: no retired class, no Alpine, no style= and no on*=, before and during play', () => {
  const { dom, mount } = setup(withHints());
  const bad = (when) => {
    const html = dom.body.innerHTML;
    assert.equal(/\s(?:x-[\w.:-]+|@[\w.:-]+|:[\w.:-]+)=/.test(html), false, `${when}: Alpine`);
    assert.equal(/\sstyle=/.test(html), false, `${when}: style=`);
    assert.equal(/\son\w+=/.test(html), false, `${when}: on*=`);
    const classes = qa('[class]').flatMap((el) => el.getAttribute('class').split(/\s+/));
    assert.deepEqual(classes.filter((c) => RETIRED.includes(c)), [], `${when}: retired class`);
  };
  bad('rendered');
  mount();
  plan('head', 'none');
  check();
  bad('wrong');
  click('#bill-hint');
  click('#bill-hint');
  bad('hinted');
  plan('tail', 'tier');
  check();
  bad('right');
});

// ---- the mount: picks, the cost meter, Check, tones, the one penalty --------------------------

test('mounting focuses the first radio and changes nothing else', () => {
  const { focus, counts, mount } = setup();
  mount();
  assert.equal(focus.last(), 'input');
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 0 });
  assert.equal(q('#bill-feedback').hasAttribute('hidden'), true);
  assert.equal(text('#bill-meter-value'), '0 of 12 GB/day');
});

test('picking is free, replaces the knob choice, moves the meter and the cap line in place and keeps focus', () => {
  const { focus, counts, mount } = setup();
  mount();
  const before = focus.names().length;
  pick('sampling', 'tail');
  assert.equal(text('#bill-meter-value'), '8 of 12 GB/day');
  assert.equal(meterCells(), 's'.repeat(13) + 'l'.repeat(7));
  pick('attrs', 'user');
  assert.equal(text('#bill-meter-value'), '17 of 12 GB/day');
  assert.equal(meterCells(), 'o'.repeat(20), 'over the cap: every cell reads over');
  assert.equal(text('#bill-total'), 'Over the cap by 5 GB/day.');
  pick('attrs', 'tier');
  assert.equal(text('#bill-meter-value'), '11 of 12 GB/day');
  assert.equal(meterCells(), 's'.repeat(18) + 'll');
  assert.equal(text('#bill-total'), 'Within the cap, 1 GB/day to spare.');
  assert.deepEqual(picked(), ['sampling:tail', 'attrs:tier']);
  assert.deepEqual(marked(), ['sampling:tail', 'attrs:tier'], 'the selected cards are marked, only those');
  assert.equal(counts.mistakes, 0);
  assert.deepEqual(focus.names().slice(before), []);
  assert.equal(q('#bill-feedback').hasAttribute('hidden'), true);
});

test('Check with a knob unpicked is free, neutral, and asks for a pick on every knob', () => {
  const { counts, focus, mount } = setup();
  mount();
  pick('sampling', 'tail');
  check();
  assert.equal(counts.mistakes, 0);
  assert.equal(feedback(), 'Pick an option for every knob first.');
  assert.equal(tone(), 'neutral');
  assert.equal(text('#bill-wrong'), '0');
  assert.equal(focus.last(), '#bill-feedback');
});

test('an over-cap plan costs one mistake, in the error tone, says by how much and shows the tally, without the answer', () => {
  const { counts, mount } = setup();
  mount();
  plan('tail', 'user');
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Not quite. Over the cap by 5 GB/day. A raw user id has a new value for every user.');
  assert.equal(tone(), 'error');
  assert.equal(text('#bill-wrong'), '1');
  assert.equal(text('#bill-wrong-label'), 'failed Check');
  assert.equal(counts.done, 0);
  assert.deepEqual(correctCards(), [], 'nothing is marked right');
});

test('an under-cap plan that drops a need costs one mistake and names the lost signal', () => {
  const { counts, focus, mount } = setup();
  mount();
  plan('head', 'tier');
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Not quite. It is within the cap but drops what you need: every error trace.');
  assert.equal(tone(), 'error');
  assert.equal(focus.last(), '#bill-feedback');
});

test('a plan that drops several needs says every one; over the cap and dropping a need says both', () => {
  const { mount } = setup();
  mount();
  plan('head', 'none');
  check();
  assert.equal(feedback(), 'Not quite. It is within the cap but drops what you need: every error trace, a per-user view.');
  const s = fixture();
  s.knobs[0].options[0].cost = 11;
  const b = setup(s);
  b.mount();
  plan('head', 'user');
  check();
  assert.equal(feedback(), 'Not quite. Over the cap by 8 GB/day, and it drops what you need: every error trace. A raw user id has a new value for every user.');
});

test('the same failing plan again is free and neutral, even after a different failing one; a changed plan costs again', () => {
  const { counts, mount } = setup();
  mount();
  plan('tail', 'user');
  check();
  check();
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'You already checked this plan. Nothing new was counted.');
  assert.equal(tone(), 'neutral');
  pick('attrs', 'none');
  check();
  assert.equal(counts.mistakes, 2);
  pick('attrs', 'user');
  check();
  assert.equal(feedback(), 'You already checked this plan. Nothing new was counted.');
  assert.deepEqual([counts.mistakes, text('#bill-wrong'), text('#bill-wrong-label')], [2, '2', 'failed Checks']);
});

test('the reference plan is right: success tone, states cost, explains, locks, marks the cards, completes once, shows the card with its stars', () => {
  const { counts, focus, swirls, mount } = setup();
  mount();
  plan('tail', 'tier');
  check();
  assert.equal(counts.mistakes, 0);
  assert.equal(feedback(), 'Right. This plan costs 11 of 12 GB/day and keeps everything you need. Tail sampling keeps the errors; a tier is bounded.');
  assert.equal(tone(), 'success');
  assert.equal(counts.done, 1);
  assert.equal(focus.last(), '#bill-win-title');
  assert.equal(q('#bill-win').hasAttribute('hidden'), false);
  assert.equal(text('#bill-win-stars'), '5 of 5 stars: 0 failed Checks, 0 hints.');
  assert.deepEqual(swirls, [false]);
  assert.equal(qa('[data-option] input').every((r) => r.disabled), true);
  assert.equal(q('#bill-check').disabled, true);
  assert.deepEqual(correctCards(), ['sampling:tail', 'attrs:tier']);
  assert.deepEqual(focus.unfocusable(), []);
  // Locked: a card pressed anyway changes nothing, and nothing counts after that.
  q('[data-knob="attrs"] [data-option="user"] input').onclick({});
  q('#bill-check').onclick({});
  assert.deepEqual(picked(), ['sampling:tail', 'attrs:tier']);
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 1 });
});

test('stars follow the one rule: a failed Check costs a star, a repeat does not', () => {
  const { mount } = setup();
  mount();
  plan('tail', 'user');
  check();
  check();
  plan('tail', 'tier');
  check();
  assert.equal(text('#bill-win-stars'), '4 of 5 stars: 1 failed Check, 0 hints.');
  assert.equal(qa('#bill-stars [data-star="earned"]').length, 4);
  assert.equal(qa('#bill-stars [data-star="lost"]').length, 1);
});

test('mounting throws a TypeError naming the spec for a bad spec, no onComplete, or no render', () => {
  const bad = fixture();
  bad.cap = 0;
  const a = setup();
  assert.throws(() => mountTradeoff(a.ctx, bad, { onComplete() {} }), { name: 'TypeError', message: /tradeoff "bill": invalid spec: .*cap/ });
  const b = setup();
  assert.throws(() => b.mount({ onComplete: undefined }), { name: 'TypeError', message: /onComplete/ });
  const c = setup();
  c.dom.body.innerHTML = '';
  assert.throws(() => c.mount(), { name: 'TypeError', message: /not rendered/ });
});

test('the unit is escaped in feedback: over-cap verdict and Right message (I3)', () => {
  const spec = fixture();
  spec.unit = '<img src=x onerror=1>';
  const a = setup(spec);
  a.mount();
  plan('tail', 'user');
  check();
  assert.equal(qa('img').length, 0);
  assert.equal(q('#bill-feedback').innerHTML.includes('Over the cap by 5 &lt;img src=x onerror=1&gt;.'), true);
  plan('tail', 'tier');
  check();
  assert.equal(qa('img').length, 0);
  assert.equal(q('#bill-feedback').innerHTML.includes('costs 11 of 12 &lt;img src=x onerror=1&gt; and keeps'), true);
});

// ---- the hint ladder on the board -----------------------------------------------------------------

const hintText = () => text('#bill-hint-text');

test('three hint tiers: the rule, two outlined options of one knob, then the answer picked for you; hints, never mistakes', () => {
  const { counts, focus, swirls, mount } = setup(withHints(), { shuffle: (a) => [...a].reverse() });
  mount();
  pick('sampling', 'tail'); // right already; the attribute knob is open
  assert.equal(text('#bill-hint'), 'Hint 1 of 3');
  assert.equal(text('#bill-hint-cost'), 'costs 1 star');

  click('#bill-hint'); // tier 1: the rule
  assert.deepEqual(counts, { mistakes: 0, hints: 1, done: 0 });
  assert.equal(text('#bill-hints'), '1');
  assert.equal(hintText().startsWith('Hint 1 of 3'), true, hintText());
  assert.equal(hintText().includes(TRADEOFF_RULE), true, 'no authored hint: the rule');
  assert.deepEqual(hintedCards(), [], 'tier 1 outlines nothing');
  assert.deepEqual(picked(), ['sampling:tail'], 'a hint changes no pick');

  click('#bill-hint'); // tier 2: the first knob not yet right (attrs): the answer and, drawn in reverse, the last decoy
  assert.deepEqual(counts, { mistakes: 0, hints: 2, done: 0 });
  assert.deepEqual(hintedCards(), ['attrs:tier', 'attrs:user']);
  assert.equal(hintText().startsWith('Hint 2 of 3'), true);
  assert.deepEqual(picked(), ['sampling:tail']);
  const tier2 = hintText();
  pick('attrs', 'user'); // picking an outlined card keeps the outlines and the paid text
  assert.deepEqual(hintedCards(), ['attrs:tier', 'attrs:user']);
  assert.equal(hintText(), tier2);
  assert.equal(text('#bill-wrong'), '0');

  click('#bill-hint'); // tier 3: picked for you
  assert.deepEqual(picked(), ['sampling:tail', 'attrs:tier']);
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 1 }, 'a hint solve costs hints, never a mistake, and completes once');
  assert.equal(text('#bill-wrong'), '0');
  assert.equal(text('#bill-win-stars'), '2 of 5 stars: 0 failed Checks, 3 hints.');
  assert.equal(tone(), 'neutral', 'a hint solve is not earned');
  assert.equal(feedback().startsWith('Picked for you.'), true, feedback());
  assert.equal(feedback().includes('Right.'), false);
  assert.deepEqual(hintedCards(), [], 'the outlines clear on success');
  assert.deepEqual(correctCards(), ['sampling:tail', 'attrs:tier']);
  assert.equal(q('#bill-hint').disabled, true);
  assert.equal(text('#bill-hint-tier'), 'Nothing to hint right now.');
  assert.equal(focus.last(), '#bill-win-title');
  assert.deepEqual(swirls, [false]);
  q('#bill-hint').onclick?.({});
  q('#bill-check').onclick?.({});
  assert.deepEqual(counts, { mistakes: 0, hints: 3, done: 1 }, 'nothing after done');
});

test('each hint tier costs a star by the one rule, and a wrong Check costs on top', () => {
  const { counts, mount } = setup(withHints());
  mount();
  plan('head', 'none');
  check();
  assert.deepEqual(counts, { mistakes: 1, hints: 0, done: 0 });
  assert.equal(q('#bill-stars').getAttribute('aria-label'), '4 of 5 stars still possible');
  assert.equal(qa('#bill-stars [data-star="possible"]').length, 4);
  assert.equal(text('#bill-hint-cost'), 'costs 1 star');
  click('#bill-hint');
  assert.equal(q('#bill-stars').getAttribute('aria-label'), '3 of 5 stars still possible');
  click('#bill-hint');
  assert.equal(q('#bill-stars').getAttribute('aria-label'), '2 of 5 stars still possible');
  assert.equal(text('#bill-hint-cost'), 'costs no star now', 'the 4th penalty falls on the same rung as the 3rd');
  click('#bill-hint');
  assert.equal(text('#bill-win-stars'), '2 of 5 stars: 1 failed Check, 3 hints.');
});

test('an authored hint is tier 1; the identity draw outlines the first decoy and the answer at tier 2', () => {
  const { mount } = setup(withHints({ hint: 'Count the <b>values</b> each option keeps.' }));
  mount();
  click('#bill-hint');
  assert.equal(hintText().includes('Count the values each option keeps.'), true);
  assert.equal(hintText().includes(TRADEOFF_RULE), false);
  click('#bill-hint');
  assert.deepEqual(hintedCards(), ['sampling:head', 'sampling:tail'], 'nothing picked yet: the first knob, the answer and the first decoy, in card order');
});

test('with hints off there is no Hint button and nothing to click', () => {
  const { counts, mount } = setup();
  mount();
  assert.equal(qa('[id="bill-hint"]').length, 0);
  plan('tail', 'tier');
  check();
  assert.deepEqual(counts, { mistakes: 0, hints: 0, done: 1 });
  assert.equal(text('#bill-win-stars'), '5 of 5 stars: 0 failed Checks, 0 hints.');
});

// ---- hintFor: the tiers, pure ---------------------------------------------------------------------

test('hintFor tier 2: the first knob whose pick is not the answer; the answer and one decoy of that knob, shuffled; none when the picks already pass', () => {
  const s = fixture();
  const h = (picks, o) => hintFor(s, picks, 2, o);
  assert.deepEqual(h({}).hinted, [{ knob: 'sampling', option: 'head' }, { knob: 'sampling', option: 'tail' }]);
  assert.deepEqual(h({}, { shuffle: (a) => [...a].reverse() }).hinted, [{ knob: 'sampling', option: 'tail' }, { knob: 'sampling', option: 'all' }]);
  assert.deepEqual(h({ sampling: 'tail' }).hinted.map((x) => x.knob), ['attrs', 'attrs']);
  assert.deepEqual(h({ sampling: 'all', attrs: 'tier' }).hinted.map((x) => x.knob), ['sampling', 'sampling'], 'a picked wrong option is a knob still open');
  const done = h({ sampling: 'tail', attrs: 'tier' });
  assert.deepEqual([done.hinted, done.apply, done.html.includes('Press Check')], [[], null, true]);
  // A plan that differs from the answer but fits the cap and keeps every need already passes.
  s.knobs[1].options.push({ id: 'tier2', label: 'user.tier too', cost: 3, keeps: ['per-user'] });
  assert.equal(h({ sampling: 'tail', attrs: 'tier2' }).html.includes('Press Check'), true);
});

test('hintFor tier 1 and 3: the rule or the authored hint; the answer as the picks to apply', () => {
  const s = fixture();
  assert.equal(hintFor(s, {}, 1).html, `<p>${TRADEOFF_RULE}</p>`);
  assert.equal(hintFor({ ...s, hint: 'Mine.' }, {}, 1).html, '<p>Mine.</p>');
  assert.deepEqual(hintFor(s, {}, 3).apply, { sampling: 'tail', attrs: 'tier' });
  assert.notEqual(hintFor(s, {}, 3).apply, s.answer, 'a copy: the spec is never handed out to be changed');
  assert.deepEqual(hintFor(s, {}, 1).apply, null);
});

test('validateTradeoffHelps: helps keys are hints only and boolean; a hint line is text and needs hints on', () => {
  assert.deepEqual(validateTradeoffHelps(fixture()), []);
  assert.deepEqual(validateTradeoffHelps(withHints({ hint: 'Ok' })), []);
  assert.deepEqual(validateTradeoffHelps({ ...fixture(), helps: { hints: 1 } }), ['helps: "hints" is not true or false']);
  assert.match(validateTradeoffHelps({ ...fixture(), helps: { tips: true } })[0], /"tips" is not one of hints/);
  assert.deepEqual(validateTradeoffHelps(withHints({ hint: ' ' })), ['hint: not non-empty text']);
  assert.deepEqual(validateTradeoffHelps({ ...fixture(), hint: 'x' }), ['hint: shown only when helps.hints is on']);
});
