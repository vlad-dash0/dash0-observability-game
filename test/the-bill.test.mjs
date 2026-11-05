// Act 3 boss "The bill" beyond the play-through: the scenario pinned (views, kinds, costs, budget, burn
// rate, answerAfterViews), the engine's validator and budget arithmetic on it, the numbers the three
// clues share (one series count from the volume view to the label breakdown, one label, one deploy
// time before the step), the reference path within budget (I7), one penalty per run (herring, exhaustion,
// wrong hypothesis), and a focus walk that ends on Finish; the board is read in minutes (20 at 5%/min,
// #143) through test/helpers/incident-board.mjs. The scenario is designed for this game
// (docs/OUTLINE.md §4 Act 3 defines no boss; decided on #16); the structure mirrors The 3 a.m. errors
// (test/the-3am-errors.test.mjs). The happy and sloppy runs are generated from the level's data
// (test/play.test.mjs). Asserts strings, numbers and booleans only.
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
import { isActUnlocked, levelState } from '../lib/unlock.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
const ID = 'the-bill';
const BOSS = LIVE.levels[ID];
const S = BOSS.play.steps[0].incident;
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const view = (id) => S.views.find((v) => v.id === id);
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const cost = (kind) => S.views.filter((v) => v.kind === kind).reduce((n, v) => n + v.costMin, 0);
const ACT_3 = ['instruments', 'temporality', 'histograms', 'promql-basics', 'cardinality', 'exemplars', 'red-and-use'];

// ---- content pin ---------------------------------------------------------------------

test('the-bill: scenario pin: id, budget, burn rate, answerAfterViews, views with kinds and costs, hypotheses', () => {
  assert.equal(S.id, ID);
  assert.equal(S.alert.title, 'The bill');
  assert.deepEqual(S.budget, { startPct: 100, burnPctPerMin: 5 });
  assert.equal(S.answerAfterViews, 2);
  assert.deepEqual(
    S.views.map((v) => `${v.id}|${v.kind}|${v.costMin}`),
    [
      'volume-by-metric|clue|5', 'label-breakdown|clue|4', 'deploys|clue|3',
      'request-rate|neutral|2', 'export-interval|neutral|3', 'collector-health|neutral|2',
      'biggest-metric|herring|4', 'new-service|herring|3',
    ],
  );
  assert.deepEqual(
    S.hypotheses.map((h) => `${h.id}|${h.right}`),
    ['user-id-label|true', 'traffic-growth|false', 'new-service-metrics|false', 'export-interval-change|false'],
  );
});

test('the-bill: valid; 20 minutes; clues plus neutrals cost 19 min and leave 5% (1 min), so any one herring exhausts the budget', () => {
  assert.deepEqual(validateScenario(S), []);
  assert.equal(S.budget.startPct / S.budget.burnPctPerMin, 20);
  assert.equal(cost('clue'), 12);
  assert.equal(cost('neutral'), 7);
  assert.equal(S.budget.startPct - (cost('clue') + cost('neutral')) * S.budget.burnPctPerMin, 5);
  for (const h of S.views.filter((v) => v.kind === 'herring')) {
    assert.equal(h.costMin > 1, true, `${h.id} alone spends more than the 1 min that is left`);
  }
  assert.equal(S.views.every((v) => v.kind === 'clue' || v.costMin <= 4), true, 'no view is a long wait');
});

test('the-bill: a scored Act 3 boss lighting Checkout, no cards, mechanics derived from the one incident step', () => {
  assert.deepEqual(
    { id: BOSS.id, no: BOSS.no, mechanics: [...BOSS.mechanics], cards: [...BOSS.cards], lights: [...BOSS.lights], scored: BOSS.scored, parMs: BOSS.scoring.parMs, kind: BOSS.kind, actId: BOSS.actId },
    { id: ID, no: null, mechanics: ['incident'], cards: [], lights: ['checkout'], scored: true, parMs: null, kind: 'boss', actId: 'act-3' },
  );
  assert.equal(LIVE.acts.find((a) => a.id === 'act-3').bossId, ID);
  assert.deepEqual(BOSS.play.steps.map((s) => Object.keys(s).find((k) => ['incident', 'choice'].includes(k))), ['incident', 'choice']);
});

