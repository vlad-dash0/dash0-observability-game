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
];
