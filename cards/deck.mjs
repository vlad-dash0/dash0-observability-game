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
    id: 'exemplars-need-sampled-spans',
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
  {
    id: 'red-and-use',
    front:
      'RED (rate, errors, duration) reads a service\'s requests; USE (utilisation, saturation, errors) reads a resource.',
    back:
      'RED is Tom Wilkie\'s checklist for each request-driven service: Rate, the requests per second; Errors, the share ' +
      'of them that fail; Duration, how long they take, as a distribution. USE is Brendan Gregg\'s checklist for each ' +
      'resource, such as a CPU or a disk: Utilisation, how busy it is; Saturation, how much work waits for it, often a ' +
      'queue; Errors, the count of error events. A burst can saturate a resource while its average utilisation looks ' +
      'low. When a service sends traces but no metrics, the Collector\'s span_metrics connector (contrib) turns the spans ' +
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
  {
    id: 'configured-not-enabled',
    front:
      'Configuring a Collector component does not enable it: list it in a pipeline (extensions under service.extensions) or it does nothing.',
    back:
      'A Collector config has five kinds of component. Receivers take data in, processors change it, exporters send it out, ' +
      'connectors join two pipelines (an exporter at the end of one and a receiver at the start of another), and extensions ' +
      'add abilities that are not part of the data path, such as a health check. Defining one under its section only ' +
      'configures it. Receivers, processors and exporters are enabled by listing them in a pipeline under service.pipelines, ' +
      'a connector by listing it in both pipelines it joins, and an extension under service.extensions. A component that is ' +
      'defined but not listed is not enabled, so a memory_limiter nobody listed protects nothing; one that is listed but not ' +
      'defined keeps the Collector from starting.',
    specUrl: 'https://opentelemetry.io/docs/collector/configuration/#service',
    dash0Angle: null,
  },
  {
    id: 'memory-limiter-first',
    front:
      'Processor order is processing order, per pipeline: memory_limiter first, drops and context readers before batch, batch late.',
    back:
      'The processors in a pipeline run in the order they are listed, and every pipeline has its own list, so the same ' +
      'processors can be right in one pipeline and wrong in another. memory_limiter goes first: when memory runs high it ' +
      'refuses data by returning an error to the component before it, so receivers can retry and slow their senders before ' +
      'later processors pile up more. batch goes late, after the processors that drop, filter or change data, so it does not ' +
      'batch what is discarded afterwards. A processor that reads the request context, such as k8sattributes, must run before ' +
      "batch, because batching clears that context. The processor docs also say to prefer an exporter's own batching where " +
      'it has one.',
    specUrl: 'https://opentelemetry.io/docs/collector/configuration/#processors',
    dash0Angle: null,
  },
  {
    id: 'otlp-ports-and-paths',
    front:
      'OTLP/gRPC is port 4317, OTLP/HTTP 4318. A general HTTP endpoint gets /v1/traces added; a per-signal one is used as is.',
    back:
      'OTLP has two transports with their own default ports: OTLP/gRPC on 4317 and OTLP/HTTP on 4318. A gRPC endpoint is a ' +
      'host and a port with no path. For OTLP/HTTP, OTEL_EXPORTER_OTLP_ENDPOINT is a base URL: the exporter adds /v1/traces, ' +
      '/v1/metrics or /v1/logs to it. The per-signal variables, such as OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, are used as they ' +
      'are, with no path added: set to http://collector:4318 it sends traces to the root path, so it has to carry /v1/traces ' +
      "itself. The Collector's otlp_http exporter follows the same rule: endpoint is a base URL that gets the signal path, " +
      'traces_endpoint is used as is. Its gRPC counterpart, otlp_grpc, takes a host and a port with no path. In Collector v0.164.0 ' +
      'otlp and otlphttp are deprecated aliases for these two exporter types and still resolve.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/protocol/exporter/#endpoint-urls-for-otlphttp',
    dash0Angle:
      'Dash0 takes OTLP over gRPC and over HTTP. The Collector example in the Dash0 docs uses the OTLP/gRPC ingress endpoint ' +
      'of your organization, whose URL shows your region, with your auth token in an Authorization: Bearer header, read from ' +
      'an environment variable so the token is not written into the file.',
  },
  {
    id: 'tail-sampling-needs-one-collector',
    front:
      'Tail sampling needs every span of a trace in one Collector: put a load_balancing exporter on traceID in front of the gateways.',
    back:
      'An agent Collector runs next to the workload, as a sidecar or as a DaemonSet pod on each node. A gateway is a standalone ' +
      'Collector service, such as a Kubernetes Deployment, that apps or agents send to: one OTLP endpoint per cluster, data ' +
      'center or region. The tail_sampling processor keeps spans in memory until it can decide on the whole trace, so all spans ' +
      'of a trace must reach the same Collector instance, and several gateway replicas behind an ordinary load balancer split ' +
      'a trace between them. A first tier, the agents or a Collector that only routes, uses the load_balancing exporter with ' +
      'routing_key: traceID, so every span of a trace goes to the same second-tier replica, where tail_sampling runs. ' +
      'routing_key: service would keep a service together but split its traces. The exporter was renamed from loadbalancing, ' +
      'and the old name still works as a deprecated alias.',
    specUrl: 'https://opentelemetry.io/docs/collector/deployment/gateway/#load-balancing-exporter',
    dash0Angle: null,
  },
  {
    id: 'filelog-tails-files',
    front: 'filelog tails files from the end by default and splits on newlines; multiline needs a pattern for where an entry starts.',
    back:
      'The filelog receiver (contrib and Kubernetes distributions, beta for logs) reads the files that match include. start_at ' +
      'defaults to end, so lines already in a file are skipped unless you set beginning. Entries split at newlines unless ' +
      'multiline gives a line_start_pattern or a line_end_pattern, which is how a stack trace stays one record; the split happens ' +
      'as the file is read, before any operator runs. Operators such as json_parser and regex_parser turn each entry into fields, ' +
      'and an embedded severity block sets the severity. Like any component it does nothing until a logs pipeline lists it. For ' +
      'code you own, exporting over OTLP with a log appender needs no files and no parsing, and carries the trace context.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/logs/',
    dash0Angle:
      'Dash0 Log AI infers a severity and extracts patterns from unstructured logs as they are ingested. It keeps a severity ' +
      'that is already set and leaves structured JSON logs to JSON log processing.',
  },
  {
    id: 'redact-in-the-pipeline',
    front:
      'Redact PII in the Collector before export. A spam filter drops whole points after they reach Dash0 and ' +
      'cannot edit one attribute.',
    back:
      'OTTL statements in the transform processor change telemetry inside the pipeline. A rename is a set followed ' +
      'by a delete_key, a redaction is a delete_key, a masking set or a replace_pattern, and dropping whole ' +
      'telemetry is the job of the filter processor. Sensitive values have to go before the exporter sends them, so ' +
      'the processor must be listed in every pipeline that carries them: defined but not listed does nothing. A ' +
      'statement that deletes from the wrong map, a misspelled key or a where clause that matches only some spans ' +
      'still leaks. Dash0 spam filters are the backend-side drop: they drop whole spans, logs or data points that ' +
      'match, at ingestion. A drop cannot be recovered, a filter cannot edit one attribute, and filtered telemetry ' +
      'still carries the ingest charge.',
    specUrl: 'https://opentelemetry.io/docs/collector/transforming-telemetry/',
    dash0Angle:
      'A Dash0 spam filter drops matching spans, logs and data points at ingestion. It is the backend-side drop, ' +
      'not a way to redact one attribute, and filtered telemetry still carries the ingest charge.',
  },
  {
    id: 'not-every-component',
    front:
      'A component works only in a distribution that ships it: check its Distributions row or the manifest, or ' +
      'build your own with OCB.',
    back:
      'The project ships pre-built Collector distributions (core, contrib, k8s, otlp and an eBPF profiling one), ' +
      'and each ships a different set of components, listed in its manifest.yaml and in the Distributions row of ' +
      'each component README. batch, memory_limiter and the otlp_grpc exporter are in core, contrib and k8s. ' +
      'k8sattributes, redaction and tail_sampling are in contrib and k8s but not core, and vendor exporters such as ' +
      'awss3 and awsxray are in contrib only. A config that names a component the binary does not contain stops the ' +
      'Collector with an unknown type error. When no distribution has what you need, including a component your ' +
      'team wrote, build your own with ocb, the OpenTelemetry Collector Builder, from a manifest that lists the ' +
      'components you want. The core list has grown over time, so read the current manifest rather than a copy.',
    specUrl: 'https://opentelemetry.io/docs/collector/distributions/',
    dash0Angle: null,
  },
  {
    id: 'parent-based-sampling',
    front:
      'Head sampling decides once, at the root. Child services must follow the parent\'s sampled flag, or traces come out with holes.',
    back:
      'Head sampling decides before the trace is complete, at its root span: OTEL_TRACES_SAMPLER=parentbased_traceidratio with ' +
      'OTEL_TRACES_SAMPLER_ARG=0.1 keeps about one trace in ten. ParentBased uses its root sampler only for a span with no ' +
      'parent. For a span with a parent it follows the parent\'s sampled flag, which travels in the W3C traceparent header: by ' +
      'default a sampled parent means sampled and an unsampled parent means dropped. A child that ignores the flag, such as one ' +
      'set to always_on, exports spans of traces whose root was dropped, and the backend shows traces with holes. ' +
      'TraceIdRatioBased ignores the parent\'s flag by design, so the spec recommends it only for root spans, in combination ' +
      'with ParentBased. If you set nothing, the default sampler is parentbased_always_on. Head sampling never sees the whole trace, ' +
      'so it cannot promise to keep the errors: that is what tail sampling is for.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/trace/sdk/#parentbased',
    dash0Angle: null,
  },
  {
    id: 'spanmetrics-before-sampling',
    front:
      'Compute span metrics before sampling: a connector fed from a tail_sampling pipeline counts only the spans of the traces kept.',
    back:
      'The span_metrics connector counts the spans it receives, for each set of dimensions, into calls and duration metrics. ' +
      'A connector is an exporter at the end of one pipeline and a receiver at the start of another, so it receives what leaves ' +
      'the processors of the traces pipeline that lists it. List it in a pipeline that has tail_sampling and it sees only the ' +
      'spans of the kept traces: the request rate comes out too low, and when the policies keep every error the error ratio comes out too ' +
      'high. Give the connector a traces pipeline of its own with no sampling processor, and let the sampled pipeline feed the ' +
      'backend. A receiver can be listed in more than one pipeline, so both pipelines can read the same one. The component was ' +
      'renamed from spanmetrics to span_metrics, and the old name still works but is deprecated.',
    specUrl: 'https://opentelemetry.io/docs/collector/configuration/#connectors',
    dash0Angle: null,
  },
  {
    id: 'rate-not-value',
    front: 'A counter only grows. Alert on its rate or increase() over a window, not its value: the value says nothing about now.',
    back:
      'A counter only goes up, or resets to zero when the process restarts. Compare its value with a threshold and the rule ' +
      'fires for good once the total passes it, failing or not; divide two totals and you average the whole history since the ' +
      'restart, which hides what is failing now. rate() calculates the per-second average rate of increase over the range ' +
      'you give it, and adjusts for counter resets from target restarts. So alert on a rate or an increase() over a window: ' +
      'sum(rate(errors[5m])) / sum(rate(all[5m])) > 0.02.',
    specUrl: 'https://prometheus.io/docs/prometheus/latest/querying/functions/#rate',
    dash0Angle: null,
  },
  {
    id: 'multi-window-burn',
    front: 'Page on a burn rate over two windows: the long one says it is worth a page, the short one says it is still happening.',
    back:
      'Burn rate is the error ratio divided by what the SLO allows. A short window alone pages on a blip: a 30-second total outage reads ' +
      '100 on the last 5 minutes, yet it spent only 1.2% of a 30-day budget. A long window alone starts slowly and keeps paging after the fix: ' +
      'a 10-minute outage still reads 167 on the last hour six minutes after the rollback. Pairing them does not speed up the start; it removes the blips ' +
      'and clears the page soon after recovery. Require both above the line, for example 14.4, which is 2% of a 30-day budget spent in an hour. ' +
      'The 30-day window and these figures are the game\'s example; Dash0 SLOs use 28 days.',
    specUrl: 'https://www.dash0.com/docs/dash0/monitoring/alerting/slos',
    dash0Angle:
      'A Dash0 SLO exposes ready-made fast burn and slow burn signals (a fast burn spends the budget quickly, a slow burn slowly), each paired with a shorter window that confirms the problem is still happening, ' +
      'so a check rule on them needs no hand-built two-window query.',
  },
  {
    id: 'synthetics-see-the-edge',
    front: 'Failures in front of your service (DNS, TLS, CDN, load balancer) leave no server span of yours; a probe from outside sees them.',
    back:
      'A server span covers the handling of a request that arrived at your service. A failed DNS lookup, a failed TLS handshake, or an answer from ' +
      'a CDN or a load balancer in front of it can happen before the request reaches your code, so your service records no server span and its ' +
      'error ratio can stay at 0%. A proxy or ingress you instrument records its own span, and a failed call out of your service is recorded ' +
      'by its client span, DNS error included. A synthetic check sends its own request from outside at regular intervals and fails when the lookup, ' +
      'the handshake or the response is wrong. Keep the spans for why a request that arrived went wrong.',
    specUrl: 'https://opentelemetry.io/docs/specs/semconv/http/http-spans/',
    dash0Angle:
      'A Dash0 synthetic check runs from public or private locations, shows DNS resolution, TCP connection and the SSL/TLS handshake ' +
      'for each run, and sends a notification through your channels when an assertion fails.',
  },
];
