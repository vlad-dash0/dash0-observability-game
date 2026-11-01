// lib/widgets/trade-off-view.mjs: the Trade-off view and mount (render, live cost, the one
// penalty, focus). Spec: docs/M1-DESIGN.md §4.5. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newTradeoffState } from '../lib/widgets/trade-off.mjs';
import { mountTradeoff, renderTradeoff, totalText } from '../lib/widgets/trade-off-view.mjs';
import { spec as fixture } from './fixtures/trade-off-spec.mjs';

function setup(spec = fixture(), opts = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, done: 0 };
  const ctx = { ovBody: dom.body, ovActions: dom.actions, escapeHtml, mistake() { counts.mistakes += 1; } };
  dom.body.innerHTML = renderTradeoff(spec, newTradeoffState(spec), { escapeHtml, ...opts });
  dom.actions.innerHTML = '<button id="finish" disabled>Finish</button>';
  const onComplete = () => {
    counts.done += 1;
    const fin = dom.actions.querySelector('#finish');
    fin.disabled = false;
    return fin;
  };
  return { dom, focus, counts, mount: (extra = {}) => mountTradeoff(ctx, spec, { onComplete, ...extra }) };
}

const pick = (knob, option) => click(`[data-knob="${knob}"][data-option="${option}"]`);
const plan = (sampling, attrs) => { pick('sampling', sampling); pick('attrs', attrs); };
const checked = () => qa('[data-option]').filter((r) => r.checked).map((r) => `${r.dataset.knob}:${r.dataset.option}`);
const feedback = () => q('#bill-feedback').textContent;
const total = () => q('#bill-total').textContent;
const check = () => click('#bill-check');

test('renderTradeoff: the cost model is shown: every cost, the cap, the needs, and what each option keeps', () => {
  setup();
  const text = q('.tradeoff').textContent;
  assert.match(text, /cost of your plan is the sum of the options you pick/i);
  assert.match(text, /Cap: 12 GB\/day/);
  assert.equal(qa('.tradeoff-needs li').map((li) => li.textContent).join('|'), 'every error trace|a per-user view');
  assert.equal(qa('[data-option]').map((r) => r.closest('label').querySelector('.tradeoff-cost').textContent).join('|'), '2 GB/day|8 GB/day|18 GB/day|1 GB/day|3 GB/day|9 GB/day');
  assert.equal(q('[data-knob="sampling"][data-option="tail"]').closest('label').querySelector('.tradeoff-keeps').textContent, 'Keeps: every error trace');
  assert.equal(q('[data-knob="sampling"][data-option="head"]').closest('label').querySelector('.tradeoff-keeps').textContent, 'Keeps: nothing you need');
});

test('renderTradeoff: one fieldset with a legend per knob, one radio per option, none chosen, same name per knob', () => {
  setup();
  assert.deepEqual(qa('fieldset').map((f) => f.querySelector('legend').textContent), ['Sampling', 'User attribute']);
  assert.equal(qa('[data-option]').length, 6);
  assert.equal(qa('[data-option]').every((r) => r.localName === 'input' && r.getAttribute('type') === 'radio'), true);
  assert.deepEqual(checked(), []);
  assert.equal(qa('[data-knob="sampling"]').every((r) => r.getAttribute('name') === 'bill-sampling'), true);
  assert.equal(qa('[data-knob="attrs"]').every((r) => r.getAttribute('name') === 'bill-attrs'), true);
  assert.equal(qa('[data-option]').every((r) => r.closest('label') !== null), true);
});

test('renderTradeoff: live total and feedback regions; labelledBy makes a group; no role otherwise', () => {
  setup();
  const fb = q('#bill-feedback');
  assert.deepEqual([fb.getAttribute('role'), fb.getAttribute('aria-live'), fb.getAttribute('tabindex')], ['status', 'polite', '-1']);
  assert.equal(q('#bill-total').getAttribute('aria-live'), 'polite');
  assert.equal(q('#bill-check').textContent, 'Check');
  assert.equal(q('.tradeoff').hasAttribute('role'), false);
  assert.equal(q('.tradeoff').getAttribute('data-tradeoff'), 'bill');
  const s = setup(fixture(), { labelledBy: 'bill-q' });
  assert.equal(q('.tradeoff').getAttribute('role'), 'group');
  assert.equal(q('.tradeoff').getAttribute('aria-labelledby'), 'bill-q');
  assert.ok(s);
  const spec = fixture();
  for (const bad of ['', 'a"b', 'two words']) {
    assert.throws(() => renderTradeoff(spec, newTradeoffState(spec), { escapeHtml, labelledBy: bad }), { name: 'TypeError', message: /labelledBy/ }, JSON.stringify(bad));
  }
});

test('renderTradeoff: unit and ids are escaped; labels are trusted authored HTML', () => {
  const spec = fixture();
  spec.unit = '<img src=x onerror=alert(1)>/day';
  spec.knobs[0].options[0].label = 'Head <code>5%</code>';
  const dom = makeDom();
  dom.body.innerHTML = renderTradeoff({ ...spec, id: 'a"b' }, newTradeoffState(spec), { escapeHtml });
  assert.equal(qa('img').length, 0);
  assert.equal(q('.tradeoff-cost').textContent, '2 <img src=x onerror=alert(1)>/day');
  assert.equal(q('.tradeoff').getAttribute('data-tradeoff'), 'a"b');
  assert.equal(q('.tradeoff-option code') === null, false);
});

