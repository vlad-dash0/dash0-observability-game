// Level 9.6 "The alert that stayed green" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs): level fields and
// the globe; the dataset figures the copy states, recomputed from the samples; the Query it step graded through the real grader (the given,
// each single fix and the plausible wrong queries fail, equivalent forms pass); the Choice (one right, whyNots that hold against the step);
// the sources. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { getDataset } from '../lib/promql/datasets.mjs';
import { gradeQuery, referenceResult } from '../lib/promql/grade.mjs';
import { validateQuerySpec } from '../lib/widgets/query-it.mjs';

const ID = 'the-alert-that-stayed-green';
const LIVE = liveRegistry();
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');
const level = LIVE.levels[ID];
const [WHY_STEP, RULE_STEP] = level.play.steps;
const query = RULE_STEP.query;
const M = 'http_server_requests_total';
const grade = (q) => gradeQuery(query.dataset, query.at, q, query.reference);
const run = (q) => referenceResult(query.dataset, query.at, q);

// ---- the level -----------------------------------------------------------------------------

test('9.6 fields: in act-9 right before 9.7 and the boss, scored with no par time, a choice then a query, no helps, lights checkout, no card', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, scored: level.scored, parMs: level.scoring.parMs, prefix: level.play.prefix },
    { no: '9.6', name: 'The alert that stayed green', sub: 'Does that answer hold?', icon: '\u{1F7E2}', rewardTitle: 'Green doubter', kind: 'level', actId: 'act-9', scored: true, parMs: null, prefix: 'asg' },
  );
  assert.deepEqual(level.play.steps.map((s) => ['choice', 'query'].find((k) => s[k])), ['choice', 'query']);
  assert.deepEqual([...level.mechanics], ['query'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual([...level.lights], ['checkout']);
  assert.deepEqual([...level.cards], []);
  assert.deepEqual([...level.hintless], ['query']);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Green doubter').length, 1, 'the reward title is unique');
  assert.deepEqual(LIVE.acts.find((a) => a.id === 'act-9').levelIds.slice(-2), [ID, 'two-vendors-one-weekend']);
});

test('9.6 globe: Fiji, lit by this level, named, in Oceania', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'FJI');
  assert.equal(COUNTRY_NAMES.FJI, 'Fiji');
  assert.equal(ACT_REGIONS['act-9'].region, 'Oceania');
});

// ---- the data behind the copy --------------------------------------------------------------

const series = (labels) =>
  getDataset('checkout-http').series.filter((s) => Object.entries(labels).every(([k, v]) => s.labels[k] === v));
const perScrapeAt = (s, t) => {
  const at = (x) => s.samples.find(([ts]) => ts === x)[1];
  return at(t) - at(t - 15);
};

test('dataset: the status label has only "200" and "500", /pay fails 15 of 60 a scrape since the deploy, /quote 0 of 120', () => {
  const counters = series({ __name__: M });
  assert.deepEqual([...new Set(counters.map((s) => s.labels.status))].sort(), ['200', '500']);
  assert.deepEqual([...new Set(counters.filter((s) => s.labels.service === 'checkout').map((s) => s.labels.route))].sort(), ['/pay', '/quote']);
  for (const t of [2700, 3000, 3300, 3585, 3600]) {
    const failed = (route) => perScrapeAt(series({ __name__: M, route, status: '500' })[0], t);
    const ok = (route) => perScrapeAt(series({ __name__: M, route, status: '200' })[0], t);
    assert.deepEqual([failed('/pay'), failed('/pay') + ok('/pay'), failed('/quote'), failed('/quote') + ok('/quote')], [15, 60, 0, 120], `t=${t}`);
  }
});

test('the figures: 15/180 = 0.083 for the service, 15/60 = 0.25 for /pay, a [5m] window holds 20 scrapes', () => {
  const sel = 'service="checkout"';
  assert.equal(Math.abs(run(`sum(rate(${M}{${sel}, status="500"}[5m])) / sum(rate(${M}{${sel}}[5m]))`).series[0].value - 15 / 180) < 1e-9, true);
  assert.equal((15 / 180).toFixed(3), '0.083');
  assert.equal(15 / 180 < 0.1 && 15 / 60 > 0.1, true);
  const pay = run(query.reference);
  assert.deepEqual(pay.series.map((s) => [s.labels, s.value]), [[{ route: '/pay' }, 0.25]]);
  assert.equal(300 / 15, 20);
  assert.equal(SRC.includes('0.083'), false, 'the figure is computed in the level, not typed');
});

// ---- step 2: Query it ----------------------------------------------------------------------

