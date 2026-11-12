// Level 5.4: Agent vs gateway. The player tells the gateway pattern from the agent, says why tail sampling in a
// gateway with several replicas needs the same Collector to see every span of a trace, wires the `load_balancing`
// exporter into an agent's traces pipeline so the Collector starts, and says what the exporter routes by (traceID).
// Spec: docs/OUTLINE.md §4 Act 5.
// Spec: https://opentelemetry.io/docs/collector/deployment/agent/ , https://opentelemetry.io/docs/collector/deployment/gateway/
// Docs (GitHub READMEs, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/loadbalancingexporter/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md
//
// Facts used: an agent runs close to the application or on the same host, as a sidecar or a DaemonSet; a gateway is one or
// more Collector instances running as a standalone service, such as a Deployment, with typically one endpoint per cluster,
// data center or region (the deployment pages). The tail_sampling processor needs all spans of a trace in the same Collector
// instance; the way to scale is two tiers, the first with the load balancing exporter (the processor README and the gateway
// page). The exporter picks a backend by hashing its routing_key: traceID is the default for traces, service keeps a service
// together, and traceID is not valid for metrics. The exporter type is now load_balancing; loadbalancing is a deprecated alias.
//
// COLLECTOR_SCHEMA (docs/M1-DESIGN.md §4.8) does not model component settings, so the configure step grades the wiring
// (`uses` requires load_balancing in the traces pipeline and otlp_grpc/gateway in the metrics one, `forbids` keeps otlp_grpc/gateway out of the traces list and load_balancing out of the metrics one) and says so; `routing_key` is graded by the last Choice step.
// Extending the schema to grade one key of one exporter was not worth it. Listing load_balancing in the metrics pipeline is
// wrong twice over: metrics must keep otlp_grpc/gateway (`uses`) and `forbids` rejects load_balancing there; the explain says metrics are not routed by trace ID.
// Accepted gap: pipelines are graded by name, so a second pipeline (say `traces/direct`) that sends traces to otlp_grpc/gateway
// is not caught by `forbids`; only the `traces` list is read. Not worth modelling for this level.

// Step 1: the patterns. `why` follows "Right." or "Not quite.".
const PATTERN = [
  {
    key: 'agent',
    label: 'A Collector next to the workload: a sidecar in the pod, or a <code>DaemonSet</code> pod on each node that the apps on that node send to, forwarding it onward',
    why: 'That is the agent pattern. An agent runs close to the application or on the same host, takes its telemetry and forwards it to a backend or to a gateway.',
  },
  {
    key: 'gateway',
    label: 'A standalone Collector service, such as a <code>Deployment</code>, that apps or agents send OTLP to: one endpoint per cluster, data center or region',
    right: true,
    why: 'The gateway pattern: one or more Collector instances run as a standalone service and give apps and agents a single OTLP endpoint, typically per cluster, data center or region. Work that should not be repeated on every node, such as sampling, can live there.',
  },
  {
    key: 'embedded',
    label: 'A Collector built into each application\'s process as a library, with no separate Collector process to run, upgrade or scale',
    why: 'Neither deployment pattern is a Collector inside the application. The application\'s SDK sends OTLP to a Collector that runs beside it (an agent) or to a central one (a gateway).',
  },
];

// Step 2: why tail sampling cares. `why` follows "Right." or "Not quite.".
const WHY = [
  {
    key: 'same-instance',
    label: 'Tail sampling decides per trace, so all spans of a trace must reach one Collector, and the Service splits them',
    right: true,
    why: 'The <code>tail_sampling</code> processor keeps spans in memory until it can decide on the whole trace, so all spans of a trace must reach the same Collector instance. An ordinary load balancer, or a Service that spreads requests, sends the spans of one trace to different replicas, and each replica decides on the part it has.',
  },
  {
    key: 'wait',
    label: '<code>decision_wait</code> is too short for slow requests, so each replica decides before the late spans of a trace arrive',
    why: '<code>decision_wait</code> is how long the processor waits before it decides on a trace, and a longer wait helps with late spans. It does not help when the spans are not at that Collector at all because they went to another replica.',
  },
  {
    key: 'unsupported',
    label: '<code>tail_sampling</code> cannot run in a gateway Collector, because only agent Collectors can hold spans in memory for a time',
    why: 'The processor runs in any Collector that includes it, such as the contrib and Kubernetes distributions. An agent only sees the spans of the pods on its own node, which does not help.',
  },
];

// Step 3: the config. The given is an agent whose traces pipeline names load_balancing, which nobody defined
// (the Collector would refuse to start); metrics go straight to the gateway Service.
const GIVEN = [
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  '        endpoint: 0.0.0.0:4317',
  'processors:',
  '  memory_limiter:',
  '    check_interval: 1s',
  '    limit_mib: 400',
  '  batch:',
  'exporters:',
  '  otlp_grpc/gateway:',
  '    endpoint: gateway-collector:4317',
  'service:',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, batch]',
  '      exporters: [load_balancing]',
  '    metrics:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, batch]',
  '      exporters: [otlp_grpc/gateway]',
  '',
].join('\n');

