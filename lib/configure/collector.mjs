// The Collector configuration schema for Configure it (docs/M1-DESIGN.md §4.8).
// Shape: https://opentelemetry.io/docs/collector/configuration/ . A deliberate subset for
// the game: the six top-level sections, pipelines for the three signals, and the
// references between them. Component settings are not validated (any mapping, or none).
import { deepFreeze } from './schema.mjs';

const COMPONENTS = {
  type: 'mapping',
  nullable: true,
  additional: { type: 'mapping', nullable: true, additional: { type: 'any' } },
  keyPattern: '^[A-Za-z0-9_]+(/\\S+)?$',
  keyExpect: 'a component id such as "otlp" or "otlp/2"',
};
const STRINGS = { type: 'list', items: { type: 'string' } };

export const COLLECTOR_SCHEMA = deepFreeze({
  root: {
    type: 'mapping',
    required: ['service'],
    keys: {
      receivers: COMPONENTS,
      processors: COMPONENTS,
      exporters: COMPONENTS,
      connectors: COMPONENTS,
      extensions: COMPONENTS,
      service: {
        type: 'mapping',
        required: ['pipelines'],
        keys: {
          extensions: STRINGS,
          telemetry: { type: 'mapping', additional: { type: 'any' } },
          pipelines: {
            type: 'mapping',
            min: 1,
            keyPattern: '^(traces|metrics|logs)(/\\S+)?$',
            keyExpect: 'a signal (traces, metrics or logs), optionally followed by /name',
            additional: {
              type: 'mapping',
              required: ['receivers', 'exporters'],
              keys: {
                receivers: { ...STRINGS, min: 1 },
                processors: STRINGS,
                exporters: { ...STRINGS, min: 1 },
              },
            },
          },
        },
      },
    },
  },
  refs: [{ at: 'service.extensions[]', in: ['extensions'] }],
  pipelines: {
    at: 'service.pipelines',
    stages: [
      { key: 'receivers', in: ['receivers', 'connectors'] },
      { key: 'processors', in: ['processors'] },
      { key: 'exporters', in: ['exporters', 'connectors'] },
    ],
  },
});
