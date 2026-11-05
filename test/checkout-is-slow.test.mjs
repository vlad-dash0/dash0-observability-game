// Act 2 boss "Checkout is slow" beyond the play-through: the scenario pinned to
// docs/M1-DESIGN.md §6, the engine's validator and budget arithmetic on it, the reference
// path within budget (I7), one penalty per run (herring, exhaustion, wrong hypothesis),
// the triage numbers, and a focus walk that ends on the win card, with the board read in
// minutes (25 at 4%/min) through test/helpers/incident-board.mjs. Spec: docs/M1-DESIGN.md §6
// Boss checkout-is-slow and §7 P11. The happy and sloppy runs live in test/levels-play.test.mjs.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { answer, budgetLeft, newIncident, openView, validateScenario } from '../lib/widgets/incident.mjs';
import { compareAttribute } from '../lib/widgets/triage.mjs';
import { liveRegistry } from '../app.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { alertTitle, budget as board, cardText, causeState, locked as lockedOf, region } from './helpers/incident-board.mjs';
import boss, { CONTENT } from '../levels/checkout-is-slow.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
const S = CONTENT.scenario;

// ---- content pin: docs/M1-DESIGN.md §6 Boss checkout-is-slow ------------------------

test('checkout-is-slow: scenario matches docs/M1-DESIGN.md §6', () => {
  assert.equal(S.id, 'checkout-is-slow');
  assert.deepEqual(S.budget, { startPct: 100, burnPctPerMin: 4 });
  assert.equal(S.answerAfterViews, 1);
  assert.deepEqual(
    S.views.map((v) => `${v.id}|${v.kind}|${v.costMin}`),
    [
      'trace-slow|clue|5', 'triage|clue|4', 'deploys|neutral|2', 'checkout-logs|neutral|4',
      'db-metrics|neutral|6', 'gateway-latency|neutral|4', 'payments-errors|herring|5', 'redis-cpu|herring|3',
    ],
  );
  assert.deepEqual(S.hypotheses.map((h) => `${h.id}|${h.right}`), ['n-plus-one|true', 'provider|false', 'redis|false', 'replicas|false']);
});

test('checkout-is-slow: the scenario is valid and neutrals plus clues cost exactly the 25 min that spend the budget', () => {
  assert.deepEqual(validateScenario(S), []);
  const min = (kind) => S.views.filter((v) => v.kind === kind).reduce((n, v) => n + v.costMin, 0);
  assert.equal(min('clue') + min('neutral'), 25);
  assert.equal(S.budget.startPct - 25 * S.budget.burnPctPerMin, 0);
});

test('checkout-is-slow: a scored Act 2 boss lighting inventory, no cards', () => {
  assert.deepEqual(
    { id: boss.id, no: boss.no, mechanics: boss.mechanics, cards: boss.cards, lights: boss.lights, scored: boss.scored, scoring: boss.scoring },
    { id: 'checkout-is-slow', no: null, mechanics: ['incident'], cards: [], lights: ['inventory'], scored: true, scoring: { parMs: null } },
  );
  const built = LIVE.levels['checkout-is-slow'];
  assert.equal(built.kind, 'boss');
  assert.equal(built.actId, 'act-2');
  assert.equal(built.scored, true);
  assert.equal(LIVE.acts.find((a) => a.id === 'act-2').bossId, 'checkout-is-slow');
});

test('checkout-is-slow: star totals count the boss (the derived scored-level max)', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
});

test('checkout-is-slow: no em dash in the level file', () => {
  const src = readFileSync(new URL('../levels/checkout-is-slow.mjs', import.meta.url), 'utf8');
  assert.equal(src.includes('—'), false);
});

// ---- the triage numbers ------------------------------------------------------------

const shares = (attr) => compareAttribute(CONTENT.triage.slow, CONTENT.triage.normal, attr).map((r) => `${r.value}:${r.slowPct}/${r.baselinePct}`).join(' ');

test('checkout-is-slow: service.version 2.4.0 is 100% of slow and 7% of normal; region is even', () => {
  assert.equal(shares('service.version'), '2.3.9:0/93 2.4.0:100/7');
  assert.equal(shares('cloud.region'), 'eu-west-1:50/50 us-east-1:50/50');
});

// ---- play -------------------------------------------------------------------------

/** Start the boss with the real ctx; counts ctx.mistake() calls. */
function start() {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const finished = [];
  const slips = { mistakes: 0 };
  const ctx = createLevelContext({
    level: LIVE.levels['checkout-is-slow'],
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => 0,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (_id, r) => finished.push(r),
    signal: new AbortController().signal,
  });
  const mistake = ctx.mistake;
  ctx.mistake = () => {
    slips.mistakes += 1;
    mistake();
  };
  LIVE.levels['checkout-is-slow'].run(ctx);
  return { finished, focus, slips };
}

const ID = 'checkout-is-slow';
const open = (id) => click(`[data-view="${id}"]`);
const guess = (id) => click(`[data-hypothesis="${id}"]`);
/** The meter's headline and spent line: 25 minutes at 4%/min. */
const budget = () => {
  const b = board(ID);
  return `${b.left} ${b.spent}`;
};
const panel = (id) => cardText(ID, id);
const locked = () => lockedOf(ID);

test('checkout-is-slow: the first screen shows the alert, a full budget, locked hypotheses and a disabled Finish', () => {
  start();
  assert.equal(alertTitle(ID), 'Checkout is slow');
  assert.equal(budget(), '25 min left. 0 of 25 min spent');
  assert.equal(board(ID).cells.total, 25);
  assert.equal(qa('[data-view]').length, 8);
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('[data-finish]').disabled, true);
});