test('the-bill: lights Checkout (shared with 3.7), the boss waits for the act, and Act 4 waits for the boss', () => {
  const lit = (done) => {
    const p = emptyProgress();
    for (const id of done) p.levels[id] = { stars: 3, at: null };
    return litIds(LIVE, p).sort();
  };
  assert.deepEqual(lit([ID]), ['checkout']);
  assert.deepEqual(lit(['red-and-use']), ['checkout']);
  const partly = emptyProgress();
  for (const id of ACT_3.slice(0, 6)) partly.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, partly, LIVE), 'locked', 'the boss is locked until the act\'s levels are done');
  const all = emptyProgress();
  for (const id of ACT_3) all.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, all, LIVE), 'open');
  const index = LIVE.acts.findIndex((a) => a.id === 'act-4');
  const before = [
    ...LIVE.acts.filter((a) => ['act-0', 'act-1', 'act-2'].includes(a.id)).flatMap((a) => [...a.levelIds, ...(a.bossId ? [a.bossId] : [])]),
    ...ACT_3,
  ];
  const noBoss = emptyProgress();
  for (const id of before) noBoss.levels[id] = { stars: 3, at: null };
  assert.equal(isActUnlocked(index, noBoss, LIVE), false, 'Act 3 is not complete without its boss');
  noBoss.levels[ID] = { stars: 3, at: null };
  assert.equal(isActUnlocked(index, noBoss, LIVE), true);
});

test('the-bill: star totals count the boss (the derived scored-level max), and a 3-star boss is 3 of them', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  const p = emptyProgress();
  p.levels[ID] = { stars: 3, at: null };
  assert.deepEqual(starTotals(p, LIVE), { earned: 3, max: MAX_STARS });
});

test('the-bill: no em dash in the level file', () => {
  assert.equal(read(`levels/${ID}.mjs`).includes('\u2014'), false);
});

// ---- the clues agree with each other -------------------------------------------------

const num = (s) => Number(s.replace(/,/g, ''));
const SERIES_AFTER = 118904;
const SERIES_BEFORE = 228;

test('one series count runs through the alert, the volume view and the label breakdown: 228 before, 118,904 after', () => {
  const volume = plain(view('volume-by-metric').html);
  assert.equal(volume.includes('228'), true);
  assert.equal(volume.includes('118,904'), true);
  assert.equal(plain(view('label-breakdown').html).includes('118,904'), true);
  // The fleet: every other metric is unchanged, so total points a minute = 12,400 - 228 + 118,904, at one point per series per minute.
  assert.equal(12400 - SERIES_BEFORE + SERIES_AFTER, 131076);
  assert.equal(plain(S.alert.html).includes('131,000'), true);
  assert.equal(volume.includes('131,076'), true);
  assert.equal(plain(S.alert.html).includes('12,400'), true);
  assert.equal(plain(view('export-interval').html).includes('60 s'), true, 'one point per series every 60 s, which is why points a minute equal series');
});

test('the label breakdown: the old labels multiply to 228, user_id has one value per user and is the new series count', () => {
  const t = plain(view('label-breakdown').html);
  const v = (label) => num(new RegExp(`${label}\\s+([0-9,]+)`).exec(t)[1]);
  assert.equal(v('payment_method') * v('store_country'), SERIES_BEFORE);
  assert.equal(v('user_id'), 112367);
  assert.equal(v('user_id') < SERIES_AFTER, true, 'a few users appear in more than one series');
  assert.equal(SERIES_AFTER / v('user_id') < 1.1, true, 'almost one series per user');
  assert.equal(/09:40[^.]*payment_method[^.]*store_country[^.]*only/.test(t), true, 'before the deploy the labels were the two bounded ones');
  assert.equal(/user_id="u-[0-9a-f]+"/.test(view('label-breakdown').html), true, 'a sample series shows a user id');
  assert.equal(t.includes('otel.metric.overflow'), true, 'no overflow point: this SDK has no cardinality limit');
});

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