test('totalText: cost against the cap, overshoot in words, numbers formatted the same way', () => {
  const s = fixture();
  assert.equal(totalText(s, {}), 'Plan cost: 0 of 12 GB/day');
  assert.equal(totalText(s, { sampling: 'tail', attrs: 'tier' }), 'Plan cost: 11 of 12 GB/day');
  assert.equal(totalText(s, { sampling: 'tail', attrs: 'user' }), 'Plan cost: 17 of 12 GB/day, over the cap by 5 GB/day');
  s.cap = 1250.5;
  s.knobs[0].options[0].cost = 1300.25;
  assert.equal(totalText(s, { sampling: 'head' }), 'Plan cost: 1,300.25 of 1,250.5 GB/day, over the cap by 49.75 GB/day');
});

test('no Alpine attributes, no style= and no on*= attributes, before and during play', () => {
  const { dom, mount } = setup();
  const bad = (when) => {
    const html = dom.body.innerHTML;
    assert.equal(/\s(?:x-[\w.:-]+|@[\w.:-]+|:[\w.:-]+)=/.test(html), false, `${when}: Alpine`);
    assert.equal(/\sstyle=/.test(html), false, `${when}: style=`);
    assert.equal(/\son\w+=/.test(html), false, `${when}: on*=`);
  };
  bad('rendered');
  mount();
  plan('head', 'none');
  check();
  bad('wrong');
  plan('tail', 'tier');
  check();
  bad('right');
});

test('mounting focuses the first radio and changes nothing else', () => {
  const { focus, counts, mount } = setup();
  mount();
  assert.equal(focus.last(), 'knob:sampling');
  assert.deepEqual(counts, { mistakes: 0, done: 0 });
  assert.equal(feedback(), '');
  assert.equal(total(), 'Plan cost: 0 of 12 GB/day');
});

test('picking is free, replaces the knob choice, updates the total in place and keeps focus', () => {
  const { focus, counts, mount } = setup();
  mount();
  const before = focus.names().length;
  pick('sampling', 'tail');
  assert.equal(total(), 'Plan cost: 8 of 12 GB/day');
  pick('attrs', 'user');
  assert.equal(total(), 'Plan cost: 17 of 12 GB/day, over the cap by 5 GB/day');
  pick('attrs', 'tier');
  assert.equal(total(), 'Plan cost: 11 of 12 GB/day');
  assert.deepEqual(checked(), ['sampling:tail', 'attrs:tier']);
  assert.equal(counts.mistakes, 0);
  assert.deepEqual(focus.names().slice(before), []);
  assert.equal(feedback(), '');
});

test('Check with a knob unpicked is free and asks for a pick on every knob', () => {
  const { counts, focus, mount } = setup();
  mount();
  pick('sampling', 'tail');
  check();
  assert.equal(counts.mistakes, 0);
  assert.equal(feedback(), 'Pick an option for every knob first.');
  assert.equal(q('#bill-feedback').className, 'feedback info show');
  assert.equal(focus.last(), '#bill-feedback');
});

test('an over-cap plan costs one mistake and says by how much, without the answer', () => {
  const { counts, mount } = setup();
  mount();
  plan('tail', 'user');
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Not quite. Over the cap by 5 GB/day. A raw user id has a new value for every user.');
  assert.equal(counts.done, 0);
});

test('an under-cap plan that drops a need costs one mistake and names the lost signal', () => {
  const { counts, focus, mount } = setup();
  mount();
  plan('head', 'tier');
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Not quite. It is within the cap but drops what you need: every error trace.');
  assert.equal(focus.last(), '#bill-feedback');
});

test('a plan that is over the cap and drops a need says both, and every lost need', () => {
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

test('the same failing plan again is free and says so; a changed plan costs again', () => {
  const { counts, mount } = setup();
  mount();
  plan('tail', 'user');
  check();
  check();
  check();
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback(), 'Same as last time: that plan still fails.');
  pick('attrs', 'none');
  check();
  assert.equal(counts.mistakes, 2);
});

test('the reference plan is right: states cost, explains, locks, completes once and focuses the return', () => {
  const { counts, focus, mount } = setup();
  mount();
  plan('tail', 'tier');
  check();
  assert.equal(counts.mistakes, 0);
  assert.equal(feedback(), 'Right. This plan costs 11 of 12 GB/day and keeps everything you need. Tail sampling keeps the errors; a tier is bounded.');
  assert.equal(q('#bill-feedback').className, 'feedback good show');
  assert.equal(counts.done, 1);
  assert.equal(focus.last(), '#finish');
  assert.equal(qa('[data-option]').every((r) => r.disabled), true);
  assert.equal(q('#bill-check').disabled, true);
  assert.deepEqual(focus.unfocusable(), []);
});

test('mounting throws a TypeError naming the spec for a bad spec, no onComplete, or no render', () => {
  const bad = fixture();
  bad.cap = 0;
  const a = setup(bad);
  assert.throws(() => a.mount(), { name: 'TypeError', message: /tradeoff "bill": invalid spec: .*cap/ });
  const b = setup();
  assert.throws(() => b.mount({ onComplete: undefined }), { name: 'TypeError', message: /onComplete/ });
  const c = setup();
  c.dom.body.innerHTML = '';
  assert.throws(() => c.mount(), { name: 'TypeError', message: /not rendered/ });
});
