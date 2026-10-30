// Nuance cards a level can award (docs/FOUNDATION.md §2.3), checked by validateDeck:
// { id, front (<=140 chars), back, specUrl ('https://...'), dash0Angle (text or null) }.
export const DECK = [
  {
    id: 'unknown-service',
    front: 'Without service.name, your telemetry arrives as unknown_service:<executable>.',
    back:
      'With neither OTEL_SERVICE_NAME nor service.name in OTEL_RESOURCE_ATTRIBUTES set, the ' +
      'SDK reports service.name as unknown_service:<executable> (unknown_service:node for ' +
      'Node), or plain unknown_service when it cannot tell the executable. When both are ' +
      'set, OTEL_SERVICE_NAME wins.',
    specUrl: 'https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/',
    dash0Angle:
      'Any backend that groups telemetry by service, Dash0 included, can only tell your ' +
      'services apart when each one sets its own service.name.',
  },
];
