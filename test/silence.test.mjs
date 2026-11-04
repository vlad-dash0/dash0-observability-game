// Act 5 boss "Silence" beyond the play-through: the scenario pinned (views, kinds, costs, budget, burn
// rate, answerAfterViews), the engine's validator and budget arithmetic on it, the facts the clues share
// (one exporter id the pipelines list and the config no longer defines, one rollout time a minute before
// the data stops, the Collector's own error line), the shortcuts a player could take through the real
// incident engine, the reference path within budget (I7), one penalty per run (herring, exhaustion, wrong
// hypothesis), and a focus walk that ends on Finish. The scenario is designed for this game
// (docs/OUTLINE.md §4 Act 5 defines no boss; decided on #16); the structure mirrors The 3 a.m. errors
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
import { litIds } from './helpers/lights.mjs';
import { levelState } from '../lib/unlock.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
const ID = 'silence';
const BOSS = LIVE.levels[ID];
const S = BOSS.play.steps[0].incident;
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const view = (id) => S.views.find((v) => v.id === id);
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const cost = (kind) => S.views.filter((v) => v.kind === kind).reduce((n, v) => n + v.costMin, 0);
const CLUES = ['arrival-by-cluster', 'collector-pods', 'collector-log', 'config-diff'];
const NEUTRALS = ['app-pods', 'nodes', 'backend-ingest'];
const HERRINGS = ['network-blip', 'memory-limiter-refusals'];
const RIGHT = 'exporter-renamed';

// ---- content pin ---------------------------------------------------------------------

test('silence: scenario pin: id, budget, burn rate, answerAfterViews, views with kinds and costs, hypotheses', () => {
  assert.equal(S.id, ID);
  assert.equal(S.alert.title, 'Silence from eu-west');
  assert.deepEqual(S.budget, { startPct: 100, burnPctPerMin: 5 });
  assert.equal(S.answerAfterViews, 3);
  assert.deepEqual(
    S.views.map((v) => `${v.id}|${v.kind}|${v.costMin}`),
    [
      'arrival-by-cluster|clue|3', 'collector-pods|clue|3', 'collector-log|clue|3', 'config-diff|clue|3',
      'app-pods|neutral|2', 'nodes|neutral|2', 'backend-ingest|neutral|3',
      'network-blip|herring|4', 'memory-limiter-refusals|herring|3',
    ],
  );
  assert.deepEqual(
    S.hypotheses.map((h) => `${h.id}|${h.right}`),
    ['exporter-renamed|true', 'memory-limiter|false', 'wrong-port|false', 'apps-stopped|false'],
  );
});

test('silence: valid; clues plus neutrals cost 19 min and leave 5%, so only a herring can exhaust the budget', () => {
  assert.deepEqual(validateScenario(S), []);
  assert.equal(cost('clue'), 12);
  assert.equal(cost('neutral'), 7);
  assert.equal(S.budget.startPct - (cost('clue') + cost('neutral')) * S.budget.burnPctPerMin, 5);
  for (const h of S.views.filter((v) => v.kind === 'herring')) {
    assert.equal(h.costMin * S.budget.burnPctPerMin > 5, true, `${h.id} spends more than the 5% that is left`);
  }
  assert.equal(S.views.every((v) => v.kind === 'clue' || v.costMin <= 4), true, 'no view is a long wait');
  assert.equal(S.views.filter((v) => v.kind === 'neutral').length >= 2 && S.views.filter((v) => v.kind === 'herring').length >= 2, true);
});

test('silence: a scored Act 5 boss lighting the Collector, no cards, mechanics derived from the one incident step', () => {
  assert.deepEqual(
    { id: BOSS.id, no: BOSS.no, mechanics: [...BOSS.mechanics], cards: [...BOSS.cards], lights: [...BOSS.lights], scored: BOSS.scored, parMs: BOSS.scoring.parMs, kind: BOSS.kind, actId: BOSS.actId },
    { id: ID, no: null, mechanics: ['incident'], cards: [], lights: ['collector'], scored: true, parMs: null, kind: 'boss', actId: 'act-5' },
  );
  assert.equal(LIVE.acts.find((a) => a.id === 'act-5').bossId, ID);
  assert.deepEqual(BOSS.play.steps.map((s) => Object.keys(s).find((k) => ['incident', 'choice'].includes(k))), ['incident', 'choice']);
  assert.equal(S.hypotheses.length, 4);
});

