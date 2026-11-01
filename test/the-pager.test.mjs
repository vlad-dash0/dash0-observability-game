// Act 0 boss "The pager" beyond the play-through: the copy pinned to docs/M1-DESIGN.md
// §6, part 1 (blind: each look on its own and all of them in a row, its "No data."
// reason, the budget down by exactly 25, Escalate gated on the first look, budget 0 moves
// on by itself) and part 2 (the same four questions answered from made-up telemetry, then
// Finish), the reward, no star change, no reachable ctx.mistake(), and the focus walks. Spec: docs/M1-DESIGN.md
// §6 Boss the-pager and §7 P4. The happy and sloppy runs live in test/levels-play.test.mjs.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { liveRegistry } from '../app.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import pager, { CONTENT } from '../levels/the-pager.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);

// ---- content pin: docs/M1-DESIGN.md §6 Boss the-pager ------------------------------

const ALERT = 'PAGE: checkout p95 > 2 s (firing)';
const REWARD = 'You could not answer one question. Time to instrument.';
// The four looks in play order: key, label (§6), and the reason it reveals.
const LOOKS = [
  ['service', 'Which service?', 'No data. No service sends telemetry yet, so nothing says which one is slow.'],
  ['since', 'Since when?', 'No data. The alert only says it is firing now; nothing was recorded before it.'],
  ['customers', 'Which customers?', 'No data. Requests carry no customer details, so there is nothing to slice by.'],
  ['trace', 'Show me a trace', 'No data. No service records traces, so there is no request to follow.'],
];
const budgetText = (pct) => `Error budget: ${pct}% left`;
const INTRO = 'Your pager goes off. Try the four questions below: you will find you cannot answer them, because nothing sends telemetry yet. Each try burns error budget. When you give up, press Escalate.';
const LIT_INTRO = 'Same alert, now with telemetry. Ask the same four questions. The data is made up, for illustration. Ask all four to finish.';
// Part 2: the same four questions, key and label as part 1, and the made-up answer.
const ASKS = [
  ['service', 'Which service?', 'payment-api. Its p95 is 4.1 s; cart and storefront stay under 0.3 s.'],
  ['since', 'Since when?', 'Since 14:02, when p95 jumped from 0.2 s to 4.1 s. payment-api v2.31 started at 14:02.'],
  ['customers', 'Which customers?', 'Orders paid with payment.provider=acme-pay. Other providers stay fast.'],
  ['trace', 'Show me a trace', 'Trace 4bf92f3577b34da6a3ce929d0e0e4736: checkout took 4.2 s, 3.9 s of it in payment-api POST /charge.'],
];

test('the-pager: copy matches docs/M1-DESIGN.md §6', () => {
  assert.equal(CONTENT.alert, ALERT);
  assert.deepEqual(CONTENT.looks.map((l) => [l.key, l.label, l.reason]), LOOKS);
  for (const l of CONTENT.looks) {
    assert.equal(l.reason.startsWith('No data. '), true, `${l.key} reveals "No data. ..."`);
  }
  assert.deepEqual(CONTENT.budget, { startPct: 100, stepPct: 25 });
  assert.equal(CONTENT.reward, REWARD);
  assert.equal(CONTENT.intro, INTRO);
  assert.equal(CONTENT.telemetry.intro, LIT_INTRO);
  assert.deepEqual(CONTENT.telemetry.asks.map((a) => [a.key, a.label, a.answer]), ASKS);
  assert.deepEqual(CONTENT.telemetry.asks.map((a) => a.key), CONTENT.looks.map((l) => l.key), 'same questions');
  assert.deepEqual(CONTENT.telemetry.asks.map((a) => a.label), CONTENT.looks.map((l) => l.label));
  const all = JSON.stringify(CONTENT);
  assert.equal(all.includes('\u2014'), false, 'no em dash in the copy');
});

test('the-pager: an unscored Act 0 boss with no cards and no lights', () => {
  assert.deepEqual(
    { id: pager.id, no: pager.no, name: pager.name, mechanics: pager.mechanics, cards: pager.cards, lights: pager.lights, scored: pager.scored, scoring: pager.scoring },
    { id: 'the-pager', no: null, name: 'The pager', mechanics: ['incident'], cards: [], lights: [], scored: false, scoring: { parMs: null } },
  );
  const built = LIVE.levels['the-pager'];
  assert.equal(built.kind, 'boss');
  assert.equal(built.actId, 'act-0');
  assert.equal(built.scored, false);
  assert.equal(LIVE.acts.find((a) => a.id === 'act-0').bossId, 'the-pager');
});

// Derived from the registry (test/helpers/stars.mjs): a level PR does not edit this.
test('the-pager: star totals ignore this boss (the derived scored-level max)', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  const all = emptyProgress();
  for (const id of LIVE.order) all.levels[id] = { stars: 3, at: null };
  assert.deepEqual(starTotals(all, LIVE), { earned: MAX_STARS, max: MAX_STARS }, 'the pager adds nothing');
});

