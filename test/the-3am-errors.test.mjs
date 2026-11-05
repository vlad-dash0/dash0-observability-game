// Act 4 boss "The 3 a.m. errors" beyond the play-through: the scenario pinned (views, kinds, costs,
// budget, burn rate, answerAfterViews), the engine's validator and budget arithmetic on it, the
// facts the three clues share (one trace id from the log to the trace, one field name, one deploy
// time before the burst), the reference path within budget (I7), one penalty per run (herring,
// exhaustion, wrong hypothesis), and a focus walk that ends on Finish; the board is read in minutes
// (25 at 4%/min, #143) through test/helpers/incident-board.mjs. The scenario is designed
// for this game (docs/OUTLINE.md §4 Act 4 gives only "error burst; correlate logs to the trace to
// the deploy"); the structure mirrors Checkout is slow (test/checkout-is-slow.test.mjs). The happy
// and sloppy runs are generated from the level's data (test/play.test.mjs). Asserts strings,
// numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { answer, budgetLeft, canAnswer, newIncident, openView, validateScenario } from '../lib/widgets/incident.mjs';
import { liveRegistry } from '../app.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { alertTitle, budget as board, causeState, locked as lockedOf, region } from './helpers/incident-board.mjs';
import { litIds } from './helpers/lights.mjs';
import { levelState } from '../lib/unlock.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
const ID = 'the-3am-errors';
const BOSS = LIVE.levels[ID];
const S = BOSS.play.steps[0].incident;
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const view = (id) => S.views.find((v) => v.id === id);
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const cost = (kind) => S.views.filter((v) => v.kind === kind).reduce((n, v) => n + v.costMin, 0);

// ---- content pin ---------------------------------------------------------------------

test('the-3am-errors: scenario pin: id, budget, burn rate, answerAfterViews, views with kinds and costs, hypotheses', () => {
  assert.equal(S.id, ID);
  assert.equal(S.alert.title, 'The 3 a.m. errors');
  assert.deepEqual(S.budget, { startPct: 100, burnPctPerMin: 4 });
  assert.equal(S.answerAfterViews, 2);
  assert.deepEqual(
    S.views.map((v) => `${v.id}|${v.kind}|${v.costMin}`),
    [
      'error-patterns|clue|4', 'trace-of-error|clue|5', 'deploys|clue|3',
      'db-metrics|neutral|3', 'gateway-traffic|neutral|2', 'orders-pods|neutral|2',
      'warn-noise|herring|4', 'provider-errors|herring|3',
    ],
  );
  assert.deepEqual(
    S.hypotheses.map((h) => `${h.id}|${h.right}`),
    ['inventory-reply|true', 'orders-release|false', 'database|false', 'traffic-spike|false'],
  );
});

test('the-3am-errors: valid; 25 minutes; clues plus neutrals cost 19 and leave 6, so only the herrings can exhaust the budget', () => {
  assert.deepEqual(validateScenario(S), []);
  assert.equal(S.budget.startPct / S.budget.burnPctPerMin, 25);
  assert.equal(cost('clue'), 12);
  assert.equal(cost('neutral'), 7);
  assert.equal(25 - (cost('clue') + cost('neutral')), 6);
  assert.equal(cost('herring'), 7, 'both herrings on top spend more than the 6 minutes left');
  assert.equal(S.views.every((v) => v.kind === 'clue' || v.costMin <= 4), true, 'no view is a long wait');
});

test('the-3am-errors: a scored Act 4 boss lighting Orders, no cards, mechanics derived from the one incident step', () => {
  assert.deepEqual(
    { id: BOSS.id, no: BOSS.no, mechanics: [...BOSS.mechanics], cards: [...BOSS.cards], lights: [...BOSS.lights], scored: BOSS.scored, parMs: BOSS.scoring.parMs, kind: BOSS.kind, actId: BOSS.actId },
    { id: ID, no: null, mechanics: ['incident'], cards: [], lights: ['orders'], scored: true, parMs: null, kind: 'boss', actId: 'act-4' },
  );
  assert.equal(LIVE.acts.find((a) => a.id === 'act-4').bossId, ID);
  assert.deepEqual(BOSS.play.steps.map((s) => Object.keys(s).find((k) => ['incident', 'choice'].includes(k))), ['incident', 'choice']);
});