test('silence: lights the Collector (shared with 5.1 to 5.6), and the boss waits for the act\'s six levels', () => {
  const lit = (done) => {
    const p = emptyProgress();
    for (const id of done) p.levels[id] = { stars: 3, at: null };
    return litIds(LIVE, p).sort();
  };
  assert.deepEqual(lit([ID]), ['collector']);
  assert.deepEqual(lit(['pipelines']), ['collector']);
  const act = [...LIVE.acts.find((a) => a.id === 'act-5').levelIds];
  assert.equal(act.length, 6);
  const earlier = LIVE.order.slice(0, LIVE.order.indexOf(act[0]));
  const partly = emptyProgress();
  for (const id of [...earlier, ...act.slice(0, 5)]) partly.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, partly, LIVE), 'locked', 'the boss is locked until the act\'s levels are done');
  const all = emptyProgress();
  for (const id of [...earlier, ...act]) all.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, all, LIVE), 'open');
  assert.equal(LIVE.order[LIVE.order.indexOf(act[act.length - 1]) + 1], ID, 'the boss comes right after its act\'s levels');
});

test('silence: star totals count the boss (the derived scored-level max), and a 3-star boss is 3 of them', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  const p = emptyProgress();
  p.levels[ID] = { stars: 3, at: null };
  assert.deepEqual(starTotals(p, LIVE), { earned: 3, max: MAX_STARS });
});

test('silence: no em dash in the level file', () => {
  assert.equal(read(`levels/${ID}.mjs`).includes('\u2014'), false);
});

// ---- the clues agree with each other -------------------------------------------------

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

test('one exporter id runs through the log, the diff and the answer: the pipelines list otlp_grpc/dash0, the config now defines otlp_grpc/dash0-eu', () => {
  const diff = view('config-diff').html;
  assert.equal(/-\s+otlp_grpc\/dash0:/.test(diff), true, 'the diff removes the old id');
  assert.equal(/\+\s+otlp_grpc\/dash0-eu:/.test(diff), true, 'the diff adds the new id');
  assert.equal((diff.match(/exporters: \[otlp_grpc\/dash0\]/g) ?? []).length, 3, 'traces, metrics and logs still list the old id, unchanged');
  assert.equal(diff.includes('otlp_grpc/dash0-eu]'), false, 'no pipeline lists the new id');
  const log = plain(view('collector-log').html);
  assert.equal(log.includes('references exporter "otlp_grpc/dash0" which is not configured'), true);
  assert.equal(log.includes('service::pipelines::'), true);
  assert.equal(log.includes('naming one of the three pipelines (traces, metrics or logs)'), true, 'the log does not claim a fixed pipeline');
  assert.equal(log.includes('same two lines'), false, 'no claim that every restart prints identical lines');
  const right = plain(S.hypotheses.find((h) => h.id === RIGHT).label + S.hypotheses.find((h) => h.id === RIGHT).why);
  for (const w of ['otlp_grpc/dash0-eu', 'otlp_grpc/dash0', 'service.pipelines', 'refuses to start']) assert.equal(right.includes(w), true, w);
});

test('the rollout is a minute before the silence, only eu-west has it, and the other clusters keep sending', () => {
  const stop = /stopped at (\d\d:\d\d)/.exec(plain(S.alert.html))[1];
  const diff = plain(view('config-diff').html);
  const merged = /merged at (\d\d:\d\d)/.exec(diff)[1];
  const rolled = /applied to eu-west at (\d\d:\d\d)/.exec(diff)[1];
  assert.equal(minutes(stop) - minutes(merged), 1);
  assert.equal(stop, rolled);
  assert.equal(/us-east, us-west and ap-south[^.]*previous/.test(diff), true, 'the other clusters still run the previous config');
  const arrival = plain(view('arrival-by-cluster').html);
  for (const w of ['k8s.cluster.name', 'us-east', 'us-west', 'ap-south', 'eu-west', 'exactly 0', 'traces, metrics and logs']) {
    assert.equal(arrival.includes(w), true, `arrival-by-cluster says "${w}"`);
  }
});

test('the pods view shows restarts, not a limit: the Collector never stays up, and the other clusters have none', () => {
  const pods = plain(view('collector-pods').html);
  for (const w of ['k8s.container.restart.count', 'Ready 0/1', 'last terminated reason', 'Error', 'otel-collector', 'eu-west', 'no restarts']) {
    assert.equal(pods.includes(w), true, `collector-pods says "${w}"`);
  }
  assert.equal(pods.includes('otlp_grpc/dash0'), false, 'the pod view does not give the cause away');
  assert.equal(plain(view('arrival-by-cluster').html).includes('otlp_grpc/dash0'), false);
  assert.equal(/renam/.test(plain(view('collector-log').html)), false, 'the log says what is missing, not why');
});

