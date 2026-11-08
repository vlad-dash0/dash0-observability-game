// Act 7 "Alerting and SLOs" and level 7.1 "Good alerts" beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's place in the
// registry, unlock and globe; level fields; the Spot it board of seven alerting rules and an
// independent reading of each rule; the fix Choice; and the sources. Asserts strings, numbers and
// booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { DECK } from '../cards/deck.mjs';
import { COMING_SOON } from '../hub/coming-soon.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { isActComplete, isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';
import { checkSpot, newSpotState, toggleLine, validateSpotSpec } from '../lib/widgets/spot-it.mjs';
import { validateSpotHelps } from '../lib/widgets/spot-it-help.mjs';

const ID = 'good-alerts';
const LIVE = liveRegistry();
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
const [SPOT_STEP, FIX_STEP] = level.play.steps;
const spec = SPOT_STEP.spot;
const choices = FIX_STEP.choice.choices;
const layout = (s) => s.lines.map((l) => (s.faults.includes(l.id) ? 'F' : '.')).join('');
const spotRun = (ids) => {
  let state = newSpotState(spec);
  for (const id of ids) state = toggleLine(spec, state, id).state;
  const r = checkSpot(spec, state);
  return { solved: r.state.solved, outcome: r.outcome };
};

// ---- the act ------------------------------------------------------------------------

test('act-7 follows act-6, holds 7.1 to 7.4 then its boss, and is not coming soon', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-7');
  assert.ok(act, 'act-7 is in the registry');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 7, name: 'Alerting and SLOs', sub: 'Wake me only when it matters', levelIds: [ID, 'slis-and-slos', 'burn-rate-alerts', 'synthetic-checks'], bossId: 'everything-is-green' },
  );
  const ids = LIVE.acts.map((a) => a.id);
  assert.equal(ids.indexOf('act-7'), ids.indexOf('act-6') + 1, 'act-7 comes right after act-6');
  assert.deepEqual(COMING_SOON.filter((s) => s.id === 'act-7' || s.no === 7), [], 'act-7 is no longer coming soon');
  assert.equal(LIVE.order[LIVE.order.indexOf('errors-tripled') + 1], ID, '7.1 plays right after the act-6 boss');
});

test('act-7 opens when acts 0-6 are complete, or once entered', () => {
  const index = LIVE.acts.findIndex((a) => a.id === 'act-7'); // isActUnlocked takes the position, not the number
  const before = LIVE.acts.slice(0, index).flatMap((a) => idsOf(a.id));
  assert.deepEqual(LIVE.acts.slice(0, index).map((a) => a.id), ['act-0', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'act-6']);
  assert.equal(isActUnlocked(index, progressOf(before), LIVE), true);
  assert.equal(levelState(ID, progressOf(before), LIVE), 'open');
  assert.equal(lockReason(ID, progressOf(before), LIVE), null);

  const withoutBoss = before.filter((id) => id !== 'errors-tripled');
  assert.equal(isActUnlocked(index, progressOf(withoutBoss), LIVE), false, 'the boss of act-6 counts');
  assert.equal(levelState(ID, progressOf(withoutBoss), LIVE), 'locked');
  assert.deepEqual(lockReason(ID, progressOf(withoutBoss), LIVE), { kind: 'act', actId: 'act-6' });
  assert.deepEqual(lockReason(ID, emptyProgress(), LIVE), { kind: 'act', actId: 'act-0' });

  assert.equal(levelState(ID, progressOf([ID]), LIVE), 'done', 'completed even when earlier acts are not');
  assert.equal(isActUnlocked(index, progressOf([ID]), LIVE), true, 'entered');
  const act = LIVE.acts[index];
  assert.equal(isActComplete(act, emptyProgress()), false);
  assert.equal(isActComplete(act, progressOf([ID])), false, '7.2 to 7.4 are still to play');
  assert.equal(isActComplete(act, progressOf([ID, 'slis-and-slos', 'burn-rate-alerts'])), false, '7.4 is still to play');
  assert.equal(isActComplete(act, progressOf([ID, 'slis-and-slos', 'burn-rate-alerts', 'synthetic-checks'])), false, 'the boss is still to play');
  assert.equal(isActComplete(act, progressOf([ID, 'slis-and-slos', 'burn-rate-alerts', 'synthetic-checks', 'everything-is-green'])), true, 'its four levels and its boss complete it');
});

