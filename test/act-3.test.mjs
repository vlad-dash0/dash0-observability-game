// Act 3 levels 3.1 Instruments, 3.2 Temporality, 3.3 Histograms, 3.4 PromQL basics, 3.5 Cardinality, 3.6 Exemplars and 3.7 RED and USE beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's place in the
// registry, unlock and map; level fields and lights; card fronts and backs; the facts the copy
// states (docs/OUTLINE.md §4 Act 3), each checked from the level's own data. Asserts strings,
// numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { getDataset } from '../lib/promql/datasets.mjs';
import { evaluate } from '../lib/promql/eval.mjs';
import { allPlans, evaluatePlan } from '../lib/widgets/trade-off.mjs';
import { gradeQuery } from '../lib/promql/grade.mjs';
import { checkSpot, newSpotState, toggleLine } from '../lib/widgets/spot-it.mjs';
import { liveRegistry } from '../app.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { litIds } from './helpers/lights.mjs';
import { isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';

const LIVE = liveRegistry();
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
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
const stepOf = (levelId, key, widgetId) =>
  LIVE.levels[levelId].play.steps.find((s) => s[key] && s[key].id === widgetId)[key];
const choiceOf = (levelId, widgetId) => stepOf(levelId, 'choice', widgetId).choices;
const rightOf = (levelId, widgetId) => choiceOf(levelId, widgetId).find((c) => c.right);

// ---- the act ------------------------------------------------------------------------

test('act-3 "Metrics" holds 3.1 to 3.7, after Act 2, with the boss "The bill"', () => {
  const index = LIVE.acts.findIndex((a) => a.id === 'act-3');
  assert.equal(index, 3, 'act-3 follows act-0, act-1 and act-2');
  const act = LIVE.acts[index];
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 3, name: 'Metrics', sub: 'How much, how often', levelIds: ['instruments', 'temporality', 'histograms', 'promql-basics', 'cardinality', 'exemplars', 'red-and-use'], bossId: 'the-bill' },
  );
});

test('act-3 unlocks like act-2 did: every earlier act complete, or entered', () => {
  const before = [...idsOf('act-0'), ...idsOf('act-1')];
  assert.equal(isActUnlocked(3, progressOf(before), LIVE), false, 'act-2 not complete');
  assert.deepEqual(lockReason('instruments', progressOf(before), LIVE), { kind: 'act', actId: 'act-2' });
  assert.equal(levelState('instruments', emptyProgress(), LIVE), 'locked');

  const all = [...before, ...idsOf('act-2')];
  assert.equal(isActUnlocked(3, progressOf(all), LIVE), true);
  assert.equal(levelState('instruments', progressOf(all), LIVE), 'open');
  assert.equal(levelState('temporality', progressOf(all), LIVE), 'open', 'levels open in any order');

  // Entered: one completed level opens its act, and that holds when earlier acts are not done.
  assert.equal(levelState('temporality', progressOf(['instruments']), LIVE), 'open');
  assert.equal(levelState('instruments', progressOf(['temporality']), LIVE), 'open');
});

test('act-3 levels are scored with no par time, and belong to act-3', () => {
  for (const id of ['instruments', 'temporality', 'histograms', 'promql-basics', 'cardinality', 'red-and-use']) {
    const level = LIVE.levels[id];
    assert.equal(level.actId, 'act-3', id);
    assert.equal(level.kind, 'level', id);
    assert.equal(level.scored, true, id);
    assert.equal(level.scoring.parMs, null, id);
  }
});

// ---- level fields and lights --------------------------------------------------------

const FIELDS = {
  instruments: { no: '3.1', name: 'Instruments', mechanics: ['sort'], cards: ['gauge-not-count'], lights: ['kafka'] },
  temporality: { no: '3.2', name: 'Temporality', mechanics: ['spot'], cards: ['delta-needs-converting'], lights: ['notifications'] },
  histograms: { no: '3.3', name: 'Histograms', mechanics: ['query'], cards: ['averages-hide-tails'], lights: ['payment-provider'] },
  'promql-basics': { no: '3.4', name: 'PromQL basics', mechanics: ['query'], cards: ['prometheus-names'], lights: ['shipping'] },
  cardinality: { no: '3.5', name: 'Cardinality', mechanics: ['spot', 'tradeoff'], cards: ['series-are-combinations'], lights: ['postgres'] },
  exemplars: { no: '3.6', name: 'Exemplars', mechanics: ['spot'], cards: ['exemplars-need-sampled-spans'], lights: ['payments'] },
  'red-and-use': { no: '3.7', name: 'RED and USE', mechanics: ['query'], cards: ['red-and-use'], lights: ['checkout'] },
};

for (const [id, want] of Object.entries(FIELDS)) {
  test(`${id}: level fields, derived mechanics, cards and lights`, () => {
    const level = LIVE.levels[id];
    assert.deepEqual(
      { no: level.no, name: level.name, mechanics: [...level.mechanics], cards: [...level.cards], lights: [...level.lights] },
      want,
    );
    assert.equal(level.run.length, 1, 'a play level gets its run from the registry');
    assert.equal(typeof level.play.finish, 'string');
  });
}

test('lights: 3.1 lights Kafka and 3.2 Notifications', () => {
  const lit = (done) => litIds(LIVE, progressOf(done)).sort();
  assert.deepEqual(lit([]), []);
  assert.deepEqual(lit(['instruments']), ['kafka']);
  assert.deepEqual(lit(['temporality']), ['notifications']);
  assert.deepEqual(lit(['instruments', 'temporality']), ['kafka', 'notifications']);
});

test('lights: 3.3 lights the payment provider and 3.4 shipping, and each lights only its own node', () => {
  const lit = (done) => {
    return litIds(LIVE, progressOf(done)).sort();
  };
  assert.deepEqual(lit(['histograms']), ['payment-provider']);
  assert.deepEqual(lit(['promql-basics']), ['shipping']);
  assert.deepEqual(lit(['instruments', 'temporality', 'histograms', 'promql-basics']), ['kafka', 'notifications', 'payment-provider', 'shipping']);
});

test('lights: 3.5 lights Postgres and 3.7 Checkout (a node 1.2 also lights), each only its own node', () => {
  const lit = (done) => {
    return litIds(LIVE, progressOf(done)).sort();
  };
  assert.deepEqual(lit(['cardinality']), ['postgres']);
  assert.deepEqual(lit(['red-and-use']), ['checkout']);
  assert.deepEqual(
    lit(['instruments', 'temporality', 'histograms', 'promql-basics', 'cardinality', 'red-and-use']),
    ['checkout', 'kafka', 'notifications', 'payment-provider', 'postgres', 'shipping'],
  );
});

// ---- cards --------------------------------------------------------------------------

