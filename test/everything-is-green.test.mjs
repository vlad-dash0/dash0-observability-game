// Act 7 boss "Everything is green" beyond the play-through: the scenario pinned (views, kinds, costs, budget, answerAfterViews), the
// engine's validator and budget arithmetic on it, the one table every figure comes from (TABLE) and why it makes the monitoring green,
// the shortcuts a player could take through the real incident engine, the reference path within budget (I7), one penalty per run
// (herring, exhaustion, wrong hypothesis, wrong closing answer), and a focus walk that ends on Finish. The scenario is designed for this
// game (#135); the structure mirrors Silence (test/silence.test.mjs). The happy and sloppy runs are generated from the level's data
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
import { TABLE } from '../levels/everything-is-green.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { alertTitle, budget as board, causeState, locked as lockedOf, region } from './helpers/incident-board.mjs';
import { litIds } from './helpers/lights.mjs';
import { levelState } from '../lib/unlock.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
const ID = 'everything-is-green';
const BOSS = LIVE.levels[ID];
const S = BOSS.play.steps[0].incident;
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const view = (id) => S.views.find((v) => v.id === id);
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const cost = (kind) => S.views.filter((v) => v.kind === kind).reduce((n, v) => n + v.costMin, 0);
const CLUES = ['span-numbers', 'who-calls', 'alert-rules', 'outside-request'];
const NEUTRALS = ['origin-pods', 'last-deploy', 'database'];
const HERRINGS = ['collector-health', 'payment-latency'];
const RIGHT = 'expired-certificate';

// ---- content pin ---------------------------------------------------------------------

test('everything-is-green: scenario pin: id, budget, answerAfterViews, views with kinds and costs, hypotheses', () => {
  assert.equal(S.id, ID);
  assert.equal(S.alert.title, 'Shop unreachable, dashboards green');
  assert.deepEqual(S.budget, { startPct: 100, burnPctPerMin: 5 });
  assert.equal(S.answerAfterViews, 3);
  assert.deepEqual(
    S.views.map((v) => `${v.id}|${v.kind}|${v.costMin}`),
    [
      'span-numbers|clue|3', 'who-calls|clue|3', 'outside-request|clue|3', 'alert-rules|clue|4',
      'origin-pods|neutral|2', 'last-deploy|neutral|2', 'database|neutral|2',
      'collector-health|herring|4', 'payment-latency|herring|3',
    ],
  );
  assert.deepEqual(
    S.hypotheses.map((h) => `${h.id}|${h.right}`),
    ['expired-certificate|true', 'collector-dropping|false', 'payment-provider-slow|false', 'dns-lapsed|false', 'origin-overloaded|false'],
  );
});

test('everything-is-green: valid; 20 minutes; clues plus neutrals cost 19 min and leave 5% (1 min), so only a herring can exhaust the budget', () => {
  assert.deepEqual(validateScenario(S), []);
  assert.equal(S.budget.startPct / S.budget.burnPctPerMin, 20);
  assert.equal(cost('clue'), 13);
  assert.equal(cost('neutral'), 6);
  assert.equal(S.budget.startPct - (cost('clue') + cost('neutral')) * S.budget.burnPctPerMin, 5);
  for (const h of S.views.filter((v) => v.kind === 'herring')) {
    assert.equal(h.costMin > 1, true, `${h.id} alone spends more than the 1 min that is left`);
  }
  assert.equal(S.views.every((v) => v.costMin <= 4), true, 'no view is a long wait');
  assert.equal(S.views.filter((v) => v.kind === 'neutral').length >= 2 && S.views.filter((v) => v.kind === 'herring').length >= 2, true);
  assert.equal(S.hypotheses.filter((h) => h.right).length, 1);
});

