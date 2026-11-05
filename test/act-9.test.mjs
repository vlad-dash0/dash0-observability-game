// Act 9 "Live Demo" and level 9.2 "The 34% error rate" beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's place in the
// registry, unlock and globe; level fields; the verdict Choice and the setup Trade-off through the
// real graders; the arithmetic the copy shows, recomputed here from scratch; and the sources
// (docs/LIVE-DEMO.md). Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { runPlay, validatePlay } from '../lib/play.mjs';
import { ACTS } from '../levels/index.mjs';
import { DECK } from '../cards/deck.mjs';
import { NODE_IDS } from '../hub/map-data.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { isActComplete, isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';
import { allPlans, evaluatePlan, validateTradeoffSpec } from '../lib/widgets/trade-off.mjs';

const ID = 'the-34-percent-error-rate';
const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const SRC = read(`levels/${ID}.mjs`);
const plain = (html) => html.replace(/<[^>]+>/g, '');

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};
const idsOf = (actId) => {
  const act = LIVE.acts.find((a) => a.id === actId);
  return [...act.levelIds, ...(act.bossId ? [act.bossId] : [])];
};
const level = LIVE.levels[ID];
const [VERDICT_STEP, PLAN_STEP] = level.play.steps;
const choices = VERDICT_STEP.choice.choices;
const spec = PLAN_STEP.tradeoff;
const copyOf = (step) => plain([step.intro, step.show ?? '', step.question].join(' '));

// ---- the act ------------------------------------------------------------------------

test('act-9 "Live Demo" is the last act, after act-6, holding only 9.2 and no boss', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-9');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 9, name: 'Live Demo', sub: 'Does that answer hold?', levelIds: [ID], bossId: null },
  );
  assert.deepEqual(LIVE.acts.map((a) => a.id).slice(-2), ['act-6', 'act-9']);
  assert.deepEqual(LIVE.order.slice(-2), ['errors-tripled', ID]);
});

test('act-9 unlocks like the acts before it: open when acts 0-6 are complete, or once entered', () => {
  const before = [0, 1, 2, 3, 4, 5, 6].flatMap((n) => idsOf(`act-${n}`));
  const index = LIVE.acts.findIndex((a) => a.id === 'act-9'); // isActUnlocked takes the position, not the number
  assert.equal(index, 7);
  assert.equal(isActUnlocked(index, progressOf(before), LIVE), true);
  assert.equal(levelState(ID, progressOf(before), LIVE), 'open');
  assert.equal(levelState(ID, progressOf([ID]), LIVE), 'done', 'completed even when earlier acts are not');
  assert.equal(isActUnlocked(index, progressOf([ID]), LIVE), true);

  const withoutBoss = before.filter((id) => id !== 'errors-tripled');
  assert.equal(isActUnlocked(index, progressOf(withoutBoss), LIVE), false, 'the boss of act-6 counts');
  assert.equal(levelState(ID, progressOf(withoutBoss), LIVE), 'locked');
  assert.deepEqual(lockReason(ID, progressOf(withoutBoss), LIVE), { kind: 'act', actId: 'act-6' });
  assert.equal(levelState(ID, emptyProgress(), LIVE), 'locked');
  assert.deepEqual(lockReason(ID, emptyProgress(), LIVE), { kind: 'act', actId: 'act-0' });
});

test('act-9 is complete when its one level is done (no boss)', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-9');
  assert.equal(isActComplete(act, emptyProgress()), false);
  assert.equal(isActComplete(act, progressOf([ID])), true);
});

test('adding act-9 re-locks nothing in acts 0-6: every level has the state it has in a registry built without it', () => {
  const without = buildRegistry(ACTS.filter((a) => a.id !== 'act-9'), { deck: DECK, nodeIds: NODE_IDS, play: { validatePlay, runPlay } });
  const all = [0, 1, 2, 3, 4, 5, 6].flatMap((n) => idsOf(`act-${n}`));
  const fixtures = [
    [],
    ['monitoring-vs-observability'],
    idsOf('act-0'),
    [...idsOf('act-0'), ...idsOf('act-1'), 'spans-and-traces'],
    all.filter((id) => id !== 'errors-tripled'),
    all,
    [...all, ID],
    ['head-sampling'],
  ];
  assert.deepEqual(without.order, LIVE.order.slice(0, -1));
  for (const ids of fixtures) {
    const p = progressOf(ids);
    for (const id of without.order) assert.equal(levelState(id, p, LIVE), levelState(id, p, without), `${id} with ${ids.length} done`);
  }
});