const CARDS = {
  'gauge-not-count': {
    front:
      'A Gauge is a reading, not a count: report a running total with one and the backend gets samples, not a sum it can take a rate of.',
    back:
      'Pick the instrument by what the number means. A Counter only goes up. An UpDownCounter goes up and down, and its ' +
      'values add up across sources, like active requests or queue length. A Gauge is a current value that makes no ' +
      'sense to sum, like a temperature. A Histogram records many values where the spread matters, like durations. ' +
      'Synchronous instruments are called where the event happens; asynchronous (observable) ones take a callback the ' +
      'SDK runs at each collection. A gauge point is only a sampled value, with no aggregation semantic. A monotonic ' +
      'Sum also carries a start time, which is what lets a backend compute a rate that notices restarts, so a running ' +
      'total belongs in a Counter.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/metrics/api/#instrument',
    dash0Angle: null,
  },
  'delta-needs-converting': {
    front:
      'Prometheus-style backends need cumulative sums: convert delta series first, and expect a restart to reset a cumulative counter.',
    back:
      'Temporality says whether a point holds the total since the process started (cumulative) or only the change since ' +
      'the last report (delta). SDKs default to cumulative. Prometheus is the textbook cumulative system, and ' +
      "OpenTelemetry's data model notes that the time series model it targets has no delta counters. So a delta sum has " +
      'to be turned into a cumulative one before it reaches such a backend, and an exporter either converts a delta ' +
      "histogram or drops it. The Collector's deltatocumulative processor does the conversion, but it is stateful: it " +
      'keeps every series in memory, so all the points of one series must reach the same instance. A cumulative counter ' +
      'lives in the process, so a restart starts it again from zero with a new start time, which a backend that reads ' +
      'start times treats as a reset, not as a drop.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/metrics/data-model/#temporality',
    dash0Angle:
      'Dash0 accepts both temporalities and you query metrics with PromQL, so the conversion is for Prometheus-style ' +
      'backends, not for Dash0.',
  },
  'averages-hide-tails': {
    front:
      'An average hides the slow tail: read p95 and p99 from histogram buckets, and make sure the buckets reach your slowest requests.',
    back:
      'A histogram counts observations into buckets and keeps a count and a sum, so sum over count is the mean, and a few ' +
      'very slow requests barely move it. A percentile needs the buckets: histogram_quantile estimates it from the rate of ' +
      'the _bucket series, summed by le, and the estimate is only as good as the bucket boundaries. A quantile that falls ' +
      'in the +Inf bucket is reported as the highest finite bound. The SDK default boundaries (0 to 10000) suit large ' +
      'values, not durations in seconds, but for http.server.request.duration the semantic conventions advise boundaries ' +
      'from 0.005 to 10 seconds, which the SDK uses; set your own for other durations. An explicit bucket histogram uses boundaries you choose. An exponential histogram ' +
      'derives them from a scale, so one histogram covers a wide range with small relative error, but not every backend ' +
      'accepts it: the Prometheus text formats drop it or convert it to fixed buckets.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exponentialhistogram',
    dash0Angle:
      'Dash0 speaks PromQL, so histogram_quantile over the rate of the _bucket series gives you the percentile, ' +
      'as it would in Prometheus.',
  },
  'prometheus-names': {
    front: 'OpenTelemetry names change for PromQL: dots become underscores, a unit word is added, and monotonic sums get _total.',
    back:
      'With the classic translation, http.server.request.duration with the unit s is queried as ' +
      'http_server_request_duration_seconds, and its histogram series are _bucket, _sum and _count. A monotonic sum such as ' +
      'http.server.requests becomes a counter, http_server_requests_total, and a unit in braces such as {request} is dropped. ' +
      'Use rate() for a per-second figure and increase() for growth over a window; both adjust for counter resets. ' +
      'Prometheus can also keep UTF-8 names, and a backend may be configured to skip the suffixes, so check what yours does.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/#otlp-metric-points-to-prometheus',
    dash0Angle:
      'Dash0 exposes each metric under both names, and the otel_metric_name label selects the original one. It also ' +
      'derives metrics from logs and spans, which you query with the same PromQL.',
  },
  'series-are-combinations': {
    front:
      'A metric has one series per attribute combination: keep user ids and raw URLs off metrics, and use http.route.',
    back:
      'Every unique combination of attribute values is its own time series, so the worst case is the product of the ' +
      'number of values of each attribute: 5 methods, 14 routes and 9 status codes make at most 630 series, and adding ' +
      'user.id with 31,402 values makes it 19,783,260. Series cost memory, storage and query time, and the Prometheus ' +
      'guidance is not to use labels for unbounded values such as user IDs. http.route is the low-cardinality choice: ' +
      'a route template with placeholders for the dynamic segments. An SDK that implements the specification\'s ' +
      'cardinality limit (2,000 per metric by default) folds the combinations it had not seen yet into one overflow ' +
      'point. Keep per-user detail on spans and logs.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/metrics/sdk/#cardinality-limits',
    dash0Angle:
      'Dash0\'s Metric Explorer tree map sizes each metric by its cardinality, so you can see what drives volume. A ' +
      'spam filter drops matching data points at ingestion, but fixing the source is the cheaper answer.',
  },
  'exemplars-need-sampled-spans': {
    front: 'An exemplar links one metric measurement to its trace, but only if it was recorded inside a sampled span.',
    back:
      'An exemplar is a recorded measurement that keeps its value, its time, the attributes the metric point does not ' +
      'keep, and, for a synchronous instrument, the trace_id and span_id of the span that was active when it was recorded. ' +
      'The SDK picks exemplars as measurements are recorded: a filter decides which measurements are eligible and a ' +
      'reservoir decides which are kept. The default filter in the specification is TraceBased, which only makes ' +
      'measurements recorded in the context of a sampled span eligible, so a measurement made outside any span, or ' +
      'inside a span that was sampled out, cannot become one. OTEL_METRICS_EXEMPLAR_FILTER sets the filter to ' +
      'always_on, always_off or trace_based.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/metrics/sdk/#exemplarfilter',
    dash0Angle: null,
  },
  'red-and-use': {
    front:
      'RED (rate, errors, duration) reads a service\'s requests; USE (utilisation, saturation, errors) reads a resource.',
    back:
      'RED is Tom Wilkie\'s checklist for each request-driven service: Rate, the requests per second; Errors, the share ' +
      'of them that fail; Duration, how long they take, as a distribution. USE is Brendan Gregg\'s checklist for each ' +
      'resource, such as a CPU or a disk: Utilisation, how busy it is; Saturation, how much work waits for it, often a ' +
      'queue; Errors, the count of error events. A burst can saturate a resource while its average utilisation looks ' +
      'low. When a service sends traces but no metrics, the Collector\'s spanmetrics connector (contrib) turns the spans ' +
      'into a calls counter and a duration histogram: rate is the calls, errors are the calls with an error status, and ' +
      'the metric names and the duration unit depend on the version, so check yours. Count a service\'s own requests ' +
      'from its SERVER spans, and keep span names low-cardinality, because every distinct name is a series.',
    specUrl: 'https://opentelemetry.io/docs/collector/components/connector/',
    dash0Angle:
      'Dash0 derives RED from the spans it receives (dash0.spans.red) for its Service Catalog and Service Map, so you ' +
      'do not run a connector for them.',
  },
};

test('Act 3 cards: front, back, spec URL and Dash0 angle are pinned; fronts fit a card (<=140)', () => {
  for (const [id, want] of Object.entries(CARDS)) {
    const card = DECK.find((c) => c.id === id);
    assert.deepEqual(card, { id, ...want });
    assert.equal(want.front.length <= 140, true, `${id} front is ${want.front.length} characters`);
  }
});

// ---- 3.1 Instruments ----------------------------------------------------------------

const instr = () => stepOf('instruments', 'sort', 'instr-sort');

test('instruments: the four instruments are the buckets, two measurements each', () => {
  const sort = instr();
  assert.deepEqual(
    sort.buckets.map((b) => `${b.id}=${b.label}`),
    ['counter=Counter', 'up-down-counter=UpDownCounter', 'gauge=Gauge', 'histogram=Histogram'],
  );
  for (const b of sort.buckets) assert.equal(sort.items.filter((it) => it.bucket === b.id).length, 2, b.id);
});

test('instruments: every wrong-bucket hint that exists is for a bucket the item is not in, and a count never fits a Gauge', () => {
  for (const it of instr().items) {
    for (const key of Object.keys(it.whyNot ?? {})) assert.notEqual(key, it.bucket, `${it.id} whyNot ${key}`);
  }
  const counts = instr().items.filter((it) => it.bucket === 'counter');
  assert.equal(counts.length, 2);
  for (const it of counts) assert.equal(/\bgauge\b/i.test(it.whyNot?.gauge ?? ''), true, `${it.id} says why not a Gauge`);
});

test('instruments: sync vs async is graded: a snapshot you can read is an asynchronous UpDownCounter, not a Gauge', () => {
  const right = rightOf('instruments', 'instr-async');
  assert.equal(right.key, 'async-updown');
  const text = plain(right.label + right.why);
  for (const w of ['asynchronous', 'UpDownCounter', 'callback']) assert.equal(text.includes(w), true, w);
  const gauge = choiceOf('instruments', 'instr-async').find((c) => /Gauge/.test(c.label));
  assert.equal(/add up|sum/i.test(gauge.why), true, 'the Gauge option is wrong because heap sizes add up');
});

