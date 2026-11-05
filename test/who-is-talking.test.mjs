// Act 1 boss "Who is talking?" beyond the play-through: the scenario pinned (views, kinds, costs, budget,
// burn rate, answerAfterViews), the engine's validator and budget arithmetic on it, the facts the clues
// share (one fallback name, one executable, one deployment and pod, one version, a deploy two minutes
// before the first alert), the shortcuts a player could take through the real incident engine, the
// reference path within budget (I7), one penalty per run (herring, exhaustion, wrong hypothesis), and a
// focus walk that ends on Finish. The board is read in minutes (25 at 4%/min, #143) through
// test/helpers/incident-board.mjs. The scenario is designed for this game (docs/OUTLINE.md §4 Act 1 defines
// no boss; decided on #16); the structure mirrors The 3 a.m. errors (test/the-3am-errors.test.mjs). The
// happy and sloppy runs are generated from the level's data (test/play.test.mjs). Asserts strings, numbers
// and booleans only.
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
const ID = 'who-is-talking';
const BOSS = LIVE.levels[ID];
const S = BOSS.play.steps[0].incident;
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const view = (id) => S.views.find((v) => v.id === id);
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const cost = (kind) => S.views.filter((v) => v.kind === kind).reduce((n, v) => n + v.costMin, 0);
const CLUES = ['alert-resource', 'deploy-history', 'pod-env'];
const NEUTRALS = ['collector-restart', 'message-volume', 'pod-health'];

// ---- content pin ---------------------------------------------------------------------

test('who-is-talking: scenario pin: id, budget, burn rate, answerAfterViews, views with kinds and costs, hypotheses', () => {
  assert.equal(S.id, ID);
  assert.equal(S.alert.title, 'Who is unknown_service:node?');
  assert.deepEqual(S.budget, { startPct: 100, burnPctPerMin: 4 });
  assert.equal(S.answerAfterViews, 2);
  assert.deepEqual(
    S.views.map((v) => `${v.id}|${v.kind}|${v.costMin}`),
    [
      'alert-resource|clue|4', 'deploy-history|clue|4', 'pod-env|clue|4',
      'collector-restart|neutral|3', 'message-volume|neutral|2', 'pod-health|neutral|2',
      'catalog-rename|herring|4', 'k8s-warnings|herring|3',
    ],
  );
  assert.deepEqual(
    S.hypotheses.map((h) => `${h.id}|${h.right}`),
    ['name-dropped|true', 'new-service|false', 'detector-broken|false', 'collector-renamed|false'],
  );
});

test('who-is-talking: valid; 25 minutes; clues plus neutrals cost 19 and leave 6, so only the herrings can exhaust the budget', () => {
  assert.deepEqual(validateScenario(S), []);
  assert.equal(S.budget.startPct / S.budget.burnPctPerMin, 25);
  assert.equal(cost('clue'), 12);
  assert.equal(cost('neutral'), 7);
  assert.equal(25 - (cost('clue') + cost('neutral')), 6);
  assert.equal(cost('herring'), 7, 'both herrings on top spend more than the 6 minutes left');
  assert.equal(S.views.every((v) => v.kind === 'clue' || v.costMin <= 4), true, 'no view is a long wait');
  assert.equal(S.views.filter((v) => v.kind === 'herring').length >= 2, true);
  assert.equal(S.views.filter((v) => v.kind === 'neutral').length >= 2, true);
});

test('who-is-talking: a scored Act 1 boss lighting Notifications, no cards, mechanics derived from the one incident step', () => {
  assert.deepEqual(
    { id: BOSS.id, no: BOSS.no, mechanics: [...BOSS.mechanics], cards: [...BOSS.cards], lights: [...BOSS.lights], scored: BOSS.scored, parMs: BOSS.scoring.parMs, kind: BOSS.kind, actId: BOSS.actId },
    { id: ID, no: null, mechanics: ['incident'], cards: [], lights: ['notifications'], scored: true, parMs: null, kind: 'boss', actId: 'act-1' },
  );
  assert.equal(LIVE.acts.find((a) => a.id === 'act-1').bossId, ID);
  assert.equal(BOSS.play.steps.map((s) => Object.keys(s).find((k) => ['incident', 'choice'].includes(k))).join(), 'incident,choice');
  assert.equal(S.hypotheses.length, 4);
});