test('9.2 fields: scored with no par time, in act-9, lights the collector, awards no card; a 3-star run is 3 stars', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, scored: level.scored, parMs: level.scoring.parMs },
    { no: '9.2', name: 'The 34% error rate', sub: 'Does that answer hold?', icon: '\u{1F399}', rewardTitle: 'Ratio sceptic', kind: 'level', actId: 'act-9', scored: true, parMs: null },
  );
  assert.deepEqual([...level.cards], []);
  assert.deepEqual([...level.lights], ['collector']);
  assert.deepEqual([...level.mechanics], ['tradeoff']);
  assert.equal(level.play.prefix, 'ser');
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  assert.deepEqual(starTotals(progressOf([ID]), LIVE), { earned: 3, max: MAX_STARS });
});

// ---- step 1: the verdict --------------------------------------------------------------

test('step 1 is a Choice: holds, wrong, follow-up; exactly one right answer, "wrong"', () => {
  assert.equal(VERDICT_STEP.qid, 'ser-q-verdict');
  assert.equal(VERDICT_STEP.choice.id, 'ser-verdict');
  assert.deepEqual(choices.map((c) => c.key), ['holds', 'wrong', 'follow-up']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['wrong']);
  assert.deepEqual(
    choices.map((c) => c.label.split(':')[0]),
    ['It holds', 'It is wrong', 'Ask first'],
  );
  for (const c of choices) assert.equal(c.label.startsWith({ holds: 'It holds:', wrong: 'It is wrong:', 'follow-up': 'Ask first:' }[c.key]), true, c.key);
  assert.equal(plain(VERDICT_STEP.question), 'Does the presenter\'s answer hold?');
});

test('step 1 copy: the intro has the 34% claim, the show has 1,000 requests, 10% and 145 spans of which 50 are errors; the right why says 5%', () => {
  assert.match(plain(VERDICT_STEP.intro), /34%/);
  assert.match(plain(VERDICT_STEP.intro), /presenter/);
  const show = plain(VERDICT_STEP.show);
  for (const s of ['1,000', '10%', '145', '50', 'Error']) assert.equal(show.includes(s), true, s);
  assert.equal(VERDICT_STEP.show.includes('<pre'), false, 'prose and a table, no YAML');
  assert.equal(VERDICT_STEP.show.includes('<table'), true);
  const right = choices.find((c) => c.right);
  assert.equal(plain(right.why).includes('50 / 1,000 = 5%'), true);
  assert.equal(plain(right.why).includes('50 / 145 = 34%'), true);
  assert.match(plain(choices.find((c) => c.key === 'follow-up').why), /bias comes from the policy, not from noise/);
});

// ---- step 2: the trade-off ---------------------------------------------------------------

test('step 2 is a valid Trade-off whose only passing plan is errors-metrics-before', () => {
  assert.equal(PLAN_STEP.qid, 'ser-q-plan');
  assert.deepEqual(validateTradeoffSpec(spec), []);
  assert.equal(spec.unit, 'spans/s sent to the backend');
  assert.equal(spec.cap, 200);
  assert.deepEqual(spec.knobs.map((k) => k.id), ['setup']);
  assert.deepEqual(spec.needs.map((x) => [x.id, x.label]), [
    ['every-error', 'every failed trace'],
    ['baseline', 'a sample of healthy traces'],
    ['true-rate', 'an error rate that matches the requests'],
  ]);
  const passing = allPlans(spec).filter((p) => {
    const r = evaluatePlan(spec, p);
    return r.over === 0 && r.lost.length === 0;
  });
  assert.deepEqual(passing, [{ setup: 'errors-metrics-before' }]);
  assert.deepEqual(spec.answer, { setup: 'errors-metrics-before' });
});

test('step 2 plans: send-all is over by 800, uniform loses every-error, errors-stored loses true-rate, the answer fits', () => {
  const ev = (setup) => evaluatePlan(spec, { setup });
  assert.deepEqual(ev('send-all'), { complete: true, total: 1000, over: 800, lost: [] });
  assert.deepEqual(ev('uniform'), { complete: true, total: 100, over: 0, lost: ['every-error'] });
  assert.deepEqual(ev('errors-stored'), { complete: true, total: 145, over: 0, lost: ['true-rate'] });
  assert.deepEqual(ev('errors-metrics-before'), { complete: true, total: 145, over: 0, lost: [] });
});