test('instruments: the nuance is graded: a Gauge used for a count loses the sum and the start time a rate needs', () => {
  const right = rightOf('instruments', 'instr-gauge');
  assert.equal(right.key, 'sampled-not-sum');
  const text = plain(right.label + right.why);
  for (const w of ['sampled', 'start time', 'Counter']) assert.equal(text.includes(w), true, w);
  const lost = choiceOf('instruments', 'instr-gauge').find((c) => c.key === 'lost-between');
  assert.equal(/nothing is lost|no order is lost|still includes/i.test(lost.why), true, 'the running total keeps every earlier order');
});

// ---- 3.2 Temporality ----------------------------------------------------------------

test('temporality: the spotted series are exactly the delta ones; gauges and cumulative series are not', () => {
  const spot = stepOf('temporality', 'spot', 'temp-spot');
  assert.equal(spot.target, 'metric');
  const delta = (l) => /temporality="delta"/.test(l.text);
  assert.deepEqual(spot.lines.filter(delta).map((l) => l.id), spot.faults);
  assert.equal(spot.lines.some((l) => !/temporality=/.test(l.text)), true, 'a gauge line has no temporality at all');
  for (const l of spot.lines.filter((x) => !delta(x))) {
    assert.equal(typeof spot.whyNot[l.id], 'string', `${l.id} says why it needs no conversion`);
  }
});

test('temporality: the Prometheus-style rule, the deltatocumulative processor and its statefulness are graded', () => {
  const right = rightOf('temporality', 'temp-convert');
  assert.equal(right.key, 'deltatocumulative');
  assert.equal(right.label.includes('<code>deltatocumulative</code>'), true);
  assert.equal(/stateful|same instance/i.test(right.why), true, 'the cost is stated');
  const explain = stepOf('temporality', 'spot', 'temp-spot').explain;
  assert.equal(/Prometheus/.test(explain) && /convert/i.test(explain), true);
});

test('temporality: a restart resets a cumulative counter, and the new start time says so', () => {
  const right = rightOf('temporality', 'temp-restart');
  assert.equal(right.key, 'reset');
  assert.equal(/start time/.test(right.why) && /zero/.test(right.why), true);
  const wrong = choiceOf('temporality', 'temp-restart').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['negative', 'survives']);
});

test('temporality: Dash0 accepts both temporalities and you query with PromQL (no conversion needed for Dash0)', () => {
  const right = rightOf('temporality', 'temp-dash0');
  assert.equal(right.key, 'both');
  assert.equal(/both/.test(right.label) && /PromQL/.test(right.label), true);
  for (const c of choiceOf('temporality', 'temp-dash0').filter((x) => !x.right)) {
    assert.equal(/Dash0 accepts both/.test(c.why), true, `${c.key} is corrected with what Dash0 does`);
  }
});

// ---- 3.3 Histograms and 3.4 PromQL basics: the Query it steps -------------------------

const queryOf = (levelId, widgetId) => stepOf(levelId, 'query', widgetId);
const keysOf = (levelId) => LIVE.levels[levelId].play.steps.map((st) => ['choice', 'query'].find((k) => st[k]));
/** Grade `text` as a learner's answer to the step: `{ok}` or `{ok: false, reason}`. */
const grade = (spec, text) => gradeQuery(spec.dataset, spec.at, text, spec.reference);
const valueOf = (spec, text = spec.reference) => {
  const r = evaluate(getDataset(spec.dataset), spec.at, text);
  return r.series.map((x) => [x.labels, x.value]);
};
const LE_TEXT = (name) =>
  getDataset('checkout-http')
    .series.filter((x) => x.labels.__name__ === name && x.labels.route === '/pay' && x.labels.service === 'checkout')
    .map((x) => x.labels.le);

test('3.3 and 3.4: every query step reads a registered dataset inside its range, and its reference passes itself', () => {
  for (const [level, ids] of [['histograms', ['hist-avg', 'hist-p99', 'hist-p95']], ['promql-basics', ['pql-rate', 'pql-increase']]]) {
    for (const id of ids) {
      const spec = queryOf(level, id);
      const data = getDataset(spec.dataset);
      assert.equal(spec.at >= data.meta.start && spec.at <= data.meta.end, true, `${id} at ${spec.at}`);
      assert.equal(grade(spec, spec.reference).ok, true, id);
    }
  }
  assert.deepEqual(keysOf('histograms'), ['choice', 'query', 'query', 'choice', 'query']);
  assert.deepEqual(keysOf('promql-basics'), ['choice', 'choice', 'query', 'query', 'choice']);
});

// ---- 3.3 Histograms ------------------------------------------------------------------

test('histograms: the average is a rate of _sum over a rate of _count, and the increase form is the same answer', () => {
  const spec = queryOf('histograms', 'hist-avg');
  const [[labels, mean]] = valueOf(spec);
  assert.deepEqual(labels, {});
  assert.equal(Math.abs(mean - 0.831) < 1e-6, true, `mean ${mean}`);
  const B = 'http_server_request_duration_seconds';
  const alt = `sum(increase(${B}_sum{route="/pay"}[5m])) / sum(increase(${B}_count{route="/pay"}[5m]))`;
  assert.equal(grade(spec, alt).ok, true, 'increase over increase is the same mean');
  assert.equal(grade(spec, `sum(rate(${B}_sum{route="/pay"}[5m]))`).reason, 'wrong-values', 'the rate of the sum alone is not a mean');
  assert.equal(grade(spec, `sum(rate(${B}_sum[5m])) / sum(rate(${B}_count[5m]))`).reason, 'wrong-values', 'all routes is a different mean');
});

test('histograms: the p99 is histogram_quantile over summed bucket rates, and a plain rate without sum by le is a different shape', () => {
  const spec = queryOf('histograms', 'hist-p99');
  const B = 'http_server_request_duration_seconds_bucket';
  assert.equal(/histogram_quantile\(0\.99,/.test(spec.reference) && /rate\([^)]*_bucket/.test(spec.reference), true);
  assert.equal(grade(spec, `histogram_quantile(0.99, sum(rate(${B}{route="/pay"}[5m])) by (le))`).ok, true, 'by after the argument');
  assert.equal(grade(spec, `histogram_quantile(0.99, sum by (le) (increase(${B}{route="/pay"}[5m])))`).ok, true, 'increase gives the same quantile');
  assert.equal(grade(spec, `histogram_quantile(0.99, rate(${B}{route="/pay"}[5m]))`).reason, 'wrong-labels', 'no sum: route and service stay as labels');
  assert.equal(grade(spec, `histogram_quantile(0.5, sum by (le) (rate(${B}{route="/pay"}[5m])))`).reason, 'wrong-values', 'p50 is not p99');
  assert.equal(grade(spec, `histogram_quantile(0.99, sum by (le) (rate(${B}[5m])))`).reason, 'wrong-values', 'all routes is not /pay');
});

test('histograms: the p99 reads exactly the top finite bucket bound, three times the mean (the nuance the buckets step grades)', () => {
  const avg = valueOf(queryOf('histograms', 'hist-avg'))[0][1];
  const p99 = valueOf(queryOf('histograms', 'hist-p99'))[0][1];
  const bounds = LE_TEXT('http_server_request_duration_seconds_bucket');
  const finite = bounds.filter((b) => b !== '+Inf').map(Number);
  assert.equal(p99, Math.max(...finite), 'a quantile inside +Inf answers the second highest bound');
  assert.equal(p99 / avg > 2.9 && p99 / avg < 3.1, true, `p99 ${p99} over mean ${avg}`);
  // the buckets step names these boundaries; they must be the dataset's
  const intro = plain(LIVE.levels.histograms.play.steps[3].intro);
  assert.equal(intro.includes(`${finite.slice(0, -1).join(', ')} and ${finite.at(-1)} seconds, then +Inf`), true, intro);
  assert.equal(plain(LIVE.levels.histograms.play.steps[3].question).includes(String(p99)), true);
  assert.equal(plain(queryOf('histograms', 'hist-avg').explain).includes('0.83'), true);
});

test('histograms: the buckets step grades the nuance: a p99 on the top bound is a floor, and the average is not the number to trust', () => {
  const right = rightOf('histograms', 'hist-buckets');
  assert.equal(right.key, 'top-bucket');
  const text = plain(right.label + right.why);
  for (const w of ['at least 2.5', '+Inf', 'second highest', 'exponential', '0 to 10000', '(0, 5]']) assert.equal(text.includes(w), true, w);
  const wrong = choiceOf('histograms', 'hist-buckets').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['exact-p99', 'trust-average']);
  assert.equal(/diluted|sum divided by a count/.test(wrong.find((c) => c.key === 'trust-average').why), true, 'why the average hid it');
});