test('who-is-talking: lights Notifications, a node no Act 1 level lights, and the boss waits for the act\'s three levels', () => {
  const lit = (done) => {
    const p = emptyProgress();
    for (const id of done) p.levels[id] = { stars: 3, at: null };
    return litIds(LIVE, p).sort();
  };
  assert.deepEqual(lit([ID]), ['notifications']);
  assert.deepEqual(lit(['resources', 'naming-your-service', 'detectors-and-kubernetes']), ['checkout', 'recommendations', 'redis']);
  const act = ['resources', 'naming-your-service', 'detectors-and-kubernetes'];
  const partly = emptyProgress();
  for (const id of act.slice(0, 2)) partly.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, partly, LIVE), 'locked', 'the boss is locked until the act\'s levels are done');
  const all = emptyProgress();
  for (const id of ['monitoring-vs-observability', 'the-signals', 'why-opentelemetry', 'the-pager', ...act]) all.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, all, LIVE), 'open');
});

test('who-is-talking: star totals count the boss (the derived scored-level max), and a 3-star boss is 3 of them', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  const p = emptyProgress();
  p.levels[ID] = { stars: 3, at: null };
  assert.deepEqual(starTotals(p, LIVE), { earned: 3, max: MAX_STARS });
});

test('who-is-talking: no em dash in the level file', () => {
  assert.equal(read(`levels/${ID}.mjs`).includes('\u2014'), false);
});

// ---- the clues agree with each other -------------------------------------------------

test('one fallback name: the alert and the resource say unknown_service:node, and it is the fallback shape for executable node', () => {
  const alert = plain(S.alert.html);
  const res = plain(view('alert-resource').html);
  for (const t of [alert, res]) assert.equal(t.includes('unknown_service:node'), true);
  assert.equal(res.includes('process.executable.name node'), true, 'the executable is node');
  assert.equal(res.includes('unknown_service: plus process.executable.name'), true, 'the view explains the fallback shape');
  assert.equal(/service\.name unknown_service:node/.test(res), true);
  assert.equal(res.includes('OTEL_SERVICE_NAME'), false, 'the resource view does not give the cause away');
});

test('the k8s attributes name the owner: one deployment, namespace and pod across the resource, the deploys and the pod', () => {
  const res = plain(view('alert-resource').html);
  assert.equal(res.includes('k8s.deployment.name notifications'), true);
  assert.equal(res.includes('k8s.namespace.name comms'), true);
  const pod = /k8s\.pod\.name (notifications-[0-9a-f]+-[a-z0-9]{5})/.exec(res)?.[1];
  assert.equal(typeof pod, 'string');
  assert.equal(plain(view('pod-env').html).includes(pod), true, 'pod-env is the env of that pod');
  assert.equal(/Collector[^.]*k8sattributes/.test(res), true, 'the k8s attributes come from the Collector, as in 1.3');
  assert.equal(plain(view('deploy-history').html).includes('notifications 5.2.0'), true);
  assert.equal(plain(view('pod-env').html).includes('namespace comms'), true);
});

test('one version and one executable: 5.2.0 on the resource, the deploy and the pod; node is the start command', () => {
  for (const id of ['alert-resource', 'deploy-history', 'pod-env']) {
    assert.equal(plain(view(id).html).includes('5.2.0'), true, `${id} names 5.2.0`);
  }
  assert.equal(plain(view('pod-env').html).includes('node dist/server.js'), true, 'the container starts node');
});

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

test('the deploy is two minutes before the first alert span, and removed OTEL_SERVICE_NAME, which the running pod lacks', () => {
  const began = /since (\d\d:\d\d)/.exec(plain(S.alert.html))[1];
  const deploy = /notifications 5\.2\.0 rolled out at (\d\d:\d\d)/.exec(plain(view('deploy-history').html))[1];
  assert.equal(minutes(began) - minutes(deploy), 2);
  const diff = plain(view('deploy-history').html);
  assert.equal(diff.includes('- OTEL_SERVICE_NAME=notifications'), true, 'the diff removes the variable');
  assert.equal(diff.includes('5.1.3'), true, 'the previous release');
  const env = plain(view('pod-env').html);
  assert.equal(env.includes('OTEL_SERVICE_NAME is not set'), true);
  assert.equal(/OTEL_SERVICE_NAME=/.test(env), false, 'no OTEL_SERVICE_NAME line in the running env');
  assert.equal(/OTEL_RESOURCE_ATTRIBUTES=[^ ]*service\.name=/.test(env), false, 'and no service.name in OTEL_RESOURCE_ATTRIBUTES either');
  assert.equal(env.includes('OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,service.namespace=comms,service.version=5.2.0'), true);
});