test('everything-is-green: a scored Act 7 boss lighting existing nodes, no cards, mechanics derived from the one incident step', () => {
  assert.deepEqual(
    { id: BOSS.id, no: BOSS.no, mechanics: [...BOSS.mechanics], cards: [...BOSS.cards], lights: [...BOSS.lights], scored: BOSS.scored, parMs: BOSS.scoring.parMs, kind: BOSS.kind, actId: BOSS.actId },
    { id: ID, no: null, mechanics: ['incident'], cards: [], lights: ['storefront', 'api-gateway'], scored: true, parMs: null, kind: 'boss', actId: 'act-7' },
  );
  assert.equal(LIVE.acts.find((a) => a.id === 'act-7').bossId, ID);
  assert.deepEqual(BOSS.play.steps.map((s) => Object.keys(s).find((k) => ['incident', 'choice'].includes(k))), ['incident', 'choice']);
  assert.equal(S.hypotheses.length, 5);
});

test('everything-is-green: shares storefront and api-gateway with 7.4, and the boss waits for the act\'s four levels', () => {
  const lit = (done) => {
    const p = emptyProgress();
    for (const id of done) p.levels[id] = { stars: 3, at: null };
    return litIds(LIVE, p).sort();
  };
  assert.deepEqual(lit([ID]), ['api-gateway', 'storefront']);
  assert.deepEqual(lit(['synthetic-checks']), ['api-gateway', 'storefront']);
  const act = [...LIVE.acts.find((a) => a.id === 'act-7').levelIds];
  assert.equal(act.length, 4);
  const earlier = LIVE.order.slice(0, LIVE.order.indexOf(act[0]));
  const partly = emptyProgress();
  for (const id of [...earlier, ...act.slice(0, 3)]) partly.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, partly, LIVE), 'locked', 'the boss is locked until the act\'s levels are done');
  const all = emptyProgress();
  for (const id of [...earlier, ...act]) all.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, all, LIVE), 'open');
  assert.equal(LIVE.order[LIVE.order.indexOf(act[act.length - 1]) + 1], ID, 'the boss comes right after its act\'s levels');
});

test('everything-is-green: star totals count the boss (the derived scored-level max), and a 3-star boss is 3 of them', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  const p = emptyProgress();
  p.levels[ID] = { stars: 3, at: null };
  assert.deepEqual(starTotals(p, LIVE), { earned: 3, max: MAX_STARS });
});

test('everything-is-green: no em dash in the level file', () => {
  assert.equal(read(`levels/${ID}.mjs`).includes('\u2014'), false);
});

// ---- the one table, and why everything is green ---------------------------------------

const [BEFORE, FIRST, NOW] = TABLE.windows;
const ratio = (w) => w.errors / w.requests;
const burn = (w) => ratio(w) / (1 - TABLE.sloTarget);

test('the table is pinned: three windows, 240 internal requests a window, a normal morning a week earlier, the rules, the health runs', () => {
  assert.deepEqual(TABLE.windows, [
    { at: '07:55', requests: 12000, errors: 12, p99Ms: 210 },
    { at: '08:00', requests: 240, errors: 0, p99Ms: 190 },
    { at: '09:15', requests: 240, errors: 0, p99Ms: 190 },
  ]);
  assert.deepEqual(
    { sloTarget: TABLE.sloTarget, internal: TABLE.internal, lastWeek: TABLE.lastWeek, expiresAt: TABLE.expiresAt, rules: TABLE.rules, healthPassed: TABLE.healthPassed, outsideAt: TABLE.outsideAt },
    { sloTarget: 0.999, internal: 240, lastWeek: { at: '09:15', requests: 12300 }, expiresAt: '08:00', rules: { errorRatioPct: 1, burnRate: 14.4, p99LimitMs: 800, rateFloor: 0.5 }, healthPassed: 60, outsideAt: '09:22' },
  );
});

