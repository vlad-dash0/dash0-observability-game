// Level 5.1: Pipelines. The player says which component type joins two pipelines (a connector),
// fixes a Collector config so the `memory_limiter` processor, defined but listed in no pipeline,
// is wired into the traces and metrics pipelines and the Collector starts, and says where an
// extension is enabled (under `service.extensions`, not in a pipeline).
// Spec: docs/OUTLINE.md §4 Act 5.
// Spec: https://opentelemetry.io/docs/collector/configuration/#service , https://opentelemetry.io/docs/collector/configuration/#connectors , https://opentelemetry.io/docs/collector/configuration/#extensions
// Spec: https://opentelemetry.io/docs/collector/configuration/#processors , https://opentelemetry.io/docs/collector/components/
// Docs (GitHub READMEs, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector/blob/main/connector/README.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/healthcheckextension/README.md
// Docs (exporter type names, Collector v0.164.0; the one place Act 5 says the old names are deprecated aliases): https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlpexporter/metadata.yaml , https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlpexporter/factory.go , https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlphttpexporter/metadata.yaml , https://github.com/open-telemetry/opentelemetry-collector/blob/main/CHANGELOG.md (v0.144.0: #14403, #14396)
//
// The configure step grades the config through COLLECTOR_SCHEMA (docs/M1-DESIGN.md §4.8), which does
// not model component settings, so the step grades the wiring (defined, the Collector would start,
// `uses` requires the traces and the metrics pipeline to list memory_limiter, and `extensions` requires health_check enabled under service.extensions) and says so. The
// given's own error is the extension (enabled in `service.extensions` but not defined), so the
// level shows both directions of the same rule: listed but not defined stops the Collector,
// defined but not listed does nothing. Where memory_limiter sits in each list is level 5.2.

// Step 1: the five component types, through the one that joins pipelines. `why` follows "Right." or "Not quite.".
const JOIN = [
  {
    key: 'processor',
    label: 'A processor, listed in the traces pipeline',
    why: 'A processor changes or filters data inside one pipeline. It cannot hand traces to a different pipeline as metrics.',
  },
  {
    key: 'connector',
    label: 'A connector, such as <code>count</code>, used as an exporter in the traces pipeline and as a receiver in the metrics pipeline',
    right: true,
    why: 'A connector is both an exporter and a receiver: it consumes data at the end of one pipeline and emits data at the start of another, of the same signal or a different one. It has to be used in both roles. Defining it under <code>connectors</code> only configures it.',
  },
  {
    key: 'extension',
    label: 'An extension, enabled under <code>service.extensions</code>',
    why: 'Extensions add abilities that are not part of the data path, such as a health check. They do not take part in a pipeline at all.',
  },
];

// Step 2: the config. The given enables health_check without defining it (the Collector would
// refuse to start) and defines memory_limiter without listing it. The reference does both jobs.
const GIVEN = [
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  'processors:',
  '  memory_limiter:',
  '    check_interval: 1s',
  '    limit_mib: 400',
  '    spike_limit_mib: 100',
  '  batch:',
  'exporters:',
  '  otlp_grpc/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  'service:',
  '  extensions: [health_check]',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [batch]',
  '      exporters: [otlp_grpc/dash0]',
  '    metrics:',
  '      receivers: [otlp]',
  '      processors: [batch]',
  '      exporters: [otlp_grpc/dash0]',
  '',
].join('\n');

const REFERENCE = [
  'extensions:',
  '  health_check:',
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  'processors:',
  '  memory_limiter:',
  '    check_interval: 1s',
  '    limit_mib: 400',
  '    spike_limit_mib: 100',
  '  batch:',
  'exporters:',
  '  otlp_grpc/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  'service:',
  '  extensions: [health_check]',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, batch]',
  '      exporters: [otlp_grpc/dash0]',
  '    metrics:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, batch]',
  '      exporters: [otlp_grpc/dash0]',
  '',
].join('\n');

