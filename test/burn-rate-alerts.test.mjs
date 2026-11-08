// Level 7.3 "Burn-rate alerts" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs):
// level fields and the globe; the Query it step (reference read independently from the dataset's samples, not trivially 0 or 1, the
// obvious wrong queries failing through the real grader); the Choice (every number in the copy recomputed from first principles); the sources.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { liveRegistry } from '../app.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { getDataset } from '../lib/promql/datasets.mjs';
import { gradeQuery, referenceResult } from '../lib/promql/grade.mjs';
import { validateQuerySpec } from '../lib/widgets/query-it.mjs';

const ID = 'burn-rate-alerts';
const LIVE = liveRegistry();
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');
const level = LIVE.levels[ID];
const [QUERY_STEP, RULE_STEP] = level.play.steps;
const query = QUERY_STEP.query;

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};

// ---- the level -----------------------------------------------------------------------------

test('7.3 fields: third level of act-7, scored with no par time, a query then a choice, lights checkout, awards multi-window-burn', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs, prefix: level.play.prefix },
    { no: '7.3', name: 'Burn-rate alerts', sub: 'Fast enough, not jumpy', icon: '\u{1F525}', rewardTitle: 'Burn watcher', kind: 'level', actId: 'act-7', parMs: null, prefix: 'br' },
  );
  assert.deepEqual([...level.mechanics], ['query'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual(level.play.steps.map((s) => ['choice', 'query'].find((k) => s[k])), ['query', 'choice']);
  assert.deepEqual([...level.lights], ['checkout']);
  assert.deepEqual([...level.cards], ['multi-window-burn']);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Burn watcher').length, 1, 'the reward title is unique');
  const act = LIVE.acts.find((a) => a.id === 'act-7');
  assert.deepEqual([...act.levelIds], ['good-alerts', 'slis-and-slos', ID, 'synthetic-checks']);
});

test('card multi-window-burn: pinned front, fits a card, Dash0 SLO page as source, figures match the choice, no em dash', () => {
  const card = DECK.find((c) => c.id === 'multi-window-burn');
  assert.equal(card.front, 'Page on a burn rate over two windows: the long one says it is worth a page, the short one says it is still happening.');
  assert.equal(card.front.length <= 140, true, `front is ${card.front.length} characters`);
  assert.equal(card.specUrl, 'https://www.dash0.com/docs/dash0/monitoring/alerting/slos');
  for (const w of ['reads 100 on 5 minutes', 'reads 167 on the hour', '14.4', '2% of a 30-day budget']) assert.equal(card.back.includes(w), true, w);
  assert.match(card.dash0Angle, /fast burn and slow burn/);
  assert.equal((card.front + card.back + card.dash0Angle).includes('\u2014'), false);
});

// ---- step 1: Query it ----------------------------------------------------------------------

const M = 'http_server_requests_total';
const grade = (q) => gradeQuery(query.dataset, query.at, q, query.reference);
const value = (q) => referenceResult(query.dataset, query.at, q).series[0].value;
const burn = (win, sel = 'service="checkout"', div = '0.001') =>
  `sum(rate(${M}{${sel}, status="500"}[${win}])) / sum(rate(${M}{${sel}}[${win}])) / ${div}`;

test('step 1: a valid Query it spec on checkout-http, pinned dataset and eval time, hints on', () => {
  assert.equal(QUERY_STEP.qid, 'br-q-burn');
  assert.deepEqual(validateQuerySpec(query), []);
  assert.deepEqual({ id: query.id, dataset: query.dataset, at: query.at }, { id: 'br-burn', dataset: 'checkout-http', at: 3600 });
  assert.deepEqual(query.helps, { hints: true });
  assert.equal(typeof query.hint, 'string');
  assert.equal(/\[1h\]/.test(query.reference), true);
});

