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
  {
    id: 'resource-not-span-attribute',
    front:
      'What the telemetry is about (service, pod, host, region) goes on the Resource once, not on every span as a span attribute.',
    back:
      'A Resource describes the entity that produces telemetry, as resource attributes such as service.name, k8s.pod.name, ' +
      'host.name and cloud.region. It is attached to the tracer, meter and logger providers when they are created, and ' +
      'cannot be changed later, so every span, metric and log from the provider carries it. Attributes such as ' +
      'http.request.method, http.route or http.response.status_code describe one operation, so they belong on that span. ' +
      'Setting k8s.pod.name on every span as a span attribute repeats one value on each span and leaves metrics and logs ' +
      'without it.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/resource/sdk/',
    dash0Angle:
      "Dash0's Resources view is built from the resource attributes on your telemetry, such as k8s.pod.uid, so what you put on the " +
      'Resource decides what Dash0 can show.',
  },
  {
    id: 'k8sattributes-in-collector',
    front:
      'Add pod metadata in the Collector with k8sattributes, and list it in the pipeline: configured but not listed, it does nothing.',
    back:
      'SDK resource detectors run once, when the SDK starts, and the Resource cannot change afterwards. Kubernetes metadata is better ' +
      'added once in the Collector by the k8sattributes processor, which looks up the pod each piece of telemetry came from through ' +
      'the Kubernetes API (by default through the IP address of the incoming connection) and adds attributes such as ' +
      'k8s.pod.name and k8s.namespace.name as resource attributes. The Collector service account needs get, watch and list ' +
      'permissions on pods and namespaces. It is a contrib component, so use a contrib or Kubernetes distribution. ' +
      'Configuring a processor does not enable it: it must also be listed under a pipeline in the service section.',
    specUrl: 'https://opentelemetry.io/docs/platforms/kubernetes/collector/components/#kubernetes-attributes-processor',
    dash0Angle:
      'The Dash0 operator adds k8s.namespace.name, k8s.pod.name, k8s.pod.uid and k8s.container.name to workloads in namespaces ' +
      'enabled for Dash0 monitoring, so you do not set them by hand.',
  },
  {
    id: 'series-are-combinations',
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
  {
    id: 'red-and-use',
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
  {
    id: 'severity-number-not-text',
    front:
      'Filter logs on SeverityNumber, not SeverityText: the text is whatever the source printed, the number is normalised.',
    back:
      'A log record keeps the message in the Body, facts about this one event in Attributes, and the source that emitted it in ' +
      'the Resource. Severity comes twice: SeverityText is the original string from the source (WARN, warning, Warn) and ' +
      'SeverityNumber is an integer from 1 to 24 in six ranges: TRACE 1-4, DEBUG 5-8, INFO 9-12, WARN 13-16, ERROR 17-20, ' +
      'FATAL 21-24. Compare and filter on the number, because one library\'s "warning" is another\'s "WARN". Keep your own ' +
      'logging library: the Logs Bridge API is for logging library authors, who build the appenders that bridge into ' +
      'OpenTelemetry.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/logs/data-model/',
    dash0Angle: null,
  },
  {
    id: 'logs-need-an-active-span',
    front: 'A log record gets TraceId and SpanId only if the log call ran inside an active span, through a bridged logger.',
    back:
      'TraceId and SpanId are fields of the log record, not attributes. They are set when the record is emitted with a context ' +
      'that holds a span: the Logs API uses the current context when none is passed, and the appender or bridge for your ' +
      'logging library passes it. A call outside any span, such as startup code or a background worker whose context was not ' +
      'carried over, leaves them empty. An all-zero trace id or span id is invalid under W3C Trace Context, so a record with ' +
      'zeros is not linked either, and a trace id written into the message text is not a link at all.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-traceid',
    dash0Angle:
      'Dash0 shows the span a log was created in from the log, and the logs of a span from the span. The span view lists the ' +
      'logs of the same trace by default and can switch to the same resource, which finds logs outside the trace, such as ' +
      'background jobs.',
  },
];