test('the explanation ties to Dash0 truthfully: before-sampling RED, SignalControl, dash0redmetrics on 100% of spans, 6.2 for the Collector fix', () => {
  const e = plain(spec.explain);
  for (const s of ['before sampling', 'SignalControl', 'dash0redmetrics', 'pre-sampling pipeline', '100% of spans', '6.2']) assert.equal(e.includes(s), true, s);
  assert.equal(/dash0\.spans\.red/.test(SRC.replace(/^\/\/.*$/gm, '')), false, 'no claim about what dash0.spans.red shows');
});

// ---- the arithmetic, recomputed from scratch -------------------------------------------------

test('the figures: 950 healthy, 95 kept, 145 stored, 50 / 145 is 34%, 50 / 1,000 is 5%, shown in the copy', () => {
  const healthy = 1000 - 50;
  const keptHealthy = healthy / 10;
  const stored = 50 + keptHealthy;
  assert.equal(keptHealthy, 95);
  assert.equal(stored, 145);
  assert.equal(Math.round((50 / stored) * 100), 34);
  assert.equal((50 / 1000) * 100, 5);
  assert.equal(spec.knobs[0].options.find((o) => o.id === 'errors-stored').cost, stored);
  assert.equal(spec.knobs[0].options.find((o) => o.id === 'uniform').cost, 1000 / 10);
  const all = [copyOf(VERDICT_STEP), ...choices.map((c) => plain(`${c.label} ${c.why}`)), plain(spec.explain), ...spec.knobs[0].options.map((o) => plain(o.label))].join(' ');
  assert.equal(all.includes('50 / 145 = 34%'), true);
  assert.equal(all.includes('50 / 1,000 = 5%'), true);
  assert.equal(plain(PLAN_STEP.intro).includes('200'), true);
  assert.equal(plain(VERDICT_STEP.show).includes('95'), true);
});

// ---- sources (docs/LIVE-DEMO.md) ----------------------------------------------------------

test('sources: the Spec and Dash0 URLs, only allowed hosts, the LIVE-DEMO source line, no pricing, no em dash', () => {
  for (const url of [
    'https://opentelemetry.io/docs/concepts/sampling/#tail-sampling',
    'https://opentelemetry.io/docs/collector/configuration/#connectors',
    'https://www.dash0.com/docs/dash0/telemetry/signal-control/sample-traces',
    'https://www.dash0.com/docs/dash0/telemetry/signal-control/edge/about-signalcontrol-edge',
  ]) assert.equal(SRC.includes(url), true, url);
  assert.match(SRC, /^\/\/ Spec: https:/m);
  assert.match(SRC, /^\/\/ Dash0 docs: https:/m);
  const hosts = ['opentelemetry.io', 'www.w3.org', 'prometheus.io', 'www.dash0.com'];
  for (const url of SRC.match(/https:\/\/[^\s,)]+/g)) {
    const u = new URL(url);
    assert.equal(hosts.includes(u.host) || (u.host === 'github.com' && u.pathname.startsWith('/open-telemetry/')), true, url);
  }
  assert.match(SRC.split('\n').slice(0, 12).join('\n'), /docs\/LIVE-DEMO\.md/);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Invented/);
  const copy = plain(JSON.stringify(level.play));
  assert.equal(/pric|\$|dollar|cost per|per GB|invoice|bill/i.test(copy.replace(/spans\/s sent/g, '')), false, 'no pricing copy');
  assert.equal(SRC.includes('—'), false);
});

// ---- the globe -----------------------------------------------------------------------------

test('globe: 9.2 lights Australia, completing Oceania, and the announcement says so', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'AUS');
  assert.equal(COUNTRY_NAMES.AUS, 'Australia');
  assert.equal(ACT_REGIONS['act-9'].region, 'Oceania');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const fresh = freshlyLit(emptyProgress(), progressOf([ID]), LIVE, map);
  assert.deepEqual(fresh.countryIds, ['AUS']);
  assert.deepEqual(fresh.regionIds, ['act-9']);
  assert.equal(litText(fresh, level, map), 'Australia is now lit: The 34% error rate. Oceania is complete.');
});
