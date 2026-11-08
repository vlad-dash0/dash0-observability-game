// Level 7.2 "SLIs and SLOs" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs):
// level fields, the card and the globe; the Query it step (the reference result read independently from the
// dataset's samples, not trivially 0 or 1, and the obvious wrong queries failing through the real grader);
// the three Choices; and the sources. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { DECK } from '../cards/deck.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { getDataset } from '../lib/promql/datasets.mjs';
import { gradeQuery, referenceResult } from '../lib/promql/grade.mjs';
import { validateQuerySpec } from '../lib/widgets/query-it.mjs';

const ID = 'slis-and-slos';
const LIVE = liveRegistry();
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');
const level = LIVE.levels[ID];
const [SLI_STEP, QUERY_STEP, BUDGET_STEP, EDGE_STEP] = level.play.steps;
const query = QUERY_STEP.query;

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};

// ---- the level -----------------------------------------------------------------------------

test('7.2 fields: second level of act-7, scored with no par time, query and choices, lights checkout and the gateway', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs, prefix: level.play.prefix },
    { no: '7.2', name: 'SLIs and SLOs', sub: 'A number for "it works"', icon: '\u{1F3AF}', rewardTitle: 'Budget keeper', kind: 'level', actId: 'act-7', parMs: null, prefix: 'sl' },
  );
  assert.deepEqual([...level.mechanics], ['query'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual(level.play.steps.map((s) => ['choice', 'query'].find((k) => s[k])), ['choice', 'query', 'choice', 'choice']);
  assert.deepEqual([...level.lights], ['checkout', 'api-gateway']);
  assert.deepEqual([...level.cards], ['rate-not-value']);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Budget keeper').length, 1, 'the reward title is unique');
  const act = LIVE.acts.find((a) => a.id === 'act-7');
  assert.deepEqual([...act.levelIds], ['good-alerts', ID]);
});

test('card rate-not-value: pinned front, spec URL on prometheus.io, no Dash0 angle, front fits a card', () => {
  const card = DECK.find((c) => c.id === 'rate-not-value');
  assert.equal(card.front, 'A counter only grows. Alert on its rate, not its value, and build an SLI from rates: the value says nothing about now.');
  assert.equal(card.front.length <= 140, true, `front is ${card.front.length} characters`);
  assert.equal(card.specUrl, 'https://prometheus.io/docs/prometheus/latest/querying/functions/#rate');
  assert.equal(card.dash0Angle, null);
  for (const w of ['resets to zero', 'per-second average rate of increase', 'sum(rate(good[5m])) / sum(rate(all[5m]))', 'increase()']) assert.equal(card.back.includes(w), true, w);
  assert.equal(card.back.includes('\u2014') || card.front.includes('\u2014'), false, 'no em dash');
});

// ---- step 1: the shape of an SLI -----------------------------------------------------------