const REFERENCE = GIVEN.replace(
  '  otlp_grpc/gateway:\n    endpoint: gateway-collector:4317\n',
  [
    '  otlp_grpc/gateway:',
    '    endpoint: gateway-collector:4317',
    '  load_balancing:',
    '    routing_key: traceID',
    '    protocol:',
    '      otlp:',
    '        tls:',
    '          insecure: true',
    '    resolver:',
    '      dns:',
    '        hostname: gateway-collector-headless',
    '',
  ].join('\n'),
);

const CONFIG = {
  id: 'agw-config',
  schema: 'collector',
  given: GIVEN,
  reference: REFERENCE,
  uses: { traces: ['load_balancing'], metrics: ['otlp_grpc/gateway'] },
  forbids: { traces: ['otlp_grpc/gateway'], metrics: ['load_balancing'] },
  helps: { hints: true },
  hint: 'Every span of one trace has to reach the same gateway replica; metrics have no such need. That is why the traces list names an exporter of its own: give that name a definition rather than pointing traces where metrics already go.',
  explain:
    'A pipeline can only list an exporter that is defined, and one that is defined but not listed does nothing. Pointing traces at <code>otlp_grpc/gateway</code>, the Service in front of the replicas, ' +
    'would start the Collector and still split traces between them. <code>load_balancing</code> picks a replica by hashing a routing key: with <code>routing_key: traceID</code> every span of a trace goes to the same replica, ' +
    'so tail sampling there sees whole traces. For traces, <code>traceID</code> is also the default, so spelling it out only makes the intent clear. The resolver, DNS on a headless Service here, lists the replicas. ' +
    'Metrics are not routed by trace ID, which is not a valid key for metrics, so they keep their own exporter. The exporter\'s type was renamed from <code>loadbalancing</code>; the old name still works in the Collector as a deprecated alias, ' +
    'but this task asks for the current name, so a different id is a different component here. This game checks the wiring, not the settings: the routing key is the next question.',
};

// Step 4: the key. `why` follows "Right." or "Not quite.".
const KEY = [
  {
    key: 'trace-id',
    label: '<code>routing_key: traceID</code>: every span of a trace goes to the same gateway replica',
    right: true,
    why: 'The exporter picks a replica by hashing the routing_key, so every span with the same trace ID goes to the same one and the <code>tail_sampling</code> processor there sees the whole trace. For traces, traceID is also the default routing key, so setting it makes the intent explicit.',
  },
  {
    key: 'service',
    label: '<code>routing_key: service</code>: every span of one service goes to the same gateway replica',
    why: 'That keeps a service together, which suits something like the span metrics connector. A trace crosses services, so its spans still land on different replicas and the trace is split.',
  },
  {
    key: 'round-robin',
    label: 'Round robin: send each batch to the next replica in turn',
    why: 'The exporter does not round-robin batches: it hashes a routing key to choose the replica, so the same key always goes to the same one. Spreading batches evenly would split traces.',
  },
];

export default {
  id: 'agent-vs-gateway',
  no: '5.4',
  name: 'Agent vs gateway',
  sub: 'Where it runs',
  icon: '\u{1F500}',
  rewardTitle: 'Trace router',
  cards: ['tail-sampling-needs-one-collector'],
  lights: ['collector'],
  scoring: { parMs: null },
  play: {
    prefix: 'agw',
    steps: [
      {
        intro:
          'Kettle &amp; Co now runs a Collector on every node, and the platform team wants a central place for heavier work such as sampling. ' +
          'The Collector docs call the two shapes agent and gateway.',
        question: 'Which of these is the gateway pattern?',
        qid: 'agw-q-pattern',
        choice: { id: 'agw-pattern', choices: PATTERN },
      },
      {
        intro:
          'The gateway is a <code>Deployment</code> with three replicas behind a Kubernetes Service that spreads requests across them. ' +
          'The team turns on the <code>tail_sampling</code> processor there to keep slow and failed traces. Then the replicas disagree: one keeps its half of a trace and another drops its half.',
        question: 'Why?',
        qid: 'agw-q-why',
        choice: { id: 'agw-why', choices: WHY },
      },
      {
        intro:
          'The platform team\'s answer is two tiers: the agents route, and the gateway replicas, behind a headless Service, sample. ' +
          'This is an agent\'s config. Its traces pipeline names a <code>load_balancing</code> exporter that nobody defined, so it will not start.',
        question: 'Fix the agent config so it starts and sends traces through the <code>load_balancing</code> exporter. Metrics keep going straight to the gateway.',
        qid: 'agw-q-config',
        configure: CONFIG,
      },
      {
        intro:
          'The agents send traces through <code>load_balancing</code> now. A teammate asks what the exporter should route by so that the gateway\'s tail sampling sees whole traces.',
        question: 'Which routing key?',
        qid: 'agw-q-key',
        choice: { id: 'agw-key', choices: KEY },
      },
    ],
    finish:
      'You know an agent runs beside the workload and a gateway is a standalone service, and that tail sampling needs every span of a trace in one Collector: a load_balancing exporter routing by traceID in front of the gateways.',
  },
};