test('histograms: the boundary teaching names the semconv advisory for http.server.request.duration, not just the bare SDK default', () => {
  const why = plain(rightOf('histograms', 'hist-buckets').why);
  for (const w of ['http.server.request.duration', 'semantic conventions', '0.005 to 10', 'which the SDK uses', 'set the boundaries yourself']) {
    assert.equal(why.includes(w), true, w);
  }
  const back = DECK.find((c) => c.id === 'averages-hide-tails').back;
  assert.equal(back.includes('http.server.request.duration') && back.includes('0.005 to 10'), true, 'the card says it too');
  const intro = plain(LIVE.levels.histograms.play.steps[3].intro);
  assert.equal(/stop at 2\.5 seconds/.test(intro) && /narrower than the semantic conventions/.test(intro), true, 'this level\'s buckets are narrower than the advisory');
});

test('histograms: explicit vs exponential is graded: scale and relative error, not exactness, and backend support varies', () => {
  const right = rightOf('histograms', 'hist-kind');
  assert.equal(right.key, 'exponential');
  const text = plain(right.label + right.why);
  for (const w of ['scale', 'relative error', 'no list to pick', 'dropped or converted']) assert.equal(text.includes(w), true, w);
  const wrong = choiceOf('histograms', 'hist-kind').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['exact', 'fixed']);
  assert.equal(/estimate/.test(wrong.find((c) => c.key === 'exact').why), true, 'a percentile from buckets is an estimate');
  assert.equal(/first or last bucket/.test(wrong.find((c) => c.key === 'fixed').why), true, 'explicit boundaries are fixed');
  assert.equal(/native/i.test(text), false, 'no exponential = native claim in the player copy');
});

test('histograms: the Dash0 tie-in is a per-service p95 with histogram_quantile, one series per service', () => {
  const spec = queryOf('histograms', 'hist-p95');
  const rows = valueOf(spec);
  assert.deepEqual(rows.map(([l]) => l), [{ service: 'cart' }, { service: 'checkout' }]);
  assert.equal(Math.abs(rows[1][1] - 1.5) < 1e-6 && Math.abs(rows[0][1] - 0.238) < 1e-6, true, JSON.stringify(rows));
  const B = 'http_server_request_duration_seconds_bucket';
  assert.equal(grade(spec, `histogram_quantile(0.95, sum(rate(${B}[5m])) by (service, le))`).ok, true);
  assert.equal(grade(spec, `histogram_quantile(0.95, sum by (le) (rate(${B}[5m])))`).reason, 'wrong-count', 'no service: one series, not two');
  assert.equal(grade(spec, `histogram_quantile(0.99, sum by (service, le) (rate(${B}[5m])))`).reason, 'wrong-values', 'p99 is not p95');
  const dash0 = plain(spec.explain + LIVE.levels.histograms.play.steps[4].intro);
  assert.equal(/Dash0/.test(dash0) && /PromQL/.test(dash0) && /histogram_quantile/.test(dash0), true);
});

// ---- 3.4 PromQL basics ---------------------------------------------------------------

/** The classic OTel -> Prometheus name: dots to underscores, a unit word, then the type suffix. */
const classicName = ({ name, unit, monotonicSum }) => {
  const word = { s: 'seconds', By: 'bytes' }[unit] ?? ''; // a unit in braces, like {request}, is dropped
  const base = name.replace(/[^a-zA-Z0-9_:]/g, '_');
  const withUnit = word && !base.endsWith(`_${word}`) ? `${base}_${word}` : base;
  return monotonicSum && !withUnit.endsWith('_total') ? `${withUnit}_total` : withUnit;
};
const codeOf = (c) => c.label.match(/<code>(.*)<\/code>/)[1];
const seriesNames = () => new Set(getDataset('checkout-http').series.map((x) => x.labels.__name__));

test('promql-basics: the right names are the classic translation, and they are series the dataset has', () => {
  const unit = rightOf('promql-basics', 'pql-unit');
  assert.equal(unit.key, 'seconds-bucket');
  const hist = classicName({ name: 'http.server.request.duration', unit: 's' });
  assert.equal(codeOf(unit), `${hist}_bucket`);
  const total = rightOf('promql-basics', 'pql-total');
  assert.equal(total.key, 'total');
  assert.equal(codeOf(total), classicName({ name: 'http.server.requests', unit: '{request}', monotonicSum: true }));
  for (const name of [codeOf(unit), codeOf(total)]) assert.equal(seriesNames().has(name), true, name);
  // every wrong name is not a series, so choosing it would give an empty graph
  for (const id of ['pql-unit', 'pql-total']) {
    for (const c of choiceOf('promql-basics', id).filter((x) => !x.right)) {
      assert.equal(seriesNames().has(codeOf(c)), false, `${id}/${c.key} ${codeOf(c)}`);
    }
  }
});

test('promql-basics: the name nuance is stated so it stays true: classic translation, backend settings, units in braces', () => {
  const steps = LIVE.levels['promql-basics'].play.steps;
  assert.equal(/classic translation/.test(plain(steps[0].question)), true, 'the question says which translation');
  const unit = plain(rightOf('promql-basics', 'pql-unit').why);
  for (const w of ['classic translation', 'UTF-8', 'check what yours does', '_seconds', '_sum', '_count']) assert.equal(unit.includes(w), true, w);
  const total = plain(rightOf('promql-basics', 'pql-total').why);
  for (const w of ['_total', 'monotonic', 'braces']) assert.equal(total.includes(w), true, w);
  assert.equal(/\bdots?\b.*(underscore)/.test(plain(choiceOf('promql-basics', 'pql-unit').find((c) => c.key === 'dotted').why)), true);
});

test('promql-basics: sum by (route) over a rate: one series per route, and equivalent forms pass', () => {
  const spec = queryOf('promql-basics', 'pql-rate');
  const rows = valueOf(spec);
  assert.deepEqual(rows.map(([l]) => l), [{ route: '/pay' }, { route: '/quote' }]);
  assert.equal(Math.abs(rows[0][1] - 1) < 1e-6 && rows[1][1] === 0, true, `${JSON.stringify(rows)}: a real 0 stays a 0`);
  const C = 'http_server_requests_total';
  assert.equal(grade(spec, `sum(rate(${C}{service="checkout",status="500"}[5m])) by (route)`).ok, true, 'by after the argument');
  assert.equal(grade(spec, `sum by (route) (rate(${C}{service="checkout",status=~"5.."}[5m]))`).ok, true, 'a regex on the status');
  assert.equal(grade(spec, `sum by (route) (rate(${C}{service="checkout",status="500"}[10m]))`).ok, true, 'a steady rate reads the same over 10m');
  assert.equal(grade(spec, `sum by (route) (rate(${C}{status="500"}[5m]))`).reason, 'wrong-count', 'cart routes join in without the service');
  assert.equal(grade(spec, `sum by (route) (${C}{service="checkout",status="500"})`).reason, 'wrong-values', 'the raw counter is not a rate');
  assert.equal(grade(spec, `sum(rate(${C}{service="checkout",status="500"}[5m]))`).reason, 'wrong-count', 'no by: one series');
});

test('promql-basics: increase over a window with a restart equals rate times the window, and the range matters', () => {
  const spec = queryOf('promql-basics', 'pql-increase');
  const data = getDataset(spec.dataset);
  assert.equal(spec.at > data.meta.deployAt && spec.at - 600 < data.meta.deployAt, true, 'the window contains the restart');
  const [[labels, total]] = valueOf(spec);
  assert.deepEqual(labels, {});
  assert.equal(total > 2300 && total < 2400, true, `increase ${total}`);
  assert.equal(plain(spec.explain).includes('2,338'), true);
  const C = 'http_server_requests_total{route="/pay"}';
  assert.equal(grade(spec, `sum(rate(${C}[10m])) * 600`).ok, true, 'rate times the window');
  assert.equal(grade(spec, `sum(increase(${C}[10m]))`).ok, true);
  assert.equal(grade(spec, `sum(increase(${C}[5m]))`).reason, 'wrong-values', 'the range is graded');
  assert.equal(grade(spec, `sum(rate(${C}[10m]))`).reason, 'wrong-values', 'a rate is not a count');
  assert.equal(grade(spec, `sum(increase(${C}[10m])) by (status)`).reason, 'wrong-count', 'by status gives two series');
});