test('the deploy is one minute before the step, adds user.id to the counter\'s attributes, and nothing else changed', () => {
  const step = /began at (\d\d:\d\d)/.exec(plain(S.alert.html))[1];
  const deploy = /checkout 5\.12\.0 deployed at (\d\d:\d\d)/.exec(plain(view('deploys').html))[1];
  assert.equal(minutes(step) - minutes(deploy), 1);
  const html = view('deploys').html;
  assert.equal(/\n\+\s*attempts\.add\([^\n]*"user\.id"/.test(html), true, 'the diff adds the user.id attribute');
  assert.equal(/\n-\s*attempts\.add\([^\n]*"store\.country": country\}\)/.test(html), true, 'and removes the line without it');
  const t = plain(html);
  for (const w of ['checkout.attempts', 'Collector', 'No other']) assert.equal(t.includes(w), true, w);
  assert.equal(plain(view('volume-by-metric').html).includes('09:42'), true, 'the series count steps at 09:42');
  assert.equal(plain(view('volume-by-metric').html).includes('checkout_attempts_total'), true, 'the metric as Dash0 lists it (3.4: dots to underscores, _total)');
});

test('herrings and neutrals say why they do not explain the step, in numbers the clues contradict', () => {
  assert.equal(plain(view('biggest-metric').html).includes('3,112'), true);
  assert.equal(plain(view('biggest-metric').html).includes('same as last week'), true);
  assert.equal(plain(view('new-service').html).includes('46 series'), true);
  assert.equal(plain(view('new-service').html).includes('0.1%'), true);
  assert.equal(46 / SERIES_AFTER < 0.001, true, 'the new service is under 0.1% of the series');
  assert.equal(plain(view('request-rate').html).includes('same as last Thursday'), true);
  assert.equal(plain(view('export-interval').html).includes('unchanged'), true);
  assert.equal(plain(view('collector-health').html).includes('no refused'), true);
});

test('each wrong hypothesis is refuted by a view the player can open, and the right one cites all three clues', () => {
  const why = (id) => plain(S.hypotheses.find((h) => h.id === id).why);
  const right = why('user-id-label');
  for (const w of ['118,904', '228', 'user_id', '5.12.0', '09:41']) assert.equal(right.includes(w), true, w);
  assert.equal(why('traffic-growth').includes('same as last Thursday'), true);
  assert.equal(why('new-service-metrics').includes('46'), true);
  assert.equal(why('export-interval-change').includes('60 s'), true);
});

