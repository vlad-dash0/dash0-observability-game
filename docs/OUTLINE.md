# Outline

## 1. Pitch

**Working title: "On Call".** It's your first week as the on-call engineer at
*Kettle & Co*, a fictional online coffee-gear shop running a dozen services. Nothing
is instrumented, the last engineer left a note that says "good luck", and the pager
goes off on day one. Each level teaches one idea by having you do it: classify
signals, build a trace, fix a Collector config, write the PromQL, find the root cause
before the SLO budget runs out.

**Audience:** developers, SREs and platform engineers who have heard of
OpenTelemetry but not shipped it; Dash0 prospects in a sales motion; new Dash0
hires (SEs, CSMs, support). Not kids: plain technical language, real YAML, real
PromQL, real semantic-convention names.

**Goals**

1. Teach the concepts so they stick (doing, not reading).
2. Teach the OTel nuances that cost people days in production.
3. Show, without a hard sell, why an OTel-native backend makes each one easier.
4. Be short: each level takes 3 to 8 minutes; the whole game a few hours, playable in
   sittings.

## 2. What we take from webo-money-world

| webo-money-world | This game |
| --- | --- |
| Town hub; a prop pops in when a lesson completes | **World globe**: each act is a world region and each level a country; a country lights up when you finish its level, so a region fills in as you work through its act; a coral pulse marks the current incident (an open boss pulses its whole region); no edges between countries |
| One ES module per lesson + ordered registry (`lessons/index.mjs`) | Same. Each level is one file that exports `{id, no, name, …, run(ctx)}` (its act comes from its registry position; FOUNDATION.md §2.1); the hub, progress and rewards derive from the registry |
| `lesson-kit` primitives (`renderStep`, `speech`, `finish`) | Same kit plus engineer-grade widgets: YAML editor with validation, PromQL box run against a fake TSDB, trace waterfall, log stream, drag-to-classify |
| Stars per lesson | Stars (0 to 3) for accuracy and speed, plus collectible **Nuance cards** (section 5) |
| Lessons unlock in order | Acts unlock in order, except that an act stays open once entered (any of its levels or its boss completed); levels inside an act can be played in any order; a "boss" incident ends each act |
| Progress in `localStorage` + anonymous save codes | Keep both. Drop the COPPA-specific machinery; optionally add sign-in later for leaderboards |
| "Ask Webo" Claude proxy with moderation | **Ask the guide**: a Claude-backed helper that knows the glossary and the current level, gives hints rather than answers, and keeps the key server-side |
| Play-through tests for every lesson (linkedom) | Same, plus tests that every YAML/PromQL puzzle's reference answer passes its own checker |

webo-money-world was built by the same author, so its code is reused directly; see
[FOUNDATION.md](FOUNDATION.md) §5 for what is copied, adapted or left behind.

**Dogfooding:** the game itself is instrumented with OpenTelemetry (browser SDK +
the serverless functions) and sends to a Dash0 org. The final act's boss is a real
incident in the game you've been playing, viewed in Dash0.

## 3. Level types (mechanics)

1. **Sort it**: drag items into buckets (is this a metric, log, span or event? a
   resource attribute or a span attribute?).
2. **Build it**: assemble a span tree from loose spans; set parent IDs, kinds and
   status; the waterfall renders live.
3. **Configure it**: fix or complete a Collector / SDK config. Validated by a
   schema-aware checker; the pipeline animates data flowing (or not).
4. **Query it**: write PromQL against a fake dataset; graded by comparing result
   series, so any correct query passes.
5. **Spot it**: find the wrong line in a config, the bad attribute in a span, the
   cardinality bomb in a metric.
6. **Incident**: a timed scenario. Alerts fire, you pick what to look at, each view
   costs time, the SLO burn meter runs down. Scored on time to root cause and on
   not chasing red herrings.
7. **Trade-off**: budget puzzles: a sampling rate or retention plan that keeps the
   signal you need under a cost cap.

## 4. Curriculum

Each level lists **concept** / **OTel nuance** / **Dash0 tie-in** / **mechanic**.

### Act 0: Orientation ("Day one")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 0.1 Monitoring vs observability | Known-unknowns (dashboards) vs unknown-unknowns (asking new questions) | n/a | A tour of the hub map, which will become the Dash0 resource view | Sort it |
| 0.2 The signals | Metrics, logs, traces, and profiles as the fourth; what each is good and bad at | Profiles are the newest OTel signal and still maturing | All signals in one place, correlated | Sort it |
| 0.3 Why OpenTelemetry | Vendor-neutral API, SDK, protocol (OTLP), Collector, semantic conventions | API vs SDK split: libraries depend on the API only | Dash0 is OTel-native: OTLP in, semantic conventions understood, no proprietary agent | Sort it |
| Boss: "The pager" | An alert with no context; you can't answer anything yet | n/a | Motivates the rest of the game | Incident (designed to be unwinnable; it's the hook) |