test('herrings and neutrals say why they do not explain the name, in facts the clues contradict', () => {
  assert.equal(plain(view('catalog-rename').html).includes('catalog-api'), true);
  assert.equal(plain(view('catalog-rename').html).includes('separate'), true);
  assert.equal(plain(view('k8s-warnings').html).includes('a month'), true);
  assert.equal(plain(view('collector-restart').html).includes('14:03'), true);
  assert.equal(plain(view('collector-restart').html).includes('config is unchanged'), true);
  assert.equal(plain(view('message-volume').html).includes('same as yesterday'), true);
  assert.equal(plain(view('pod-health').html).includes('no restarts'), true);
  assert.equal(minutes('14:03') < minutes('14:09'), true, 'the restart is before the deploy, so it cannot be what changed the name');
});

test('each wrong hypothesis is refuted by a view the player can open, and the right one cites the three clues', () => {
  const why = (id) => plain(S.hypotheses.find((h) => h.id === id).why);
  const right = why('name-dropped');
  for (const w of ['unknown_service:node', 'process.executable.name', '14:09', 'OTEL_SERVICE_NAME', 'k8s']) assert.equal(right.includes(w), true, w);
  assert.equal(why('new-service').includes('5.1.3'), true);
  assert.equal(why('detector-broken').includes('k8s.deployment.name'), true);
  assert.equal(why('collector-renamed').includes('14:03'), true);
});

test('the Dash0 tie-in is bounded to the Resources docs, and every Spec line is an opentelemetry.io page', () => {
  const src = read(`levels/${ID}.mjs`);
  const finish = BOSS.play.finish;
  for (const w of ['Dash0', 'Kubernetes pods and deployments', 'filters by resource attributes']) assert.equal(finish.includes(w), true, w);
  const dash0 = src.split('\n').filter((l) => /^\/\/ Dash0 docs/.test(l)).join('\n');
  for (const u of [
    'https://www.dash0.com/docs/dash0/monitoring/resources/about-resources',
    'https://www.dash0.com/docs/dash0/monitoring/resources/explore-resources',
  ]) assert.equal(dash0.includes(u), true, u);
  const spec = src.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(spec.length > 0 && spec.every((u) => new URL(u).host === 'opentelemetry.io'), true);
  for (const u of [
    'https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/',
    'https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/',
  ]) assert.equal(spec.includes(u), true, u);
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
  click('#wit-next');
  click('[data-pick="env-var"]');
  click('[data-finish]');
};

test('who-is-talking: the first screen shows the alert, a full budget, eight views, locked hypotheses, a disabled Next and no Finish', () => {
  start();
  assert.equal(alertTitle(ID), 'Who is unknown_service:node?');
  assert.equal(budget(), '25 min left. 0 of 25 min spent');
  assert.equal(board(ID).cells.total, 25);
  assert.equal(qa('[data-view]').length, 8);
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#wit-next').disabled, true);
  assert.equal(qa('[data-finish]').length, 0, 'Finish is on the closing step');
});

test('who-is-talking: it takes two looks to unlock the answers (answerAfterViews 2): one view is not enough', () => {
  start();
  open('alert-resource');
  assert.equal(locked(), 'true,true,true,true');
  open('deploy-history');
  assert.equal(locked(), 'false,false,false,false');
});

test('who-is-talking: neutral and herring views never unlock the answers; only clue views do', () => {
  start();
  for (const id of ['collector-restart', 'message-volume', 'pod-health']) open(id);
  for (const id of ['catalog-rename', 'k8s-warnings']) open(id);
  assert.equal(locked(), 'true,true,true,true', 'every neutral and herring view is open and the answers are still locked');
  open('alert-resource');
  assert.equal(locked(), 'true,true,true,true', 'one clue is still not enough');
  open('deploy-history');
  assert.equal(locked(), 'false,false,false,false');
});

// ---- reference path (I7) and shortcuts -----------------------------------------------

test('who-is-talking: the reference path (resource, deploys, pod env, then name-dropped) solves with 52% (13 min) left and no penalty', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const id of CLUES) {
    const r = openView(S, st, id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 52);
  assert.equal(canAnswer(S, st), true);
  assert.equal(answer(S, st, 'name-dropped').outcome, 'right');
  assert.equal(mistakes, 0);
});

