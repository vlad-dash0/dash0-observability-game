// Act 0 boss "The pager" beyond the play-through: the copy pinned to docs/M1-DESIGN.md
// §6, each look on its own and all of them in a row (its "No data." reason, the budget
// down by exactly 25), Escalate gated on the first look, the reward, no star change, no
// reachable ctx.mistake(), and a focus walk that ends on Escalate. Spec: docs/M1-DESIGN.md
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
import pager, { CONTENT } from '../levels/the-pager.mjs';

const LIVE = liveRegistry();

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

test('the-pager: copy matches docs/M1-DESIGN.md §6', () => {
  assert.equal(CONTENT.alert, ALERT);
  assert.deepEqual(CONTENT.looks.map((l) => [l.key, l.label, l.reason]), LOOKS);
  for (const l of CONTENT.looks) {
    assert.equal(l.reason.startsWith('No data. '), true, `${l.key} reveals "No data. ..."`);
  }
  assert.deepEqual(CONTENT.budget, { startPct: 100, stepPct: 25 });
  assert.equal(CONTENT.reward, REWARD);
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

// Raised with each scored level PR, like EXPECTED_ORDER (P6 added 2.1 and 2.2, P7 2.3 and 2.5,
// P8 2.4 and 2.6, P9 2.7, P11 the scored Act 2 boss, M3 P1 3.1 and 3.2, M3 P2 3.3 and 3.4).
test('the-pager: star totals ignore this boss (16 scored levels, max 48)', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: 48 });
  const all = emptyProgress();
  for (const id of LIVE.order) all.levels[id] = { stars: 3, at: null };
  assert.deepEqual(starTotals(all, LIVE), { earned: 48, max: 48 }, 'the pager adds nothing');
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

test('the-pager: the first screen shows the alert, a full budget and a disabled Escalate', () => {
  start();
  assert.equal(text('#pager-alert'), ALERT);
  assert.equal(budget(), budgetText(100));
  assert.deepEqual(qa('[data-look]').map((b) => `${b.dataset.look}|${b.textContent.trim()}|${b.disabled}`),
    LOOKS.map(([k, label]) => `${k}|${label}|false`));
  assert.deepEqual(said(), []);
  assert.equal(text('#pager-escalate'), 'Escalate');
  assert.equal(q('#pager-escalate').hasAttribute('data-finish'), true);
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
  LOOKS.forEach(([key, label, reason], i) => {
    click(`[data-look="${key}"]`);
    assert.equal(budget(), budgetText(100 - 25 * (i + 1)), `after ${i + 1} looks`);
    assert.equal(text(`[data-said="${key}"]`), `${label} ${reason}`);
  });
  assert.deepEqual(said(), LOOKS.map(([k]) => k));
  const used = q('[data-look="service"]');
  used.onclick({ currentTarget: used, target: used }); // a stray click on a disabled look
  assert.equal(budget(), budgetText(0));
  assert.equal(said().length, 4);
  assert.equal(escalateDisabled(), false);
});

test('the-pager: Escalate ends the run with the reward, 0 stars and no cards', () => {
  for (const looks of [1, 4]) {
    const { finished } = start();
    for (const [key] of LOOKS.slice(0, looks)) click(`[data-look="${key}"]`);
    click('#pager-escalate');
    assert.equal(finished.length, 1, `${looks} looks: finished once`);
    assert.deepEqual({ ...finished[0], at: null }, { stars: 0, cards: [], text: REWARD, at: null });
  }
});

test('the-pager: no ctx.mistake() or ctx.hint() is reachable (I1)', () => {
  const { slips } = start();
  for (const [key] of LOOKS) click(`[data-look="${key}"]`);
  for (const b of qa('[data-look]')) b.onclick({ currentTarget: b, target: b });
  click('#pager-escalate');
  assert.deepEqual(slips, { mistakes: 0, hints: 0 });
  const src = readFileSync(new URL('../levels/the-pager.mjs', import.meta.url), 'utf8');
  assert.equal(/\bmistake\s*\(/.test(src), false, 'the level never calls ctx.mistake()');
});

test('the-pager focus walk: first look, each next look, then Escalate', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'look:service', 'starts on the first look');
  LOOKS.forEach(([key], i) => {
    click(`[data-look="${key}"]`);
    const next = i < LOOKS.length - 1 ? `look:${LOOKS[i + 1][0]}` : '#pager-escalate';
    assert.equal(focus.last(), next, `after "${key}" focus goes to ${next}`);
  });
  assert.equal(q('[data-finish]').id, 'pager-escalate', 'the walk ends on [data-finish]');
  assert.deepEqual(focus.unfocusable(), [], 'focused only enabled, connected controls');
  assert.equal(focus.names().includes('body'), false);
});

test('the-pager focus wraps to the first unused look', () => {
  const { focus } = start();
  click('[data-look="trace"]');
  assert.equal(focus.last(), 'look:service');
  click('[data-look="service"]');
  assert.equal(focus.last(), 'look:since');
  assert.deepEqual(focus.unfocusable(), []);
});