// ---- play -------------------------------------------------------------------------

/** Start the pager with the real ctx; counts any ctx.mistake() / ctx.hint() call. */
function start() {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const finished = [];
  const slips = { mistakes: 0, hints: 0 };
  const ctx = createLevelContext({
    level: LIVE.levels['the-pager'],
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => 0,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (_id, r) => finished.push(r),
    signal: new AbortController().signal,
  });
  ctx.mistake = () => (slips.mistakes += 1);
  ctx.hint = () => (slips.hints += 1);
  LIVE.levels['the-pager'].run(ctx);
  return { finished, focus, slips };
}

const text = (sel) => q(sel)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
const budget = () => text('#pager-budget');
const escalateDisabled = () => q('#pager-escalate').disabled;
/** The look keys whose reason is on screen, in screen order. */
const said = () => qa('[data-said]').map((el) => el.dataset.said);
const answered = () => qa('[data-answer]').map((el) => el.dataset.answer);
const partTwo = () => qa('[data-ask]').length > 0;
const finishDisabled = () => q('#pager-finish').disabled;

test('the-pager: the first screen shows the alert, a full budget and a disabled Escalate', () => {
  start();
  assert.equal(text('#pager-alert'), ALERT);
  assert.equal(budget(), budgetText(100));
  assert.deepEqual(qa('[data-look]').map((b) => `${b.dataset.look}|${b.textContent.trim()}|${b.disabled}`),
    LOOKS.map(([k, label]) => `${k}|${label}|false`));
  assert.deepEqual(said(), []);
  assert.equal(text('#pager-escalate'), 'Escalate');
  assert.equal(text('.speech'), INTRO, 'the intro states the goal and explains Escalate');
  assert.equal(q('#pager-escalate').hasAttribute('data-finish'), false, 'Escalate moves to part 2, it does not finish');
  assert.equal(qa('[data-finish]').length, 0, 'no Finish on the first screen');
  assert.equal(escalateDisabled(), true, 'Escalate waits for the first look');
  assert.equal(q('#pager-budget').getAttribute('role'), 'status');
  assert.equal(q('#pager-feedback').getAttribute('role'), 'status');
});

for (const [key, label, reason] of LOOKS) {
  test(`the-pager: "${label}" alone reveals its reason, costs 25 and opens Escalate`, () => {
    start();
    click(`[data-look="${key}"]`);
    assert.deepEqual(said(), [key], 'only this look is answered');
    assert.equal(text(`[data-said="${key}"]`), `${label} ${reason}`);
    assert.equal(q('#pager-feedback').contains(q(`[data-said="${key}"]`)), true, 'stated in the status region');
    assert.equal(budget(), budgetText(75));
    assert.equal(q(`[data-look="${key}"]`).disabled, true, 'a look is used once');
    assert.equal(escalateDisabled(), false, 'Escalate opens after the first look');
  });
}

test('the-pager: the looks add up, 25 each, to 0% left; a used look costs nothing again', () => {
  start();
  LOOKS.slice(0, 3).forEach(([key, label, reason], i) => {
    click(`[data-look="${key}"]`);
    assert.equal(budget(), budgetText(100 - 25 * (i + 1)), `after ${i + 1} looks`);
    assert.equal(text(`[data-said="${key}"]`), `${label} ${reason}`);
  });
  assert.deepEqual(said(), ['service', 'since', 'customers']);
  const used = q('[data-look="service"]');
  used.onclick({ currentTarget: used, target: used }); // a stray click on a disabled look
  assert.equal(budget(), budgetText(25), 'a used look costs nothing again');
  assert.equal(said().length, 3);
  assert.equal(escalateDisabled(), false);
});

test('the-pager: budget 0 moves to part 2 by itself, with no Escalate click', () => {
  const { finished } = start();
  for (const [key] of LOOKS.slice(0, 3)) click(`[data-look="${key}"]`);
  assert.equal(partTwo(), false, 'still blind at 25% left');
  click('[data-look="trace"]');
  assert.equal(partTwo(), true, 'part 2 at 0% left');
  assert.equal(qa('#pager-budget').length, 0, 'the budget is gone');
  assert.equal(finished.length, 0, 'moving on does not finish');
});