test('the span-based ratio is defined, not 0/0: every window has requests, and the post-expiry windows are 0 of 240', () => {
  for (const w of TABLE.windows) assert.equal(w.requests > 0, true, w.at);
  assert.equal(FIRST.requests, TABLE.internal, 'after the expiry only the internal tools are left');
  assert.equal(NOW.requests, TABLE.internal);
  assert.equal(ratio(NOW), 0);
  assert.equal(Number.isNaN(ratio(NOW)), false);
  assert.equal(`${NOW.errors} of ${NOW.requests}`, '0 of 240');
  assert.equal(Math.round(ratio(BEFORE) * 1000) / 10, 0.1, 'before the expiry: 12 of 12,000');
  assert.equal(Math.round(burn(BEFORE) * 10) / 10, 1);
});

test('green is explained by the data: every rule reads under its line at the late window, and only the request count would have moved', () => {
  assert.equal(ratio(NOW) * 100 < TABLE.rules.errorRatioPct, true, 'error ratio');
  assert.equal(burn(NOW) < TABLE.rules.burnRate, true, 'burn rate, 5 minutes');
  assert.equal(NOW.p99Ms < TABLE.rules.p99LimitMs, true, 'p99');
  assert.equal(NOW.p99Ms <= BEFORE.p99Ms, true, 'faster than before, never slower');
  assert.equal(TABLE.healthPassed, 60, 'every health run passed');
  assert.equal(NOW.requests < TABLE.rules.rateFloor * TABLE.lastWeek.requests, true, 'a request-rate rule would have fired against the usual for the hour on the board; none exists');
  const rules = plain(view('alert-rules').html);
  assert.equal(rules.includes('No rule watches how many requests arrive'), true);
  assert.equal(/request (rate|count)/i.test(rules.replace('how many requests arrive', '')), false, 'no rate rule is listed');
});

test('the views state exactly the table\'s figures', () => {
  const spans = plain(view('span-numbers').html);
  for (const w of TABLE.windows) {
    const row = `${w.at} ${w.requests.toLocaleString('en-US')} ${w.errors} ${(Math.round(ratio(w) * 1000) / 10).toFixed(1)}% ${(Math.round(burn(w) * 10) / 10).toFixed(1)} ${w.p99Ms} ms`;
    assert.equal(spans.includes(row), true, row);
  }
  const drop = Math.round(((BEFORE.requests - FIRST.requests) / BEFORE.requests) * 100);
  assert.equal(drop, 98);
  assert.equal(spans.includes(`fell by ${drop}%`), true);
  assert.equal(spans.includes('0 of 240 failed'), true);
  const callers = plain(view('who-calls').html);
  assert.equal(callers.includes('Browsers 0 12,060'), true, '240 - 240 = 0 now; 12,300 - 240 = 12,060 last week');
  assert.equal(callers.includes('Internal tools 240 240'), true);
  assert.equal(callers.includes('Counted by the load balancer 240 12,300'), true);
  assert.equal(TABLE.lastWeek.requests - TABLE.internal, 12060);
  const rules = plain(view('alert-rules').html);
  for (const w of ['0.0%', 'above 1%', 'above 14.4 in both', '190 ms', 'above 800 ms', 'passed 60 of 60']) assert.equal(rules.includes(w), true, w);
  const outside = plain(view('outside-request').html);
  assert.equal(outside.includes('certificate has expired') && outside.includes(`ends at ${TABLE.expiresAt}`), true);
  assert.equal(outside.includes('internal name returns 200'), true);
  assert.equal(outside.includes(`at ${TABLE.outsideAt}`) && outside.includes('abridged') && outside.includes('was resolved') && outside.includes('Connected to') && outside.includes('curl: (60)'), true, 'dated after the page, marked abridged, resolved and connected, then error 60');
});