test('step 1 reference: one series, the hour\'s burn rate read independently from the samples, neither 0 nor 1', () => {
  const ref = referenceResult(query.dataset, query.at, query.reference);
  assert.equal(ref.kind, 'vector');
  assert.equal(ref.series.length, 1);
  assert.deepEqual(ref.series[0].labels, {});
  // Independent reading: failures and requests of the checkout counters over the hour. They restart at the deploy (t=2400), so each
  // counter's increase is its growth before the restart plus its value at the end.
  const mine = getDataset(query.dataset).series.filter((s) => s.labels.__name__ === M && s.labels.service === 'checkout');
  const increase = (s) => {
    let total = 0;
    for (let i = 1; i < s.samples.length; i++) {
      const [prev, cur] = [s.samples[i - 1][1], s.samples[i][1]];
      total += cur >= prev ? cur - prev : cur; // a drop is a reset: the counter restarted at 0
    }
    return total;
  };
  const failed = mine.filter((s) => s.labels.status === '500').reduce((a, s) => a + increase(s), 0);
  const all = mine.reduce((a, s) => a + increase(s), 0);
  assert.deepEqual([failed, all], [1518, 43020]);
  const want = failed / all / (1 - 0.999);
  assert.equal(Math.abs(ref.series[0].value - want) / want < 0.001, true, `${ref.series[0].value} vs ${want}`);
  assert.equal(ref.series[0].value > 35 && ref.series[0].value < 36, true, 'about 35');
  assert.equal(ref.series[0].value > 14.4, true, 'above the line of the next step');
});

test('step 1 graded for real: the reference and equivalent formulations pass', () => {
  assert.equal(grade(query.reference).ok, true);
  assert.equal(grade(burn('1h', 'service="checkout"', '(1 - 0.999)')).ok, true, '1 - 0.999 is the same divisor');
  assert.equal(grade(`sum(increase(${M}{service="checkout", status="500"}[1h])) / sum(increase(${M}{service="checkout"}[1h])) / 0.001`).ok, true, 'increase over the same window');
  assert.equal(grade(`(1 - sum(rate(${M}{service="checkout", status!="500"}[1h])) / sum(rate(${M}{service="checkout"}[1h]))) / 0.001`).ok, true, 'one minus the good share');
});

test('step 1 graded for real: each obvious wrong query fails, and the verdict tells the slip', () => {
  const sel = 'service="checkout"';
  const wrong = {
    'no rate (only the 20 minutes since the restart)': [`sum(${M}{${sel}, status="500"}) / sum(${M}{${sel}}) / 0.001`, 'wrong-values'],
    'the failed share, not divided by (1 - target)': [`sum(rate(${M}{${sel}, status="500"}[1h])) / sum(rate(${M}{${sel}}[1h]))`, 'wrong-values'],
    'divided by the target, not by (1 - target)': [burn('1h', sel, '0.999'), 'wrong-values'],
    'multiplied by (1 - target)': [`sum(rate(${M}{${sel}, status="500"}[1h])) / sum(rate(${M}{${sel}}[1h])) * 0.001`, 'wrong-values'],
    'inverted ratio (requests over failures)': [`sum(rate(${M}{${sel}}[1h])) / sum(rate(${M}{${sel}, status="500"}[1h])) * 0.001`, 'wrong-values'],
    'failures over the successes, not over all': [`sum(rate(${M}{${sel}, status="500"}[1h])) / sum(rate(${M}{${sel}, status="200"}[1h])) / 0.001`, 'wrong-values'],
    'failures over only /pay': [`sum(rate(${M}{${sel}, status="500"}[1h])) / sum(rate(${M}{${sel}, route="/pay"}[1h])) / 0.001`, 'wrong-values'],
    'every service, not checkout': [burn('1h', 'service=~".+"'), 'wrong-values'],
    'the good share over (1 - target)': [`sum(rate(${M}{${sel}, status!="500"}[1h])) / sum(rate(${M}{${sel}}[1h])) / 0.001`, 'wrong-values'],
    'the last 5 minutes, not the hour': [burn('5m'), 'wrong-values'],
    'a 99% target (divided by 0.01)': [burn('1h', sel, '0.01'), 'wrong-values'],
    'failures only, no division': [`sum(rate(${M}{${sel}, status="500"}[1h]))`, 'wrong-values'],
    'grouped by route': [`sum by (route) (rate(${M}{${sel}, status="500"}[1h])) / sum by (route) (rate(${M}{${sel}}[1h])) / 0.001`, 'wrong-count'],
  };
  for (const [name, [q, reason]] of Object.entries(wrong)) {
    const r = grade(q);
    assert.deepEqual([name, r.ok, r.reason], [name, false, reason]);
  }
  // The tempting slips are different numbers, not rounding.
  assert.equal(Math.abs(value(wrong['no rate (only the 20 minutes since the restart)'][0]) - 83.3333) < 0.001, true, 'no rate reads 83.3');
  assert.equal(Math.abs(value(burn('5m')) - 250 / 3) < 1e-6, true, 'the last 5 minutes read 83.3');
  assert.equal(value(wrong['the failed share, not divided by (1 - target)'][0]) < 0.04, true, 'the failed share reads 0.035');
});

