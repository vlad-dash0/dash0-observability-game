// Level 3.2: Temporality. The player spots the delta series among seven (the ones a
// Prometheus-style backend cannot take as they are), picks the Collector's deltatocumulative
// processor as the way to convert them, says what a restart does to a cumulative counter, and
// learns that Dash0 accepts both temporalities.
// Spec: docs/OUTLINE.md §4 Act 3.
// Spec: https://opentelemetry.io/docs/specs/otel/metrics/data-model/#temporality , https://opentelemetry.io/docs/specs/otel/metrics/data-model/#sums-delta-to-cumulative
// Spec: https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/#sums , https://opentelemetry.io/docs/collector/components/processor/

// Step 1. Lines read `name{labels}`; the debug view adds the temporality of Sum and Histogram
// series. A Gauge has none. `whyNot` is shown for a picked line that needs no conversion.
const SPOT = {
  id: 'temp-spot',
  target: 'metric',
  helps: { hints: true },
  hint: 'Ask of each series whether it is a running total, a change since the last report, or has no temporality at all.',
  lines: [
    { id: 'orders-placed', text: 'orders_placed_total{service="orders", temporality="cumulative"}' },
    { id: 'emails-sent', text: 'emails_sent_total{service="notifications", temporality="delta"}' },
    { id: 'queue-length', text: 'orders_queue_length{service="orders", temporality="cumulative"}' },
    { id: 'warehouse-temp', text: 'warehouse_temperature_celsius{site="rotterdam"}' },
    { id: 'checkout-duration', text: 'checkout_duration_seconds{service="checkout", region="eu-west-1", temporality="delta"}' },
    { id: 'payments-declined', text: 'payments_declined_total{service="payments", temporality="delta"}' },
    { id: 'request-duration', text: 'http_server_request_duration_seconds{service="storefront", temporality="cumulative"}' },
  ],
  faults: ['emails-sent', 'checkout-duration', 'payments-declined'],
  whyNot: {
    'orders-placed': 'Already cumulative: the total since the process started, which is what a Prometheus-style backend stores.',
    'queue-length': 'An UpDownCounter stays cumulative even when the OTLP exporter is set to delta, so it needs no conversion.',
    'warehouse-temp': 'A Gauge has no aggregation temporality: each point is the last sampled value, so there is nothing to convert.',
    'request-duration': 'A cumulative histogram maps straight onto a Prometheus histogram.',
  },
  explain:
    'Those three are delta: each point is only the change since the last report. A Prometheus-style backend ' +
    'stores cumulative totals, and OpenTelemetry\'s data model notes that the time series model it targets has no ' +
    'delta counters. So something has to convert them first, and an exporter either converts a delta histogram or drops it.',
};

// Step 2: the delta series come from an agent you cannot change. `why` follows "Right." or "Not quite.".
const CONVERT = [
  {
    key: 'gauge',
    label: 'Turn them into gauges, to report a plain value each time',
    why: 'A gauge has no aggregation semantic, so you would swap the temporality problem for lost rate math. Counts and durations should stay Sums and Histograms.',
  },
  {
    key: 'deltatocumulative',
    label: 'Add the <code>deltatocumulative</code> processor to the Collector\'s metrics pipeline',
    right: true,
    why: 'It adds each delta onto a running total and exports a cumulative series. It is stateful: it keeps every series in memory, so all the points of one series must reach the same instance. It ships in Collector contrib.',
  },
  {
    key: 'suffix',
    label: 'Rename them with a <code>_total</code> suffix, to make the backend treat them as counters',
    why: 'A name is only a name. The points are still the change since the last report.',
  },
  {
    key: 'nothing',
    label: 'Nothing: the backend adds the deltas up as they arrive',
    why: 'A Prometheus-style backend stores the samples it is sent. It does not accumulate deltas, so something upstream has to.',
  },
];

// Step 3: a restart. `why` follows "Right." or "Not quite.".
const RESTART = [
  {
    key: 'negative',
    label: 'A drop of 8,365 orders, as that many orders were lost in the restart',
    why: 'A monotonic sum never goes down, so a drop is a restart, not lost orders. A backend that read it as negative would get the rate wrong.',
  },
  {
    key: 'reset',
    label: 'A reset: the sum started over, and the new start time marks it',
    right: true,
    why: 'A cumulative sum lives in the process, so after a restart it begins again from zero, with a new start time. A backend that reads start times treats that as a reset and counts the rate from zero, not as a drop.',
  },
  {
    key: 'survives',
    label: 'Nothing: a cumulative counter survives a restart and keeps counting from 8,400',
    why: 'The running total lives in the process\'s memory, so a restart ends it. The new process starts again from zero.',
  },
];

// Step 4: the Dash0 tie-in. `why` follows "Right." or "Not quite.".
const DASH0 = [
  {
    key: 'convert-all',
    label: 'Yes: every backend needs cumulative sums',
    why: 'That is the Prometheus-style rule, not a universal one. OTLP supports both temporalities, and Dash0 accepts both.',
  },
  {
    key: 'both',
    label: 'No: Dash0 accepts both temporalities, and you query with PromQL',
    right: true,
    why: 'Dash0 takes delta and cumulative series, and you query metrics with PromQL. The conversion matters for Prometheus-style backends. On a cumulative counter, use <code>rate()</code> or <code>increase()</code> in PromQL.',
  },
  {
    key: 'processor',
    label: 'Yes: put the <code>deltatocumulative</code> processor in front of Dash0 in the Collector',
    why: 'Dash0 accepts both, so you would add a stateful component that keeps every series in memory for no gain. Add it where a backend needs it.',
  },
];

export default {
  id: 'temporality',
  no: '3.2',
  name: 'Temporality',
  sub: 'Total or change',
  icon: '\u{1F552}',
  rewardTitle: 'Temporality translator',
  cards: ['delta-needs-converting'],
  lights: ['notifications'],
  scoring: { parMs: null },
  play: {
    prefix: 'temp',
    steps: [
      {
        intro:
          'Every Sum and Histogram point comes in one of two temporalities: <b>cumulative</b>, the total ' +
          'since the process started, or <b>delta</b>, only the change since the last report. The infra ' +
          'team wants Kettle & Co\'s metrics in their Prometheus-style backend too, and it stores cumulative ' +
          'totals. A debug view lists seven series, with the temporality of each.',
        question: 'Spot the series that need converting before that backend can use them.',
        qid: 'temp-q-spot',
        spot: SPOT,
      },
      {
        intro:
          'The delta series come from a vendor agent, and its temporality is not yours to change this ' +
          'quarter. The Collector sits between the services and the backend.',
        question: 'How do you get them into the backend?',
        qid: 'temp-q-convert',
        choice: { id: 'temp-convert', choices: CONVERT },
      },
      {
        intro:
          'Orders runs on a node that restarts at 14:02. Until then, its cumulative ' +
          '<code>orders_placed_total</code> read 8,400. The first point after the restart reads 35.',
        question: 'What does a backend make of 8,400 followed by 35?',
        qid: 'temp-q-restart',
        choice: { id: 'temp-restart', choices: RESTART },
      },
      {
        intro:
          'Dash0 is where Kettle & Co looks at metrics day to day, and notifications sends delta ' +
          'counters such as <code>emails_sent_total</code>.',
        question: 'Do you have to convert them to cumulative before Dash0 can use them?',
        qid: 'temp-q-dash0',
        choice: { id: 'temp-dash0', choices: DASH0 },
      },
    ],
    finish:
      'You can tell delta from cumulative, you know Prometheus-style backends need cumulative and a restart resets a counter, and that Dash0 takes both.',
  },
};
