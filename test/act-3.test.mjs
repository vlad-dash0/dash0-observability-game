// Act 3 levels 3.1 Instruments, 3.2 Temporality, 3.3 Histograms and 3.4 PromQL basics beyond the generated play-through
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
import { gradeQuery } from '../lib/promql/grade.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { nodeStates } from '../lib/map.mjs';
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

test('act-3 "Metrics" holds 3.1 to 3.4, after Act 2, with no boss yet', () => {
  const index = LIVE.acts.findIndex((a) => a.id === 'act-3');
  assert.equal(index, 3, 'act-3 follows act-0, act-1 and act-2');
  const act = LIVE.acts[index];
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 3, name: 'Metrics', sub: 'How much, how often', levelIds: ['instruments', 'temporality', 'histograms', 'promql-basics'], bossId: null },
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
  for (const id of ['instruments', 'temporality', 'histograms', 'promql-basics']) {
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

test('lights: 3.1 lights Kafka and 3.2 Notifications, so the order pipeline fills in and its edge lights', () => {
  const lit = (done) => {
    const s = nodeStates(LIVE, progressOf(done), NODES, EDGES);
    return {
      nodes: NODES.filter((n) => s.nodes[n.id].lit).map((n) => n.id).sort(),
      edge: s.edges.find((e) => e.from === 'kafka' && e.to === 'notifications').lit,
    };
  };
  assert.deepEqual(lit([]), { nodes: [], edge: false });
  assert.deepEqual(lit(['instruments']), { nodes: ['kafka'], edge: false });
  assert.deepEqual(lit(['temporality']), { nodes: ['notifications'], edge: false });
  assert.deepEqual(lit(['instruments', 'temporality']), { nodes: ['kafka', 'notifications'], edge: true });
});

test('lights: 3.3 lights the payment provider and 3.4 shipping, and each lights only its own node', () => {
  const lit = (done) => {
    const s = nodeStates(LIVE, progressOf(done), NODES, EDGES);
    return NODES.filter((n) => s.nodes[n.id].lit).map((n) => n.id).sort();
  };
  assert.deepEqual(lit(['histograms']), ['payment-provider']);
  assert.deepEqual(lit(['promql-basics']), ['shipping']);
  assert.deepEqual(lit(['instruments', 'temporality', 'histograms', 'promql-basics']), ['kafka', 'notifications', 'payment-provider', 'shipping']);
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
