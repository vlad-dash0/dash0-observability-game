// Level 3.4: PromQL basics. The player learns how an OpenTelemetry metric name turns into a
// Prometheus one (units and _total), writes rate with sum by and a range, writes increase over a
// window that contains a restart, and learns that Dash0 exposes metrics under both names and turns
// logs and spans into metrics you query with the same PromQL.
// Spec: docs/OUTLINE.md §4 Act 3.
// Spec: https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/#otlp-metric-points-to-prometheus , https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/#sums
// Spec: https://prometheus.io/docs/prometheus/latest/querying/functions/#rate , https://prometheus.io/docs/prometheus/latest/querying/functions/#increase , https://prometheus.io/docs/prometheus/latest/querying/operators/#aggregation-operators
// Dash0 docs: https://www.dash0.com/docs/dash0/telemetry/metrics/understand-otel-metric-names , https://www.dash0.com/docs/dash0/telemetry/metrics/understand-synthetic-metrics

// Step 1. `why` follows "Right." or "Not quite.".
const UNIT = [
  {
    key: 'dotted',
    label: '<code>http.server.request.duration_bucket</code>',
    why: 'A bare PromQL metric name cannot contain dots. With the classic translation each one becomes an underscore.',
  },
  {
    key: 'wrong-unit',
    label: '<code>http_server_request_duration_milliseconds_bucket</code>',
    why: 'The unit is wrong. The metric\'s unit is <code>s</code>, so the translation adds <code>_seconds</code>, not <code>_milliseconds</code>, before any suffix for the type.',
  },
  {
    key: 'seconds-bucket',
    label: '<code>http_server_request_duration_seconds_bucket</code>',
    right: true,
    why: 'Dots become underscores, the unit <code>s</code> becomes <code>_seconds</code>, and the histogram adds <code>_bucket</code>, <code>_sum</code> and <code>_count</code> series. That is the classic translation. A backend can be set to keep UTF-8 names or to skip the suffixes, so check what yours does.',
  },
  {
    key: 'bare',
    label: '<code>http_server_request_duration_seconds</code>',
    why: 'A classic histogram has no series under its bare name: its series are <code>_bucket</code>, <code>_sum</code> and <code>_count</code>.',
  },
];

// Step 2. `why` follows "Right." or "Not quite.".
const TOTAL = [
  {
    key: 'bare',
    label: '<code>http_server_requests</code>',
    why: 'A monotonic Sum becomes a Prometheus counter, and the translation adds <code>_total</code> unless the name already ends with it.',
  },
  {
    key: 'total',
    label: '<code>http_server_requests_total</code>',
    right: true,
    why: 'Dots become underscores and a monotonic Sum gets <code>_total</code>. The unit <code>{request}</code> is in braces, and a unit in braces is dropped, so it adds no suffix.',
  },
  {
    key: 'brace-unit',
    label: '<code>http_server_requests_request_total</code>',
    why: 'A unit in braces such as <code>{request}</code> is only an annotation, and the translation drops it.',
  },
];

// Step 5. `why` follows "Right." or "Not quite.".
const DASH0 = [
  {
    key: 'translated-only',
    label: 'Only the translated names work, and you have to learn how each OpenTelemetry name is translated first',
    why: 'Dash0 keeps the original name too. Every metric carries an <code>otel_metric_name</code> label, so you can select it without knowing how it was translated.',
  },
  {
    key: 'both-names',
    label: 'The OpenTelemetry name works through <code>otel_metric_name</code>, and logs and spans are queryable as metrics',
    right: true,
    why: 'Dash0 exposes each metric under both names, and <code>otel_metric_name</code> keeps a query stable whatever the translation does. It also derives metrics such as <code>dash0.logs</code> and <code>dash0.spans</code> from logs and spans on demand, so the same PromQL reaches them.',
  },
  {
    key: 'metrics-only',
    label: 'PromQL is for metrics only: logs and spans need a different query language, learned separately',
    why: 'Dash0 turns logs and spans into synthetic metrics such as <code>dash0.logs</code> and <code>dash0.spans</code>, and you query those with the same PromQL.',
  },
];