test('promql-basics: the Dash0 tie-in is graded: both names, otel_metric_name, and logs and spans as synthetic metrics', () => {
  const right = rightOf('promql-basics', 'pql-dash0');
  assert.equal(right.key, 'both-names');
  const text = plain(right.label + right.why);
  for (const w of ['otel_metric_name', 'dash0.logs', 'dash0.spans', 'same PromQL']) assert.equal(text.includes(w), true, w);
  const wrong = choiceOf('promql-basics', 'pql-dash0').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['metrics-only', 'translated-only']);
  assert.equal(/otel_metric_name/.test(wrong.find((c) => c.key === 'translated-only').why), true);
  assert.equal(/dash0\.logs/.test(wrong.find((c) => c.key === 'metrics-only').why), true);
  const step = LIVE.levels['promql-basics'].play.steps[4];
  assert.equal(step.code.includes('otel_metric_name="http.server.requests"'), true, 'the shown selector is the one the intro explains');
});

// ---- both levels --------------------------------------------------------------------

test('the Act 3 level files cite the metrics spec pages their facts come from', () => {
  const urls = (f) => read(`levels/${f}.mjs`).split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(urls('instruments').some((u) => u.startsWith('https://opentelemetry.io/docs/specs/otel/metrics/api/')), true);
  assert.equal(urls('temporality').some((u) => u.startsWith('https://opentelemetry.io/docs/specs/otel/metrics/data-model/')), true);
  const prom = (f) => urls(f).filter((u) => u.startsWith('https://prometheus.io/'));
  assert.equal(urls('histograms').some((u) => u.startsWith('https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exponentialhistogram')), true);
  assert.equal(prom('histograms').some((u) => u.endsWith('#histogram_quantile')), true);
  assert.equal(urls('promql-basics').some((u) => u.startsWith('https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/')), true);
  assert.deepEqual(prom('promql-basics').map((u) => u.split('#')[1]).filter(Boolean).sort(), ['aggregation-operators', 'increase', 'rate']);
  for (const f of ['instruments', 'temporality', 'histograms', 'promql-basics']) {
    const src = read(`levels/${f}.mjs`);
    assert.equal(/\bthe spec says\b/i.test(src), false, f);
  }
});

// ---- 3.5 Cardinality ------------------------------------------------------------------

// How many values each attribute takes, written out here a second time (the level computes every
// number it shows from its own table; this one is the independent check).
const COUNTS = { method: 5, route: 14, status: 9, tier: 3, user: 31402, path: 48211 };
const prod = (...ks) => ks.reduce((a, k) => a * COUNTS[k], 1);
const grouped = (n) => n.toLocaleString('en-US');
const budget = () => stepOf('cardinality', 'tradeoff', 'cdn-budget');
const spotOf = () => stepOf('cardinality', 'spot', 'cdn-spot');
const cdnKeys = () => LIVE.levels.cardinality.play.steps.map((st) => ['choice', 'spot', 'tradeoff'].find((k) => st[k]));

test('cardinality: the steps are choice, spot, tradeoff, choice', () => {
  assert.deepEqual(cdnKeys(), ['choice', 'spot', 'tradeoff', 'choice']);
});

test('cardinality: series are every label combination, so the bound is the product, and a sum is the wrong answer', () => {
  const right = rightOf('cardinality', 'cdn-combos');
  assert.equal(right.key, 'product');
  assert.equal(plain(right.label), `5 × 14 × 9 = ${prod('method', 'route', 'status')}`);
  assert.equal(prod('method', 'route', 'status'), 630);
  const sum = choiceOf('cardinality', 'cdn-combos').find((c) => c.key === 'sum');
  assert.equal(plain(sum.label).startsWith(`5 + 14 + 9 = ${5 + 14 + 9}`), true, plain(sum.label));
  assert.equal(plain(right.why).includes(`${grouped(prod('method', 'route', 'status', 'user'))}`), true, 'the user.id multiplication is stated, and exact');
  assert.equal(prod('method', 'route', 'status', 'user'), 19783260);
  assert.equal(/most|upper|worst/.test(plain(right.why)), true, 'the product is a bound, not a count');
  const intro = plain(LIVE.levels.cardinality.play.steps[0].intro);
  for (const w of ['5 values', '14 routes', '9 codes']) assert.equal(intro.includes(w), true, w);
});

test('cardinality: the spotted attributes are exactly the unbounded ones; the bounded ones say why they are fine', () => {
  const spec = spotOf();
  assert.deepEqual([...spec.faults].sort(), ['request-id', 'url-path', 'user-id']);
  const text = (id) => spec.lines.find((l) => l.id === id).text;
  assert.equal(/url_path="\/recommendations\/\d+"/.test(text('url-path')), true, 'a raw URL with an id in it');
  assert.equal(text('route').includes('http_route="/recommendations/{id}"'), true, 'the template, not the URL');
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['method', 'port', 'region', 'route', 'status']);
  assert.equal(/low-cardinality/.test(plain(spec.whyNot.route)) && /placeholder/.test(plain(spec.whyNot.route)), true);
  assert.equal(/_OTHER/.test(plain(spec.whyNot.method)), true);
  assert.equal(/not what they look like/.test(plain(spec.whyNot.status)), true, 'a number-looking attribute is not the problem');
  // #190: a digit-heavy decoy, so "the lines with the most digits" is not the answer.
  assert.equal(/\d.*\d.*\d.*\d/.test(text('port')), true, 'the port id carries four digits');
  assert.equal(/not how many digits it has/.test(plain(spec.whyNot.port)), true, 'a digit-heavy id is not the problem');
  assert.equal(/short, published list of regions/.test(plain(spec.whyNot.region)), true);
});

test('cardinality: the spot step teaches the nuance: http.route, the Prometheus guidance and the SDK overflow', () => {
  const t = plain(spotOf().explain);
  for (const w of ['http.route', '/recommendations/{id}', 'unbounded values such as user IDs', '2,000 per metric', 'otel.metric.overflow']) assert.equal(t.includes(w), true, w);
});

test('cardinality: every budget cost is the product of the values of the attributes kept, and the labels show that arithmetic', () => {
  const spec = budget();
  const cost = (knob, option) => spec.knobs.find((k) => k.id === knob).options.find((o) => o.id === option).cost;
  const label = (knob, option) => plain(spec.knobs.find((k) => k.id === knob).options.find((o) => o.id === option).label);
  assert.equal(cost('requests', 'none'), 1, 'a counter with no attributes is one series');
  assert.equal(cost('requests', 'route-status'), 14 * 9);
  assert.equal(cost('requests', 'path-status'), 48211 * 9);
  assert.equal(cost('served', 'none'), 1);
  assert.equal(cost('served', 'tier'), 3);
  assert.equal(cost('served', 'user'), 31402);
  assert.equal(cost('customer', 'span-attribute'), 0, 'a span attribute is not a metric series');
  assert.equal(label('requests', 'route-status').endsWith('14 × 9 = 126'), true, label('requests', 'route-status'));
  assert.equal(label('requests', 'path-status').endsWith('48,211 × 9 = 433,899'), true, label('requests', 'path-status'));
  assert.equal(label('served', 'user').endsWith(': 31,402'), true);
  assert.equal(433899, prod('path', 'status'), 'the arithmetic shown is the arithmetic');
  assert.equal(spec.cap, 500);
  assert.equal(spec.unit, 'series');
});