test('7.1 fields: scored with no par time, in act-7, lights checkout, awards the rate-not-value card; mechanics as derived', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs },
    { no: '7.1', name: 'Good alerts', sub: 'Page on what users feel', icon: '\u{1F514}', rewardTitle: 'Alert tuner', kind: 'level', actId: 'act-7', parMs: null },
  );
  assert.deepEqual([...level.mechanics], ['spot'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual(level.play.steps.map((s) => ['spot', 'choice'].find((k) => s[k])), ['spot', 'choice']);
  assert.equal(level.play.prefix, 'ga');
  assert.deepEqual([...level.cards], ['rate-not-value']);
  assert.deepEqual([...level.lights], ['checkout']);
  const titles = Object.values(LIVE.levels).map((l) => l.rewardTitle);
  assert.equal(titles.filter((t) => t === 'Alert tuner').length, 1, 'the reward title is unique');
});

test('card rate-not-value: pinned front, spec URL on prometheus.io, no Dash0 angle, front fits a card, an alerting lesson', () => {
  const card = DECK.find((c) => c.id === 'rate-not-value');
  assert.equal(card.front, 'A counter only grows. Alert on its rate or increase() over a window, not its value: the value says nothing about now.');
  assert.equal(card.front.length <= 140, true, `front is ${card.front.length} characters`);
  assert.equal(card.specUrl, 'https://prometheus.io/docs/prometheus/latest/querying/functions/#rate');
  assert.equal(card.dash0Angle, null);
  for (const w of ['resets to zero', 'per-second average rate of increase', 'increase()', 'sum(rate(errors[5m])) / sum(rate(all[5m])) > 0.02']) assert.equal(card.back.includes(w), true, w);
  assert.equal(/\bSLI\b/.test(card.front + card.back), false, 'an SLI is 7.2, after this card');
  assert.equal(card.back.includes('\u2014') || card.front.includes('\u2014'), false, 'no em dash');
});

// ---- step 1: Spot it ----------------------------------------------------------------------

test('step 1: a valid config board of seven rules, hints off, faults at F...F.F', () => {
  assert.equal(SPOT_STEP.qid, 'ga-q-spot');
  assert.equal(spec.id, 'ga-spot');
  assert.equal(spec.target, 'config');
  assert.deepEqual(validateSpotSpec(spec), []);
  assert.deepEqual(validateSpotHelps(spec), []);
  assert.deepEqual(spec.helps, { hints: false });
  assert.equal(Object.hasOwn(spec, 'hint'), false, 'no authored hint (hints off)');
  assert.deepEqual(spec.lines.map((l) => l.id), ['counter-value', 'error-ratio', 'queue-age', 'payments-increase', 'cause-cpu', 'checkout-slow', 'no-for']);
  assert.deepEqual(spec.faults, ['counter-value', 'cause-cpu', 'no-for']);
  assert.equal(layout(spec), 'F...F.F');
  assert.equal(spotRun(spec.faults).solved, true, 'the three faults solve it');
  assert.equal(spotRun(['counter-value', 'cause-cpu']).solved, false, 'two of three do not');
  assert.equal(spotRun([...spec.faults, 'error-ratio']).solved, false, 'a good rule picked too does not');
  assert.equal(plain(SPOT_STEP.question), 'Spot the rules that page badly: for something no user feels, without end, or on and off.');
  assert.match(plain(SPOT_STEP.intro), /Prometheus alerting rules/);
});

test('step 1 oracle: an independent reading flags exactly the faults, each for one reason', () => {
  const LINE = /^alert: (\S+) expr: (.+) for: (\d+)([smh])$/;
  const UNIT = { s: 1, m: 60, h: 3600 };
  const reasons = {};
  for (const l of spec.lines) {
    const m = LINE.exec(l.text);
    assert.ok(m, `${l.id} reads as "alert: name expr: expression for: duration"`);
    const [, , expr, n, unit] = m;
    const forSeconds = Number(n) * UNIT[unit];
    const flags = [];
    if (/_total\{[^}]*\}(?!\[)/.test(expr)) flags.push('bare'); // a counter compared as it is, no range for rate() or increase()
    if (/cpu|memory|disk|load/i.test(expr)) flags.push('cause'); // a resource, not something a user feels
    if (forSeconds === 0) flags.push('flap'); // no for: fires on the first evaluation over the line
    assert.equal(flags.length <= 1, true, `${l.id}: at most one reason, got ${flags}`);
    if (flags.length) reasons[l.id] = flags[0];
  }
  assert.deepEqual(Object.keys(reasons), spec.faults, 'the flagged rules are exactly the faults, in order');
  assert.deepEqual(reasons, { 'counter-value': 'bare', 'cause-cpu': 'cause', 'no-for': 'flap' });
  // The counter in the good rules is always inside a range: the bare-counter reading has something to tell apart.
  assert.equal(spec.lines.filter((l) => l.text.includes('_total{')).length >= 4, true, 'counters appear in good rules too');
});