test('the-pager: Escalate moves to part 2; only Finish after all four asks ends the run', () => {
  for (const looks of [1, 3]) {
    const { finished } = start();
    for (const [key] of LOOKS.slice(0, looks)) click(`[data-look="${key}"]`);
    click('#pager-escalate');
    assert.equal(partTwo(), true, `${looks} looks: Escalate shows part 2`);
    assert.equal(finished.length, 0, 'Escalate does not finish');
    assert.equal(text('.speech'), LIT_INTRO);
    assert.equal(text('#pager-alert'), ALERT, 'the same alert');
    assert.deepEqual(qa('[data-ask]').map((b) => `${b.dataset.ask}|${b.textContent.trim()}|${b.disabled}`),
      ASKS.map(([k, label]) => `${k}|${label}|false`));
    assert.equal(finishDisabled(), true, 'Finish waits for all four');
    ASKS.forEach(([key], i) => {
      assert.equal(finishDisabled(), true, `Finish still waits after ${i} asks`);
      click(`[data-ask="${key}"]`);
    });
    assert.equal(finishDisabled(), false);
    click('#pager-finish');
    assert.equal(finished.length, 1, `${looks} looks: finished once`);
    assert.deepEqual({ ...finished[0], at: null }, { stars: 0, cards: [], text: REWARD, at: null });
  }
});

test('the-pager: part 2 reveals each answer by clicking its question, once', () => {
  start();
  for (const l of LOOKS.slice(0, 1)) click(`[data-look="${l[0]}"]`);
  click('#pager-escalate');
  assert.deepEqual(answered(), []);
  click('[data-ask="customers"]');
  assert.deepEqual(answered(), ['customers'], 'only the asked question is answered');
  assert.equal(text('[data-answer="customers"]'), `Which customers? ${ASKS[2][2]}`);
  assert.equal(q('[data-ask="customers"]').disabled, true);
  assert.equal(q('#pager-answers').contains(q('[data-answer="customers"]')), true, 'stated in the status region');
  const used = q('[data-ask="customers"]');
  used.onclick({ currentTarget: used, target: used });
  assert.deepEqual(answered(), ['customers'], 'a stray click adds nothing');
  for (const [key] of ASKS) if (key !== 'customers') click(`[data-ask="${key}"]`);
  assert.deepEqual(answered(), ['customers', 'service', 'since', 'trace']);
  for (const [key, label, answer] of ASKS) {
    assert.equal(text(`[data-answer="${key}"]`), `${label} ${answer}`);
  }
});

test('the-pager: one live region per part, never two copies', () => {
  start();
  assert.equal(qa('[role="status"]').length, 2, 'part 1: the budget and the feedback');
  click('[data-look="service"]');
  click('#pager-escalate');
  assert.equal(qa('[role="status"]').length, 1, 'part 2: only the answers');
  assert.equal(qa('#pager-budget, #pager-feedback').length, 0, 'part 1 regions are gone');
});

test('the-pager: no ctx.mistake() or ctx.hint() is reachable (I1)', () => {
  const { slips } = start();
  for (const [key] of LOOKS) click(`[data-look="${key}"]`);
  for (const [key] of ASKS) click(`[data-ask="${key}"]`);
  click('#pager-finish');
  assert.deepEqual(slips, { mistakes: 0, hints: 0 });
  const src = readFileSync(new URL('../levels/the-pager.mjs', import.meta.url), 'utf8');
  assert.equal(/\bmistake\s*\(/.test(src), false, 'the level never calls ctx.mistake()');
});

test('the-pager focus walk: each look, then part 2 (by budget 0), each ask, then Finish', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'look:service', 'starts on the first look');
  LOOKS.forEach(([key], i) => {
    click(`[data-look="${key}"]`);
    const next = i < LOOKS.length - 1 ? `look:${LOOKS[i + 1][0]}` : 'ask:service';
    assert.equal(focus.last(), next, `after "${key}" focus goes to ${next}`);
  });
  ASKS.forEach(([key], i) => {
    click(`[data-ask="${key}"]`);
    const next = i < ASKS.length - 1 ? `ask:${ASKS[i + 1][0]}` : '#pager-finish';
    assert.equal(focus.last(), next, `after asking "${key}" focus goes to ${next}`);
  });
  assert.equal(q('[data-finish]').id, 'pager-finish', 'the walk ends on [data-finish]');
  assert.deepEqual(focus.unfocusable(), [], 'focused only enabled, connected controls');
  assert.equal(focus.names().includes('body'), false);
});

test('the-pager focus: Escalate hands focus to the first question of part 2', () => {
  const { focus } = start();
  click('[data-look="since"]');
  click('#pager-escalate');
  assert.equal(focus.last(), 'ask:service');
  click('[data-ask="trace"]');
  assert.equal(focus.last(), 'ask:service', 'wraps to the first unasked question');
  assert.deepEqual(focus.unfocusable(), []);
});

test('the-pager focus wraps to the first unused look', () => {
  const { focus } = start();
  click('[data-look="trace"]');
  assert.equal(focus.last(), 'look:service');
  click('[data-look="service"]');
  assert.equal(focus.last(), 'look:since');
  assert.deepEqual(focus.unfocusable(), []);
});