test('herrings and neutrals say why they do not explain the silence, in times and numbers the clues contradict', () => {
  const blip = plain(view('network-blip').html);
  assert.equal(blip.includes('13:12') && blip.includes('13:14') && blip.includes('recovered'), true);
  const refusals = plain(view('memory-limiter-refusals').html);
  assert.equal(refusals.includes('otelcol_processor_memory_limiter_refused_spans') && refusals.includes('us-east') && refusals.includes('12:40'), true);
  assert.equal(plain(view('app-pods').html).includes('no restarts'), true);
  assert.equal(plain(view('nodes').html).includes('12 of 12'), true);
  assert.equal(plain(view('backend-ingest').html).includes('no rejected'), true);
});

test('each wrong hypothesis is refuted by a view the player can open, and the right one cites the clues', () => {
  const why = (id) => plain(S.hypotheses.find((h) => h.id === id).why);
  const right = why(RIGHT);
  for (const w of ['14:01', '14:02', 'not configured', 'restart']) assert.equal(right.includes(w), true, w);
  assert.equal(why('memory-limiter').includes('memory_limiter') && /never (starts|runs)|before/.test(why('memory-limiter')), true);
  assert.equal(why('wrong-port').includes('endpoint') && why('wrong-port').includes('valid'), true);
  assert.equal(why('apps-stopped').includes('no restarts'), true);
});

// ---- sources -------------------------------------------------------------------------