### Act 1: Resources and identity ("Who is talking?")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 1.1 Resources | Telemetry is about *something*: service, pod, host, cloud region | Resource attributes vs signal attributes; putting `k8s.pod.name` on every span is wrong | Dash0 builds its resource / infrastructure views from resource attributes | Sort it |
| 1.2 Naming your service | `service.name`, `service.version`, `deployment.environment.name` | Missing `service.name` gives `unknown_service:<executable>`; `OTEL_SERVICE_NAME` wins over `OTEL_RESOURCE_ATTRIBUTES` | Services group and filter by these in Dash0 | Configure it |
| 1.3 Detectors and Kubernetes | Resource detectors; the `k8sattributes` processor | Detectors run at SDK start; pod metadata is better added in the Collector | Dash0 Kubernetes operator auto-instruments workloads and adds resource attributes | Configure it |

### Act 2: Traces ("Follow the request")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 2.1 Spans and traces | Trace ID, span ID, parent, start/end, attributes | A trace is just spans sharing a trace ID; there is no trace object | Trace waterfall | Build it |
| 2.2 Span kinds | SERVER, CLIENT, PRODUCER, CONSUMER, INTERNAL | Kinds drive service-map edges; wrong kinds break the map | Dash0 service map derives from client/server pairs | Build it |
| 2.3 Status and errors | Unset, Error, Ok | A 404 is an error on the CLIENT span but not on the SERVER span; Ok is for overriding, not the default | Error rates in Dash0 follow span status | Spot it |
| 2.4 Context propagation | W3C `traceparent` / `tracestate` across HTTP and queues | A proxy that drops headers splits one trace into two; async work needs links, not parents | Broken traces show as orphan roots | Spot it + Build it |
| 2.5 Baggage | Key/values that travel with the context | Baggage isn't added to spans automatically, and it leaks to third parties | n/a | Sort it |
| 2.6 Events and links | Span events (exceptions), span links (batch consumers, fan-in) | `exception` events vs separate logs; recording an exception doesn't set status | Exceptions surfaced on spans | Build it |
| 2.7 Auto vs manual | Zero-code instrumentation, then adding business spans and attributes | Double instrumentation (injected agent + your own SDK setup) can duplicate spans, depending on the instrumentation: fetch client spans do today | Operator-injected auto-instrumentation | Configure it |
| Boss: "Checkout is slow" | Latency spike; find the span that changed | n/a | Dash0 triage: compare attribute distributions of slow vs normal spans | Incident |

### Act 3: Metrics ("How much, how often")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 3.1 Instruments | Counter, UpDownCounter, Gauge, Histogram; sync vs async | Using a gauge for a count loses rate math | n/a | Sort it |
| 3.2 Temporality | Cumulative vs delta | Prometheus-style backends need cumulative; the `deltatocumulative` processor; restarts reset counters | Dash0 accepts both and queries with PromQL | Spot it |
| 3.3 Histograms | Explicit buckets vs exponential histograms; percentiles | Averages hide tails; default buckets may not fit your latencies | `histogram_quantile` in Dash0 | Query it |
| 3.4 PromQL basics | `rate`, `sum by`, ranges, `increase` | OTel to Prometheus name translation: dots to underscores, unit suffixes, `_total` | Dash0 speaks PromQL for metrics **and** for logs and spans | Query it |
| 3.5 Cardinality | Series = every unique label combination | `user.id` or a raw URL as a label is a bill and an outage; use `http.route` | Dash0 shows what drives volume; spam filters drop it at ingest | Spot it + Trade-off |
| 3.6 Exemplars | Linking a metric point to a trace | Exemplars only appear if the SDK records them with sampled spans | Jump from a spike to a trace | Query it |
| 3.7 RED and USE | Rate/Errors/Duration for services; Utilisation/Saturation/Errors for resources | Span metrics: deriving RED from traces with the `spanmetrics` connector | RED metrics derived from spans in Dash0 | Query it |