test('step 1 copy: the numbers in the explain are the data, the window is labelled illustrative', () => {
  const e = plain(query.explain);
  for (const w of ['about 35', 'about 11', '83.3', '0.035', '20 minutes', '40 minutes', 'rate()']) assert.equal(e.includes(w), true, w);
  // before the deploy: 2 failures of 180 requests per scrape; the last 5 minutes: 15 of 180.
  assert.equal(Math.abs(value(burn('5m')) - (15 / 180) / 0.001) < 1e-6, true);
  assert.equal(Math.abs((2 / 180) / 0.001 - 11.11) < 0.01, true, 'before the deploy about 11 times');
  const intro = plain(QUERY_STEP.intro);
  assert.match(intro, /illustrative/);
  assert.match(intro, /99\.9%/);
  assert.match(intro, /20 minutes ago/);
  assert.equal(getDataset(query.dataset).meta.deployAt, query.at - 20 * 60, 'the deploy was 20 minutes before the evaluation time');
  assert.match(plain(QUERY_STEP.question), /last hour/);
});

// ---- step 2: the paging rule ---------------------------------------------------------------

// The two incidents of the copy, recomputed. Burn rate = failed share over a window / (1 - target).
const TARGET = 0.999;
const allow = 1 - TARGET;
const failedShare = (failedSeconds, windowSeconds) => failedSeconds / windowSeconds;
const burnOf = (failedSeconds, windowSeconds) => failedShare(failedSeconds, windowSeconds) / allow;
const LINE = 14.4;

test('step 2: the 14.4 line is 2% of a 30-day budget spent in an hour, computed, not copied', () => {
  const hours = 30 * 24;
  assert.equal(hours, 720);
  assert.equal(Number((0.02 * hours).toFixed(6)), LINE);
  assert.equal(Number((LINE * 1 / hours).toFixed(6)), 0.02, '14.4 x 1 hour out of 720 hours is 2%');
  assert.equal(Math.round(burnOf(1, 1)), 1000, 'every request failing is a burn rate of 1,000');
  const intro = plain(RULE_STEP.intro);
  for (const w of ['14.4', '2%', '720 hours', '1,000', '30-day']) assert.equal(intro.includes(w), true, w);
  assert.equal(Number((0.02 * 28 * 24).toFixed(6)), 13.44, "Dash0's 28-day window puts the same tier at 13.44");
});

test('step 2: the readings of incidents A and B in the copy are the arithmetic', () => {
  const intro = plain(RULE_STEP.intro);
  // A: 30 s of total failure. Right after, the 5-minute window holds all 30 s, the 1-hour window too.
  assert.equal(Math.round(burnOf(30, 300)), 100);
  assert.equal(burnOf(30, 3600).toFixed(1), '8.3');
  // B: 10 minutes of total failure, rolled back; six minutes later the 5-minute window holds none, the hour holds all 600 s.
  assert.equal(burnOf(0, 300), 0);
  assert.equal(Math.round(burnOf(600, 3600)), 167);
  for (const w of ['reads 100', 'reads 8.3', 'reads 0 ', 'reads 167', '30 seconds', '10 minutes', 'Six minutes after']) assert.equal(intro.includes(w) || intro.includes(w.trim()), true, w);
  assert.deepEqual([burnOf(30, 300) > LINE, burnOf(30, 3600) > LINE], [true, false], 'A: the short window crosses the line, the long one does not');
  assert.deepEqual([burnOf(0, 300) > LINE, burnOf(600, 3600) > LINE], [false, true], 'B after the rollback: the short window is clear, the long one still pages');
  assert.match(intro, /The team wants a page for B, none for A/);
  assert.match(intro, /no blip followed by a long failure/);
});