test('step 2: a valid Query it spec on checkout-http at 3600, with the failing given and no hint', () => {
  assert.deepEqual(validateQuerySpec(query), []);
  assert.deepEqual({ id: query.id, dataset: query.dataset, at: query.at, hint: query.hint, helps: query.helps }, { id: 'asg-rule', dataset: 'checkout-http', at: 3600, hint: undefined, helps: {} });
  assert.equal(query.given, `sum(rate(${M}{service="checkout", status="5xx"}[5m])) / sum(rate(${M}{service="checkout"}[5m])) > 0.1`);
  assert.equal(query.given.includes('by ('), false);
  assert.equal(plain(RULE_STEP.question).includes('one series per route, labelled route only'), true);
});

test('step 2 graded for real: the given, each single fix and each plausible wrong query fail, with the reason', () => {
  const S = 'service="checkout"';
  const ratio = (num, den, tail = ' > 0.1') => `${num} / ${den}${tail}`;
  const sumRate = (sel, by = '') => `sum${by}(rate(${M}{${sel}}[5m]))`;
  const byRoute = ' by (route) ';
  const wrong = {
    'the given (status 5xx, no by)': [query.given, 'empty'],
    'label fixed only (0.083 is filtered out)': [ratio(sumRate(`${S}, status="500"`), sumRate(S)), 'empty'],
    'by (route) only (the numerator is still empty)': [ratio(sumRate(`${S}, status="5xx"`, byRoute), sumRate(S, byRoute)), 'empty'],
    'both fixes but a regex that matches nothing': [ratio(sumRate(`${S}, status=~"5xx"`, byRoute), sumRate(S, byRoute)), 'empty'],
    'sum without by, status 500': [ratio(sumRate(`${S}, status="500"`), sumRate(S)), 'empty'],
    'by (service) instead of route': [ratio(sumRate(`${S}, status="500"`, ' by (service) '), sumRate(S, ' by (service) ')), 'empty'],
    'by (route, service): extra label': [ratio(sumRate(`${S}, status="500"`, ' by (route, service) '), sumRate(S, ' by (route, service) ')), 'wrong-labels'],
    'status != 200 without the threshold': [ratio(sumRate(`${S}, status!="200"`, byRoute), sumRate(S, byRoute), ''), 'wrong-count'],
    'no threshold: every route, /quote at 0': [ratio(sumRate(`${S}, status="500"`, byRoute), sumRate(S, byRoute), ''), 'wrong-count'],
    'threshold 0.3 (nothing above it)': [ratio(sumRate(`${S}, status="500"`, byRoute), sumRate(S, byRoute), ' > 0.3'), 'empty'],
    'a threshold of 0.08 on the service sum reads 0.083 but is unlabelled': [ratio(sumRate(`${S}, status="500"`), sumRate(S), ' > 0.08'), 'wrong-labels'],
    'the ratio is requests over failures': [ratio(sumRate(S, byRoute), sumRate(`${S}, status="500"`, byRoute), ' > 0.1'), 'wrong-count'],
    'failures over the successes, not over all': [ratio(sumRate(`${S}, status="500"`, byRoute), sumRate(`${S}, status="200"`, byRoute), ' > 0.1'), 'wrong-values'],
    'the bool modifier (returns 0 and 1, and this PromQL does not support it)': [ratio(sumRate(`${S}, status="500"`, byRoute), sumRate(S, byRoute), ' > bool 0.1'), 'unsupported'],
  };
  for (const [name, [q, reason]] of Object.entries(wrong)) {
    const r = grade(q);
    assert.deepEqual([name, r.ok, r.reason], [name, false, reason]);
  }
});

test('step 2 graded for real: the reference and equivalent formulations pass', () => {
  const S = 'service="checkout"';
  assert.equal(grade(query.reference).ok, true);
  const by = ' by (route) ';
  assert.equal(grade(`sum${by}(rate(${M}{${S}, status="500"}[5m])) / sum${by}(rate(${M}{${S}}[5m])) > 0.1`).ok, true, 'the reference spelled out');
  assert.equal(grade(`sum${by}(increase(${M}{${S}, status="500"}[5m])) / sum${by}(increase(${M}{${S}}[5m])) > 0.1`).ok, true, 'increase over the same window');
  assert.equal(grade(`sum${by}(rate(${M}{${S}, status!="200"}[5m])) / sum${by}(rate(${M}{${S}}[5m])) > 0.1`).ok, true, 'status != "200", the same series here');
  assert.equal(grade(`sum${by}(rate(${M}{${S}, status="500"}[5m])) / sum${by}(rate(${M}{${S}}[5m])) > 0.2`).ok, true, 'a threshold of 0.2 keeps /pay too');
  assert.equal(grade(`sum without (service, status) (rate(${M}{${S}, status="500"}[5m])) / sum without (service, status) (rate(${M}{${S}}[5m])) > 0.1`).ok, true, 'without drops the same labels');
});