test('step 1 whyNot on exactly the four good rules; explain names the three problems and leaves the fix to step 2', () => {
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['checkout-slow', 'error-ratio', 'payments-increase', 'queue-age']);
  for (const [id, t] of Object.entries(spec.whyNot)) assert.match(plain(t), /\S[\s\S]*\.$/, `${id} ends a sentence`);
  assert.match(plain(spec.whyNot['queue-age']), /gauge/);
  assert.match(plain(spec.whyNot['payments-increase']), /increase\(\)/);
  const e = plain(spec.explain);
  for (const s of ['stays firing until a restart', 'for: 0s', 'symptoms', 'cause', 'flaps']) assert.equal(e.includes(s), true, s);
  // The fix for the bare counter is step 2's Choice: the step-1 explain must not give it away.
  for (const s of ['rate()', 'increase()']) assert.equal(e.includes(s), false, `explain does not name ${s}`);
  // The explain names each faulty rule by the exact alert name the board shows.
  const nameOf = (id) => /^alert: (\S+) /.exec(spec.lines.find((l) => l.id === id).text)[1];
  for (const id of spec.faults) assert.equal(spec.explain.includes(`<code>${nameOf(id)}</code>`), true, `explain names ${nameOf(id)}`);
});

// ---- step 2: the fix ----------------------------------------------------------------------

test('step 2: one right fix, increase; labels give nothing away', () => {
  assert.equal(FIX_STEP.qid, 'ga-q-fix');
  assert.equal(FIX_STEP.choice.id, 'ga-fix');
  assert.equal(plain(FIX_STEP.question), 'How do you fix CheckoutErrors?');
  assert.deepEqual(choices.map((c) => c.key), ['raise', 'for-1h', 'increase', 'delta']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['increase']);
  const lens = choices.map((c) => plain(c.label).length);
  const right = choices.find((c) => c.right);
  assert.equal(plain(right.label).length < Math.max(...lens), true, `the right label is not the longest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 10, true, `plain label lengths ${lens}`);
  assert.match(plain(choices.find((c) => c.key === 'delta').why), /gauges/);
  assert.equal(plain(right.why).includes('increase(http_requests_total{job="checkout", code=~"5.."}[10m]) > 20'), true);
  for (const c of choices) assert.equal(typeof c.why === 'string' && c.why.length > 0, true, `${c.key} has a why`);
});

// ---- sources ------------------------------------------------------------------------------

test('sources: the four prometheus.io pages, a Spec line, a cited Dash0 page for every Dash0 sentence, no unsupported Dash0 claim, no em dash', () => {
  for (const url of [
    'https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/',
    'https://prometheus.io/docs/practices/alerting/',
    'https://prometheus.io/docs/prometheus/latest/querying/functions/',
    'https://prometheus.io/docs/concepts/metric_types/#counter',
  ]) assert.equal(SRC.includes(url), true, url);
  assert.match(SRC, /^\/\/ Spec: https:\/\/prometheus\.io/m);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Invented/);
  const hosts = ['opentelemetry.io', 'prometheus.io', 'www.dash0.com'];
  for (const url of SRC.match(/https:\/\/[^\s,)]+/g)) assert.equal(hosts.includes(new URL(url).host), true, url);
  // G2-a: the copy's Dash0 sentence ships with a www.dash0.com check-rules page cited (#16).
  const copy = plain(JSON.stringify(level.play));
  assert.deepEqual([/^\/\/ Dash0 docs: https:\/\/www\.dash0\.com\/\S*check-rules/m.test(SRC), /Dash0/.test(copy)], [true, true], 'a Dash0 check-rules page is cited, and it backs a Dash0 sentence in the copy (#16 / G2-a)');
  assert.doesNotMatch(copy, /Prometheus-compatible|carry over as they are/, 'not claimed: rule files carry over to Dash0 as they are');
  assert.equal(SRC.includes('—'), false, 'no em dash');
});

// ---- the globe -----------------------------------------------------------------------------

test('globe: 7.1 lights Japan; East Asia is complete only with 7.2 (test/slis-and-slos.test.mjs)', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'JPN');
  assert.equal(COUNTRY_NAMES.JPN, 'Japan');
  assert.equal(ACT_REGIONS['act-7'].region, 'East Asia');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const fresh = freshlyLit(emptyProgress(), progressOf([ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['JPN'], regionIds: [] });
  assert.equal(litText(fresh, level, map), 'Japan is now lit: Good alerts.');
});