test('the-3am-errors: lights Orders (shared with 2.4), and the boss waits for the act like the Act 2 boss does', () => {
  const lit = (done) => {
    const p = emptyProgress();
    for (const id of done) p.levels[id] = { stars: 3, at: null };
    return litIds(LIVE, p).sort();
  };
  assert.deepEqual(lit([ID]), ['orders']);
  assert.deepEqual(lit(['context-propagation']), ['orders']);
  const act = ['structured-logs', 'correlation', 'collecting-logs'];
  const partly = emptyProgress();
  for (const id of act.slice(0, 2)) partly.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, partly, LIVE), 'locked', 'the boss is locked until the act\'s levels are done');
  const all = emptyProgress();
  for (const id of act) all.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, all, LIVE), 'open');
});

test('the-3am-errors: star totals count the boss (the derived scored-level max), and a 3-star boss is 3 of them', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  const p = emptyProgress();
  p.levels[ID] = { stars: 3, at: null };
  assert.deepEqual(starTotals(p, LIVE), { earned: 3, max: MAX_STARS });
});

test('the-3am-errors: no em dash in the level file', () => {
  assert.equal(read(`levels/${ID}.mjs`).includes('\u2014'), false);
});

// ---- the clues agree with each other -------------------------------------------------

const TRACE_ID = /\b[0-9a-f]{32}\b/;

test('the log record and the trace share one valid trace id: that is how the player gets from the log to the trace', () => {
  const inLog = TRACE_ID.exec(plain(view('error-patterns').html))?.[0];
  const inTrace = TRACE_ID.exec(plain(view('trace-of-error').html))?.[0];
  assert.equal(typeof inLog, 'string');
  assert.equal(inLog, inTrace);
  assert.equal(/^0+$/.test(inLog), false, 'not the invalid all-zero id');
  assert.equal(/trace_id/.test(view('error-patterns').html), true, 'the log says the id is its trace_id field');
});

test('one field name runs through the logs, the trace and the deploy: reserved_qty is missing because 3.1.0 renamed it', () => {
  for (const id of ['error-patterns', 'trace-of-error', 'deploys']) {
    assert.equal(plain(view(id).html).includes('reserved_qty'), true, `${id} names reserved_qty`);
  }
  assert.equal(plain(view('deploys').html).includes('reserved_quantity'), true, 'the deploy names the new field');
  for (const id of ['error-patterns', 'trace-of-error']) assert.equal(plain(view(id).html).includes('reserved_quantity'), false, `${id} does not give the cause away`);
});

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

test('the deploy is one minute before the burst, orders was not deployed, and the trace names inventory 3.1.0', () => {
  const burst = /began at (\d\d:\d\d)/.exec(plain(S.alert.html))[1];
  const deploy = /inventory 3\.1\.0 deployed at (\d\d:\d\d)/.exec(plain(view('deploys').html))[1];
  assert.equal(minutes(burst) - minutes(deploy), 1);
  assert.equal(/orders[^.]*Thursday/.test(plain(view('deploys').html)), true, 'orders was last deployed days ago');
  const trace = plain(view('trace-of-error').html);
  for (const w of ['POST /orders', 'POST /reserve', 'inventory', '3.1.0', '200', 'parse reservation', 'ERROR', 'before it writes the order']) {
    assert.equal(trace.includes(w), true, `trace-of-error says "${w}"`);
  }
  const logs = plain(view('error-patterns').html);
  for (const w of ['Cannot read stock reservation: missing field <field>', 'ERROR', 'orders', 'Patterns']) {
    assert.equal(logs.includes(w), true, `error-patterns says "${w}"`);
  }
});

test('herrings and neutrals say why they do not explain the burst, in numbers the clues contradict', () => {
  assert.equal(plain(view('warn-noise').html).includes('9,400 a day for a month'), true);
  assert.equal(plain(view('provider-errors').html).includes('0.3%'), true);
  assert.equal(plain(view('db-metrics').html).includes('21%'), true);
  assert.equal(plain(view('gateway-traffic').html).includes('same as last Tuesday'), true);
  assert.equal(plain(view('orders-pods').html).includes('no restarts'), true);
});

test('each wrong hypothesis is refuted by a view the player can open, and the right one cites all three clues', () => {
  const why = (id) => plain(S.hypotheses.find((h) => h.id === id).why);
  const right = why('inventory-reply');
  for (const w of ['reserved_qty', '3.1.0', '03:01', 'parse']) assert.equal(right.includes(w), true, w);
  assert.equal(why('orders-release').includes('Thursday'), true);
  assert.equal(why('database').includes('21%'), true);
  assert.equal(why('traffic-spike').includes('17%'), true);
});

