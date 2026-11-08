// Level 9.5: Lost in translation. Act 9 "Live Demo" (docs/LIVE-DEMO.md). The player hears a confident answer to a customer,
// "setting the SDK to delta only changes how it keeps its state, so nothing changes downstream", and says whether it holds
// (Choice), then spots the series that now arrive as delta from seven lines (Spot it). The answer is wrong: with
// OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta, Counter, Asynchronous Counter and Histogram instruments export delta
// and UpDownCounters stay cumulative. The presenter has no name and no affiliation.
// How it differs from 3.2 (Temporality): 3.2 hands the player a debug view that already prints each series' temporality and asks
// them to read it, then to pick a fix. Here no line says its temporality: the player derives it from the instrument kind, the
// environment variable and which service changed it. Nothing about the Collector fix is asked.
// Source: an anonymised call question (docs/LIVE-DEMO.md). Nothing below identifies a customer, a person or a product.
// Spec: https://opentelemetry.io/docs/specs/otel/metrics/sdk_exporters/otlp/ , https://opentelemetry.io/docs/specs/otel/metrics/data-model/#gauge
// Spec: https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/#sums
// Docs (GitHub README, not an allowed Spec host): the prometheusremotewriteexporter README at
// https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.164.0/exporter/prometheusremotewriteexporter/README.md
//
// Facts used (each read on the pages above, 2026-11-08). The OTLP exporter page: OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE
// defaults to cumulative, and "Delta: Choose Delta aggregation temporality for Counter, Asynchronous Counter and Histogram
// instrument kinds, choose Cumulative aggregation for UpDownCounter and Asynchronous UpDownCounter instrument kinds." The data model: "Gauges do not provide an
// aggregation semantic", so a gauge has no temporality. The Prometheus compatibility page: a cumulative monotonic Sum becomes a
// Prometheus Counter, and a delta monotonic Sum "MAY be converted to a cumulative temporality"; a delta Histogram "MAY be
// aggregated into a Cumulative aggregation temporality ... or MUST be dropped". The README at v0.164.0: "Non-cumulative monotonic,
// histogram, and summary OTLP metrics are dropped by this exporter."
// Not claimed: what any Dash0 page says about delta series, and the LowMemory value (it keeps Asynchronous Counters cumulative).
//
// Invented for the game: the services, the seven series, and the scenario, including that each service sets the preference for itself,
// so payments keeps the cumulative default. No pricing.

// Step 1: does the presenter's answer hold? `why` follows "Right." or "Not quite.".
const VERDICT = [
  {
    key: 'all-delta',
    label: 'It is wrong: every metric is now delta, UpDownCounters and gauges too',
    why: 'Not every instrument turns delta. UpDownCounters stay cumulative, and a gauge has no temporality, so it is not converted either.',
  },
  {
    key: 'holds',
    label: 'It holds: delta only changes how the SDK keeps its own state',
    why: 'The setting changes what the SDK exports, not only what it keeps. A delta point is the change since the last report, and a cumulative-only backend cannot store it as it is.',
  },
  {
    key: 'wrong',
    label: 'It is wrong: counters and histograms now arrive as delta points',
    right: true,
    why:
      'With the preference set to delta, Counter, Asynchronous Counter and Histogram instruments export delta, and UpDownCounter and Asynchronous UpDownCounter instruments stay cumulative. ' +
      'A backend that stores cumulative totals cannot use the delta ones as they are.',
  },
];

// Step 2: seven series. Lines read `name{labels}`; none says its temporality, so the player derives it. `whyNot` is shown for a picked
// line that still arrives as cumulative or has no temporality.
const SPOT = {
  id: 'lit-spot',
  target: 'metric',
  helps: { hints: false },
  lines: [
    { id: 'queue-depth', text: 'queue_depth{instrument="ObservableGauge", service="orders"}' },
    { id: 'orders-placed', text: 'orders_placed{instrument="Counter", service="orders"}' },
    { id: 'payments-declined', text: 'payments_declined{instrument="Counter", service="payments"}' },
    { id: 'cpu-time', text: 'cpu_time_seconds{instrument="ObservableCounter", service="orders"}' },
    { id: 'orders-in-flight', text: 'orders_in_flight{instrument="UpDownCounter", service="orders"}' },
    { id: 'db-pool', text: 'db_pool_connections{instrument="ObservableUpDownCounter", service="checkout"}' },
    { id: 'checkout-duration', text: 'checkout_duration_seconds{instrument="Histogram", service="checkout"}' },
  ],
  faults: ['orders-placed', 'cpu-time', 'checkout-duration'],
  whyNot: {
    'orders-in-flight': 'An UpDownCounter stays cumulative even when the preference is delta, so this one arrives as a running total.',
    'db-pool': 'An Asynchronous UpDownCounter stays cumulative with the delta preference, like its synchronous twin.',
    'queue-depth': 'A gauge has no aggregation temporality: each point is the last sampled value, so there is nothing to translate.',
    'payments-declined': 'A Counter, but payments did not change its preference. The default is cumulative, so this series still arrives as a running total.',
  },
  explain:
    'Those three arrive as delta: the Counter and the Histogram are synchronous instruments the delta preference turns, and so is the Asynchronous Counter, ' +
    'the one that is easy to miss (the LowMemory value would have kept it cumulative). The UpDownCounters stay cumulative and the gauge has no temporality. ' +
    'Payments is a Counter too, but it did not change its preference. The OpenTelemetry mapping to Prometheus lets a delta sum be converted to cumulative, or not, and ' +
    'the remote write exporter in the Collector contrib at v0.164.0 drops non-cumulative monotonic sums and histograms. Where the series have to be translated is a decision for 3.2.',
};

export default {
  id: 'lost-in-translation',
  no: '9.5',
  name: 'Lost in translation',
  sub: 'Does that answer hold?',
  icon: '\u{1F310}',
  rewardTitle: 'Delta decoder',
  cards: [],
  lights: ['collector'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'lit',
    steps: [
      {
        intro:
          'On a call, a customer asks: "We set <code>OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta</code> on two of our services. ' +
          'Does that change what our Prometheus-style backend receives?" The presenter answers: "No. Delta only changes how the SDK keeps its state inside. Nothing changes downstream."',
        question: 'Does the presenter\'s answer hold?',
        qid: 'lit-q-verdict',
        choice: { id: 'lit-verdict', choices: VERDICT },
      },
      {
        intro:
          'Only <b>orders</b> and <b>checkout</b> changed the preference to delta. <b>payments</b> did not. A debug view lists seven series with the instrument that makes each, and ' +
          'the backend stores cumulative totals only.',
        question: 'Spot the series that now arrive as delta.',
        qid: 'lit-q-spot',
        spot: SPOT,
      },
    ],
    finish:
      'You did not take the "nothing changes" on trust: with the preference at delta, counters and histograms export the change since the last report, UpDownCounters stay running totals and a gauge has no temporality. ' +
      'A service that did not change the setting still sends cumulative, so ask which instrument and which service before you say what arrives.',
  },
};
