// Act 9 "Live Demo", level 9.1 "Filter, sampler, or both?" and level 9.2 "The 34% error rate" beyond the generated play-through
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
import { validateSortSpec } from '../lib/widgets/sort-it.mjs';
import { validateSortHelps } from '../lib/widgets/sort-it-help.mjs';

const ID91 = 'filter-or-sampler';
const ID92 = 'the-34-percent-error-rate';
const ID93 = 'connect-to-dash0';
const BOSS = 'its-us';
const LEVELS9 = [ID91, ID92, ID93];
const ID = ID92; // the 9.2 tests below
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
const SRC91 = read(`levels/${ID91}.mjs`);
const level91 = LIVE.levels[ID91];
// Optional chaining so a registry without 9.1 fails the act and globe tests on their assertions, not this file at load.
const [V91, S91_STEP] = level91?.play.steps ?? [];
const choices91 = V91?.choice.choices;
const sort91 = S91_STEP?.sort;

// ---- the act ------------------------------------------------------------------------

test('act-9 "Live Demo" is the last act, after act-8, holding 9.1, 9.2 then 9.3 and the lab boss "It\'s us"', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-9');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 9, name: 'Live Demo', sub: 'Does that answer hold?', levelIds: [ID91, ID92, ID93], bossId: BOSS },
  );
  assert.deepEqual(LIVE.acts.map((a) => a.id).slice(-2), ['act-8', 'act-9']);
  assert.deepEqual(LIVE.order.slice(LIVE.order.indexOf('dashboards-as-code')), ['dashboards-as-code', 'semantic-convention-versions', 'migrating-vendors', 'frontend-rum', 'ai-assisted-debugging', ID91, ID92, ID93, BOSS], 'act-9 plays after 8.5, last: 9.1, 9.2, 9.3, then its boss');
});

test('act-9 unlocks like the acts before it: open when acts 0-8 are complete, or once entered', () => {
  const index = LIVE.acts.findIndex((a) => a.id === 'act-9'); // isActUnlocked takes the position, not the number
  assert.equal(index, 9);
  assert.deepEqual(LIVE.acts.slice(0, 9).map((a) => a.id), ['act-0', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'act-6', 'act-7', 'act-8']);
  const acts0to6 = [0, 1, 2, 3, 4, 5, 6].flatMap((n) => idsOf(`act-${n}`));
  const acts0to7 = [...acts0to6, ...idsOf('act-7')];
  const before = [...acts0to7, ...idsOf('act-8')];
  assert.equal(isActUnlocked(index, progressOf(before), LIVE), true);
  assert.equal(levelState(ID, progressOf(before), LIVE), 'open');
  assert.equal(levelState(ID, progressOf([ID]), LIVE), 'done', 'completed even when earlier acts are not');
  assert.equal(isActUnlocked(index, progressOf([ID]), LIVE), true);
  assert.equal(levelState(ID91, progressOf(before), LIVE), 'open');
  assert.equal(levelState(ID91, progressOf([ID92]), LIVE), 'open', 'entering the act (9.2 done) opens 9.1');
  assert.equal(levelState(ID92, progressOf([ID91]), LIVE), 'open', 'and 9.1 done opens 9.2');
  assert.equal(levelState(ID91, progressOf([ID91]), LIVE), 'done');

  // LIVE-DEMO §7 option A (D1): with acts 7 and 8 ahead of it, acts 0-6 (or 0-7) alone no longer open act-9.
  assert.equal(isActUnlocked(index, progressOf(acts0to6), LIVE), false);
  assert.equal(levelState(ID, progressOf(acts0to6), LIVE), 'locked');
  assert.deepEqual(lockReason(ID, progressOf(acts0to6), LIVE), { kind: 'act', actId: 'act-7' });
  assert.equal(isActUnlocked(index, progressOf(acts0to7), LIVE), false);
  assert.deepEqual(lockReason(ID, progressOf(acts0to7), LIVE), { kind: 'act', actId: 'act-8' });
  // A player who finished 9.2 has entered act-9: every act-9 level stays open or done.
  for (const id of idsOf('act-9')) {
    const want = id === ID ? 'done' : id === BOSS ? 'locked' : 'open';
    assert.equal(levelState(id, progressOf([...acts0to6, ID]), LIVE), want, id);
  }
  // The boss opens once the act's levels are done, and not before.
  assert.equal(levelState(BOSS, progressOf([...acts0to6, ID91, ID92]), LIVE), 'locked', '9.3 is still to do');
  assert.deepEqual(lockReason(BOSS, progressOf([...acts0to6, ID91, ID92]), LIVE), { kind: 'boss', remaining: [ID93] });
  assert.equal(levelState(BOSS, progressOf([...before, ...LEVELS9]), LIVE), 'open');

  const withoutBoss = before.filter((id) => id !== 'errors-tripled');
  assert.equal(isActUnlocked(index, progressOf(withoutBoss), LIVE), false, 'the boss of act-6 counts');
  assert.equal(levelState(ID, progressOf(withoutBoss), LIVE), 'locked');
  assert.equal(levelState(ID91, progressOf(withoutBoss), LIVE), 'locked');
  assert.deepEqual(lockReason(ID91, progressOf(withoutBoss), LIVE), { kind: 'act', actId: 'act-6' });
  assert.deepEqual(lockReason(ID, progressOf(withoutBoss), LIVE), { kind: 'act', actId: 'act-6' });
  assert.equal(levelState(ID, emptyProgress(), LIVE), 'locked');
  assert.deepEqual(lockReason(ID, emptyProgress(), LIVE), { kind: 'act', actId: 'act-0' });
});