test('sources: Spec lines are opentelemetry.io or prometheus.io, Dash0 lines are the two verified pages, wording is bounded', () => {
  const src = read(`levels/${ID}.mjs`);
  const spec = src.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(spec.length > 0 && spec.every((u) => ['opentelemetry.io', 'prometheus.io'].includes(new URL(u).host)), true);
  for (const u of [
    'https://opentelemetry.io/docs/specs/otel/metrics/sdk/#cardinality-limits',
    'https://opentelemetry.io/docs/specs/semconv/http/http-metrics/',
    'https://prometheus.io/docs/practices/instrumentation/#do-not-overuse-labels',
  ]) assert.equal(spec.includes(u), true, u);
  const dash0 = src.split('\n').filter((l) => /^\/\/ Dash0 docs/.test(l)).join('\n');
  for (const u of [
    'https://www.dash0.com/docs/dash0/telemetry/metrics/identify-high-cardinality-metrics',
    'https://www.dash0.com/docs/dash0/cost-control/spam-filters',
  ]) assert.equal(dash0.includes(u), true, u);
  assert.equal(/\bthe spec says\b/i.test(src), false);
  assert.equal(/\$|price|pricing|dollar|invoice|per month|a month/i.test(plain(JSON.stringify([S, BOSS.play.steps[1], BOSS.play.finish]))), false, 'volume and series only: no pricing claim');
  const finish = BOSS.play.finish;
  for (const w of ['tree map', 'cardinality', 'instrumentation']) assert.equal(finish.includes(w), true, w);
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
  click('#tbl-next');
  click('[data-pick="drop-the-label"]');
  click('[data-finish]');
};

test('the-bill: the first screen shows the alert, a full budget, eight views, locked hypotheses, a disabled Next and no Finish', () => {
  start();
  assert.equal(alertTitle(ID), 'The bill');
  assert.equal(budget(), '20 min left. 0 of 20 min spent');
  assert.equal(board(ID).cells.total, 20);
  assert.equal(qa('[data-view]').length, 8);
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#tbl-next').disabled, true);
  assert.equal(qa('[data-finish]').length, 0, 'Finish is on the closing step');
});

test('the-bill: it takes two looks to unlock the answers (answerAfterViews 2): one view is not enough', () => {
  start();
  open('volume-by-metric');
  assert.equal(locked(), 'true,true,true,true');
  open('label-breakdown');
  assert.equal(locked(), 'false,false,false,false');
});

test('the-bill: neutral and herring views never unlock the answers; only clue views do', () => {
  start();
  for (const id of ['request-rate', 'export-interval', 'collector-health']) open(id);
  for (const id of ['biggest-metric', 'new-service']) open(id);
  assert.equal(locked(), 'true,true,true,true', 'every neutral and herring view is open and the answers are still locked');
  open('volume-by-metric');
  assert.equal(locked(), 'true,true,true,true', 'one clue is still not enough');
  open('label-breakdown');
  assert.equal(locked(), 'false,false,false,false');
});

// ---- reference path (I7) -------------------------------------------------------------

test('the-bill: the reference path (volume, labels, deploy, then user-id-label) solves with 40% of the budget (8 min) left and no penalty', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const id of ['volume-by-metric', 'label-breakdown', 'deploys']) {
    const r = openView(S, st, id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 40);
  assert.equal(canAnswer(S, st), true);
  assert.equal(answer(S, st, 'user-id-label').outcome, 'right');
  assert.equal(mistakes, 0);
});

test('the-bill: the shortest path is two clues (volume, labels); it solves with 11 of 20 min left and no penalty', () => {
  const { finished, slips } = start();
  open('volume-by-metric');
  open('label-breakdown');
  assert.equal(q('#tbl-next').disabled, true, 'Next waits for the right answer');
  guess('user-id-label');
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '11 min left. 9 of 20 min spent');
  finish();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 5);
  assert.equal(finished[0].text, BOSS.play.finish);
});

// ---- penalties: one each from a clean start ------------------------------------------

