// Nuance cards a level can award (docs/FOUNDATION.md §2.3), checked by validateDeck:
// { id, front (<=140 chars), back, specUrl ('https://...'), dash0Angle (text or null) }.
export const DECK = [
  {
    id: 'unknown-service',
    front: 'Without service.name, your telemetry arrives as unknown_service:<executable>.',
    back:
      'With no service name set in code, OTEL_SERVICE_NAME or OTEL_RESOURCE_ATTRIBUTES, and ' +
      'no platform detector supplying one, the SDK reports service.name as ' +
      'unknown_service:<executable>: for a process started as node, that is ' +
      'unknown_service:node. When the SDK cannot tell the executable, it is plain ' +
      'unknown_service. When OTEL_SERVICE_NAME and service.name in OTEL_RESOURCE_ATTRIBUTES ' +
      'are both set, OTEL_SERVICE_NAME wins.',
    specUrl: 'https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/',
    dash0Angle:
      'Any backend that groups telemetry by service, Dash0 included, can tell your services ' +
      'apart only when every service carries its own service.name.',
  },
  {
    id: 'profiles-signal',
    front:
      "Profiles are OTel's fourth and newest signal. The profiles spec is Alpha, and profiles in " +
      'OTLP are still in Development, so expect changes.',
    back:
      'OpenTelemetry has four signals: traces, metrics, logs and profiles. Profiles came last. ' +
      'The profiles spec has status Alpha, and the OTLP spec marks the profiles signal as ' +
      'Development, so its data model and wire format may still change.',
    specUrl: 'https://opentelemetry.io/docs/concepts/signals/profiles/',
    dash0Angle: null,
  },
  {
    id: 'api-vs-sdk',
    front:
      'Libraries depend only on the OTel API; only the app installs the SDK. Without an SDK, ' +
      'API calls are no-ops that record nothing.',
    back:
      'Libraries depend only on the OTel API; only the application installs the SDK. Without ' +
      'an SDK, API calls are no-ops: they record nothing and cost almost nothing. So a shared ' +
      'library can be instrumented once, and each application that uses it picks its own SDK, ' +
      'sampling and exporter.',
    specUrl: 'https://opentelemetry.io/docs/concepts/instrumentation/libraries/#opentelemetry-api',
    dash0Angle: null,
  },
  {
    id: 'no-trace-object',
    front:
      'There is no trace object: a trace is just the spans that share a trace ID, each exported ' +
      'on its own.',
    back:
      'OpenTelemetry defines a trace only through its spans. Each span carries its trace ID and ' +
      "its parent's span ID, and the SDK passes each span on to its span processors when that " +
      'span ends, so the spans of one request reach a backend separately, often from different ' +
      'services. The backend puts the trace together by trace ID.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/overview/#traces',
    dash0Angle: null,
  },
  {
    id: 'span-kind-edges',
    front:
      'Span kind is not cosmetic: service maps draw edges from CLIENT to SERVER and PRODUCER to ' +
      'CONSUMER pairs.',
    back:
      'Span kind says which side of a call a span is on: CLIENT calls out and SERVER handles ' +
      'the call; PRODUCER sends a message and CONSUMER processes it. Backends derive ' +
      'service-map edges from those pairs, so a SERVER span recorded as INTERNAL leaves its ' +
      'caller with no edge, even though the call happened.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/trace/api/#spankind',
    dash0Angle: null,
  },
  {
    id: 'span-status',
    front:
      'Status starts Unset. A 4xx is Error on the CLIENT span but stays Unset on the SERVER ' +
      'span. Ok is a final override.',
    back:
      "A span's status is Unset (the default), Error or Ok. The HTTP semantic " +
      'conventions say a 4xx MUST leave a SERVER span Unset and SHOULD make a CLIENT span ' +
      'Error; a 5xx SHOULD be Error on both. Successes stay Unset, and instrumentation ' +
      'SHOULD NOT set Ok. Once a span is Ok, later attempts to change its status SHOULD be ' +
      'ignored.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/trace/api/#set-status',
    dash0Angle: null,
  },
  {
    id: 'baggage-leaks',
    front:
      'Baggage is not copied onto spans for you, and it travels in plain headers to every ' +
      'downstream, third parties too.',
    back:
      'Baggage is a key/value store that travels with the context, separate from span, metric ' +
      'and log attributes. To see an entry on spans, read it and set it as an attribute, or ' +
      'add a baggage span processor. It is sent in the W3C baggage HTTP header, which anyone ' +
      'inspecting the traffic can read, and downstream services can pass it on outside your ' +
      'network. Keep personal data and secrets out of it.',
    specUrl: 'https://opentelemetry.io/docs/concepts/signals/baggage/#baggage-security-considerations',
    dash0Angle: null,
  },
  {
    id: 'broken-propagation',
    front:
      'When a hop drops the traceparent header, one request becomes two traces: look for ' +
      'unexpected root spans.',
    back:
      'Each hop passes the trace context on in the W3C traceparent header: version 00, the ' +
      "32-hex trace ID, the caller's 16-hex span ID as parent-id, and the flags. A proxy or " +
      'gateway that does not forward it makes the next service start a new trace, so one ' +
      'request shows up as two traces, each with its own root span. A receiver also MUST ' +
      'ignore a traceparent whose IDs are all zeros or not lowercase hex.',
    specUrl: 'https://www.w3.org/TR/trace-context/#traceparent-header',
    dash0Angle: null,
  },
  {
    id: 'exception-no-status',
    front:
      'An exception record and the span status are separate fields: recording one never sets ' +
      'the other. Set Error when the operation fails.',
    back:
      'An exception can be recorded as a span event (the Trace API RecordException, still ' +
      'Stable) or as a log record, which semantic conventions 1.44 now recommend: they mark ' +
      'exceptions on spans Deprecated. Either way the record leaves the status alone. The ' +
      'code or instrumentation that ends the span sets Error when the operation failed, and ' +
      'a handled exception that let it complete leaves the status Unset.',
    specUrl: 'https://opentelemetry.io/docs/specs/semconv/general/recording-errors/',
    dash0Angle: null,
  },
  {
    id: 'batch-links',
    front:
      'A span has at most one parent. A consumer handling a batch from many traces links to ' +
      "each message's context.",
    back:
      'A span gets one parent, from the context it starts in. A consumer that processes a ' +
      'batch of messages, each sent by a different request, cannot have them all as parents, ' +
      "so it adds a link to each message's span context. Links can join spans across traces.",
    specUrl: 'https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/#batch-receiving',
    dash0Angle: null,
  },
  {
    id: 'double-instrumentation',
    front:
      'Instrument the same library twice, say an injected agent plus your own SDK setup, and ' +
      'each call can appear twice.',
    back:
      'Whether a second setup duplicates spans depends on the instrumentation. Patch-based ' +
      'ones, such as the http and express server spans, unwrap before they wrap again, so ' +
      'they stay single. Instrumentations built on diagnostics_channel, such as undici and ' +
      "Node's fetch, subscribe once per setup, so each fetch call gets two CLIENT spans " +
      "today. Run one setup: the operator's injected agent or your own SDK, and add business " +
      'spans and attributes with the API.',
    specUrl: 'https://opentelemetry.io/docs/zero-code/js/',
    dash0Angle: null,
  },  {
    id: 'gauge-not-count',
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
  {
    id: 'delta-needs-converting',
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
  {
    id: 'averages-hide-tails',
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
  {
    id: 'prometheus-names',
    front:
      'OpenTelemetry names change for PromQL: dots become underscores, a unit word is added, and monotonic sums get _total.',
    back:
      'With the classic translation, http.server.request.duration with the unit s is queried as ' +
      'http_server_request_duration_seconds, and its histogram series are _bucket, _sum and _count. A monotonic sum such as ' +
      'http.server.requests becomes a counter, http_server_requests_total, and a unit in braces such as {request} is dropped. ' +
      'Use rate() for a per-second figure and increase() for growth over a window; both adjust for counter resets. ' +
      'Prometheus can also keep UTF-8 names, and a backend may be configured to skip the suffixes, so check what yours does.',
    specUrl:
      'https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/#otlp-metric-points-to-prometheus',
    dash0Angle:
      'Dash0 exposes each metric under both names, and the otel_metric_name label selects the original one. It also ' +
      'derives metrics from logs and spans, which you query with the same PromQL.',
  },
];