test('the time line holds: the certificate ends at 08:00, the last good window is 07:55, the first bad one 08:00, the first report 08:10, the page 09:21', () => {
  const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  assert.equal(minutes(BEFORE.at) + 5, minutes(TABLE.expiresAt), 'the 07:55 window ends where the certificate does');
  assert.equal(FIRST.at, TABLE.expiresAt);
  const alert = plain(S.alert.html);
  assert.equal(alert.includes('PAGE 09:21') && alert.includes('since 08:10'), true);
  assert.equal(minutes(TABLE.outsideAt) > minutes('09:21'), true, 'the outside request is made after the page');
  assert.equal(minutes('08:10') > minutes(TABLE.expiresAt), true);
  assert.equal(alert.includes('certificate') || alert.includes('CDN'), false, 'the alert does not give the cause away');
  for (const id of ['span-numbers', 'who-calls', 'alert-rules']) assert.equal(/certificate|TLS|CDN edge, then/.test(plain(view(id).html).replace(/Visitors come through the CDN edge, then the load balancer, then the pods;/, '')), false, `${id} does not name the cause`);
});

test('herrings and neutrals are contradicted by the clues, in times and numbers', () => {
  const collector = plain(view('collector-health').html);
  assert.equal(collector.includes('06:42') && collector.includes('recovered') && collector.includes('every 5-minute window'), true);
  const pay = plain(view('payment-latency').html);
  assert.equal(pay.includes('09:02') && pay.includes('09:06') && pay.includes('14 test orders') && pay.includes('since 08:00'), true);
  assert.equal(plain(view('origin-pods').html).includes('no restarts'), true);
  assert.equal(plain(view('last-deploy').html).includes('nothing was released near 08:00'), true);
  assert.equal(plain(view('database').html).includes('11 of 200'), true);
});

test('each hypothesis\'s why cites the table: the right one explains green, each wrong one is refuted by a view the player can open', () => {
  const why = (id) => plain(S.hypotheses.find((h) => h.id === id).why);
  const right = why(RIGHT);
  for (const w of ['12,000', '240', '08:00', '0 of 240 failed is 0.0%', 'burn rate is 0.0', 'inside the cluster']) assert.equal(right.includes(w), true, w);
  assert.equal(why('collector-dropping').includes('load balancer') && why('collector-dropping').includes('240') && why('collector-dropping').includes('06:42'), true);
  assert.equal(why('payment-provider-slow').includes('09:02') && why('payment-provider-slow').includes('0 requests') && why('payment-provider-slow').includes('12,060'), true);
  assert.equal(why('origin-overloaded').includes('9% CPU') && why('origin-overloaded').includes('190 ms') && why('origin-overloaded').includes('210 ms') && why('origin-overloaded').includes('200'), true);
});

// ---- sources -------------------------------------------------------------------------