test('act-9 is complete only when all three of its levels and the boss are done', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-9');
  assert.equal(isActComplete(act, emptyProgress()), false);
  assert.equal(isActComplete(act, progressOf([ID92])), false, '9.2 alone');
  assert.equal(isActComplete(act, progressOf([ID91])), false, '9.1 alone');
  assert.equal(isActComplete(act, progressOf([ID93])), false, '9.3 alone');
  assert.equal(isActComplete(act, progressOf([ID91, ID92])), false, '9.1 and 9.2 without 9.3');
  assert.equal(isActComplete(act, progressOf(LEVELS9)), false, 'the three levels without the boss');
  assert.equal(isActComplete(act, progressOf([BOSS])), false, 'the boss alone');
  assert.equal(isActComplete(act, progressOf([...LEVELS9, BOSS])), true);
});

test('adding act-9 re-locks nothing in acts 0-8: every level has the state it has in a registry built without it', () => {
  const without = buildRegistry(ACTS.filter((a) => a.id !== 'act-9'), { deck: DECK, nodeIds: NODE_IDS, play: { validatePlay, runPlay } });
  const all = [0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => idsOf(`act-${n}`));
  const fixtures = [
    [],
    ['monitoring-vs-observability'],
    idsOf('act-0'),
    [...idsOf('act-0'), ...idsOf('act-1'), 'spans-and-traces'],
    all.filter((id) => id !== 'errors-tripled'),
    all.filter((id) => !idsOf('act-6').includes(id)), // acts 0-5 complete, act 6 not entered: its levels are open only through the act before
    all,
    [...all, ID],
    [...all, ID91],
    [ID91, ID92],
    ['head-sampling'],
  ];
  assert.deepEqual(without.order, LIVE.order.slice(0, -4));
  for (const ids of fixtures) {
    const p = progressOf(ids);
    for (const id of without.order) assert.equal(levelState(id, p, LIVE), levelState(id, p, without), `${id} with ${ids.length} done`);
  }
});