test('step 2 explain: figures match the data, both fixes named, absent() quoted as the functions page words it', () => {
  const e = plain(query.explain);
  for (const w of ['15 of 180', '0.083', '0.25', 'by (route)', 'status="5xx"', 'drops', 'one series per route, labelled route only', 'absent()']) assert.equal(e.includes(w), true, w);
  assert.equal(e.includes('"returns an empty vector if the vector passed to it has any elements"'), true);
  assert.equal(e.includes('"useful for alerting on when no time series exist for a given metric name and label combination"'), true);
});

// ---- step 1: the Choice --------------------------------------------------------------------

test('step 1: exactly one right choice, labels of similar length, the right one not first', () => {
  const choices = WHY_STEP.choice.choices;
  assert.deepEqual(choices.map((c) => c.key), ['sampling', 'window', 'selector']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['selector']);
  const lengths = choices.map((c) => plain(c.label).length);
  assert.equal(Math.max(...lengths) - Math.min(...lengths) <= 15, true, `lengths ${lengths}`);
  assert.equal(choices.findIndex((c) => c.right) > 0, true);
});

test('step 1: the intro and table state what the whyNots rely on, and the numbers are the data', () => {
  const text = plain(WHY_STEP.intro + WHY_STEP.show);
  assert.equal(text.includes('incremented by the server for every request it handles (it is not made from spans)'), true, 'sampling whyNot needs this');
  assert.equal(text.includes('The only values the status label takes are "200" and "500"'), true);
  assert.equal(/<td>\/pay<\/td><td>60<\/td><td>15<\/td>/.test(WHY_STEP.show), true);
  assert.equal(/<td>\/quote<\/td><td>120<\/td><td>0<\/td>/.test(WHY_STEP.show), true);
  assert.equal(text.includes('status="5xx"'), true, 'the rule is shown');
  const by = Object.fromEntries(WHY_STEP.choice.choices.map((c) => [c.key, plain(c.why)]));
  assert.equal(by.sampling.includes('not from spans') && by.sampling.includes('15 of /pay\'s 60'), true);
  assert.equal(by.window.includes('15 of 60') && by.window.includes('20 scrapes'), true);
  assert.equal(by.selector.includes('"200" and "500"'), true);
});

test('step 2: the intro gives plain figures and no diagnosis, and the show repeats the status values, labels and per-route figures', () => {
  const intro = plain(RULE_STEP.intro);
  for (const w of ['whole', 'averaged', 'group', 'by (route)', 'hides', 'healthy']) assert.equal(intro.toLowerCase().includes(w), false, `the intro must not say "${w}"`);
  assert.equal(intro.includes('0.1'), true);
  const text = plain(RULE_STEP.show);
  assert.equal(text.includes('The only values the status label takes are "200" and "500"'), true);
  assert.equal(text.includes('service, route and status'), true);
  assert.equal(/<td>\/pay<\/td><td>60<\/td><td>15<\/td>/.test(RULE_STEP.show), true);
  assert.equal(/<td>\/quote<\/td><td>120<\/td><td>0<\/td>/.test(RULE_STEP.show), true);
  assert.equal(RULE_STEP.show, WHY_STEP.show, 'the same table on both steps, built once');
});

test('known pass, not the concept: min by (route) over sum by (route) passes with no status matcher (the 500 series is the smaller one on every route)', () => {
  const by = ' by (route) ';
  const min = `min${by}(rate(${M}{service="checkout"}[5m])) / sum${by}(rate(${M}{service="checkout"}[5m])) > 0.1`;
  assert.equal(grade(min).ok, true, 'accepted: no learner is likely to type it, and the dataset stays as it is');
  assert.equal(grade(min.replace('min by', 'max by')).ok, false, 'max picks the 200 series: 0.75, wrong value');
});

// ---- sources -------------------------------------------------------------------------------

test('sources: Spec lines name the three Prometheus pages, the quoted sentences are in the header, no em dash', () => {
  const spec = SRC.split('\n').find((l) => l.startsWith('// Spec:'));
  for (const u of ['https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/', 'https://prometheus.io/docs/prometheus/latest/querying/operators/', 'https://prometheus.io/docs/prometheus/latest/querying/functions/#absent']) assert.equal(spec.includes(u), true, u);
  const header = SRC.slice(0, SRC.indexOf('const THRESHOLD')).replace(/\n\/\/ /g, ' ');
  for (const w of ['results in one or more vector elements at a given point in time', 'get dropped from the result vector', 'drops labels that are not listed in the by clause', 'no time series exist for a given metric name and label combination']) assert.equal(header.includes(w), true, w);
  assert.equal(SRC.includes('\u2014'), false);
});
