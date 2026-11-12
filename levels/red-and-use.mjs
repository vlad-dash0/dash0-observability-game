// Level 3.7: RED and USE. The player pairs the two checklists with what they read (RED for a
// service's requests, USE for a resource), tells saturation from utilisation, learns how the
// Collector's spanmetrics connector turns spans into RED metrics, writes the rate, the error ratio
// and the p95 duration of each service from those span metrics, and learns that Dash0 derives RED
// from spans without a connector.
// Spec: docs/OUTLINE.md §4 Act 3.
// Spec: https://opentelemetry.io/docs/collector/components/connector/ , https://opentelemetry.io/docs/specs/semconv/http/http-spans/
// Spec: https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/#otlp-metric-points-to-prometheus , https://prometheus.io/docs/prometheus/latest/querying/functions/#histogram_quantile
// Source (spanmetrics connector README, names, dimensions, units, status codes and the feature gates): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/README.md
// Docs (component type at v0.164.0: `span_metrics`; `spanmetrics` is the deprecated alias): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/metadata.yaml
// Source (USE method, Brendan Gregg): https://www.brendangregg.com/usemethod.html
// Source (RED method, Tom Wilkie, as presented at GrafanaCon EU 2018): https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/
// Dash0 docs: https://www.dash0.com/docs/dash0/monitoring/services/built-in-metrics , https://www.dash0.com/docs/dash0/telemetry/metrics/understand-synthetic-metrics

// Step 1. `why` follows "Right." or "Not quite.".
const METHODS = [
  {
    key: 'red-services-use-resources',
    label: 'RED for each service: Rate, Errors, Duration. USE for each resource, such as a CPU or a disk: Utilisation, Saturation, Errors',
    right: true,
    why: 'RED asks how many requests a service gets, how many of them fail and how long they take. USE asks, of a resource, how busy it is, how much work waits for it and how many errors it throws. RED was made for request-driven services, and USE for resources such as CPUs, disks and network interfaces.',
  },
  {
    key: 'swapped',
    label: 'USE for each service: Utilisation, Saturation, Errors. RED for each resource, such as a CPU or a disk: Rate, Errors, Duration',
    why: 'Swapped. A CPU or a disk has no request to count the rate or duration of, and a service is not "busy" the way a resource is. RED reads requests, USE reads resources.',
  },
  {
    key: 'red-everything',
    label: 'RED for everything: Rate, Errors, Duration fit a service, a CPU or a disk alike, as every component takes requests',
    why: 'RED came out of microservices, because the USE method does not fit a service. The reverse holds too: a CPU, disk or interface is checked by how busy it is and how much work queues for it, which RED does not ask.',
  },
];

// Step 2. `why` follows "Right." or "Not quite.".
const SATURATION = [
  {
    key: 'utilisation',
    label: 'Utilisation: 60% means the CPU has room, so something else is slow',
    why: 'A long average hides bursts. Brendan Gregg\'s own example is a CPU that sat at 100% for seconds at a time inside a five-minute average that never passed 80%, with latency from CPU saturation all the same.',
  },
  {
    key: 'saturation',
    label: 'Saturation: the run queue, the work that wants a CPU and cannot have one yet',
    right: true,
    why: 'Saturation is the degree to which a resource has more work than it can service, often as a queue, and for a CPU it is the run-queue length or the scheduler latency. It can be present while the average utilisation looks low, because the average smooths out the bursts.',
  },
  {
    key: 'errors',
    label: 'Errors: the count of error events on that machine',
    why: 'Errors matter, since a failed and retried operation can slow things down without being noticed. But nothing failed here: the requests wait, and waiting is what saturation measures.',
  },
];