test('sources: Spec lines are opentelemetry.io, Dash0 docs lines are dash0.com, the reasoning and the invented parts are marked, no unsourced claim of a spec', () => {
  const src = read(`levels/${ID}.mjs`);
  const lines = src.split('\n');
  const spec = lines.filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(spec.length > 0 && spec.every((u) => new URL(u).host === 'opentelemetry.io'), true);
  assert.deepEqual(spec, ['https://opentelemetry.io/docs/specs/otel/trace/api/#spankind'], 'only the page a claim rests on (SpanKind)');
  const docs = lines.filter((l) => /^\/\/ Dash0 docs: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(docs.length, 2);
  assert.equal(docs.every((u) => new URL(u).host === 'www.dash0.com' && u.startsWith('https://www.dash0.com/docs/dash0/monitoring/synthetics/')), true);
  assert.equal(lines.some((l) => /^\/\/ Stated as reasoning, with no source/.test(l)), true, 'the TLS and CDN reasoning is labelled');
  assert.equal(lines.some((l) => /^\/\/ Invented for the game:/.test(l)), true);
  assert.equal(/\bthe spec says\b/i.test(src), false);
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
const budget = () => {
  const b = board(ID);
  return `${b.left} ${b.spent}`;
};
const locked = () => lockedOf(ID);
const status = () => region(ID, 'status');
const feedback = () => region(ID, 'feedback');
/** After the right hypothesis: Next, the closing Choice answered right, then Finish. */
const finish = () => {
  click('#eig-next');
  click('[data-pick="outside-check"]');
  click('[data-finish]');
};
const WALK = ['span-numbers', 'who-calls', 'outside-request'];

test('everything-is-green: the first screen shows the alert, a full budget, nine views, locked hypotheses and a disabled Next', () => {
  start();
  assert.equal(alertTitle(ID), 'Shop unreachable, dashboards green');
  assert.equal(budget(), '20 min left. 0 of 20 min spent');
  assert.equal(board(ID).cells.total, 20);
  assert.equal(qa('[data-view]').length, 9);
  assert.equal(locked(), 'true,true,true,true,true');
  assert.equal(q('#eig-next').disabled, true);
  assert.equal(qa('[data-finish]').length, 0, 'Finish is on the closing step');
});

test('everything-is-green: it takes three clue views to unlock the answers (answerAfterViews 3): two are not enough', () => {
  start();
  open('span-numbers');
  open('outside-request');
  assert.equal(locked(), 'true,true,true,true,true');
  open('who-calls');
  assert.equal(locked(), 'false,false,false,false,false');
});

test('everything-is-green: neutral and herring views never unlock the answers; only clue views do', () => {
  start();
  for (const id of [...NEUTRALS, ...HERRINGS]) open(id);
  assert.equal(locked(), 'true,true,true,true,true', 'every neutral and herring view is open and the answers are still locked');
  open('span-numbers');
  open('who-calls');
  assert.equal(locked(), 'true,true,true,true,true', 'two clues are still not enough');
  open('alert-rules');
  assert.equal(locked(), 'false,false,false,false,false');
});

// ---- reference path (I7) and shortcuts -----------------------------------------------

test('everything-is-green: the reference path (the four clues, then expired-certificate) solves with 35% of the budget (7 min) left and no penalty', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const id of CLUES) {
    const r = openView(S, st, id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 35);
  assert.equal(canAnswer(S, st), true);
  assert.equal(answer(S, st, RIGHT).outcome, 'right');
  assert.equal(mistakes, 0);
});

test('everything-is-green: shortcut: opening every view in order exhausts at the first herring and costs three mistakes (two herrings, one exhaustion); the answer is still open', () => {
  let st = newIncident(S);
  let mistakes = 0;
  const exhaustedOn = [];
  for (const v of S.views) {
    const r = openView(S, st, v.id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
    if (r.exhaustedNow) exhaustedOn.push(v.id);
  }
  assert.deepEqual(exhaustedOn, ['collector-health'], 'the first herring (19 + 4 of 20 min) runs the budget out');
  assert.equal(budgetLeft(S, st), 0);
  assert.equal(mistakes, 3);
  assert.equal(answer(S, st, RIGHT).outcome, 'right', 'the incident is still solvable at 0');
});

test('everything-is-green: shortcut: clues and neutrals in any order are never penalised and never exhaust; a herring is the only way to run out', () => {
  for (const order of [[...CLUES, ...NEUTRALS], [...NEUTRALS, ...CLUES], [...CLUES].reverse().concat(NEUTRALS)]) {
    let st = newIncident(S);
    for (const id of order) {
      const r = openView(S, st, id);
      st = r.state;
      assert.equal(r.herring || r.exhaustedNow, false, order.join());
    }
    assert.equal(budgetLeft(S, st), 5, order.join());
    for (const h of HERRINGS) assert.equal(openView(S, st, h).exhaustedNow, true, `${h} alone runs out the last minute`);
  }
});

test('everything-is-green: shortcut impossible: three neutrals leave every hypothesis locked with 14 of 20 min left', () => {
  const { finished, slips } = start();
  for (const id of NEUTRALS) open(id);
  assert.equal(budget(), '14 min left. 6 of 20 min spent');
  assert.equal(locked(), 'true,true,true,true,true');
  assert.equal(q('#eig-next').disabled, true);
  assert.equal(finished.length, 0);
  assert.equal(slips.mistakes, 0);
});

test('everything-is-green: shortcut impossible: neutrals plus two clues still lock the answers; the third clue unlocks them and a first-try right guess wins with 5 stars', () => {
  const { finished, slips } = start();
  for (const id of NEUTRALS) open(id);
  open('span-numbers');
  open('who-calls');
  assert.equal(locked(), 'true,true,true,true,true');
  open('outside-request');
  assert.equal(locked(), 'false,false,false,false,false');
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 0);
  assert.equal(finished[0].stars, 5);
});

test('everything-is-green: shortcut: solving the incident does not finish the level; there is no Finish on the incident screen', () => {
  const { finished } = start();
  for (const id of WALK) open(id);
  guess(RIGHT);
  assert.equal(finished.length, 0);
  assert.equal(qa('[data-finish]').length, 0);
  assert.equal(q('#eig-next').disabled, false);
});

test('everything-is-green: the shortest path is three clues; it solves with 11 of 20 min left, no penalty and 5 stars', () => {
  const { finished, slips } = start();
  for (const id of WALK) open(id);
  assert.equal(q('#eig-next').disabled, true, 'Next waits for the right answer');
  guess(RIGHT);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '11 min left. 9 of 20 min spent');
  finish();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 5);
  assert.equal(finished[0].text, BOSS.play.finish);
});