test('cardinality: the budget is a real trade-off with one right plan: 129 of 500 series, keeping all three needs', () => {
  const spec = budget();
  const plans = allPlans(spec).map((picks) => ({ picks, ...evaluatePlan(spec, picks) }));
  const passing = plans.filter((p) => p.over === 0 && p.lost.length === 0);
  assert.deepEqual(passing.map((p) => p.picks), [{ requests: 'route-status', served: 'tier', customer: 'span-attribute' }], 'exactly one plan passes');
  assert.equal(passing[0].total, 126 + 3 + 0);
  assert.equal(passing[0].total, 129);
  const cheap = evaluatePlan(spec, { requests: 'none', served: 'none', customer: 'nothing' });
  assert.deepEqual([cheap.total, cheap.over, cheap.lost.length], [2, 0, 3], 'the cheapest plan is far under the cap and drops all three needs');
  const full = evaluatePlan(spec, { requests: 'path-status', served: 'tier', customer: 'span-attribute' });
  assert.deepEqual([full.total, full.over, full.lost.length], [433899 + 3, 433899 + 3 - 500, 0], 'a raw URL keeps every need and is over the cap');
  const user = evaluatePlan(spec, { requests: 'route-status', served: 'user', customer: 'span-attribute' });
  assert.deepEqual([user.total, user.over > 0, user.lost], [126 + 31402, true, ['served-by-tier']], 'a user id on the metric is over the cap and still has no tier');
  assert.equal(plans.some((p) => p.over === 0 && p.lost.length > 0), true);
  assert.equal(plans.some((p) => p.over > 0 && p.lost.length === 0), true);
});

test('cardinality: the budget explains itself with exact figures and says spans have a cost of their own', () => {
  const spec = budget();
  const t = plain(spec.explain);
  for (const w of ['129 of 500 series', '126 for the route and status counter', '3 for the tier counter', 'route template', 'Spans have their own volume and cost']) assert.equal(t.includes(w), true, w);
  assert.equal(plain(spec.whyNot['requests:path-status']).includes('433,899 series'), true);
  assert.equal(plain(spec.whyNot['served:user']).includes('31,402 users'), true);
  assert.equal(/span/.test(plain(spec.whyNot['served:user'])), true, 'the user id belongs on a span');
});

test('cardinality: the Dash0 tie-in is graded: fix the source, and a spam filter drops whole points but is not free', () => {
  const right = rightOf('cardinality', 'cdn-dash0');
  assert.equal(right.key, 'fix-source');
  const t = plain(right.label + right.why);
  for (const w of ['tree map', 'instrumentation layer', 'cannot be recovered', 'ingest charge', 'not what you send', 'Collector filter processor']) assert.equal(t.includes(w), true, w);
  const wrong = choiceOf('cardinality', 'cdn-dash0').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['leave', 'spam-attribute', 'spam-free']);
  assert.equal(/does not strip one attribute/.test(plain(wrong.find((c) => c.key === 'spam-attribute').why)), true);
  assert.equal(/ingest charge/.test(plain(wrong.find((c) => c.key === 'spam-free').why)), true);
  assert.equal(/prompt to ask/.test(plain(wrong.find((c) => c.key === 'leave').why)), true);
  const intro = plain(LIVE.levels.cardinality.play.steps[3].intro);
  assert.equal(intro.includes('tree map') && intro.includes('spam filters'), true);
});

// ---- 3.7 RED and USE -------------------------------------------------------------------

const ruQuery = (id) => queryOf('red-and-use', id);
const SERVER_KIND = 'span_kind="SPAN_KIND_SERVER"';
const CALLS = 'traces_span_metrics_calls_total';
const DURATION = 'traces_span_metrics_duration_milliseconds_bucket';
const byService = (spec, text = spec.reference) => Object.fromEntries(valueOf(spec, text).map(([l, v]) => [l.service_name ?? JSON.stringify(l), v]));
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('red-and-use: the steps are choice, choice, choice, query, query, query, choice', () => {
  assert.deepEqual(keysOf('red-and-use'), ['choice', 'choice', 'choice', 'query', 'query', 'query', 'choice']);
});

test('red-and-use: RED reads a service and USE reads a resource, and the swaps are named as swaps', () => {
  const right = rightOf('red-and-use', 'ru-methods');
  assert.equal(right.key, 'red-services-use-resources');
  const t = plain(right.label);
  for (const w of ['Rate, Errors, Duration', 'Utilisation, Saturation, Errors', 'CPU or a disk']) assert.equal(t.includes(w), true, w);
  assert.deepEqual(choiceOf('red-and-use', 'ru-methods').filter((c) => !c.right).map((c) => c.key).sort(), ['red-everything', 'swapped']);
  assert.equal(/microservices/.test(plain(choiceOf('red-and-use', 'ru-methods').find((c) => c.key === 'red-everything').why)), true);
});

test('red-and-use: saturation is the queue, not the utilisation, because an average hides bursts', () => {
  const right = rightOf('red-and-use', 'ru-saturation');
  assert.equal(right.key, 'saturation');
  assert.equal(/run-queue length|run queue/.test(plain(right.label + right.why)), true);
  assert.equal(/average/.test(plain(right.why)), true);
  const util = choiceOf('red-and-use', 'ru-saturation').find((c) => c.key === 'utilisation');
  for (const w of ['five-minute average', '100%', 'seconds at a time']) assert.equal(plain(util.why).includes(w), true, w);
  assert.equal(/five minutes/.test(plain(LIVE.levels['red-and-use'].play.steps[1].intro)), true, 'the intro sets up the same five-minute average');
});

test('red-and-use: the spanmetrics connector is graded: calls and duration, names, unit, feature gate, and a connector is not a processor', () => {
  const right = rightOf('red-and-use', 'ru-connector');
  assert.equal(right.key, 'spanmetrics');
  const t = plain(right.label + right.why);
  for (const w of ['traces pipeline', 'metrics pipeline', 'traces.span.metrics.calls', 'traces.span.metrics.duration', 'milliseconds by default', 'connector.spanmetrics.legacyMetricNames', 'span_metrics', 'check what your version emits']) assert.equal(t.includes(w), true, w);
  const wrong = choiceOf('red-and-use', 'ru-connector').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['errors-metric', 'processor', 'raw-url']);
  assert.equal(/STATUS_CODE_ERROR/.test(plain(wrong.find((c) => c.key === 'errors-metric').why)) && /otel\.status_code/.test(plain(wrong.find((c) => c.key === 'errors-metric').why)), true);
  const raw = plain(wrong.find((c) => c.key === 'raw-url').why);
  for (const w of ['http.route', 'must not default to the URI path', 'aggregation_cardinality_limit', 'cardinality of 3.5']) assert.equal(raw.includes(w), true, w);
});

test('red-and-use: the dataset and the queries use the names the connector gives, translated as 3.4 taught', () => {
  /** The 3.4 translation: dots to underscores, then the unit word if there is one, then _total for a monotonic sum. */
  const promName = ({ name, unit, monotonicSum }) => {
    const base = name.replace(/[^a-zA-Z0-9_:]/g, '_');
    const word = { ms: 'milliseconds' }[unit];
    const withUnit = word ? `${base}_${word}` : base;
    return monotonicSum ? `${withUnit}_total` : withUnit;
  };
  const names = new Set(getDataset('checkout-spanmetrics').series.map((x) => x.labels.__name__));
  assert.equal(names.has(promName({ name: 'traces.span.metrics.calls', monotonicSum: true })), true);
  assert.equal(names.has(`${promName({ name: 'traces.span.metrics.duration', unit: 'ms' })}_bucket`), true);
  assert.equal(promName({ name: 'traces.span.metrics.calls', monotonicSum: true }), CALLS);
  const intro = plain(LIVE.levels['red-and-use'].play.steps[3].intro);
  assert.equal(intro.includes('traces.span.metrics.calls') && intro.includes(CALLS), true);
  assert.equal(plain(LIVE.levels['red-and-use'].play.steps[5].intro).includes(DURATION), true);
});

test('red-and-use: every query step reads a registered dataset inside its range, and its reference passes itself', () => {
  for (const id of ['ru-rate', 'ru-errors', 'ru-duration']) {
    const spec = ruQuery(id);
    const data = getDataset(spec.dataset);
    assert.equal(spec.dataset, 'checkout-spanmetrics', id);
    assert.equal(spec.at >= data.meta.start && spec.at <= data.meta.end, true, `${id} at ${spec.at}`);
    assert.equal(grade(spec, spec.reference).ok, true, id);
  }
});