### Act 4: Logs ("What did it say?")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 4.1 Structured logs | Body vs attributes; severity number and text | The Logs Bridge API is for appender authors, not app code; keep your logger | n/a | Sort it |
| 4.2 Correlation | `trace_id` / `span_id` on log records | Only automatic when the log call happens inside an active span with a bridged logger | Logs shown in the trace view, and the reverse | Build it |
| 4.3 Collecting logs | `filelog` receiver, parsing, multiline | stdout JSON vs OTLP export; parsing in the Collector vs the app | Dash0 log AI: pattern grouping and severity inference for unstructured logs | Configure it |
| Boss: "The 3 a.m. errors" | Error burst; correlate logs to the trace to the deploy | n/a | One query language across signals | Incident |

### Act 5: The Collector ("The plumbing")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 5.1 Pipelines | Receivers, processors, exporters, connectors, extensions | A component defined but not in `service.pipelines` does nothing | n/a | Configure it |
| 5.2 Order matters | `memory_limiter` first, `batch` late | Processor order is per pipeline and significant | n/a | Spot it |
| 5.3 OTLP endpoints | gRPC 4317 vs HTTP 4318 | With `OTEL_EXPORTER_OTLP_ENDPOINT` the SDK appends `/v1/traces`; with the per-signal variable it doesn't | Dash0 OTLP endpoint + auth token header | Configure it |
| 5.4 Agent vs gateway | DaemonSet agent, gateway deployment | Tail sampling needs all spans of a trace in one place: `loadbalancing` exporter by trace ID | n/a | Configure it |
| 5.5 OTTL and transforms | Rename, redact, drop | Redact PII in the pipeline before it leaves the cluster | Spam filters as the backend-side drop | Configure it |
| 5.6 Distributions | core vs contrib; custom builds (OCB) | Not every component is in every distribution | n/a | Sort it |

### Act 6: Sampling and cost ("You can't keep everything")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 6.1 Head sampling | Decide at the root; `parentbased_traceidratio` | Child services must respect the parent's decision or traces break | n/a | Trade-off |
| 6.2 Tail sampling | Keep errors and slow traces, sample the rest | Memory and decision-wait cost; sampled RED metrics need span metrics computed before sampling | n/a | Trade-off + Spot it |
| 6.3 What costs money | Volume, cardinality, retention | Per-GB vs per-host vs per-signal pricing changes what you optimise | Dash0 prices per signal (spans, log records, metric data points), with telemetry volume visible per service | Trade-off |

### Act 7: Alerting and SLOs ("Wake me only when it matters")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 7.1 Good alerts | Symptoms not causes; `for` durations; flapping | Alerting on a cumulative counter's value instead of its rate | Dash0 check rules are Prometheus-compatible | Spot it |
| 7.2 SLIs and SLOs | Good events / valid events; error budgets | Choosing the SLI from server spans vs load-balancer metrics | n/a | Query it |
| 7.3 Burn-rate alerts | Multi-window, multi-burn-rate | Short window alone pages on blips; long window alone pages too late | Check rules + notification channels | Query it |
| 7.4 Synthetic checks | Probing from outside | Synthetics catch DNS/TLS/CDN problems your spans never see | Dash0 synthetic checks | Configure it |

### Act 8: Operating at scale ("As code")

| Level | Concept | Nuance | Dash0 tie-in | Mechanic |
| --- | --- | --- | --- | --- |
| 8.1 Dashboards as code | Versioned, reviewed dashboards | n/a | Dash0 dashboards are Perses-based; manage them with Terraform or the Kubernetes operator | Configure it |
| 8.2 Semantic convention versions | Conventions evolve: `http.method` became `http.request.method` | `OTEL_SEMCONV_STABILITY_OPT_IN` and dual-emitting during migration | Dash0 understands semantic conventions, so the views work out of the box | Spot it |
| 8.3 Migrating vendors | Moving dashboards and alerts off a proprietary tool | Proprietary query languages don't map 1:1 | DART: Datadog/Sentry/etc. to Dash0 + Terraform | Sort it |
| 8.4 Frontend / RUM | Browser telemetry, Web Vitals, sessions | Browser spans and CORS for the OTLP endpoint | Dash0 website monitoring | Build it |
| 8.5 AI-assisted debugging | Letting an agent query your telemetry | Agents need good semantic conventions as much as humans do | Dash0 MCP server and Agent0 | Incident (with the guide as copilot) |
| Final boss: "It's us" | A real incident in the game's own telemetry, in Dash0 | n/a | Everything together | Incident |

## 5. Nuance cards (collectibles)

Each OTel nuance above is a card you earn when you get it right (or get burned by
it). A card is one front-side fact ("A 404 is not an error on the server span") and a
back side with the why, the spec link and the Dash0 angle. The deck doubles as a
cheat sheet you can export. Starter deck, in rough order:

1. `service.name` missing gives `unknown_service`.
2. Resource attributes describe the source; span attributes describe the operation.
3. Libraries depend on the API; only applications install the SDK.
4. Span status: Unset by default; Error per kind (4xx only on CLIENT); Ok overrides.
5. Recording an exception doesn't set span status.
6. Broken propagation shows up as extra root spans.
7. Async/batch work uses span links, not parent-child.
8. Baggage isn't copied onto spans, and it crosses trust boundaries.
9. Delta vs cumulative temporality; counter resets.
10. OTel metric names change when translated to Prometheus.
11. High-cardinality attributes belong on spans/logs, not metric labels.
12. Exemplars need sampled spans in context.
13. Log correlation only works through a bridged logger inside an active span.
14. A Collector component outside `service.pipelines` is inert.
15. `memory_limiter` first, `batch` later.
16. Generic OTLP endpoint gets `/v1/<signal>` appended; per-signal endpoints don't.
17. Tail sampling needs trace-ID-aware load balancing.
18. Compute span metrics before sampling, or your rates are wrong.
19. The batch processor buffers; short-lived processes (serverless, CLIs) must flush on shutdown.
20. Semantic conventions are versioned; migrate with the stability opt-in.
21. Double instrumentation creates duplicate spans.

## 6. How Dash0 brings it together

The thread through every act: each nuance is a place where data loses its meaning
(no resource, broken context, wrong temporality, wrong names). The pitch is that an
OTel-native backend keeps that meaning instead of flattening it. The game makes the
case by showing the "before" (the player struggling with raw data in the game's
simplified UI) and then the "after" view in Dash0. Points to make, one per act:

- **OTel-native ingestion**: OTLP straight in, no proprietary agent, semantic
  conventions understood out of the box (Acts 0, 1, 8).
- **Resource-centric**: everything hangs off the resource it came from; Kubernetes
  operator for auto-instrumentation and metadata (Act 1).
- **One query language**: PromQL across metrics, logs and spans (Acts 3, 4, 7).
- **Correlation built in**: trace to log to metric via IDs and exemplars (Acts 2 to 4).
- **Triage**: compare attribute distributions to find what's different about the
  bad requests (Act 2 boss).
- **Log AI**: structure for unstructured logs (Act 4).
- **Cost control you can see**: per-signal pricing, spam filters to drop noise at
  ingest (Acts 3, 6).
- **Prometheus-compatible alerting and synthetic checks** (Act 7).
- **As code**: Perses dashboards, Terraform provider, operator CRDs; DART for
  migration (Act 8).
- **AI**: MCP server and Agent0 (Act 8).

To verify with the Dash0 product team before we write copy: the exact current names
and scope of Triage, Log AI, spam filters, Agent0 and website monitoring, and the
pricing wording.

## 7. Open questions

1. **Hosting and org**: does the repo move to `dash0hq` once it's real, and who signs
   off on Dash0 branding in a public game?
2. **Real Dash0 or simulated**: Acts 0 to 7 run on a simulated backend in the browser
   (no signup). Should the final act use a shared demo org, or the player's own trial?
3. **Gating**: fully free/anonymous, or email gate for leaderboards and a certificate?
4. **Length**: is ~40 levels too many for v1? A cut-down v1 could be Acts 0, 1, 2 and
   the Act 2 boss.
5. ~~**Base code**: ask wealthbot-io for permission to reuse code, or rebuild the
   pattern from scratch.~~ **Resolved**: reuse directly; the game's author owns it.
6. **Tone and setting**: is "Kettle & Co" the right fictional company? Mascot or none?

## 8. Proposed milestones

Decided 2026-10-31: platform before content, so later acts are mostly content.

1. **M0, skeleton** (done): hub map, registry, lesson kit, progress, test harness; one
   level end to end (1.2 Naming your service).
2. **M1, vertical slice** (done): Act 0 + Act 2 + the Act 2 boss. Ask the guide moved
   out of M1 and has not shipped (separate track below).
3. **M2, platform**: declarative levels (#71, designed first: [DECLARATIVE-LEVELS.md](DECLARATIVE-LEVELS.md)), Configure it (#3), Query
   it (#4), Spot it (#5), Trade-off (#7), each proven by one thin level.
4. **M3, content**: Acts 1, 3, 4, 5.
5. **M4, content**: Acts 6 to 8; game instrumented into Dash0 (dogfooding); final boss.

Separate tracks: Ask the guide (#17) and Act 9.