test('adding acts 7 and 8 changes no state outside act-9, and locks act-9 again only for a player who finished 0-6 without entering it', () => {
  const without = buildRegistry(ACTS.filter((a) => a.id !== 'act-7' && a.id !== 'act-8'), { deck: DECK, nodeIds: NODE_IDS, play: { validatePlay, runPlay } });
  const acts0to6 = [0, 1, 2, 3, 4, 5, 6].flatMap((n) => idsOf(`act-${n}`));
  const fixtures = [
    [],
    ['monitoring-vs-observability'],
    idsOf('act-0'),
    [...idsOf('act-0'), ...idsOf('act-1'), 'spans-and-traces'],
    acts0to6.filter((id) => id !== 'errors-tripled'),
    acts0to6.filter((id) => !idsOf('act-6').includes(id)),
    acts0to6,
    [...acts0to6, ID],
    [ID],
    ['head-sampling'],
  ];
  const k = fixtures.indexOf(acts0to6);
  assert.deepEqual(without.order, LIVE.order.filter((id) => id !== 'good-alerts' && id !== 'slis-and-slos' && id !== 'burn-rate-alerts' && id !== 'synthetic-checks' && id !== 'everything-is-green' && id !== 'dashboards-as-code' && id !== 'semantic-convention-versions' && id !== 'migrating-vendors' && id !== 'frontend-rum' && id !== 'ai-assisted-debugging'));
  const changed = [];
  fixtures.forEach((ids, i) => {
    const p = progressOf(ids);
    for (const id of without.order) {
      const before = levelState(id, p, without);
      const after = levelState(id, p, LIVE);
      if (before !== after) changed.push([i, id, before, after]);
    }
    // and each act's own lock, so an entered act-9 that locks again shows even while its levels are done
    for (const act of without.acts) {
      const at = (reg) => (isActUnlocked(reg.acts.findIndex((a) => a.id === act.id), p, reg) ? 'open' : 'locked');
      if (at(without) !== at(LIVE)) changed.push([i, act.id, at(without), at(LIVE)]);
    }
  });
  // (the boss is locked either way: it opens only once the act's levels are done)
  assert.deepEqual(changed, [...LEVELS9.map((id) => [k, id, 'open', 'locked']), [k, 'act-9', 'open', 'locked']]);
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
    ['sampler', 'Sampling policy', ['probabilistic-10pct', 'keep-all', 'probabilistic-18pct', 'errors-10pct', 'errors-20pct']],
    ['rate', 'Where the error rate is computed', ['mirror', 'red-before', 'stored-spans']],
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

test('step 2 plans: all fifteen against an independent oracle, each fails for its own reason, one passes', () => {
  const policy = {
    'probabilistic-10pct': { cost: 1000 * 0.1, keeps: ['true-rate'] },
    'keep-all': { cost: 1000, keeps: ['every-error', 'true-rate'] },
    'probabilistic-18pct': { cost: 1000 * 0.18, keeps: ['true-rate'] },
    'errors-10pct': { cost: 50 + (1000 - 50) * 0.1, keeps: ['every-error'] },
    'errors-20pct': { cost: 50 + (1000 - 50) * 0.2, keeps: ['every-error'] },
  };
  const where = { mirror: { cost: 1000, keeps: ['true-rate'] }, 'red-before': { cost: 0, keeps: ['true-rate'] }, 'stored-spans': { cost: 0, keeps: [] } };
  assert.equal(policy['errors-10pct'].cost, 145);
  assert.equal(policy['probabilistic-18pct'].cost, 180);
  const plans = allPlans(spec);
  assert.equal(plans.length, 15);
  assert.equal(policy['errors-20pct'].cost, 240);
  const table = [];
  for (const p of plans) {
    const total = policy[p.sampler].cost + where[p.rate].cost;
    const kept = [...policy[p.sampler].keeps, ...where[p.rate].keeps];
    const lost = ['every-error', 'true-rate'].filter((x) => !kept.includes(x));
    assert.deepEqual(evaluatePlan(spec, p), { complete: true, total, over: Math.max(0, total - 200), lost }, `${p.sampler} + ${p.rate}`);
    table.push([p.sampler, p.rate, total > 200 ? 'cap' : lost.length ? `lost ${lost.join()}` : 'pass']);
  }
  const sampler = ['probabilistic-10pct', 'keep-all', 'probabilistic-18pct', 'errors-10pct', 'errors-20pct'];
  const expected = [];
  for (const sm of sampler) {
    expected.push([sm, 'mirror', 'cap']);
    expected.push([sm, 'red-before', sm === 'keep-all' || sm === 'errors-20pct' ? 'cap' : sm === 'errors-10pct' ? 'pass' : 'lost every-error']);
    expected.push([sm, 'stored-spans', sm === 'keep-all' || sm === 'errors-20pct' ? 'cap' : sm === 'errors-10pct' ? 'lost true-rate' : 'lost every-error']);
  }
  assert.deepEqual(table, expected);
  const ev = (sampler_, rate_) => evaluatePlan(spec, { sampler: sampler_, rate: rate_ });
  assert.equal(ev('keep-all', 'red-before').over, 800, 'keeping everything breaks the cap');
  assert.deepEqual(ev('keep-all', 'red-before').lost, [], 'and loses nothing, so only the cap rules it out');
  assert.deepEqual(ev('errors-10pct', 'red-before'), { complete: true, total: 145, over: 0, lost: [] });
  assert.deepEqual(ev('errors-20pct', 'red-before'), { complete: true, total: 240, over: 40, lost: [] }, 'a larger share of the healthy traces keeps every need and is over the cap');
});

test('step 2 shortcuts fail: dearest in cap, most Keeps in cap (dearer tie-break), greedy per knob (dearer tie-break)', () => {
  const pick = (knob, choose) => {
    const opts = spec.knobs.find((k) => k.id === knob).options.filter((o) => o.cost <= spec.cap);
    return choose(opts).id;
  };
  const dearest = (opts) => opts.reduce((a, b) => (b.cost >= a.cost ? b : a));
  const mostKeeps = (opts) => opts.reduce((a, b) => ((b.keeps ?? []).length > (a.keeps ?? []).length || ((b.keeps ?? []).length === (a.keeps ?? []).length && b.cost >= a.cost) ? b : a));
  const passes = (plan) => {
    const r = evaluatePlan(spec, plan);
    return r.over === 0 && r.lost.length === 0;
  };
  assert.equal(passes({ sampler: pick('sampler', dearest), rate: pick('rate', dearest) }), false, 'dearest in cap');
  assert.equal(passes({ sampler: pick('sampler', mostKeeps), rate: pick('rate', mostKeeps) }), false, 'most Keeps in cap, dearer tie-break');
  // greedy: per knob, the option that alone loses the fewest needs, dearer on a tie, within the cap
  const lostAlone = (o) => spec.needs.filter((x) => !(o.keeps ?? []).includes(x.id)).length;
  const greedy = (opts) => opts.reduce((a, b) => (lostAlone(b) < lostAlone(a) || (lostAlone(b) === lostAlone(a) && b.cost >= a.cost) ? b : a));
  assert.equal(passes({ sampler: pick('sampler', greedy), rate: pick('rate', greedy) }), false, 'greedy per knob, dearer tie-break');
});

test('step 2: position gives nothing away (answer 4th of 5 in the sampler list, 2nd of 3 in rate) and the cap decides (keep-all keeps more than the answer)', () => {
  const ids = (k) => spec.knobs.find((x) => x.id === k).options.map((o) => o.id);
  assert.equal(ids('sampler').indexOf(spec.answer.sampler), 3);
  assert.equal(ids('rate').indexOf(spec.answer.rate), 1);
  const sampler = spec.knobs.find((x) => x.id === 'sampler').options;
  const best = sampler.find((o) => o.id === spec.answer.sampler);
  const notDominated = sampler.filter((o) => o !== best && !(best.cost <= o.cost && o.keeps.every((x) => (best.keeps ?? []).includes(x))));
  assert.equal(notDominated.some((o) => o.id === 'keep-all' && o.cost > best.cost && o.keeps.length > best.keeps.length), true);
});

test('step 2 whyNot: only the four wrong options, each a whole capitalised sentence, each line true for either pairing', () => {
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['rate:mirror', 'rate:stored-spans', 'sampler:errors-20pct', 'sampler:keep-all', 'sampler:probabilistic-10pct', 'sampler:probabilistic-18pct']);
  assert.equal(spec.whyNot['sampler:probabilistic-10pct'], "This policy keeps an honest ratio, but only about 5 of the 50 failed traces a second, so most failures can't be opened.");
  assert.equal(spec.whyNot['sampler:probabilistic-18pct'], "This policy keeps an honest ratio, but only about 9 of the 50 failed traces a second, so most failures can't be opened.");
  assert.equal(spec.whyNot['sampler:keep-all'], 'Keeping every trace sends 1,000 spans/s, five times the cap of 200.');
  assert.equal(spec.whyNot['sampler:errors-20pct'], 'This policy keeps every error and a larger share of the healthy traces: 240 spans/s, over the cap of 200.');
  assert.equal(spec.whyNot['rate:mirror'], 'Counting every span gives the true rate, and sending all 1,000 spans a second to a second backend is five times the cap of 200 on its own.');
  assert.equal(spec.whyNot['rate:stored-spans'], 'The rate from the spans the backend keeps is a share of kept spans. With every error kept and 10% of the rest, that reads 50 / 145 = 34%, not 5%.');
  for (const [key, t] of Object.entries(spec.whyNot)) {
    assert.match(t, /^[A-Z][\s\S]*\.$/, `${key} is a capitalised sentence`);
    for (const bad of ['1,190', '955', '1,000 spans/s against', 'against a cap', 'stored spans']) assert.equal(t.includes(bad), false, bad);
  }
  // each line's numbers, checked against every pairing: they are about its own option, never the other knob
  const ev = (sampler_, rate_) => evaluatePlan(spec, { sampler: sampler_, rate: rate_ });
  for (const rate_ of ['red-before', 'stored-spans']) {
    assert.equal(ev('keep-all', rate_).total, 1000, 'keep-all line: 1,000 spans/s under either rate option');
    assert.equal(Math.round(50 * 0.1), 5);
    assert.equal(Math.round(50 * 0.18), 9);
  }
  for (const s_ of ['keep-all', 'probabilistic-10pct', 'errors-10pct', 'probabilistic-18pct', 'errors-20pct']) {
    assert.equal(ev(s_, 'red-before').total, ev(s_, 'stored-spans').total, `${s_}: the rate knob adds no spans`);
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

// ---- level 9.1: Filter, sampler, or both? -------------------------------------------------------

test('9.1 fields: scored with no par time, in act-9, lights the collector, awards no card', () => {
  assert.deepEqual(
    { no: level91.no, name: level91.name, sub: level91.sub, icon: level91.icon, rewardTitle: level91.rewardTitle, kind: level91.kind, actId: level91.actId, scored: level91.scored, parMs: level91.scoring.parMs },
    { no: '9.1', name: 'Filter, sampler, or both?', sub: 'Does that answer hold?', icon: '\u{1F4E2}', rewardTitle: 'Trace keeper', kind: 'level', actId: 'act-9', scored: true, parMs: null },
  );
  assert.deepEqual([...level91.mechanics], ['sort']);
  assert.equal(level91.play.prefix, 'fos');
  assert.deepEqual([...level91.cards], []);
  assert.deepEqual([...level91.lights], ['collector']);
  assert.deepEqual(starTotals(progressOf([ID91, ID92]), LIVE), { earned: 6, max: MAX_STARS });
});

test('9.1 step 1 is the Act 9 verdict Choice: holds, wrong, follow-up; exactly one right answer, "wrong"', () => {
  assert.equal(V91.qid, 'fos-q-verdict');
  assert.equal(V91.choice.id, 'fos-verdict');
  assert.deepEqual(choices91.map((c) => c.key), ['holds', 'wrong', 'follow-up']);
  assert.deepEqual(choices91.filter((c) => c.right).map((c) => c.key), ['wrong']);
  for (const c of choices91) assert.equal(c.label.startsWith({ holds: 'It holds:', wrong: 'It is wrong:', 'follow-up': 'Ask first:' }[c.key]), true, c.key);
  assert.equal(plain(V91.question), "Does the presenter's answer hold?");
  assert.match(plain(V91.intro), /presenter/);
  assert.match(plain(V91.intro), /filter/);
});

test('9.1 step 1 labels give nothing away: the right one is neither the longest nor the shortest, lengths within 10, no digits', () => {
  const lens = choices91.map((c) => plain(c.label).length);
  const right = choices91.find((c) => c.right);
  assert.equal(plain(right.label).length < Math.max(...lens), true, 'the right label is not the longest');
  assert.equal(plain(right.label).length > Math.min(...lens), true, `the right label is not the shortest (${lens.join(', ')})`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 10, true, `lengths ${lens.join(', ')}`);
  for (const c of choices91) assert.equal(/\d/.test(c.label), false, `no digit in ${c.key}`);
});

test('9.1 step 1 evidence: one trace of 7 spans, 3 Error, and the right why says keeps the 3 and drops the other 4', () => {
  // 7, 3 and 4 are literals here on purpose: an independent check on the TRACE table the level derives its copy from.
  assert.equal(V91.show.includes('<table'), true);
  assert.equal(V91.show.includes('<pre'), false, 'prose and a table, no YAML');
  const body = V91.show.match(/<tbody>([\s\S]*)<\/tbody>/)[1];
  const rows = body.match(/<tr>[\s\S]*?<\/tr>/g);
  assert.equal(rows.length, 7);
  const cells = rows.map((r) => [...r.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => plain(m[1])));
  for (const r of cells) assert.equal(r.length, 3, r.join(' | '));
  assert.equal(cells.filter((r) => r[2] === 'Error').length, 3);
  assert.equal(cells.filter((r) => r[2] === 'Unset').length, 4);
  assert.match(plain(V91.show), /One failed checkout trace, 7 spans/);
  const right = choices91.find((c) => c.right);
  assert.equal(plain(right.why).includes('keeps the 3 with status Error and drops the other 4'), true, plain(right.why));
  assert.match(plain(right.why), /Of the 7 spans/);
  for (const key of ['holds', 'follow-up']) assert.match(plain(choices91.find((c) => c.key === key).why), /drops the 4 healthy spans/, key);
});

test('9.1 step 2 Sort: a valid 3-bucket board, hints off, 9 items, buckets of 3/4/2', () => {
  assert.equal(S91_STEP.qid, 'fos-q-sort');
  assert.equal(sort91.id, 'fos-sort');
  assert.deepEqual(validateSortSpec(sort91), []);
  assert.deepEqual(validateSortHelps(sort91), []);
  assert.deepEqual(sort91.helps, { hints: false });
  assert.equal(Object.hasOwn(sort91, 'hint'), false, 'no hint of its own');
  assert.deepEqual(sort91.buckets.map((b) => [b.id, b.label]), [
    ['filter', 'A filter processor'],
    ['tail', 'A tail sampler'],
    ['both', 'Both: a filter and a tail sampler'],
  ]);
  assert.deepEqual(sort91.items.map((it) => it.id), ['errors-whole', 'healthz', 'slow-no-cache', 'slow', 'debug-logs', 'many-spans', 'production-only', 'via-payments', 'errors-no-keepalive']);
  const count = (b) => sort91.items.filter((it) => it.bucket === b).length;
  assert.deepEqual([count('filter'), count('tail'), count('both')], [3, 4, 2], 'not 3/3/3: "keep the buckets balanced" never wins');
});

test('9.1 step 2 oracle: each bucket follows from two independent facts', () => {
  // [the decision needs the whole trace, something inside a kept trace still has to go]
  const CAP = {
    'errors-whole': [1, 0],
    slow: [1, 0],
    'many-spans': [1, 0],
    'via-payments': [1, 0],
    healthz: [0, 0],
    'debug-logs': [0, 0],
    'production-only': [0, 0],
    'slow-no-cache': [1, 1],
    'errors-no-keepalive': [1, 1],
  };
  assert.deepEqual(Object.keys(CAP).sort(), sort91.items.map((it) => it.id).sort());
  const expected = ([whole, inside]) => (whole && inside ? 'both' : whole ? 'tail' : 'filter');
  for (const it of sort91.items) assert.equal(it.bucket, expected(CAP[it.id]), it.id);
});

test('9.1 step 2 every wrong drop explains itself', () => {
  for (const it of sort91.items) {
    const others = sort91.buckets.map((b) => b.id).filter((b) => b !== it.bucket);
    assert.deepEqual(Object.keys(it.whyNot ?? {}).sort(), others.sort(), `${it.id}: a whyNot for each other bucket`);
    for (const b of others) assert.match(plain(it.whyNot[b]), /^[A-Z][\s\S]*\.$/, `${it.id} whyNot.${b} is a capitalised sentence`);
    assert.match(plain(it.why), /^[A-Z][\s\S]*\.$/, `${it.id} why`);
  }
  const logsNotTail = plain(sort91.items.find((it) => it.id === 'debug-logs').whyNot.tail);
  assert.match(logsNotTail, /works on traces/, 'the tail sampler handles traces');
  assert.match(logsNotTail, /Log records never pass through it/, 'and log records never reach it');
});

test('9.1 sources: the Spec and Dash0 URLs, only allowed hosts, the LIVE-DEMO source line, every Dash0 sentence sourced, no pricing, no em dash', () => {
  for (const url of [
    'https://opentelemetry.io/docs/concepts/sampling/#tail-sampling',
    'https://opentelemetry.io/docs/collector/transforming-telemetry/',
    'https://opentelemetry.io/docs/specs/semconv/resource/deployment-environment/',
  ]) assert.equal(SRC91.includes(url), true, url);
  assert.match(SRC91, /^\/\/ Spec: https:/m);
  const hosts = ['opentelemetry.io', 'www.w3.org', 'prometheus.io', 'www.dash0.com'];
  for (const url of SRC91.match(/https:\/\/[^\s,)]+/g)) {
    const u = new URL(url);
    assert.equal(hosts.includes(u.host) || (u.host === 'github.com' && u.pathname.startsWith('/open-telemetry/')), true, url);
  }
  assert.match(SRC91.split('\n').slice(0, 12).join('\n'), /docs\/LIVE-DEMO\.md/);
  assert.match(SRC91, /Facts used/);
  assert.match(SRC91, /Invented/);
  // G2-c: every sentence of the copy that names Dash0 or one of its features is backed by the `// Dash0 docs:` line: each
  // feature it names has its page there, and a sentence that names Dash0 names a feature (no bare "Dash0 does X").
  const dash0Docs = SRC91.match(/^\/\/ Dash0 docs: (.*)$/m)?.[1] ?? '';
  const DASH0_PAGES = {
    'spam filter': 'https://www.dash0.com/docs/dash0/cost-control/spam-filters',
    signalcontrol: 'https://www.dash0.com/docs/dash0/telemetry/signal-control/about-signal-control',
  };
  for (const url of Object.values(DASH0_PAGES)) assert.equal(dash0Docs.includes(url), true, `the Dash0 docs line has ${url}`);
  const copy = plain(JSON.stringify(level91.play));
  const strings = [];
  const walk = (v) => (typeof v === 'string' ? strings.push(plain(v)) : v && typeof v === 'object' && Object.values(v).forEach(walk));
  walk(level91.play);
  const sentences = strings.flatMap((t) => t.split(/(?<=[.?!])\s+/)).filter((s) => /dash0|signalcontrol|spam filter/i.test(s));
  assert.equal(sentences.length > 0, true, 'the copy ties the lesson to Dash0');
  for (const s of sentences) {
    const named = Object.keys(DASH0_PAGES).filter((f) => s.toLowerCase().includes(f));
    assert.equal(named.length > 0, true, `a Dash0 sentence names a sourced feature: ${s}`);
  }
  assert.equal(/pric|\$|dollar|cost per|per GB|invoice|bill/i.test(copy), false, 'no pricing copy');
  assert.equal(SRC91.includes('—'), false, 'no em dash');
  for (const step of level91.play.steps) assert.equal(JSON.stringify(step).includes('<pre'), false, 'no YAML block');
});

// ---- the globe -----------------------------------------------------------------------------

test('globe: 9.2 lights Australia, 9.1 New Zealand, 9.3 Papua New Guinea; Oceania completes with the boss', () => {
  assert.equal(LEVEL_COUNTRY[ID92], 'AUS');
  assert.equal(LEVEL_COUNTRY[ID91], 'NZL');
  assert.equal(LEVEL_COUNTRY[ID93], 'PNG');
  assert.equal(COUNTRY_NAMES.AUS, 'Australia');
  assert.equal(COUNTRY_NAMES.NZL, 'New Zealand');
  assert.equal(COUNTRY_NAMES.PNG, 'Papua New Guinea');
  assert.equal(ACT_REGIONS['act-9'].region, 'Oceania');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const level93 = LIVE.levels[ID93];
  const first = freshlyLit(emptyProgress(), progressOf([ID92]), LIVE, map);
  assert.deepEqual(first, { countryIds: ['AUS'], regionIds: [] }, '9.1 and 9.3 are still open, so the region is not');
  assert.equal(litText(first, level, map), 'Australia is now lit: The 34% error rate.');
  const second = freshlyLit(progressOf([ID92]), progressOf([ID92, ID91]), LIVE, map);
  assert.deepEqual(second, { countryIds: ['NZL'], regionIds: [] }, '9.3 is still open');
  assert.equal(litText(second, level91, map), 'New Zealand is now lit: Filter, sampler, or both?', 'no "?." and no region line');
  const third = freshlyLit(progressOf([ID92, ID91]), progressOf(LEVELS9), LIVE, map);
  assert.deepEqual(third, { countryIds: ['PNG'], regionIds: [] }, 'the boss is still to do');
  assert.equal(litText(third, level93, map), 'Papua New Guinea is now lit: Connect the game to Dash0.');
  // The boss has no country: finishing it completes the region, named by the region.
  const boss = freshlyLit(progressOf(LEVELS9), progressOf([...LEVELS9, BOSS]), LIVE, map);
  assert.deepEqual(boss, { countryIds: [], regionIds: ['act-9'] });
  assert.equal(litText(boss, LIVE.levels[BOSS], map), "Oceania is now lit: It's us.");
  assert.equal(LEVEL_COUNTRY[BOSS], undefined, 'a boss carries no country');
});