test('who-is-talking: shortcut: opening every view in order ends at 0%: the first herring costs one, the second its herring and the exhaustion, and the right answer is still open', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const v of S.views) {
    const r = openView(S, st, v.id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 0);
  assert.equal(mistakes, 3, 'two herrings and one exhaustion; no mistake for the clues or neutrals');
  assert.equal(answer(S, st, 'name-dropped').outcome, 'right', 'the incident is still solvable at 0');
});

test('who-is-talking: shortcut: only clues, in any order, never penalised; even the lucky two (resource, pod env) unlock the answer at 68%', () => {
  for (const order of [CLUES, [...CLUES].reverse(), ['pod-env', 'alert-resource', 'deploy-history']]) {
    let st = newIncident(S);
    let mistakes = 0;
    for (const id of order) {
      const r = openView(S, st, id);
      st = r.state;
      mistakes += Number(r.herring) + Number(r.exhaustedNow);
    }
    assert.equal(mistakes, 0, order.join());
    assert.equal(budgetLeft(S, st), 52, order.join());
  }
  let st = newIncident(S);
  for (const id of ['alert-resource', 'pod-env']) st = openView(S, st, id).state;
  assert.equal(canAnswer(S, st), true);
  assert.equal(budgetLeft(S, st), 68);
});

test('who-is-talking: shortcut: every clue and neutral in any order never exhausts; skipping the closing Choice leaves no Finish', () => {
  let st = newIncident(S);
  for (const id of [...NEUTRALS, ...CLUES]) {
    const r = openView(S, st, id);
    st = r.state;
    assert.equal(r.exhaustedNow, false, id);
  }
  assert.equal(budgetLeft(S, st), 24);
  const { finished } = start();
  open('alert-resource');
  open('deploy-history');
  guess('name-dropped');
  assert.equal(finished.length, 0, 'solving the incident does not finish the level');
  assert.equal(qa('[data-finish]').length, 0, 'there is no Finish on the incident screen');
  assert.equal(q('#wit-next').disabled, false);
});

test('who-is-talking: the shortest path is two clues (resource, deploys); it solves with 17 of 25 min left, no penalty and 5 stars', () => {
  const { finished, slips } = start();
  open('alert-resource');
  open('deploy-history');
  assert.equal(q('#wit-next').disabled, true, 'Next waits for the right answer');
  guess('name-dropped');
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '17 min left. 8 of 25 min spent');
  finish();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 5);
  assert.equal(finished[0].text, BOSS.play.finish);
});

// ---- penalties: one each from a clean start ------------------------------------------