test('checkout-is-slow: trace-slow shows inventory GET /stock with 40 sequential SELECT stock CLIENT spans', () => {
  start();
  open('trace-slow');
  const p = panel('trace-slow');
  for (const part of ['inventory', 'GET /stock', '40', 'SELECT stock', 'CLIENT', 'one after another']) {
    assert.equal(p.includes(part), true, `trace-slow says "${part}"`);
  }
  assert.equal(budget(), '20 min left. 5 of 25 min spent');
});

test('checkout-is-slow: the triage view shows 100% against 7% for 2.4.0 and an even region', () => {
  start();
  open('triage');
  const p = panel('triage');
  assert.equal(p.includes('service.version'), true);
  assert.equal(/2\.4\.0\s*100%\s*7%/.test(p), true, p);
  assert.equal(/eu-west-1\s*50%\s*50%/.test(p), true, p);
  assert.equal(/us-east-1\s*50%\s*50%/.test(p), true, p);
});

test('checkout-is-slow: deploys names 2.4.0 at 14:03', () => {
  start();
  open('deploys');
  assert.equal(panel('deploys').includes('2.4.0'), true);
  assert.equal(panel('deploys').includes('14:03'), true);
});

test('checkout-is-slow: one clue view unlocks the answers (answerAfterViews 1); a neutral view does not', () => {
  start();
  open('deploys');
  assert.equal(locked(), 'true,true,true,true');
  open('triage');
  assert.equal(locked(), 'false,false,false,false');
});

test('checkout-is-slow: neutral and herring views never unlock the answers; only clue views do', () => {
  start();
  for (const id of ['deploys', 'checkout-logs', 'db-metrics', 'gateway-latency']) open(id);
  for (const id of ['payments-errors', 'redis-cpu']) open(id);
  assert.equal(locked(), 'true,true,true,true', 'every neutral and herring view is open and the answers are still locked');
  open('triage');
  assert.equal(locked(), 'false,false,false,false');
});

// ---- reference path (I7) ------------------------------------------------------------

test('checkout-is-slow: the reference path (two clues, n-plus-one) solves within budget with no penalty', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const id of S.views.filter((v) => v.kind === 'clue').map((v) => v.id)) {
    const r = openView(S, st, id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 64);
  const r = answer(S, st, 'n-plus-one');
  assert.equal(r.outcome, 'right');
  assert.equal(mistakes, 0);
});

test('checkout-is-slow: the reference run ends with 5 stars-worth of play: no mistakes, Finish with the reward', () => {
  const { finished, slips } = start();
  open('trace-slow');
  open('triage');
  assert.equal(q('[data-finish]').disabled, true, 'Finish waits for the right answer');
  guess('n-plus-one');
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '16 min left. 9 of 25 min spent');
  click('[data-finish]');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 5);
  assert.equal(finished[0].text.includes('N+1'), true);
});

// ---- penalties: one each from a clean start ------------------------------------------

test('checkout-is-slow: a herring costs one mistake on its first open only', () => {
  const { slips, finished } = start();
  open('payments-errors');
  assert.equal(slips.mistakes, 1);
  open('payments-errors');
  assert.equal(slips.mistakes, 1, 'a repeat open is free');
  open('trace-slow');
  guess('n-plus-one');
  click('[data-finish]');
  assert.equal(finished[0].stars, 4);
});

test('checkout-is-slow: the second herring is a second mistake (2 stars after a wrong answer too)', () => {
  const { slips, finished } = start();
  open('payments-errors');
  open('redis-cpu');
  assert.equal(slips.mistakes, 2);
  open('trace-slow');
  guess('redis');
  assert.equal(slips.mistakes, 3);
  guess('n-plus-one');
  click('[data-finish]');
  assert.equal(finished[0].stars, 2);
});

test('checkout-is-slow: a wrong hypothesis costs one mistake, once, and is then ruled out (picking it again is free)', () => {
  const { slips, finished } = start();
  open('trace-slow');
  guess('provider');
  assert.equal(slips.mistakes, 1);
  assert.equal(causeState(ID, 'provider'), 'wrong');
  assert.equal(region(ID, 'feedback').text.startsWith('Not quite.'), true);
  guess('provider');
  assert.equal(slips.mistakes, 1, 'a repeat pick is free');
  guess('n-plus-one');
  click('[data-finish]');
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('checkout-is-slow: opening every clue and neutral view exhausts the budget with one mistake and no herring', () => {
  const { slips, finished } = start();
  const ids = ['trace-slow', 'triage', 'deploys', 'checkout-logs', 'db-metrics', 'gateway-latency'];
  ids.slice(0, 5).forEach((id) => open(id));
  assert.equal(slips.mistakes, 0, '21 min in: 4 min left, nothing spent yet');
  assert.equal(budget(), '4 min left. 21 of 25 min spent');
  open('gateway-latency');
  assert.equal(slips.mistakes, 1);
  assert.equal(budget(), 'Budget spent. 25 of 25 min spent');
  assert.equal(board(ID).cells.over, 25);
  assert.deepEqual([region(ID, 'status').tone, region(ID, 'status').text.includes('error budget is spent')], ['error', true]);
  assert.equal(causeState(ID, 'n-plus-one'), null, 'still answerable at 0');
  guess('n-plus-one');
  click('[data-finish]');
  assert.equal(finished[0].stars, 4);
});

test('checkout-is-slow: focus walk: first view, an opened heading, then the win card; Finish is enabled', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'view:trace-slow');
  open('trace-slow');
  assert.equal(focus.last(), 'heading:trace-slow');
  guess('n-plus-one');
  assert.equal(focus.last(), `#${ID}-win-title`);
  assert.equal(q('#cis-finish').disabled, false);
  assert.equal(q('[data-finish]').id, 'cis-finish');
  assert.deepEqual(focus.unfocusable(), []);
});