test('sources: Spec lines are opentelemetry.io, Docs lines are GitHub, the invented log is marked, and the Dash0 tie-in is n/a with a reason', () => {
  const src = read(`levels/${ID}.mjs`);
  const lines = src.split('\n');
  const spec = lines.filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(spec.length > 0 && spec.every((u) => new URL(u).host === 'opentelemetry.io'), true);
  for (const u of [
    'https://opentelemetry.io/docs/collector/configuration/',
    'https://opentelemetry.io/docs/specs/semconv/registry/attributes/k8s/',
  ]) assert.equal(spec.some((s) => s.startsWith(u)), true, u);
  const docs = lines.filter((l) => /^\/\/ Docs/.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(docs.length > 0 && docs.every((u) => new URL(u).host === 'github.com'), true);
  for (const u of [
    'https://github.com/open-telemetry/opentelemetry-collector/blob/main/otelcol/config.go',
    'https://github.com/open-telemetry/opentelemetry-collector/blob/main/confmap/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/README.md',
  ]) assert.equal(docs.includes(u), true, u);
  assert.equal(lines.some((l) => /^\/\/ Invented for the game:/.test(l)), true, 'the made-up parts are named');
  assert.equal(lines.some((l) => /^\/\/ Dash0 tie-in: n\/a/.test(l)), true);
  assert.equal(/dash0\.com\/docs/.test(src), false, 'no Dash0 page is cited: none was verified for this scenario');
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

const text = (sel) => q(sel)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
const open = (id) => click(`[data-view="${id}"]`);
const guess = (id) => click(`[data-hypothesis="${id}"]`);
const budget = () => text('[data-budget-text]');
const locked = () => qa('[data-hypothesis]').map((b) => b.disabled).join();
const FEEDBACK = `#${ID}-feedback`;
/** After the right hypothesis: Next, the closing Choice answered right, then Finish. */
const finish = () => {
  click('#sil-next');
  click('[data-pick="listed-must-be-defined"]');
  click('[data-finish]');
};
const WALK = ['arrival-by-cluster', 'collector-log', 'config-diff'];

test('silence: the first screen shows the alert, a full budget, nine views, locked hypotheses and a disabled Next', () => {
  start();
  assert.equal(text('.incident-alert h3'), 'Silence from eu-west');
  assert.equal(budget(), 'Error budget: 100% left (0 min in).');
  assert.equal(qa('[data-view]').length, 9);
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#sil-next').disabled, true);
  assert.equal(qa('[data-finish]').length, 0, 'Finish is on the closing step');
});

test('silence: it takes three looks to unlock the answers (answerAfterViews 3): two views are not enough', () => {
  start();
  open('arrival-by-cluster');
  open('collector-log');
  assert.equal(locked(), 'true,true,true,true');
  open('config-diff');
  assert.equal(locked(), 'false,false,false,false');
});

test('silence: neutral and herring views never unlock the answers; only clue views do', () => {
  start();
  for (const id of ['app-pods', 'nodes', 'backend-ingest']) open(id);
  for (const id of ['network-blip', 'memory-limiter-refusals']) open(id);
  assert.equal(locked(), 'true,true,true,true', 'every neutral and herring view is open and the answers are still locked');
  open('arrival-by-cluster');
  open('collector-log');
  assert.equal(locked(), 'true,true,true,true', 'two clues are still not enough');
  open('config-diff');
  assert.equal(locked(), 'false,false,false,false');
});

// ---- reference path (I7) and shortcuts -----------------------------------------------

test('silence: the reference path (the four clues, then exporter-renamed) solves with 40% of the budget left and no penalty', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const id of CLUES) {
    const r = openView(S, st, id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 40);
  assert.equal(canAnswer(S, st), true);
  assert.equal(answer(S, st, RIGHT).outcome, 'right');
  assert.equal(mistakes, 0);
});

test('silence: shortcut: opening every view in order ends at 0%, with the two penalties of the first herring (herring, exhaustion) and a second herring mistake; the answer is still open', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const v of S.views) {
    const r = openView(S, st, v.id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 0);
  assert.equal(mistakes, 3, 'two herrings and one exhaustion; no mistake for the clues or neutrals');
  assert.equal(answer(S, st, RIGHT).outcome, 'right', 'the incident is still solvable at 0');
});

test('silence: shortcut: clues in any order are never penalised, and every clue plus neutral in any order never exhausts', () => {
  for (const order of [CLUES, [...CLUES].reverse(), ['config-diff', 'arrival-by-cluster', 'collector-log', 'collector-pods']]) {
    let st = newIncident(S);
    let mistakes = 0;
    for (const id of order) {
      const r = openView(S, st, id);
      st = r.state;
      mistakes += Number(r.herring) + Number(r.exhaustedNow);
    }
    assert.equal(mistakes, 0, order.join());
    assert.equal(budgetLeft(S, st), 40, order.join());
  }
  let st = newIncident(S);
  for (const id of [...NEUTRALS, ...CLUES]) {
    const r = openView(S, st, id);
    st = r.state;
    assert.equal(r.exhaustedNow, false, id);
  }
  assert.equal(budgetLeft(S, st), 5);
});

test('silence: shortcut impossible: three neutrals leave every hypothesis disabled at 65%, so no lucky first guess can win without a clue', () => {
  const { finished, slips } = start();
  for (const id of NEUTRALS) open(id);
  assert.equal(budget(), 'Error budget: 65% left (7 min in).');
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#sil-next').disabled, true);
  assert.equal(finished.length, 0);
  assert.equal(slips.mistakes, 0);
});

test('silence: shortcut impossible: three neutrals plus two clues still lock the answers; the third clue unlocks them and a first-try right guess wins with 5 stars', () => {
  const { finished, slips } = start();
  for (const id of NEUTRALS) open(id);
  open('arrival-by-cluster');
  open('collector-log');
  assert.equal(locked(), 'true,true,true,true');
  open('config-diff');
  assert.equal(locked(), 'false,false,false,false');
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 0);
  assert.equal(finished[0].stars, 5);
});

test('silence: shortcut: solving the incident does not finish the level; there is no Finish on the incident screen', () => {
  const { finished } = start();
  for (const id of WALK) open(id);
  guess(RIGHT);
  assert.equal(finished.length, 0);
  assert.equal(qa('[data-finish]').length, 0);
  assert.equal(q('#sil-next').disabled, false);
});

test('silence: the shortest path is three clues (arrival, log, diff); it solves at 55% with no penalty and 5 stars', () => {
  const { finished, slips } = start();
  for (const id of WALK) open(id);
  assert.equal(q('#sil-next').disabled, true, 'Next waits for the right answer');
  guess(RIGHT);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), 'Error budget: 55% left (9 min in).');
  finish();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 5);
  assert.equal(finished[0].text, BOSS.play.finish);
});

// ---- penalties: one each from a clean start ------------------------------------------