test('step 2: the facts in the answers are the arithmetic (1.2% of the budget, 59 minutes after the fix, 43 minutes to cross)', () => {
  const choices = RULE_STEP.choice.choices;
  const why = (k) => plain(choices.find((c) => c.key === k).why);
  const budgetSeconds = allow * 30 * 24 * 3600;
  assert.equal(Math.round(budgetSeconds), 2592);
  assert.equal((30 / Math.round(budgetSeconds) * 100).toFixed(1), '1.2');
  assert.equal(why('short-only').includes('1.2% of the budget (30 seconds of the 2,592'), true);
  // The 1-hour reading stays above the line until fewer than 14.4 x 0.001 x 3600 s of failures are left in the hour.
  const keepSeconds = LINE * allow * 3600;
  assert.equal(keepSeconds.toFixed(2), '51.84');
  const fixAt = 600; // the outage ran from 0 to 600 s
  const clearsAt = 3600 + (fixAt - keepSeconds); // the window start has eaten all but keepSeconds of the outage
  assert.equal(Math.round((clearsAt - fixAt) / 60), 59, 'about 59 minutes after the fix');
  for (const w of ['about 59 minutes', 'less than 52 seconds', '167', '8.3']) assert.equal(why('long-only').includes(w), true, w);
  // 2% of requests failing is a burn rate of 20; the hour crosses 14.4 after 14.4 / 20 of an hour.
  assert.equal(Math.round(0.02 / allow), 20);
  assert.equal(((LINE / 20) * 60).toFixed(1), '43.2');
  assert.equal(why('long-only').includes('a burn rate of 20) it needs 43 minutes'), true);
  assert.equal(Number((0.02 * 28 * 24).toFixed(6)), 13.44);
  assert.equal(why('both').includes('13.44 for 2% of the budget in an hour, on its 28-day window'), true);
});

test('step 2: both windows is the one right answer, labels carry no reasoning, the tempting wrong ones are named by their numbers', () => {
  assert.equal(RULE_STEP.qid, 'br-q-rule');
  const choices = RULE_STEP.choice.choices;
  assert.deepEqual(choices.map((c) => c.key), ['short-only', 'long-only', 'either', 'both']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['both']);
  const lens = choices.map((c) => plain(c.label).length);
  assert.equal(plain(choices[3].label).length < Math.max(...lens), true, `the right label is not the longest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 16, true, `plain label lengths ${lens}`);
  for (const c of choices) assert.doesNotMatch(plain(c.label), /blip|stale|too late|wrong|noisy|jumpy|keeps paging|quiet|clears/i, c.key);
  assert.match(plain(choices[0].why), /pages for a 30-second hiccup/);
  assert.match(plain(choices[2].why), /blips of the short one and the stale page of the long one/);
  assert.match(plain(choices[3].why), /no blips and a quick clear/);
});

// ---- sources -------------------------------------------------------------------------------

test('sources: Spec lines on prometheus.io, Dash0 docs lines on www.dash0.com, facts and inventions listed, no em dash', () => {
  const specs = SRC.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g));
  assert.deepEqual(specs, [
    'https://prometheus.io/docs/prometheus/latest/querying/functions/#rate',
    'https://prometheus.io/docs/prometheus/latest/querying/operators/#arithmetic-binary-operators',
    'https://prometheus.io/docs/concepts/metric_types/#counter',
  ]);
  const docs = SRC.split('\n').filter((l) => /^\/\/ Dash0 docs: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g));
  assert.deepEqual(docs, [
    'https://www.dash0.com/docs/dash0/monitoring/alerting/slos',
    'https://www.dash0.com/docs/dash0/monitoring/alerting/alert-on-slos',
    'https://www.dash0.com/docs/dash0/monitoring/alerting/about-notifications',
  ]);
  for (const url of SRC.match(/https:\/\/[^\s,)]+/g)) assert.equal(['prometheus.io', 'www.dash0.com'].includes(new URL(url).host), true, url);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Worked out in the game/);
  assert.match(SRC, /Invented/);
  assert.match(SRC, /and\/or\/unless/);
  assert.equal(SRC.includes('\u2014'), false, 'no em dash');
  assert.doesNotMatch(plain(JSON.stringify(level.play)), /\bevents?\b/, 'player-facing copy says requests');
});

// ---- the globe -----------------------------------------------------------------------------

test('globe: 7.3 lights Mongolia, East Asia is not complete yet', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'MNG');
  assert.equal(COUNTRY_NAMES.MNG, 'Mongolia');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const before = ['good-alerts', 'slis-and-slos'];
  const fresh = freshlyLit(progressOf(before), progressOf([...before, ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['MNG'], regionIds: [] });
  assert.equal(litText(fresh, level, map), 'Mongolia is now lit: Burn-rate alerts.');
});