test('red-and-use: rate is 12 and 16 requests per second, and equivalent forms pass while counting CLIENT spans does not', () => {
  const spec = ruQuery('ru-rate');
  const v = byService(spec);
  assert.deepEqual(Object.keys(v).sort(), ['cart', 'checkout']);
  assert.equal(near(v.checkout, 12) && near(v.cart, 16), true, JSON.stringify(v));
  assert.equal(plain(spec.explain).includes('12 requests per second and cart 16'), true);
  assert.equal(grade(spec, `sum by (service_name) (rate(${CALLS}{span_kind!="SPAN_KIND_CLIENT"}[5m]))`).ok, true, 'not CLIENT');
  assert.equal(grade(spec, `sum by (service_name) (rate(${CALLS}{span_kind=~"SPAN_KIND_SERVER"}[10m]))`).ok, true, 'a steady rate over 10m, with a regex');
  assert.equal(grade(spec, `sum by (service_name) (increase(${CALLS}{${SERVER_KIND}}[5m])) / 300`).ok, true, 'increase over the window');
  assert.equal(near(byService(spec, `sum by (service_name) (rate(${CALLS}[5m]))`).checkout, 16), true, 'without the span kind checkout reads 16');
  assert.equal(grade(spec, `sum by (service_name) (rate(${CALLS}[5m]))`).reason, 'wrong-values');
  assert.equal(grade(spec, `sum(rate(${CALLS}{${SERVER_KIND}}[5m]))`).reason, 'wrong-count', 'no by: one series');
  assert.equal(grade(spec, `sum by (span_name) (rate(${CALLS}{${SERVER_KIND}}[5m]))`).reason, 'wrong-count');
  assert.equal(grade(spec, `sum by (service_name) (${CALLS}{${SERVER_KIND}})`).reason, 'wrong-values', 'the raw counter is not a rate');
});

test('red-and-use: the error ratio is 1 in 12 and 1 in 240; a success is UNSET, so an OK filter matches nothing', () => {
  const spec = ruQuery('ru-errors');
  const v = byService(spec);
  assert.equal(near(v.checkout, 1 / 12) && near(v.cart, 1 / 240), true, JSON.stringify(v));
  assert.equal(plain(spec.explain).includes('1 request in 12, about 8.3%'), true);
  assert.equal(plain(spec.explain).includes('1 in 240, about 0.4%'), true);
  assert.equal(Math.round((1 / 12) * 1000) / 10, 8.3);
  assert.equal(Math.round((1 / 240) * 1000) / 10, 0.4);
  const E = `sum by (service_name) (rate(${CALLS}`;
  const all = `${E}{${SERVER_KIND}}[5m]))`;
  assert.equal(grade(spec, `${E}{${SERVER_KIND}, status_code!="STATUS_CODE_UNSET"}[5m])) / ${all}`).ok, true, 'not UNSET is the same set here');
  assert.equal(grade(spec, `${E}{${SERVER_KIND}, status_code=~".*ERROR"}[5m])) / ${all}`).ok, true);
  assert.equal(grade(spec, `${E}{${SERVER_KIND}, status_code="STATUS_CODE_OK"}[5m])) / ${all}`).reason, 'empty', 'no series says OK');
  assert.equal(grade(spec, `${E}{${SERVER_KIND}, status_code="STATUS_CODE_ERROR"}[5m])) / ${E}{${SERVER_KIND}, status_code="STATUS_CODE_UNSET"}[5m]))`).reason, 'wrong-values', 'against the unset calls, not all of them');
  assert.equal(grade(spec, `${E}{${SERVER_KIND}, status_code="STATUS_CODE_ERROR"}[5m]))`).reason, 'wrong-values', 'errors per second, not a ratio');
  assert.equal(grade(spec, `${E}{status_code="STATUS_CODE_ERROR"}[5m])) / ${E}[5m]))`).reason, 'wrong-values', 'CLIENT spans included');
});

test('red-and-use: the p95 is 1,500 and 238 milliseconds, the p95 of 3.3 from spans, and the span kind and quantile are graded', () => {
  const spec = ruQuery('ru-duration');
  const v = byService(spec);
  assert.equal(near(v.checkout, 1500) && near(v.cart, 238), true, JSON.stringify(v));
  const h3 = valueOf(queryOf('histograms', 'hist-p95'));
  const seconds = Object.fromEntries(h3.map(([l, x]) => [l.service, x]));
  assert.equal(near(seconds.checkout * 1000, v.checkout), true, '3.3 found 1.5 seconds for checkout');
  assert.equal(Math.abs(seconds.cart * 1000 - v.cart) < 1, true, '3.3 found about 0.24 seconds for cart');
  const B = `rate(${DURATION}{${SERVER_KIND}}[5m])`;
  assert.equal(grade(spec, `histogram_quantile(0.95, sum by (service_name, le) (rate(${DURATION}{span_kind=~"SPAN_KIND_SERVER"}[10m])))`).ok, true, 'a steady rate over 10m');
  assert.equal(grade(spec, `histogram_quantile(0.99, sum by (service_name, le) (${B}))`).reason, 'wrong-values', 'p99 is not p95');
  assert.equal(grade(spec, `histogram_quantile(0.95, sum by (service_name, le) (rate(${DURATION}[5m])))`).reason, 'wrong-values', 'the CLIENT span moves checkout');
  assert.equal(grade(spec, `histogram_quantile(0.95, sum by (le) (${B}))`).reason, 'wrong-count', 'no service: one series');
  assert.equal(grade(spec, `histogram_quantile(0.95, sum by (service_name, le) (${B})) / 1000`).reason, 'wrong-values', 'seconds are not milliseconds');
});

test('red-and-use: the Dash0 tie-in is graded: RED derived from spans, not billed as custom, bounded by operation name', () => {
  const right = rightOf('red-and-use', 'ru-dash0');
  assert.equal(right.key, 'derived');
  const t = plain(right.label + right.why);
  for (const w of ['dash0.spans.red', 'Service Catalog and Service Map', 'not billed as a custom metric', 'status code ERROR', 'GET /users/{id}', 'cardinality bounded']) assert.equal(t.includes(w), true, w);
  const wrong = choiceOf('red-and-use', 'ru-dash0').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['connector-needed', 'service-metrics']);
  assert.equal(/derivation itself/.test(plain(wrong.find((c) => c.key === 'connector-needed').why)), true);
  assert.equal(/still gets rate, errors and duration/.test(plain(wrong.find((c) => c.key === 'service-metrics').why)), true);
});

test('3.5 and 3.7 cite the pages their facts come from, and the sources that are not on the spec hosts are named as sources', () => {
  const lines = (f) => read(`levels/${f}.mjs`).split('\n');
  const urls = (f) => lines(f).filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  const has = (f, prefix) => urls(f).some((u) => u.startsWith(prefix));
  for (const prefix of [
    'https://opentelemetry.io/docs/specs/otel/metrics/sdk/#cardinality-limits',
    'https://opentelemetry.io/docs/specs/otel/metrics/supplementary-guidelines/',
    'https://opentelemetry.io/docs/specs/semconv/http/http-metrics/',
    'https://opentelemetry.io/docs/specs/semconv/http/http-spans/',
    'https://prometheus.io/docs/practices/naming/#labels',
    'https://prometheus.io/docs/practices/instrumentation/#do-not-overuse-labels',
  ]) assert.equal(has('cardinality', prefix), true, prefix);
  for (const prefix of ['https://opentelemetry.io/docs/collector/components/connector/', 'https://opentelemetry.io/docs/specs/semconv/http/http-spans/']) assert.equal(has('red-and-use', prefix), true, prefix);
  const src = lines('red-and-use').filter((l) => /^\/\/ Source/.test(l)).join('\n');
  for (const u of ['connector/spanmetricsconnector/README.md', 'https://www.brendangregg.com/usemethod.html', 'the-red-method-how-to-instrument-your-services']) assert.equal(src.includes(u), true, u);
  const dash0 = (f) => lines(f).filter((l) => /^\/\/ Dash0 docs: /.test(l)).join('\n');
  assert.equal(dash0('cardinality').includes('identify-high-cardinality-metrics') && dash0('cardinality').includes('cost-control/spam-filters'), true);
  assert.equal(dash0('red-and-use').includes('monitoring/services/built-in-metrics'), true);
});