export default {
  id: 'promql-basics',
  no: '3.4',
  name: 'PromQL basics',
  sub: 'Say it in PromQL',
  icon: '\u{1F50E}',
  rewardTitle: 'PromQL speaker',
  cards: ['prometheus-names'],
  lights: ['shipping'],
  scoring: { parMs: null },
  play: {
    prefix: 'pql',
    steps: [
      {
        intro:
          'Kettle & Co\'s services record <code>http.server.request.duration</code>, a Histogram with the unit ' +
          '<code>s</code>. Before you can query it with PromQL, you need the name PromQL sees. OpenTelemetry\'s ' +
          'compatibility rules translate names for Prometheus-style backends: invalid characters, a unit word, ' +
          'a type suffix.',
        question: 'Which series holds the buckets of that histogram, with the classic translation?',
        qid: 'pql-q-unit',
        choice: { id: 'pql-unit', choices: UNIT },
      },
      {
        intro:
          'Counting requests is a Counter named <code>http.server.requests</code>, with the unit ' +
          '<code>{request}</code>.',
        question: 'What is its name in PromQL?',
        qid: 'pql-q-total',
        choice: { id: 'pql-total', choices: TOTAL },
      },
      {
        intro:
          'A counter only goes up, so its raw value is rarely useful. <code>rate(x[5m])</code> gives the per-second ' +
          'increase over the last 5 minutes, and <code>sum by (label)</code> adds the series up, keeping one per label ' +
          'value. Checkout has been returning 500s since its deploy.',
        question: 'Write a query for the 500s per second of each checkout route, over the last 5 minutes.',
        qid: 'pql-q-rate',
        query: {
          id: 'pql-rate',
          dataset: 'checkout-http',
          at: 3600,
          reference: 'sum by (route) (rate(http_server_requests_total{service="checkout", status="500"}[5m]))',
          helps: { hints: true },
          hint: 'Narrow the counter to the requests you mean, turn it into a per-second figure, then keep one series for each thing the question says "each" of.',
          explain:
            '/pay returns 1 error per second and /quote none. Rate turns the counter into a per-second figure, ' +
            'and sum by keeps one series per route.',
        },
      },
      {
        intro:
          'A manager wants a count, not a speed. <code>increase(x[10m])</code> is the growth over a window, and it copes with ' +
          'counter resets. Checkout restarted at t=2400, so every checkout counter went back to zero, and the window ' +
          'ending at t=2700 contains the restart.',
        question: 'Write a query for the number of /pay requests in the 10 minutes up to now.',
        qid: 'pql-q-increase',
        query: {
          id: 'pql-increase',
          dataset: 'checkout-http',
          at: 2700,
          reference: 'sum(increase(http_server_requests_total{route="/pay"}[10m]))',
          helps: { hints: true },
          hint: 'The right function already copes with the counter reset, and the question wants one number, however the requests differ.',
          explain:
            'About 2,338 requests: increase adjusts for the reset and extrapolates to the whole window, which is why it ' +
            'is not a whole number. It equals the rate times the 600 seconds of the window.',
        },
      },
      {
        intro:
          'Dash0 is where Kettle & Co writes this PromQL. An OpenTelemetry metric arrives under its original name, and ' +
          'Dash0 adds <code>otel_metric_name</code>, <code>otel_metric_type</code> and <code>otel_metric_unit</code> labels. ' +
          'Selecting by the original name looks like this:',
        code: 'increase({otel_metric_name="http.server.requests", otel_metric_type="sum"}[10m])',
        question: 'What else is true of PromQL in Dash0?',
        qid: 'pql-q-dash0',
        choice: { id: 'pql-dash0', choices: DASH0 },
      },
    ],
    finish:
      'You can read an OpenTelemetry name as PromQL sees it, write rate with sum by and increase over a range, and you know Dash0 speaks PromQL for metrics and for logs and spans.',
  },
};