test('the Dash0 tie-in: one query language across signals, bounded to what the Query Builder docs say', () => {
  const src = read(`levels/${ID}.mjs`);
  const finish = BOSS.play.finish;
  for (const w of ['PromQL', 'logs', 'traces', 'metrics', 'Dash0']) assert.equal(finish.includes(w), true, w);
  assert.equal(finish.includes('N+1'), false);
  const dash0 = src.split('\n').filter((l) => /^\/\/ Dash0 docs/.test(l)).join('\n');
  for (const u of [
    'https://www.dash0.com/docs/dash0/telemetry/query-data/query-builder/about-query-builder',
    'https://www.dash0.com/docs/dash0/telemetry/logging/patterns',
    'https://www.dash0.com/docs/dash0/telemetry/logging/log-ai-processing',
  ]) assert.equal(dash0.includes(u), true, u);
  assert.equal(/\bthe spec says\b/i.test(src), false);
  const spec = src.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(spec.length > 0 && spec.every((u) => new URL(u).host === 'opentelemetry.io'), true);
});

// ---- play ----------------------------------------------------------------------------

/** Start the boss with the real ctx; counts ctx.mistake() calls. */
function start() {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const finished = [];
  const slips = { mistakes: 0 };
  const ctx = createLevelContext({
    level: BOSS,
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
  BOSS.run(ctx);
  return { finished, focus, slips };
}

const open = (id) => click(`[data-view="${id}"]`);
const guess = (id) => click(`[data-hypothesis="${id}"]`);
/** The meter's headline and spent line. */
const budget = () => {
  const b = board(ID);
  return `${b.left} ${b.spent}`;
};
const locked = () => lockedOf(ID);
const status = () => region(ID, 'status');
const feedback = () => region(ID, 'feedback');
/** After the right hypothesis: Next, the closing Choice answered right, then Finish. */
const finish = () => {
  click('#tae-next');
  click('[data-pick="trace-and-resource"]');
  click('[data-finish]');
};

test('the-3am-errors: the first screen shows the alert, a full budget, eight views, locked hypotheses and a disabled Next', () => {
  start();
  assert.equal(alertTitle(ID), 'The 3 a.m. errors');
  assert.equal(budget(), '25 min left. 0 of 25 min spent');
  assert.equal(board(ID).cells.total, 25);
  assert.equal(qa('[data-view]').length, 8);
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#tae-next').disabled, true);
  assert.equal(qa('[data-finish]').length, 0, 'Finish is on the closing step');
});

test('the-3am-errors: it takes two looks to unlock the answers (answerAfterViews 2): one view is not enough', () => {
  start();
  open('error-patterns');
  assert.equal(locked(), 'true,true,true,true');
  open('trace-of-error');
  assert.equal(locked(), 'false,false,false,false');
});

test('the-3am-errors: neutral and herring views never unlock the answers; only clue views do', () => {
  start();
  for (const id of ['db-metrics', 'gateway-traffic', 'orders-pods']) open(id);
  for (const id of ['warn-noise', 'provider-errors']) open(id);
  assert.equal(locked(), 'true,true,true,true', 'every neutral and herring view is open and the answers are still locked');
  open('error-patterns');
  assert.equal(locked(), 'true,true,true,true', 'one clue is still not enough');
  open('trace-of-error');
  assert.equal(locked(), 'false,false,false,false');
});

// ---- reference path (I7) -------------------------------------------------------------

test('the-3am-errors: the reference path (logs, trace, deploy, then inventory-reply) solves with 52% of the budget (13 min) left and no penalty', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const id of ['error-patterns', 'trace-of-error', 'deploys']) {
    const r = openView(S, st, id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 52);
  assert.equal(canAnswer(S, st), true);
  assert.equal(answer(S, st, 'inventory-reply').outcome, 'right');
  assert.equal(mistakes, 0);
});

test('the-3am-errors: the shortest path is two clues (logs, trace); it solves with 16 of 25 min left and no penalty', () => {
  const { finished, slips } = start();
  open('error-patterns');
  open('trace-of-error');
  assert.equal(q('#tae-next').disabled, true, 'Next waits for the right answer');
  guess('inventory-reply');
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '16 min left. 9 of 25 min spent');
  finish();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 5);
  assert.equal(finished[0].text, BOSS.play.finish);
});

// ---- penalties: one each from a clean start ------------------------------------------