// Step 3. `why` follows "Right." or "Not quite.".
const CONNECTOR = [
  {
    key: 'spanmetrics',
    label: 'Add the <code>span_metrics</code> connector: traces pipeline in, metrics pipeline out, as calls and duration',
    right: true,
    why: 'It counts the spans passing through it into <code>traces.span.metrics.calls</code>, by default for each service.name, span.name, span.kind and status.code, so rate is the calls and errors are the calls with an error status. It records span durations into <code>traces.span.metrics.duration</code>, in milliseconds by default. A feature gate, <code>connector.spanmetrics.legacyMetricNames</code>, brings back the legacy names, and the component is now spelled <code>span_metrics</code>, so check what your version emits.',
  },
  {
    key: 'processor',
    label: 'Add the <code>spanmetrics</code> processor to the traces pipeline, writing the metrics beside the spans',
    why: 'The connector replaced that processor. A processor stays inside one pipeline, and turning traces into metrics means crossing from a traces pipeline into a metrics one, which is what a connector does.',
  },
  {
    key: 'errors-metric',
    label: 'Read the errors from a separate errors metric that the connector emits beside calls and duration',
    why: 'There is no separate errors metric. An error is a call whose status code dimension is an error: <code>status.code</code> with the value <code>STATUS_CODE_ERROR</code>, or <code>otel.status_code</code> with <code>ERROR</code> when a feature gate is on.',
  },
  {
    key: 'raw-url',
    label: 'Name the spans with the full URL, giving every request path its own metric series',
    why: 'Every distinct span name is a new series in each metric, which is the cardinality of 3.5. HTTP server span names are the method and <code>http.route</code>, and instrumentation must not default to the URI path. The connector README names raw URIs in span names as the usual cause of exploding span metrics, and offers an <code>aggregation_cardinality_limit</code> as a circuit breaker, not a fix.',
  },
];

// Step 7: the Dash0 tie-in. `why` follows "Right." or "Not quite.".
const DASH0 = [
  {
    key: 'derived',
    label: 'Dash0 derives RED metrics from the spans it receives, and nobody has to run a connector or emit them',
    right: true,
    why: 'Dash0 generates a metric, <code>dash0.spans.red</code>, from your spans to power its Service Catalog and Service Map. It is not billed as a custom metric. Rate is its count over time, errors are the spans with the status code ERROR, and duration is its bucket distribution. It is grouped by operation name, which turns <code>GET /users/123</code> into <code>GET /users/{id}</code> to keep the cardinality bounded, and you can group, filter and alert on its attributes.',
  },
  {
    key: 'connector-needed',
    label: 'They come from a spanmetrics connector that Dash0 asks you to run in your Collector',
    why: 'Dash0 does that derivation itself, from the spans it ingests. A connector in your own Collector is how you would get span metrics into a backend that does not.',
  },
  {
    key: 'service-metrics',
    label: 'They come from each service\'s own metrics, and a service with no metrics instrumentation shows nothing',
    why: 'The service views are built from spans. A service that sends traces and no metrics still gets rate, errors and duration.',
  },
];

