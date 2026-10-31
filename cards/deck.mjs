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
];