// ---- penalties: one each from a clean start ------------------------------------------

test('everything-is-green: a herring costs one mistake on its first open only, and the run still finishes with 4 stars', () => {
  const { slips, finished } = start();
  open('collector-health');
  assert.equal(slips.mistakes, 1);
  assert.deepEqual([status().tone, status().text.includes('was misleading')], ['error', true]);
  open('collector-health');
  assert.equal(slips.mistakes, 1, 'a repeat open is free');
  for (const id of WALK) open(id);
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('everything-is-green: the second herring is a second mistake; a wrong answer on top is a third and leaves 2 stars', () => {
  const { slips, finished } = start();
  open('collector-health');
  open('payment-latency');
  for (const id of WALK) open(id);
  assert.equal(slips.mistakes, 2);
  guess('origin-overloaded');
  assert.equal(slips.mistakes, 3);
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 3);
  assert.equal(finished[0].stars, 2);
});

for (const id of ['collector-dropping', 'payment-provider-slow', 'origin-overloaded']) {
  test(`everything-is-green: guessing ${id} costs one mistake, once, and is then ruled out (picking it again is free)`, () => {
    const { slips, finished } = start();
    for (const v of WALK) open(v);
    guess(id);
    assert.equal(slips.mistakes, 1);
    assert.equal(causeState(ID, id), 'wrong');
    assert.equal(feedback().text.startsWith('Not quite.'), true);
    guess(id);
    assert.equal(slips.mistakes, 1);
    guess(RIGHT);
    finish();
    assert.equal(slips.mistakes, 1);
    assert.equal(finished[0].stars, 4);
  });
}

test('everything-is-green: every clue and neutral leaves 1 min and no mistake; a herring then spends the rest, a herring mistake and an exhaustion mistake in one open', () => {
  const { slips, finished } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  assert.equal(slips.mistakes, 0, '19 min in: 1 left, nothing spent yet');
  assert.equal(budget(), '1 min left. 19 of 20 min spent');
  open('payment-latency');
  assert.equal(slips.mistakes, 2, 'one herring (3 min) alone runs the 1 min out');
  assert.equal(board(ID).left, 'Budget spent.');
  assert.deepEqual([status().tone, status().text.includes('was misleading, and the error budget is spent')], ['error', true]);
  assert.equal(causeState(ID, RIGHT), null, 'still answerable at 0');
  guess(RIGHT);
  finish();
  assert.equal(finished[0].stars, 3, 'two penalties leave 3 stars');
});

test('everything-is-green: opening a view again costs neither time nor a mistake, so repeat opens cannot exhaust the budget', () => {
  const { slips } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  for (const id of ['span-numbers', 'alert-rules', 'database']) open(id);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '1 min left. 19 of 20 min spent');
});

