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
    all.filter((id) => !idsOf('act-6').includes(id)), // acts 0-5 complete, act 6 not entered: its levels are open only through the act before
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

test('step 1 labels give nothing away: the right one is not the longest, lengths within 10, no more numbers than the others, no 5%', () => {
  const lens = choices.map((c) => c.label.length);
  const numbers = (t) => (t.match(/\d[\d,.]*/g) ?? []).length;
  const right = choices.find((c) => c.right);
  const others = choices.filter((c) => !c.right);
  assert.equal(right.label.length < Math.max(...lens), true, 'the right label is not the longest');
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 10, true, `lengths ${lens.join(', ')}`);
  for (const c of others) assert.equal(numbers(right.label) <= numbers(c.label), true, `numbers in ${c.key}`);
  assert.equal(right.label.includes('50 / 1,000'), false, 'the second sum is not in the label');
  assert.equal(right.label.includes('5%'), false, 'the true rate is in the why, not the label');
  assert.equal(plain(right.why).includes('5%'), true);
});

// ---- step 2: the trade-off ---------------------------------------------------------------

test('step 2 is a valid two-knob Trade-off whose only passing plan is every error plus 10% with RED before sampling', () => {
  assert.equal(PLAN_STEP.qid, 'ser-q-plan');
  assert.deepEqual(validateTradeoffSpec(spec), []);
  assert.equal(spec.unit, 'spans/s sent to the backend');
  assert.equal(spec.cap, 200);
  assert.deepEqual(spec.knobs.map((k) => [k.id, k.label, k.options.map((o) => o.id)]), [
    ['sampler', 'Sampling policy', ['probabilistic-10pct', 'keep-all', 'errors-10pct']],
    ['rate', 'Where the error rate is computed', ['red-before', 'stored-spans']],
  ]);
  assert.deepEqual(spec.needs.map((x) => [x.id, x.label]), [
    ['every-error', 'every failed trace'],
    ['true-rate', 'an error rate that matches the requests'],
  ]);
  const passing = allPlans(spec).filter((p) => {
    const r = evaluatePlan(spec, p);
    return r.over === 0 && r.lost.length === 0;
  });
  assert.deepEqual(passing, [{ sampler: 'errors-10pct', rate: 'red-before' }]);
  assert.deepEqual(spec.answer, { sampler: 'errors-10pct', rate: 'red-before' });
});

test('step 2 plans: all six against an independent oracle, each fails for its own reason, one passes', () => {
  const healthy = 1000 - 50;
  const stored = 50 + healthy * 0.1; // 145
  assert.equal(stored, 145);
  const policy = {
    'probabilistic-10pct': { cost: 1000 * 0.1, keeps: ['true-rate'] },
    'keep-all': { cost: 1000, keeps: ['every-error', 'true-rate'] },
    'errors-10pct': { cost: stored, keeps: ['every-error'] },
  };
  const where = { 'red-before': { cost: 0, keeps: ['true-rate'] }, 'stored-spans': { cost: 0, keeps: [] } };
  const plans = allPlans(spec);
  assert.equal(plans.length, 6);
  const reasons = [];
  for (const p of plans) {
    const total = policy[p.sampler].cost + where[p.rate].cost;
    const kept = [...policy[p.sampler].keeps, ...where[p.rate].keeps];
    const lost = ['every-error', 'true-rate'].filter((x) => !kept.includes(x));
    assert.deepEqual(evaluatePlan(spec, p), { complete: true, total, over: Math.max(0, total - 200), lost }, `${p.sampler} + ${p.rate}`);
    reasons.push(total > 200 ? 'cap' : lost.length ? `lost ${lost.join()}` : 'pass');
  }
  assert.deepEqual(reasons, ['lost every-error', 'lost every-error', 'cap', 'cap', 'pass', 'lost true-rate']);
  const ev = (sampler_, rate_) => evaluatePlan(spec, { sampler: sampler_, rate: rate_ });
  assert.equal(ev('keep-all', 'red-before').over, 800, 'keeping everything breaks the cap');
  assert.deepEqual(ev('keep-all', 'red-before').lost, [], 'and loses nothing, so only the cap rules it out');
  assert.deepEqual(ev('errors-10pct', 'red-before'), { complete: true, total: 145, over: 0, lost: [] });
});

test('step 2: position gives nothing away (answer last in sampler, first in rate) and the cap decides (keep-all keeps more than the answer)', () => {
  const ids = (k) => spec.knobs.find((x) => x.id === k).options.map((o) => o.id);
  assert.equal(ids('sampler').at(-1), spec.answer.sampler);
  assert.equal(ids('rate')[0], spec.answer.rate);
  assert.notEqual(ids('sampler').indexOf(spec.answer.sampler), ids('rate').indexOf(spec.answer.rate));
  const sampler = spec.knobs.find((x) => x.id === 'sampler').options;
  const best = sampler.find((o) => o.id === spec.answer.sampler);
  const notDominated = sampler.filter((o) => o !== best && !(best.cost <= o.cost && o.keeps.every((x) => (best.keeps ?? []).includes(x))));
  assert.equal(notDominated.some((o) => o.id === 'keep-all' && o.cost > best.cost && o.keeps.length > best.keeps.length), true);
});

test('step 2 whyNot: only the three wrong options, each true for either pairing (no total that depends on the other knob)', () => {
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['rate:stored-spans', 'sampler:keep-all', 'sampler:probabilistic-10pct']);
  assert.equal(spec.whyNot['sampler:probabilistic-10pct'], "keeps an honest ratio, but only about 5 of the 50 failed traces each second, so most failures can't be opened");
  assert.equal(spec.whyNot['sampler:keep-all'], 'sends every span, 1,000 spans/s, five times the cap of 200');
  assert.equal(spec.whyNot['rate:stored-spans'], 'with a policy that keeps every error, the kept spans read 50 / 145 = 34%, a share of kept spans, not of requests');
  for (const t of Object.values(spec.whyNot)) {
    for (const bad of ['1,190', '955', '1,000 spans/s against', 'against a cap']) assert.equal(t.includes(bad), false, bad);
  }
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
  const opt = (k, id) => spec.knobs.find((x) => x.id === k).options.find((o) => o.id === id);
  assert.equal(opt('sampler', 'errors-10pct').cost, stored);
  assert.equal(opt('sampler', 'probabilistic-10pct').cost, 1000 / 10);
  assert.equal(opt('sampler', 'keep-all').cost, 1000);
  const all = [copyOf(VERDICT_STEP), ...choices.map((c) => plain(`${c.label} ${c.why}`)), plain(spec.explain), ...spec.knobs.flatMap((k) => k.options.map((o) => plain(o.label)))].join(' ');
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
  assert.equal(SRC.includes('\u2014'), false);
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