test('the-3am-errors: a herring costs one mistake on its first open only, and the run still finishes with 4 stars', () => {
  const { slips, finished } = start();
  open('warn-noise');
  assert.equal(slips.mistakes, 1);
  assert.deepEqual([status().tone, status().text.includes('was misleading')], ['error', true]);
  open('warn-noise');
  assert.equal(slips.mistakes, 1, 'a repeat open is free');
  open('error-patterns');
  open('trace-of-error');
  guess('inventory-reply');
  finish();
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('the-3am-errors: the second herring is a second mistake; a wrong answer on top is a third and leaves 2 stars', () => {
  const { slips, finished } = start();
  open('warn-noise');
  open('provider-errors');
  assert.equal(slips.mistakes, 2);
  for (const id of ['error-patterns', 'trace-of-error']) open(id);
  guess('database');
  assert.equal(slips.mistakes, 3, 'the herrings do not unlock; the two clues do');
  guess('inventory-reply');
  finish();
  assert.equal(slips.mistakes, 3);
  assert.equal(finished[0].stars, 2);
});

for (const id of ['orders-release', 'database', 'traffic-spike']) {
  test(`the-3am-errors: guessing ${id} costs one mistake, once, and is then ruled out (picking it again is free)`, () => {
    const { slips, finished } = start();
    open('error-patterns');
    open('trace-of-error');
    guess(id);
    assert.equal(slips.mistakes, 1);
    assert.equal(causeState(ID, id), 'wrong');
    assert.equal(feedback().text.startsWith('Not quite.'), true);
    guess(id);
    assert.equal(slips.mistakes, 1);
    guess('inventory-reply');
    finish();
    assert.equal(slips.mistakes, 1);
    assert.equal(finished[0].stars, 4);
  });
}

test('the-3am-errors: every clue and neutral leaves 6 min and no mistake; one herring leaves 3; the second spends the rest, a herring mistake and an exhaustion mistake in one open', () => {
  const { slips, finished } = start();
  for (const id of ['error-patterns', 'trace-of-error', 'deploys', 'db-metrics', 'gateway-traffic', 'orders-pods']) open(id);
  assert.equal(slips.mistakes, 0, '19 min in: 6 left, nothing spent yet');
  assert.equal(budget(), '6 min left. 19 of 25 min spent');
  open('provider-errors');
  assert.equal(slips.mistakes, 1, 'one herring alone does not exhaust');
  assert.equal(budget(), '3 min left. 22 of 25 min spent');
  open('warn-noise');
  assert.equal(slips.mistakes, 3);
  assert.equal(board(ID).left, 'Budget spent.');
  assert.equal(board(ID).cells.over, 25);
  assert.deepEqual([status().tone, status().text.includes('was misleading, and the error budget is spent')], ['error', true]);
  assert.equal(causeState(ID, 'inventory-reply'), null, 'still answerable at 0');
  guess('inventory-reply');
  finish();
  assert.equal(finished[0].stars, 2, 'three penalties leave 2 stars (the star rule: 3 or 4 penalties)');
});

test('the-3am-errors: opening a view again costs neither time nor a mistake, so repeat opens cannot exhaust the budget', () => {
  const { slips } = start();
  for (const id of ['error-patterns', 'trace-of-error', 'deploys', 'db-metrics', 'gateway-traffic', 'orders-pods']) open(id);
  for (const id of ['error-patterns', 'deploys', 'orders-pods']) open(id);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '6 min left. 19 of 25 min spent');
});

test('the-3am-errors: the closing step: the trace_id and the resource link the views; time alone and message text are corrected', () => {
  const link = BOSS.play.steps[1].choice.choices;
  const right = link.find((c) => c.right);
  assert.equal(right.key, 'trace-and-resource');
  const t = plain(right.label + right.why);
  for (const w of ['trace_id', 'TraceId', 'SpanId', 'service.version', 'Resource', 'by time, by trace context and by origin']) {
    assert.equal(t.includes(w), true, w);
  }
  assert.deepEqual(link.filter((c) => !c.right).map((c) => c.key).sort(), ['message-text', 'time-only']);
  assert.equal(/most basic/.test(link.find((c) => c.key === 'time-only').why), true);
});

test('the-3am-errors: a wrong answer on the closing step costs one mistake, once, and leaves 4 stars', () => {
  const { slips, finished } = start();
  open('error-patterns');
  open('trace-of-error');
  guess('inventory-reply');
  click('#tae-next');
  click('[data-pick="time-only"]');
  assert.equal(slips.mistakes, 1);
  assert.equal(q('[data-finish]').disabled, true, 'Finish waits for the right link');
  click('[data-pick="trace-and-resource"]');
  click('[data-finish]');
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('the-3am-errors: focus walk: first view, an opened heading, the win card, then Finish', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'view:error-patterns');
  open('error-patterns');
  assert.equal(focus.last(), 'heading:error-patterns');
  open('trace-of-error');
  guess('inventory-reply');
  assert.equal(focus.last(), `#${ID}-win-title`);
  assert.equal(q('#tae-next').disabled, false);
  click('#tae-next');
  click('[data-pick="trace-and-resource"]');
  assert.equal(focus.last(), '#tae-finish');
  assert.equal(q('[data-finish]').id, 'tae-finish');
  assert.deepEqual(focus.unfocusable(), []);
});