test('cardinality: the budget intro says what a plan costs without calling the span attribute a metric', () => {
  const steps = LIVE.levels.cardinality.play.steps;
  const intro = plain(steps[2].intro);
  assert.equal(intro.includes('A plan costs the sum of the series of its metrics; a span attribute is not a metric series, so it costs 0.'), true, intro);
  assert.equal(/three metrics/.test(intro + plain(steps[2].question)), false, 'only two of the three knobs are metrics');
  const knobs = budget().knobs;
  assert.deepEqual(knobs.map((k) => /<code>(?:http\.server\.requests|recommendations\.served)<\/code>/.test(k.label)), [true, true, false]);
});

// ---- 3.6 Exemplars -----------------------------------------------------------------------

const exmSpot = () => stepOf('exemplars', 'spot', 'exm-spot');
const exmKeys = () => LIVE.levels.exemplars.play.steps.map((st) => ['choice', 'spot', 'tradeoff'].find((k) => st[k]));
/** What an exemplar looks like in the debug view, written here a second time from the level's own text. */
const EXEMPLAR = /exemplar: value=\d+\.\d+s trace_id=[0-9a-f]{32} span_id=[0-9a-f]{16}$/;
const spotGrade = (spec, ids) => {
  let state = newSpotState(spec);
  for (const id of ids) state = toggleLine(spec, state, id).state;
  const r = checkSpot(spec, state);
  return { outcome: r.outcome, extra: r.extra, missing: r.missing };
};

test('lights: 3.6 lights Payments and only that node; the card and the level are in the act-3 scoring rules', () => {
  const lit = (done) => {
    return litIds(LIVE, progressOf(done)).sort();
  };
  assert.deepEqual(lit(['exemplars']), ['payments']);
  const level = LIVE.levels.exemplars;
  assert.deepEqual([level.actId, level.kind, level.scored, level.scoring.parMs], ['act-3', 'level', true, null]);
  assert.equal(LIVE.acts.find((a) => a.id === 'act-3').levelIds.indexOf('exemplars'), LIVE.acts.find((a) => a.id === 'act-3').levelIds.indexOf('cardinality') + 1, 'after 3.5');
  assert.equal(LIVE.acts.find((a) => a.id === 'act-3').levelIds.indexOf('red-and-use'), LIVE.acts.find((a) => a.id === 'act-3').levelIds.indexOf('exemplars') + 1, 'before 3.7');
});

test('exemplars: the steps are spot, then choice, and the spot step modifies no widget (config target)', () => {
  assert.deepEqual(exmKeys(), ['spot', 'choice']);
  assert.equal(exmSpot().target, 'config');
});

test('exemplars: the faults are exactly the points whose text carries an exemplar, and the level has no Dash0 step', () => {
  const spec = exmSpot();
  const withExemplar = spec.lines.filter((l) => EXEMPLAR.test(l.text)).map((l) => l.id);
  assert.deepEqual([...spec.faults].sort(), withExemplar.sort());
  assert.deepEqual([...spec.faults].sort(), ['pay-0914-15', 'pay-0914-30', 'pay-0915-00']);
  assert.equal(spec.lines.length, 8);
  assert.deepEqual(Object.keys(spec.whyNot).sort(), spec.lines.map((l) => l.id).filter((id) => !spec.faults.includes(id)).sort(), 'every non-fault has its own whyNot');
  assert.equal(LIVE.levels.exemplars.play.steps.length, 2, 'the Dash0 tie-in is n/a: no exemplar page in the Dash0 docs');
});

test('exemplars: puzzle shortcuts fail the real grader: all, none, every line that mentions a trace id, the spike', () => {
  const spec = exmSpot();
  const ids = spec.lines.map((l) => l.id);
  assert.equal(spotGrade(spec, ids).outcome, 'wrong', 'every point');
  assert.deepEqual(spotGrade(spec, ids).missing, [], 'selecting all misses nothing but picks the others');
  assert.equal(spotGrade(spec, ids).extra.length, 5, 'and five points that carry no exemplar');
  assert.equal(spotGrade(spec, []).outcome, 'empty', 'no point');
  const mentionsTrace = spec.lines.filter((l) => /trace_id/.test(l.text)).map((l) => l.id);
  assert.equal(mentionsTrace.length, 4, 'three exemplars and the trace_id label');
  assert.equal(spotGrade(spec, mentionsTrace).outcome, 'wrong', 'a trace id in a label is not an exemplar');
  const sums = spec.lines.map((l) => [l.id, Number(/sum=(\d+\.\d+)s/.exec(l.text)?.[1] ?? 0)]);
  const spike = sums.filter(([, v]) => v > 30).map(([id]) => id);
  assert.deepEqual(spike.length, 3, 'three high points');
  assert.equal(spotGrade(spec, spike).outcome, 'wrong', 'the spike alone is not the answer: a spike does not bring an exemplar');
  assert.equal(spotGrade(spec, ['pay-0914-15']).outcome, 'wrong', 'a partial pick');
  assert.equal(spotGrade(spec, [...spec.faults]).outcome, 'right');
});

test('exemplars: one exemplar is on a point that is not on the spike, and one spike point has none', () => {
  const spec = exmSpot();
  const sum = (id) => Number(/sum=(\d+\.\d+)s/.exec(spec.lines.find((l) => l.id === id).text)[1]);
  assert.equal(sum('pay-0914-15') < 10, true, 'an exemplar on an ordinary point');
  assert.equal(sum('pay-0914-45') > 30 && !spec.faults.includes('pay-0914-45'), true, 'a spike point without one');
});

test('exemplars: the trace_id label and the scheduled job are named for what they are', () => {
  const spec = exmSpot();
  const t = (id) => plain(spec.whyNot[id]);
  assert.equal(/label/.test(t('pay-label')) && /series/.test(t('pay-label')) && /own field|beside the point/.test(t('pay-label')), true);
  assert.equal(/scheduler|job/.test(plain(spec.lines.find((l) => l.id === 'refund-batch').text + t('refund-batch'))), true);
  const e = plain(spec.explain);
  for (const w of ['trace_id', 'span_id', 'one measurement']) assert.equal(e.includes(w), true, w);
});

test('exemplars: the nuance is graded: only measurements recorded in a sampled span can become exemplars', () => {
  const right = rightOf('exemplars', 'exm-why');
  assert.equal(right.key, 'unsampled-or-no-span');
  const t = plain(right.label + right.why);
  for (const w of ['outside any span', 'not sampled', 'TraceBased', 'sampled span', 'OTEL_METRICS_EXEMPLAR_FILTER', 'always_on', 'always_off', 'reservoir']) assert.equal(t.includes(w), true, w);
  const wrong = choiceOf('exemplars', 'exm-why').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['backend-dropped', 'errors-only']);
  assert.equal(/AlwaysOn, AlwaysOff and TraceBased/.test(plain(wrong.find((c) => c.key === 'errors-only').why)), true);
  assert.equal(/SDK/.test(plain(wrong.find((c) => c.key === 'backend-dropped').why)) && /reservoir/.test(plain(wrong.find((c) => c.key === 'backend-dropped').why)), true);
  for (const c of choiceOf('exemplars', 'exm-why')) assert.equal(typeof c.why, 'string', c.key);
});

test('exemplars: every Spot it and Choice intro states the setting: head sampling and a spike on the payments histogram', () => {
  const steps = LIVE.levels.exemplars.play.steps;
  assert.equal(plain(steps[0].intro).includes('payments.charge.duration'), true);
  assert.equal(/sampl/.test(plain(steps[0].intro)), true, 'the intro says traces are sampled');
  assert.equal(plain(steps[1].question).startsWith('Why'), true);
});

test('exemplars: cites the OpenTelemetry pages its facts come from, says the Dash0 tie-in is n/a, and has no em dash', () => {
  const src = read('levels/exemplars.mjs');
  const urls = src.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  for (const prefix of [
    'https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exemplars',
    'https://opentelemetry.io/docs/specs/otel/metrics/sdk/#exemplar',
    'https://opentelemetry.io/docs/specs/otel/metrics/sdk/#exemplarfilter',
    'https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/#exemplar',
  ]) assert.equal(urls.includes(prefix), true, prefix);
  assert.equal(/Dash0 tie-in: n\/a/.test(src), true);
  assert.equal(src.includes('—'), false);
  assert.equal(read('cards/deck.mjs').includes('—'), false);
});