test('who-is-talking: a herring costs one mistake on its first open only, and the run still finishes with 4 stars', () => {
  const { slips, finished } = start();
  open('catalog-rename');
  assert.equal(slips.mistakes, 1);
  assert.deepEqual([status().tone, status().text.includes('was misleading')], ['error', true]);
  open('catalog-rename');
  assert.equal(slips.mistakes, 1, 'a repeat open is free');
  open('alert-resource');
  open('deploy-history');
  guess('name-dropped');
  finish();
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('who-is-talking: the second herring is a second mistake; a wrong answer on top is a third and leaves 2 stars', () => {
  const { slips, finished } = start();
  open('catalog-rename');
  open('k8s-warnings');
  assert.equal(slips.mistakes, 2);
  for (const id of CLUES.slice(0, 2)) open(id);
  guess('new-service');
  assert.equal(slips.mistakes, 3, 'the herrings do not unlock; the two clues do');
  guess('name-dropped');
  finish();
  assert.equal(slips.mistakes, 3);
  assert.equal(finished[0].stars, 2);
});

for (const id of ['new-service', 'detector-broken', 'collector-renamed']) {
  test(`who-is-talking: guessing ${id} costs one mistake, once, and is then ruled out (picking it again is free)`, () => {
    const { slips, finished } = start();
    open('alert-resource');
    open('deploy-history');
    guess(id);
    assert.equal(slips.mistakes, 1);
    assert.equal(causeState(ID, id), 'wrong');
    assert.equal(feedback().text.startsWith('Not quite.'), true);
    guess(id);
    assert.equal(slips.mistakes, 1);
    guess('name-dropped');
    finish();
    assert.equal(slips.mistakes, 1);
    assert.equal(finished[0].stars, 4);
  });
}

test('who-is-talking: every clue and neutral leaves 6 min and no mistake; one herring leaves 3; the second spends the rest, a herring mistake and an exhaustion mistake in one open', () => {
  const { slips, finished } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  assert.equal(slips.mistakes, 0, '19 min in: 6 left, nothing spent yet');
  assert.equal(budget(), '6 min left. 19 of 25 min spent');
  open('k8s-warnings');
  assert.equal(slips.mistakes, 1, 'one herring alone does not exhaust');
  assert.equal(budget(), '3 min left. 22 of 25 min spent');
  open('catalog-rename');
  assert.equal(slips.mistakes, 3);
  assert.equal(board(ID).left, 'Budget spent.');
  assert.equal(board(ID).cells.over, 25);
  assert.deepEqual([status().tone, status().text.includes('was misleading, and the error budget is spent')], ['error', true]);
  assert.equal(causeState(ID, 'name-dropped'), null, 'still answerable at 0');
  guess('name-dropped');
  finish();
  assert.equal(finished[0].stars, 2, 'three penalties leave 2 stars (the star rule: 3 or 4 penalties)');
});

test('who-is-talking: opening a view again costs neither time nor a mistake, so repeat opens cannot exhaust the budget', () => {
  const { slips } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  for (const id of ['alert-resource', 'pod-env', 'pod-health']) open(id);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '6 min left. 19 of 25 min spent');
});

test('who-is-talking: the closing step grades the fix and the fallback; renaming the executable and k8s attributes are corrected', () => {
  const fix = BOSS.play.steps[1].choice.choices;
  const right = fix.find((c) => c.right);
  assert.equal(right.key, 'env-var');
  const t = plain(right.label + right.why);
  for (const w of ['OTEL_SERVICE_NAME=notifications', 'takes precedence over', 'OTEL_RESOURCE_ATTRIBUTES', 'unknown_service:<process.executable.name>', 'unknown_service:node']) {
    assert.equal(t.includes(w), true, w);
  }
  assert.deepEqual(fix.filter((c) => !c.right).map((c) => c.key).sort(), ['executable-name', 'k8s-attribute']);
  assert.equal(plain(fix.find((c) => c.key === 'executable-name').why).includes('unknown_service:notifications'), true);
  assert.equal(plain(fix.find((c) => c.key === 'k8s-attribute').why).includes('already'), true);
});

test('who-is-talking: a wrong answer on the closing step costs one mistake, once, and leaves 4 stars', () => {
  const { slips, finished } = start();
  open('alert-resource');
  open('deploy-history');
  guess('name-dropped');
  click('#wit-next');
  click('[data-pick="executable-name"]');
  assert.equal(slips.mistakes, 1);
  assert.equal(q('[data-finish]').disabled, true, 'Finish waits for the right fix');
  click('[data-pick="env-var"]');
  click('[data-finish]');
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('who-is-talking: focus walk: first view, an opened heading, the win card, then Finish', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'view:alert-resource');
  open('alert-resource');
  assert.equal(focus.last(), 'heading:alert-resource');
  open('deploy-history');
  guess('name-dropped');
  assert.equal(focus.last(), `#${ID}-win-title`);
  assert.equal(q('#wit-next').disabled, false);
  click('#wit-next');
  click('[data-pick="env-var"]');
  assert.equal(focus.last(), '#wit-finish');
  assert.equal(q('[data-finish]').id, 'wit-finish');
  assert.deepEqual(focus.unfocusable(), []);
});