// ---- the closing Choice: 7.2 (SLI source) and 7.4 (outside-in probing) -----------------

const pick = BOSS.play.steps[1].choice.choices;
const choice = (key) => pick.find((c) => c.key === key);

test('everything-is-green: the closing step has one right addition, an outside check, and four wrong ones that each name why with the table\'s figures', () => {
  assert.deepEqual(pick.filter((c) => c.right).map((c) => c.key), ['outside-check']);
  assert.deepEqual(pick.filter((c) => !c.right).map((c) => c.key), ['tighter-ratio', 'load-balancer-sli', 'faster-health', 'rate-drop']);
  const right = plain(choice('outside-check').label + choice('outside-check').why);
  for (const w of ['outside the network', 'public hostname', 'SSL/TLS handshake', 'shows a TLS error as such', 'notification']) assert.equal(right.includes(w), true, w);
  const ratioWhy = plain(choice('tighter-ratio').why);
  assert.equal(ratioWhy.includes('0 of 240') && ratioWhy.includes('0.0%'), true);
  const lbWhy = plain(choice('load-balancer-sli').why);
  assert.equal(lbWhy.includes('7.2') && lbWhy.includes('240 requests') && lbWhy.includes('at the CDN edge'), true, '7.2: the load balancer is the better SLI source for what it turns away, but the refusal is in front of it');
  const healthWhy = plain(choice('faster-health').why);
  assert.equal(healthWhy.includes('60 of 60') && healthWhy.includes('inside the cluster'), true);
  const rateWhy = plain(choice('rate-drop').why);
  assert.equal(rateWhy.includes('would have fired') && rateWhy.includes('240 requests') && rateWhy.includes('12,300') && rateWhy.includes('6,150') && !rateWhy.includes('12,000') && rateWhy.includes('names the step'), true, 'the rate alert is fairly granted as firing; it does not name the step');
  assert.equal(plain(BOSS.play.steps[1].question).includes('named the step that failed'), true, 'the question asks for what only the probe gives');
  assert.equal(choice('tighter-ratio').label.includes('0.1%'), true);
  assert.equal(plain(choice('faster-health').why).includes('running it more often only repeats a passing result'), true);
  assert.equal(plain(choice('tighter-ratio').why).includes('never becomes a span of the shop'), true, 'scoped to the shop\'s own spans');
});

test('everything-is-green: only the outside check meets the question: the others either stay at 0% or cannot name the step', () => {
  const ratioNow = ratio(NOW) * 100;
  assert.equal(ratioNow < 0.1, true, 'under the lowered 0.1% line');
  assert.equal(TABLE.healthPassed === 60, true);
  assert.equal(NOW.requests === TABLE.internal, true, 'the load balancer\'s count equals the internal requests, all good');
  assert.equal(TABLE.rules.rateFloor * TABLE.lastWeek.requests, 6150, 'half of the usual for the hour on the board');
  assert.equal(NOW.requests < 6150, true, 'the rate alert fires against that one baseline');
});

test('everything-is-green: a wrong answer on the closing step costs one mistake, once, and leaves 4 stars', () => {
  const { slips, finished } = start();
  for (const id of WALK) open(id);
  guess(RIGHT);
  click('#eig-next');
  click('[data-pick="faster-health"]');
  assert.equal(slips.mistakes, 1);
  assert.equal(q('[data-finish]').disabled, true, 'Finish waits for the right addition');
  click('[data-pick="outside-check"]');
  click('[data-finish]');
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('everything-is-green: focus walk: first view, an opened heading, the win card, then Finish', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'view:span-numbers');
  open('span-numbers');
  assert.equal(focus.last(), 'heading:span-numbers');
  open('who-calls');
  open('outside-request');
  guess(RIGHT);
  assert.equal(focus.last(), `#${ID}-win-title`);
  assert.equal(q('#eig-next').disabled, false);
  click('#eig-next');
  click('[data-pick="outside-check"]');
  assert.equal(focus.last(), '#eig-finish');
  assert.equal(q('[data-finish]').id, 'eig-finish');
  assert.deepEqual(focus.unfocusable(), []);
});