test('silence: a herring costs one mistake on its first open only, and the run still finishes with 4 stars', () => {
  const { slips, finished } = start();
  open('network-blip');
  assert.equal(slips.mistakes, 1);
  assert.equal(text(FEEDBACK).includes('red herring'), true);
  open('network-blip');
  assert.equal(slips.mistakes, 1, 'a repeat open is free');
  open('arrival-by-cluster');
  open('collector-log');
  open('config-diff');
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('silence: the second herring is a second mistake; a wrong answer on top is a third and leaves 2 stars', () => {
  const { slips, finished } = start();
  open('network-blip');
  open('memory-limiter-refusals');
  open('arrival-by-cluster');
  open('collector-log');
  open('config-diff');
  assert.equal(slips.mistakes, 2);
  guess('wrong-port');
  assert.equal(slips.mistakes, 3);
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 3);
  assert.equal(finished[0].stars, 2);
});

for (const id of ['memory-limiter', 'wrong-port', 'apps-stopped']) {
  test(`silence: guessing ${id} costs one mistake, once, and is then disabled`, () => {
    const { slips, finished } = start();
    for (const v of WALK) open(v);
    guess(id);
    assert.equal(slips.mistakes, 1);
    assert.equal(q(`[data-hypothesis="${id}"]`).disabled, true);
    assert.equal(text(FEEDBACK).startsWith('Not quite.'), true);
    guess(RIGHT);
    finish();
    assert.equal(slips.mistakes, 1);
    assert.equal(finished[0].stars, 4);
  });
}

test('silence: every clue and neutral leaves 5% and no mistake; a herring then spends the rest, a herring mistake and an exhaustion mistake in one open', () => {
  const { slips, finished } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  assert.equal(slips.mistakes, 0, '19 min in: 5% left, nothing spent yet');
  assert.equal(budget(), 'Error budget: 5% left (19 min in).');
  open('memory-limiter-refusals');
  assert.equal(slips.mistakes, 2);
  assert.equal(budget(), 'Error budget: 0% left (22 min in).');
  assert.equal(text(FEEDBACK).includes('red herring, and the error budget is spent'), true);
  assert.equal(q(`[data-hypothesis="${RIGHT}"]`).disabled, false, 'still answerable at 0');
  guess(RIGHT);
  finish();
  assert.equal(finished[0].stars, 3, 'two penalties leave 3 stars (the star rule: 2 penalties)');
});

test('silence: opening a view again costs neither time nor a mistake, so repeat opens cannot exhaust the budget', () => {
  const { slips } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  for (const id of ['arrival-by-cluster', 'config-diff', 'nodes']) open(id);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), 'Error budget: 5% left (19 min in).');
});

test('silence: the closing step grades the wiring rule: a listed id must be defined; the Collector does not skip it, and the slash name is part of the id', () => {
  const pick = BOSS.play.steps[1].choice.choices;
  const right = pick.find((c) => c.right);
  assert.equal(right.key, 'listed-must-be-defined');
  const t = plain(right.label + right.why);
  for (const w of ['service.pipelines', 'otlp_grpc/dash0', 'otlp_grpc/dash0-eu', 'not configured', 'validation']) {
    assert.equal(t.includes(w), true, w);
  }
  assert.deepEqual(pick.filter((c) => !c.right).map((c) => c.key).sort(), ['defined-not-listed', 'same-exporter']);
  assert.equal(/defined but not listed|does nothing/.test(plain(pick.find((c) => c.key === 'defined-not-listed').why)), true);
  assert.equal(/type\[\/name\]|different/.test(plain(pick.find((c) => c.key === 'same-exporter').why)), true);
});

test('silence: a wrong answer on the closing step costs one mistake, once, and leaves 4 stars', () => {
  const { slips, finished } = start();
  for (const id of WALK) open(id);
  guess(RIGHT);
  click('#sil-next');
  click('[data-pick="same-exporter"]');
  assert.equal(slips.mistakes, 1);
  assert.equal(q('[data-finish]').disabled, true, 'Finish waits for the right rule');
  click('[data-pick="listed-must-be-defined"]');
  click('[data-finish]');
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('silence: focus walk: first view, an opened heading, then Finish', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'view:arrival-by-cluster');
  open('arrival-by-cluster');
  assert.equal(focus.last(), 'heading:arrival-by-cluster');
  open('collector-log');
  open('config-diff');
  guess(RIGHT);
  assert.equal(focus.last(), '#sil-next');
  click('#sil-next');
  click('[data-pick="listed-must-be-defined"]');
  assert.equal(focus.last(), '#sil-finish');
  assert.equal(q('[data-finish]').id, 'sil-finish');
  assert.deepEqual(focus.unfocusable(), []);
});