const CONFIG = {
  id: 'pipe-config',
  schema: 'collector',
  given: GIVEN,
  reference: REFERENCE,
  uses: { traces: ['memory_limiter'], metrics: ['memory_limiter'] },
  extensions: ['health_check'],
  helps: { hints: true },
  hint: 'A component works only when it is both defined in its own section and enabled by a list under <code>service</code>. Compare the two both ways: a name listed but not defined stops the Collector, and a component defined but listed nowhere does nothing. Fix by adding what is missing, not by deleting a name.',
  explain:
    'A component takes effect only when it is both defined in its section and enabled: receivers, processors and exporters by listing them in a pipeline, ' +
    'extensions under <code>service.extensions</code>. Listed but not defined, the Collector refuses to start, as with <code>health_check</code> here. ' +
    'Defined but not listed, the component is not enabled and does nothing: <code>memory_limiter</code> was sitting under ' +
    '<code>processors</code> while both pipelines ran without it. Deleting it, listing it in only one pipeline, or giving it another name would all leave a pipeline ' +
    'unprotected, so the task needs it listed in both. Each pipeline gets its own instance of a processor listed in several. ' +
    'The order of each list is the next level\'s question, and this game checks the wiring, not the settings. ' +
    'In Collector v0.164.0 the OTLP gRPC exporter is <code>otlp_grpc</code> and the OTLP HTTP exporter is <code>otlp_http</code>; ' +
    '<code>otlp</code> and <code>otlphttp</code> are deprecated aliases that still resolve, and every config in this act uses the new names.',
};

// Step 3: extensions. `why` follows "Right." or "Not quite.".
const EXTENSION = [
  {
    key: 'in-pipeline',
    label: 'It is not listed in a pipeline, next to the receivers',
    why: 'Extensions are not part of a pipeline: they sit beside the data path. A pipeline lists receivers, processors and exporters (and connectors), not extensions.',
  },
  {
    key: 'service-extensions',
    label: 'It is defined under <code>extensions</code> but not listed under <code>service.extensions</code>',
    right: true,
    why: 'Configuring an extension does not enable it. Extensions are enabled by listing them under <code>service.extensions</code>, not in a pipeline. Defined but not listed, <code>health_check</code> is not enabled, so nothing answers.',
  },
  {
    key: 'start-order',
    label: 'Extensions start only after the exporters, and the Collector has not finished starting',
    why: 'An extension that is listed under <code>service.extensions</code> starts with the Collector. Nothing about the order of components keeps it from answering.',
  },
];

export default {
  id: 'pipelines',
  no: '5.1',
  name: 'Pipelines',
  sub: 'Wired or not',
  icon: '\u{1F527}',
  rewardTitle: 'Pipeline plumber',
  cards: ['configured-not-enabled'],
  lights: ['collector'],
  scoring: { parMs: null },
  play: {
    prefix: 'pipe',
    steps: [
      {
        intro:
          'Every service at Kettle &amp; Co sends its telemetry to one Collector. A Collector config has five kinds of ' +
          'component: <b>receivers</b> take data in, <b>processors</b> change it, <b>exporters</b> send it out, ' +
          '<b>connectors</b> join two pipelines, and <b>extensions</b> add abilities beside the data path, such as a health check. ' +
          'The team wants a metric that counts particular span events in its traces.',
        question: 'Which component turns the end of the traces pipeline into the start of a metrics pipeline?',
        qid: 'pipe-q-connector',
        choice: { id: 'pipe-connector', choices: JOIN },
      },
      {
        intro:
          'The Collector ran out of memory on Friday and was killed. The platform team added a ' +
          '<code>memory_limiter</code> processor, but the Collector is still unprotected, and today it will not start.',
        question: 'Fix the config so the Collector starts, <code>memory_limiter</code> runs in both the traces and the metrics pipeline, and the <code>health_check</code> extension stays enabled.',
        qid: 'pipe-q-config',
        configure: CONFIG,
      },
      {
        intro:
          'The Collector runs now. A second one, in the EU cluster, has a <code>health_check</code> extension defined under ' +
          '<code>extensions</code>, so Kubernetes can probe it. The probe never gets an answer.',
        question: 'What is missing?',
        qid: 'pipe-q-extension',
        choice: { id: 'pipe-extension', choices: EXTENSION },
      },
    ],
    finish:
      'You know a component does nothing until it is enabled: listed in a pipeline, or under service.extensions. A defined memory_limiter that no pipeline lists protects nothing.',
  },
};
