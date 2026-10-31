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
];