export default {
  id: 'red-and-use',
  no: '3.7',
  name: 'RED and USE',
  sub: 'Two checklists',
  icon: '\u{1F6A6}',
  rewardTitle: 'Golden-signals reader',
  cards: ['red-and-use'],
  lights: ['checkout'],
  scoring: { parMs: null },
  play: {
    prefix: 'ru',
    steps: [
      {
        intro:
          'Kettle & Co\'s on-call wants two short checklists: one for the services, one for the machines under them. ' +
          'Tom Wilkie\'s <b>RED</b> method reads the requests a service handles. Brendan Gregg\'s <b>USE</b> method reads ' +
          'a resource.',
        question: 'Which pairing is right?',
        qid: 'ru-q-methods',
        choice: { id: 'ru-methods', choices: METHODS },
      },
      {
        intro:
          'The machine Redis runs on shows 60% CPU utilisation, as an average over five minutes, and requests to cart ' +
          'wait on it. USE says to check three things for every resource.',
        question: 'Which signal tells you work is waiting for the CPU?',
        qid: 'ru-q-saturation',
        choice: { id: 'ru-saturation', choices: SATURATION },
      },
      {
        intro:
          'Cart and checkout send traces but no metrics, and the team wants RED for each service now. Spans have ' +
          'what RED needs: each one is a request with a start, an end and a status. The Collector\'s ' +
          '<code>spanmetrics</code> connector is in the contrib distribution.',
        question: 'How do you get RED out of the traces?',
        qid: 'ru-q-connector',
        choice: { id: 'ru-connector', choices: CONNECTOR },
      },
      {
        intro:
          'The span metrics reach your backend under PromQL names, translated as in 3.4: ' +
          '<code>traces.span.metrics.calls</code> is <code>traces_span_metrics_calls_total</code>, and the dimensions ' +
          '<code>service.name</code>, <code>span.name</code> and <code>span.kind</code> are labels. <b>Rate</b> is requests ' +
          'per second. A service also makes calls of its own, recorded as CLIENT spans, and the requests it serves are its SERVER spans.',
        question: 'Write a query for the request rate of each service, over the last 5 minutes.',
        qid: 'ru-q-rate',
        query: {
          id: 'ru-rate',
          dataset: 'checkout-spanmetrics',
          at: 3600,
          reference: 'sum by (service_name) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER"}[5m]))',
          helps: { hints: true },
          hint: 'Count only the requests a service serves, not the calls it makes; the intro says which spans those are.',
          explain:
            'Checkout serves 12 requests per second and cart 16. Without the span kind, checkout would read 16: ' +
            'its call to the payment provider is a CLIENT span, a request it makes and not one it serves.',
        },
      },
      {
        intro:
          '<b>Errors</b> are the share of requests that fail. The connector has no errors metric: an error is a call ' +
          'with an error status, and the status is the label <code>status_code</code>, with the value ' +
          '<code>STATUS_CODE_ERROR</code>. A success is <code>STATUS_CODE_UNSET</code>, not OK, because HTTP instrumentation ' +
          'leaves a server span unset unless the request failed with a 5xx.',
        question: 'Write a query for the error ratio of each service, over the last 5 minutes.',
        qid: 'ru-q-errors',
        query: {
          id: 'ru-errors',
          dataset: 'checkout-spanmetrics',
          at: 3600,
          reference:
            'sum by (service_name) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER", status_code="STATUS_CODE_ERROR"}[5m])) / ' +
            'sum by (service_name) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER"}[5m]))',
          helps: { hints: true },
          hint: 'A ratio is the failing requests over all requests, per service; no series has an OK status, so the denominator is not one status.',
          explain:
            'Checkout fails 1 request in 12, about 8.3%, and cart 1 in 240, about 0.4%. Divide by all the calls: ' +
            'no series says OK, so a ratio against the OK calls would match nothing.',
        },
      },
      {
        intro:
          '<b>Duration</b> comes from the <code>duration</code> histogram, which holds the span durations in buckets. ' +
          'Its default unit is milliseconds, so the translated name ends in <code>_milliseconds</code>: ' +
          '<code>traces_span_metrics_duration_milliseconds_bucket</code>. It is a histogram like the ones in 3.3.',
        question: 'Write the p95 duration of each service, over the last 5 minutes.',
        qid: 'ru-q-duration',
        query: {
          id: 'ru-duration',
          dataset: 'checkout-spanmetrics',
          at: 3600,
          reference:
            'histogram_quantile(0.95, sum by (service_name, le) (rate(traces_span_metrics_duration_milliseconds_bucket{span_kind="SPAN_KIND_SERVER"}[5m])))',
          helps: { hints: true },
          hint: 'The percentile recipe from 3.3, on the duration histogram, for the requests a service serves.',
          explain:
            'Checkout is at 1,450 milliseconds and cart at 238: the p95 of 3.3 again, now in milliseconds and built from spans.',
        },
      },
      {
        intro:
          'Kettle & Co\'s traces go to Dash0, and the service pages already show rate, errors and duration for every ' +
          'service. Nobody has configured a connector.',
        question: 'Where do those numbers come from?',
        qid: 'ru-q-dash0',
        choice: { id: 'ru-dash0', choices: DASH0 },
      },
    ],
    finish:
      'You can read a service with RED and a resource with USE, you know saturation is not utilisation, you can get RED from spans with the spanmetrics connector, and Dash0 derives it from your spans.',
  },
};