test('step 1: good over valid is the one right answer, labels do not give it away', () => {
  assert.equal(SLI_STEP.qid, 'sl-q-sli');
  const choices = SLI_STEP.choice.choices;
  assert.deepEqual(choices.map((c) => c.key), ['good-over-valid', 'error-count', 'uptime']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['good-over-valid']);
  const lens = choices.map((c) => plain(c.label).length);
  assert.equal(plain(choices[0].label).length < Math.max(...lens), true, `the right label is not the longest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 16, true, `plain label lengths ${lens}`);
  assert.match(plain(choices.find((c) => c.key === 'error-count').why), /follows the traffic/);
  assert.match(plain(choices.find((c) => c.key === 'uptime').why), /up and still fail/);
  const intro = plain(SLI_STEP.intro);
  assert.equal(/SLI/.test(intro) && /SLO/.test(intro), true, 'SLI and SLO are defined in the intro');
});

// ---- step 2: Query it ----------------------------------------------------------------------

const CALLS = 'traces_span_metrics_calls_total';
const SRV = 'service_name="checkout", span_kind="SPAN_KIND_SERVER"';
const ratio = (num, den) => `sum(rate(${CALLS}{${num}}[5m])) / sum(rate(${CALLS}{${den}}[5m]))`;
const grade = (q) => gradeQuery(query.dataset, query.at, q, query.reference);
const value = (q) => {
  const r = referenceResult(query.dataset, query.at, q);
  return r.series[0].value;
};

test('step 2: a valid Query it spec on the existing span metrics, pinned dataset and eval time, hints on', () => {
  assert.equal(QUERY_STEP.qid, 'sl-q-sli-query');
  assert.deepEqual(validateQuerySpec(query), []);
  assert.deepEqual({ id: query.id, dataset: query.dataset, at: query.at }, { id: 'sl-sli-query', dataset: 'checkout-spanmetrics', at: 3600 });
  assert.deepEqual(query.helps, { hints: true });
  assert.equal(typeof query.hint, 'string');
  assert.equal(/\[5m\]/.test(query.reference), true);
});

test('step 2 reference: one series, equal to good over valid read from the samples, neither 0 nor 1', () => {
  const ref = referenceResult(query.dataset, query.at, query.reference);
  assert.equal(ref.kind, 'vector');
  assert.equal(ref.series.length, 1, 'one series: the checkout SLI');
  assert.deepEqual(ref.series[0].labels, {});
  // Independent reading: the growth of the checkout SERVER counters between t-300 and t, error status or not.
  const grew = (series) => series.samples.find(([t]) => t === query.at)[1] - series.samples.find(([t]) => t === query.at - 300)[1];
  const mine = getDataset('checkout-spanmetrics').series.filter((s) => s.labels.__name__ === CALLS && s.labels.service_name === 'checkout' && s.labels.span_kind === 'SPAN_KIND_SERVER');
  const all = mine.reduce((a, s) => a + grew(s), 0);
  const bad = mine.filter((s) => s.labels.status_code === 'STATUS_CODE_ERROR').reduce((a, s) => a + grew(s), 0);
  assert.equal(all, 3600, 'the window holds 3,600 valid checkout requests');
  assert.equal(bad, 300);
  const want = (all - bad) / all;
  assert.equal(Math.abs(ref.series[0].value - want) < 1e-6, true, `${ref.series[0].value} vs ${want}`);
  assert.equal(ref.series[0].value > 0.9 && ref.series[0].value < 0.92, true, 'about 91.7%');
  assert.equal(ref.series[0].value !== 0 && ref.series[0].value !== 1, true);
});

test('step 2 graded for real: the reference and equivalent formulations pass', () => {
  assert.equal(grade(query.reference).ok, true);
  assert.equal(grade(ratio(`${SRV}, status_code="STATUS_CODE_UNSET"`, SRV)).ok, true, 'UNSET is the good status');
  assert.equal(grade(`sum(increase(${CALLS}{${SRV}, status_code!="STATUS_CODE_ERROR"}[5m])) / sum(increase(${CALLS}{${SRV}}[5m]))`).ok, true, 'increase over the same window');
  assert.equal(grade(`1 - ${ratio(`${SRV}, status_code="STATUS_CODE_ERROR"`, SRV)}`).ok, true, 'one minus the error ratio');
});

test('step 2 graded for real: each obvious wrong query fails, and the verdict tells the slip', () => {
  const wrong = {
    'no rate': [`sum(${CALLS}{${SRV}, status_code!="STATUS_CODE_ERROR"}) / sum(${CALLS}{${SRV}})`, 'wrong-values'],
    'inverted ratio': [ratio(SRV, `${SRV}, status_code!="STATUS_CODE_ERROR"`), 'wrong-values'],
    'error ratio, not the good one': [ratio(`${SRV}, status_code="STATUS_CODE_ERROR"`, SRV), 'wrong-values'],
    'wrong status value': [ratio(`${SRV}, status_code="STATUS_CODE_OK"`, SRV), 'empty'],
    'good over errors, not over all': [ratio(`${SRV}, status_code!="STATUS_CODE_ERROR"`, `${SRV}, status_code="STATUS_CODE_ERROR"`), 'wrong-values'],
    'good events only, no division': [`sum(rate(${CALLS}{${SRV}, status_code!="STATUS_CODE_ERROR"}[5m]))`, 'wrong-values'],
    'client spans counted too': [ratio('service_name="checkout", status_code!="STATUS_CODE_ERROR"', 'service_name="checkout"'), 'wrong-values'],
    'every service': [ratio('span_kind="SPAN_KIND_SERVER", status_code!="STATUS_CODE_ERROR"', 'span_kind="SPAN_KIND_SERVER"'), 'wrong-values'],
    'one hour window': [`sum(rate(${CALLS}{${SRV}, status_code!="STATUS_CODE_ERROR"}[1h])) / sum(rate(${CALLS}{${SRV}}[1h]))`, 'wrong-values'],
    'grouped by service': [`sum by (service_name) (rate(${CALLS}{${SRV}, status_code!="STATUS_CODE_ERROR"}[5m])) / sum by (service_name) (rate(${CALLS}{${SRV}}[5m]))`, 'wrong-labels'],
  };
  for (const [name, [q, reason]] of Object.entries(wrong)) {
    const r = grade(q);
    assert.deepEqual([name, r.ok, r.reason], [name, false, reason]);
  }
  // The slips are not near misses: the tempting ones are different numbers, not rounding.
  assert.equal(value(wrong['no rate'][0]) > 0.96, true, 'no rate reads 96.5% and hides the failing minutes');
  assert.equal(value(wrong['client spans counted too'][0]) < 0.88, true, 'the client span drags it to 87.5%');
});

test('step 2 copy: rate is the point, the window is the last 5 minutes, the numbers in the explain are the data', () => {
  const q = plain(QUERY_STEP.question);
  assert.match(q, /last 5 minutes/);
  const e = plain(query.explain);
  for (const w of ['91.7%', '96.5%', '87.5%', 'rate()']) assert.equal(e.includes(w), true, w);
  assert.equal(Math.abs(value(query.reference) - 11 / 12) < 1e-9, true, 'the explain says 11 of 12 per second');
  assert.equal(Math.abs(value(ratio('service_name="checkout"', 'service_name="checkout"')) - 1) < 1e-9, true, 'sanity: all over all is 1');
});

// ---- steps 3 and 4: the budget and the edge ------------------------------------------------

test('step 3: the 0.1% budget of 1,000,000 valid requests is 1,000, the illustrative window is labelled, the slips are named', () => {
  assert.equal(BUDGET_STEP.qid, 'sl-q-budget');
  const choices = BUDGET_STEP.choice.choices;
  assert.deepEqual(choices.map((c) => c.key), ['thousand', 'hundred', 'ten-thousand', 'all-but']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['thousand']);
  assert.match(plain(choices[0].label), /^1,000 failed requests/);
  assert.equal(Math.round(1_000_000 * (1 - 0.999)), 1000, 'the budget is 1,000');
  assert.match(plain(BUDGET_STEP.intro), /illustrative/);
  assert.match(plain(BUDGET_STEP.intro), /99\.9%/);
  assert.match(plain(BUDGET_STEP.intro), /1,000,000/);
  assert.match(plain(choices.find((c) => c.key === 'all-but').why), /Inverted/);
});

test('step 4: the load balancer is the right source; server spans are the tempting wrong one and the sum double counts', () => {
  assert.equal(EDGE_STEP.qid, 'sl-q-edge');
  const choices = EDGE_STEP.choice.choices;
  assert.deepEqual(choices.map((c) => c.key), ['server-spans', 'load-balancer', 'both-summed']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['load-balancer']);
  const lens = choices.map((c) => plain(c.label).length);
  assert.equal(plain(choices[1].label).length < Math.max(...lens), true, `the right label is not the longest: ${lens}`);
  assert.match(plain(choices[0].why), /never reached checkout/);
  assert.match(plain(choices[2].why), /twice/);
  assert.match(plain(EDGE_STEP.intro), /502/);
  assert.equal(plain(EDGE_STEP.intro).includes('99.95%'), true, 'the server-span SLI looks healthy through the outage');
});

// ---- sources -------------------------------------------------------------------------------

test('sources: Spec lines on prometheus.io and opentelemetry.io only, facts and inventions listed, no Dash0 claim, no em dash', () => {
  const specs = SRC.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g));
  assert.deepEqual(specs, [
    'https://prometheus.io/docs/prometheus/latest/querying/functions/#rate',
    'https://prometheus.io/docs/concepts/metric_types/#counter',
    'https://opentelemetry.io/docs/specs/semconv/http/http-spans/',
    'https://opentelemetry.io/docs/collector/components/connector/',
  ]);
  for (const url of SRC.match(/https:\/\/[^\s,)]+/g)) assert.equal(['prometheus.io', 'opentelemetry.io'].includes(new URL(url).host), true, url);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Invented/);
  assert.doesNotMatch(plain(JSON.stringify(level.play)), /Dash0/, '7.2 has no Dash0 tie-in (OUTLINE: n/a)');
  assert.equal(SRC.includes('\u2014'), false, 'no em dash');
});

// ---- the globe -----------------------------------------------------------------------------

test('globe: 7.2 lights China and completes East Asia', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'CHN');
  assert.equal(COUNTRY_NAMES.CHN, 'China');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const fresh = freshlyLit(progressOf(['good-alerts']), progressOf(['good-alerts', ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['CHN'], regionIds: ['act-7'] });
  assert.equal(litText(fresh, level, map), 'China is now lit: SLIs and SLOs. East Asia is complete.');
});