// ---- the outside request is necessary (#135 review) ------------------------------------

// The views that refute each wrong hypothesis, and the words in each view that do it.
const REFUTED_BY = {
  'collector-dropping': { 'collector-health': 'no refusals', 'who-calls': 'Counted by the load balancer 240', 'outside-request': 'certificate has expired' },
  'payment-provider-slow': { 'payment-latency': 'no browser visitors since 08:00', 'who-calls': 'Browsers 0', 'outside-request': 'certificate has expired' },
  'dns-lapsed': { 'outside-request': 'was resolved' },
  'origin-overloaded': { 'origin-pods': 'None is under pressure', 'span-numbers': '190 ms', 'outside-request': 'internal name returns 200' },
};

test('each refutation is in the text of the view it names, and nothing outside the outside request mentions DNS, the name or a record', () => {
  for (const [h, byView] of Object.entries(REFUTED_BY)) {
    for (const [v, words] of Object.entries(byView)) assert.equal(plain(view(v).html).includes(words), true, `${h} / ${v}`);
  }
  for (const v of S.views.filter((x) => x.id !== 'outside-request')) {
    assert.equal(/DNS|resolv|domain|record|hostname|name server/i.test(plain(v.html)), false, `${v.id} cannot refute a lapsed name`);
  }
  assert.equal(/DNS|resolv|domain|record|hostname/i.test(plain(S.alert.html)), false);
});

test('every board that unlocks the answers without the outside request keeps at least two defensible hypotheses (the right one and the lapsed name); with it, exactly one', () => {
  const ids = S.views.map((v) => v.id);
  let withOut = 0;
  let without = 0;
  for (let mask = 0; mask < 1 << ids.length; mask += 1) {
    const set = ids.filter((_, i) => mask & (1 << i));
    let st = newIncident(S);
    for (const id of set) st = openView(S, st, id).state;
    if (!canAnswer(S, st)) continue;
    const defensible = S.hypotheses.filter((h) => h.right || !Object.keys(REFUTED_BY[h.id]).some((v) => set.includes(v))).map((h) => h.id);
    if (set.includes('outside-request')) {
      withOut += 1;
      assert.deepEqual(defensible, [RIGHT], set.join());
    } else {
      without += 1;
      assert.equal(defensible.length >= 2 && defensible.includes('dns-lapsed'), true, set.join());
    }
  }
  assert.equal(without, 32, 'the three other clues with any of the five neutrals and herrings');
  assert.equal(withOut, 128);
});

test('the right hypothesis\'s why cites only views that unlock boards can hold: it names the outside request, and the others by their view', () => {
  const right = plain(S.hypotheses.find((h) => h.id === RIGHT).why);
  assert.equal(right.includes('The request from outside resolves the hostname and connects, then fails'), true);
  assert.equal(right.includes('In the span numbers') && right.includes('the callers view shows'), true);
  assert.equal(S.hypotheses.find((h) => h.id === 'dns-lapsed').why.includes('curl error 60'), true);
});

test('the closing labels are of similar length: the right one is not the longest, and nothing marks it by shape or by echoing the clue tile', () => {
  const lens = pick.map((c) => c.label.length);
  const right = choice('outside-check').label;
  assert.equal(right.length < Math.max(...lens), true, 'the right label is not the longest');
  assert.equal(right.length > Math.min(...lens), true, 'nor the shortest');
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 20, true, lens.join());
  assert.equal(pick.some((c) => /^The same\b/.test(c.label)), false, 'no "The same ..." pattern');
  assert.equal(/request from outside/i.test(right), false, 'does not echo the clue tile');
  assert.equal(pick.every((c) => /^An? /.test(c.label)), true, 'one shape for all five');
});
