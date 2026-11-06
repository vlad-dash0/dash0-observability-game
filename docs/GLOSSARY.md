# Glossary

Terms the game teaches, grouped by topic. Each entry is one or two lines; the game
links level text to these anchors. "(Act N)" is where it's taught.

## Foundations

- **Observability**: being able to answer new questions about a system's behaviour from
  its outputs, without shipping new code. (Act 0)
- **Monitoring**: watching known indicators for known failure modes. (Act 0)
- **Telemetry**: the data a system emits about itself.
- **Signal**: a kind of telemetry. OTel defines traces, metrics, logs and (newer)
  profiles. (Act 0)
- **Cardinality**: the number of unique values (or label combinations) a field has;
  for metrics, the number of time series. (Act 3)
- **Clue**: an evidence view on an incident board that helps explain the alert. Finding
  enough of them unlocks the causes.
- **Misleading view**: an evidence view that does not explain the alert (a red herring). Opening one counts as one penalty.
  Opening one costs a star.
- **MTTD / MTTR**: mean time to detect / to resolve an incident.
- **Par time**: the time a level sets as its target. Finishing slower costs one penalty.

## OpenTelemetry

- **OpenTelemetry (OTel)**: CNCF project defining vendor-neutral APIs, SDKs, a wire
  protocol and a Collector for telemetry. (Act 0)
- **API**: the interfaces libraries call to emit telemetry; a no-op without an SDK.
- **SDK**: the implementation an application installs to process and export telemetry.
- **OTLP**: the OpenTelemetry Protocol; gRPC (port 4317) or HTTP/protobuf (port 4318).
  (Act 5)
- **Instrumentation**: code that emits telemetry. *Auto / zero-code* is injected
  (agents, operator); *manual* is written by you. (Act 2)
- **Instrumentation scope**: the library or module that produced a piece of telemetry.
- **Semantic conventions**: standard attribute names and meanings (`http.request.method`,
  `db.system.name`, `service.name`). Versioned. (Acts 1, 8)
- **Stability opt-in**: `OTEL_SEMCONV_STABILITY_OPT_IN`. `http/dup` sends the old and the stable names; `http` sends only the stable names. (Act 8)
- **Resource**: the entity producing telemetry, described by resource attributes.
  (Act 1)
- **Resource detector**: SDK component that fills in resource attributes from the
  environment (host, container, cloud, Kubernetes).
- **Attribute**: a key/value pair on a span, metric point, log record or resource.
- **Exporter / processor / receiver**: components that send, transform or accept
  telemetry (in the SDK or the Collector). (Act 5)

## Traces

- **Trace**: all spans sharing one trace ID; one request's path through the system.
  (Act 2)
- **Span**: one timed operation with a name, kind, start/end, attributes, status,
  events and links.
- **Root span**: a span with no parent.
- **Span kind**: SERVER, CLIENT, PRODUCER, CONSUMER or INTERNAL.
- **Span status**: Unset, Error or Ok.
- **Span event**: a timestamped note inside a span, for example an exception.
- **Span link**: a reference to another span that is related but not a parent, used
  for batches and fan-in.
- **Context**: the active trace/span (and baggage) carried through a process.
- **Context propagation**: passing context between processes, usually via W3C
  `traceparent` and `tracestate` headers. (Act 2)
- **Baggage**: user-defined key/values propagated with the context.
- **Sampling**: keeping a subset of traces. *Head* sampling decides at the start;
  *tail* sampling decides after the trace completes. (Act 6)

## Metrics

- **Instrument**: Counter, UpDownCounter, Gauge, Histogram (sync) and their
  observable/async forms. (Act 3)
- **Data point**: one measurement of a metric at a time with its attributes.
- **Time series**: the stream of points for one metric + attribute combination.
- **Temporality**: *cumulative* (total since start) or *delta* (change since last
  report).
- **Histogram**: counts of values in buckets; *exponential* histograms pick buckets
  automatically.
- **Exemplar**: a sample point on a metric linked to a trace/span ID.
- **View**: SDK configuration that renames, filters or re-buckets a metric.
- **PromQL**: the Prometheus query language. (Act 3)
- **RED**: Rate, Errors, Duration, for request-driven services.
- **USE**: Utilisation, Saturation, Errors, for resources.
- **Span metrics**: RED metrics derived from spans (the `span_metrics` connector; `spanmetrics` is its deprecated alias).

## Logs

- **Log record**: timestamp, severity, body, attributes, and optional trace/span IDs.
  (Act 4)
- **Severity number / text**: OTel's 1 to 24 severity scale and its label.
- **Structured logging**: logs as key/value data instead of free text.
- **Logs Bridge API**: the API logging-library appenders use to emit OTel logs.
- **Correlation**: linking logs, metrics and traces through shared IDs and resources.

## Collector

- **Collector**: a standalone service that receives, processes and exports telemetry.
  (Act 5)
- **Pipeline**: receivers, then processors, then exporters, per signal, declared under
  `service.pipelines`.
- **Connector**: a component that is an exporter in one pipeline and a receiver in
  another (for example `span_metrics`, whose deprecated alias is `spanmetrics`).
- **Extension**: non-pipeline capability (health check, auth, storage).
- **Agent / gateway**: a Collector per node vs a central Collector tier.
- **OTTL**: the OpenTelemetry Transformation Language, used in transform/filter
  processors.
- **Distribution**: a packaged Collector build (core, contrib, vendor, or custom via the
  OpenTelemetry Collector Builder, OCB).
- **OpAMP**: protocol for remotely managing agents and Collectors.

## Reliability

- **SLI**: a measured indicator of service quality (for example, the share of requests
  under 300 ms). (Act 7)
- **SLO**: a target for an SLI over a window (99.9% over 30 days).
- **Error budget**: the allowed failure under an SLO (0.1%). In the game's incident boards, the minutes of
  investigation you can spend before the budget runs out.
- **Burn rate**: how fast the error budget is being used relative to plan.
- **Synthetic check**: a scripted probe from outside the system.
- **Alert fatigue**: ignoring alerts because too many are noise.

## Dash0

- **Dash0**: an OpenTelemetry-native observability platform for traces, metrics, logs
  and more.
- **Dash0 operator**: Kubernetes operator that auto-instruments workloads and ships
  telemetry to Dash0. (Act 1)
- **Check rule**: a Prometheus-compatible alerting rule in Dash0. (Act 7)
- **Dashboards (Perses)**: Dash0 dashboards follow the open Perses format and can be
  managed as code. (Act 8)
- **Spam filter**: a rule that drops unwanted telemetry at ingest. (Acts 3, 6)
- **Triage**: comparing attribute distributions between a selection and a baseline to
  find what's different. (Act 2)
- **Log AI**: pattern and severity extraction for unstructured logs. (Act 4)
- **Dash0 MCP server / Agent0**: AI access to your telemetry. (Act 8)
- **DART**: Dashboards, Alerts & Rules to Terraform; migrates assets from other vendors
  into Dash0. (Act 8)

Dash0 product names and descriptions to be checked with the product team before
release.