test('the-bill: a herring costs one mistake on its first open only, and the run still finishes with 4 stars', () => {
  const { slips, finished } = start();
  open('biggest-metric');
  assert.equal(slips.mistakes, 1);
  assert.deepEqual([status().tone, status().text.includes('was misleading')], ['error', true]);
  open('biggest-metric');
  assert.equal(slips.mistakes, 1, 'a repeat open is free');
  open('volume-by-metric');
  open('label-breakdown');
  guess('user-id-label');
  finish();
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('the-bill: the second herring is a second mistake; a wrong answer on top is a third and leaves 2 stars', () => {
  const { slips, finished } = start();
  open('biggest-metric');
  open('new-service');
  assert.equal(slips.mistakes, 2);
  for (const id of ['volume-by-metric', 'label-breakdown']) open(id);
  guess('traffic-growth');
  assert.equal(slips.mistakes, 3, 'the herrings do not unlock; the two clues do');
  guess('user-id-label');
  finish();
  assert.equal(slips.mistakes, 3);
  assert.equal(finished[0].stars, 2);
});

for (const id of ['traffic-growth', 'new-service-metrics', 'export-interval-change']) {
  test(`the-bill: guessing ${id} costs one mistake, once, and is then ruled out (picking it again is free)`, () => {
    const { slips, finished } = start();
    open('volume-by-metric');
    open('label-breakdown');
    guess(id);
    assert.equal(slips.mistakes, 1);
    assert.equal(causeState(ID, id), 'wrong');
    assert.equal(feedback().text.startsWith('Not quite.'), true);
    guess(id);
    assert.equal(slips.mistakes, 1);
    guess('user-id-label');
    finish();
    assert.equal(slips.mistakes, 1);
    assert.equal(finished[0].stars, 4);
  });
}

test('the-bill: every clue and neutral leaves 1 min and no mistake; a herring then spends the rest, a herring mistake and an exhaustion mistake in one open', () => {
  const { slips, finished } = start();
  for (const id of ['volume-by-metric', 'label-breakdown', 'deploys', 'request-rate', 'export-interval', 'collector-health']) open(id);
  assert.equal(slips.mistakes, 0, '19 min in: 1 left, nothing spent yet');
  assert.equal(budget(), '1 min left. 19 of 20 min spent');
  open('new-service');
  assert.equal(slips.mistakes, 2, 'one herring (3 min) alone runs the 1 min out');
  assert.equal(board(ID).left, 'Budget spent.');
  assert.deepEqual(board(ID).cells, { total: 20, spent: 0, over: 20, preview: 0, left: 0 });
  assert.deepEqual([status().tone, status().text.includes('was misleading, and the error budget is spent')], ['error', true]);
  assert.equal(causeState(ID, 'user-id-label'), null, 'still answerable at 0');
  guess('user-id-label');
  finish();
  assert.equal(finished[0].stars, 3, 'two penalties leave 3 stars (the star rule: 2 penalties)');
});

test('the-bill: opening a view again costs neither time nor a mistake, so repeat opens cannot exhaust the budget', () => {
  const { slips } = start();
  for (const id of ['volume-by-metric', 'label-breakdown', 'deploys', 'request-rate', 'export-interval', 'collector-health']) open(id);
  for (const id of ['volume-by-metric', 'deploys', 'collector-health']) open(id);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '1 min left. 19 of 20 min spent');
});

// ---- the closing step: the fix -------------------------------------------------------

test('the-bill: the closing step grades the fix: drop the label and keep per-user detail on spans or logs; slower export, a cap and a spam flag are corrected', () => {
  const fix = BOSS.play.steps[1].choice.choices;
  const right = fix.find((c) => c.right);
  assert.equal(right.key, 'drop-the-label');
  const t = plain(right.label + right.why);
  for (const w of ['user.id', 'spans', 'logs', 'one value for each request']) assert.equal(t.includes(w), true, w);
  assert.equal(/attribute filtering/i.test(JSON.stringify(BOSS.play)), false, 'a spec SHOULD is not stated as unconditional player-facing fact');
  assert.deepEqual(fix.filter((c) => !c.right).map((c) => c.key).sort(), ['cap-and-keep', 'export-less', 'spam-flag']);
  const why = (key) => plain(fix.find((c) => c.key === key).why);
  for (const w of ['SHOULD', '2000', 'otel.metric.overflow']) assert.equal(why('cap-and-keep').includes(w), true, w);
  for (const w of ['118,904', '5 minutes']) assert.equal(why('export-less').includes(w), true, w);
  for (const w of ['cannot be recovered', 'data points']) assert.equal(why('spam-flag').includes(w), true, w);
  assert.equal(fix.some((c) => /more budget|raise/i.test(c.label) && c.right === true), false, 'more budget is never the right fix');
});

test('the-bill: a wrong answer on the closing step costs one mistake, once, and leaves 4 stars', () => {
  const { slips, finished } = start();
  open('volume-by-metric');
  open('label-breakdown');
  guess('user-id-label');
  click('#tbl-next');
  click('[data-pick="export-less"]');
  assert.equal(slips.mistakes, 1);
  assert.equal(q('[data-finish]').disabled, true, 'Finish waits for the right fix');
  click('[data-pick="drop-the-label"]');
  click('[data-finish]');
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('the-bill: focus walk: first view, an opened heading, the win card, then Finish', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'view:volume-by-metric');
  open('volume-by-metric');
  assert.equal(focus.last(), 'heading:volume-by-metric');
  open('label-breakdown');
  guess('user-id-label');
  assert.equal(focus.last(), `#${ID}-win-title`);
  assert.equal(q('#tbl-next').disabled, false);
  click('#tbl-next');
  click('[data-pick="drop-the-label"]');
  assert.equal(focus.last(), '#tbl-finish');
  assert.equal(q('[data-finish]').id, 'tbl-finish');
  assert.deepEqual(focus.unfocusable(), []);
});
