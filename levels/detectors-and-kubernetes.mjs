// Level 1.3: Detectors and Kubernetes. The player says when an SDK's resource detectors run and
// where pod metadata is better added (the Collector), fixes a Collector config so the
// `k8sattributes` processor is defined and listed in the traces pipeline, says what the processor
// needs to look pods up, and says what the Dash0 operator adds for a workload.
// Spec: docs/OUTLINE.md §4 Act 1.
// Spec: https://opentelemetry.io/docs/concepts/resources/#resource-detectors , https://opentelemetry.io/docs/specs/otel/resource/sdk/#resource-detector
// Spec: https://opentelemetry.io/docs/platforms/kubernetes/collector/components/#kubernetes-attributes-processor , https://opentelemetry.io/docs/collector/components/processor/ , https://opentelemetry.io/docs/collector/configuration/#processors
// Spec: https://opentelemetry.io/docs/specs/semconv/resource/k8s/#pod
// Dash0 docs: https://www.dash0.com/docs/dash0/monitoring/kubernetes/dash0-operator/auto-instrumentation
//
// The configure step grades the config through COLLECTOR_SCHEMA (docs/M1-DESIGN.md §4.8), which
// does not model component settings, so the step grades the wiring (defined, the Collector would
// start, and `uses` requires the traces pipeline to list k8sattributes) and the settings are taught
// in the choice steps. `uses` implies the traces pipeline must flow, so there is no `target`.

// Step 1: when detectors run. `why` follows "Right." or "Not quite.".
const WHEN = [
  {
    key: 'per-span',
    label: 'On every span, in a span processor, to keep the values fresh',
    why: 'A Resource is attached to the tracer provider when the provider is created, and that association cannot be changed later. Detection is expected to finish quickly because it runs while the application starts, not per span.',
  },
  {
    key: 'at-start',
    label: 'Once, when the SDK starts: the Resource is detected then and stays as it is',
    right: true,
    why: 'Resource detectors read what the environment shows, such as the host, the operating system, the process and the container, while the application initializes. The result is the Resource, and it is attached to the providers when they are created and cannot be changed later.',
  },
  {
    key: 'in-backend',
    label: 'In the backend, from the IP address that the telemetry arrives from',
    why: 'A backend can only read the resource attributes that arrive with the telemetry. Detection happens before that, in the SDK when it starts.',
  },
];

// Step 2: where pod metadata is better added.
const WHERE = [
  {
    key: 'collector',
    label: 'In the Collector, with the <code>k8sattributes</code> processor',
    right: true,
    why: 'The processor discovers the pods in the cluster through the Kubernetes API, looks up the pod each piece of telemetry came from, and adds the pod, namespace, deployment and node, and optionally pod labels and annotations, as resource attributes. One processor covers every service in every language, and the Collector can ask the Kubernetes API for things a process does not know on its own. It is a contrib component: it ships in the contrib and Kubernetes Collector distributions, not in the core one.',
  },
  {
    key: 'per-service',
    label: 'In each service, with its own SDK setup and <code>OTEL_RESOURCE_ATTRIBUTES</code>, one service at a time',
    why: 'It can work, but every service and every language needs the same setup, and a process only knows what it is told about its pod. Adding it once in the Collector is simpler and covers them all.',
  },
  {
    key: 'span-processor',
    label: 'On every span, as a <code>k8s.pod.name</code> attribute from a custom span processor in each service',
    why: 'Pod metadata describes the producer, so it belongs on the Resource, not on each span (level 1.1). It also leaves metrics and logs without it.',
  },
];

// Step 3: the config. The pipeline lists `k8sattributes`, but it is not defined: the Collector
// would refuse to start. The reference defines it, with the default metadata.
const GIVEN = [
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  'processors:',
  '  batch:',
  'exporters:',
  '  otlp_grpc/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  'service:',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [k8sattributes, batch]',
  '      exporters: [otlp_grpc/dash0]',
  '',
].join('\n');

const REFERENCE = [
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  'processors:',
  '  k8sattributes:',
  '    extract:',
  '      metadata:',
  '        - k8s.namespace.name',
  '        - k8s.pod.name',
  '        - k8s.pod.uid',
  '        - k8s.deployment.name',
  '        - k8s.node.name',
  '  batch:',
  'exporters:',
  '  otlp_grpc/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  'service:',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [k8sattributes, batch]',
  '      exporters: [otlp_grpc/dash0]',
  '',
].join('\n');

const CONFIG = {
  id: 'det-config',
  schema: 'collector',
  given: GIVEN,
  reference: REFERENCE,
  uses: { traces: ['k8sattributes'] },
  helps: { hints: true },
  hint: 'A pipeline list holds only names, and the Collector refuses a name with no definition in its section. The task wants the traces enriched, not left alone.',
  explain:
    'A processor takes effect only when it is both defined under <code>processors</code> and listed in a pipeline. ' +
    'Defined but not listed, it does nothing and the Collector starts without it; listed but not defined, the Collector refuses to start. ' +
    'Removing it from the pipeline would start the Collector too, but then the traces carry no pod metadata, so the task needs it listed. ' +
    'The settings are what make it useful: <code>extract.metadata</code> picks the attributes it adds, and by default the ' +
    'processor matches telemetry to a pod by the IP address of the incoming connection. This game checks the wiring, not the settings.',
};

// Step 4: what the processor needs.
const RBAC = [
  {
    key: 'pods-namespaces',
    label: 'Permission to <code>get</code>, <code>watch</code> and <code>list</code> pods and namespaces, through a ClusterRole on its service account',
    right: true,
    why: 'The processor reads pod metadata from the Kubernetes API, so the service account the Collector runs as needs those permissions (some attributes need more). Without them the processor cannot discover pods and adds nothing.',
  },
  {
    key: 'api-key',
    label: 'A Dash0 auth token in the processor settings, the same one the <code>otlp_grpc/dash0</code> exporter uses to send to Dash0, for looking pods up in Dash0',
    why: 'The processor talks to the Kubernetes API of the cluster, not to Dash0. Its access is Kubernetes access, granted with RBAC. A Dash0 token belongs to the exporter.',
  },
  {
    key: 'nothing',
    label: 'Nothing: it reads <code>k8s.pod.name</code> and <code>k8s.namespace.name</code> off the telemetry that arrives, with no lookup against the cluster or its API',
    why: 'The processor looks the pod up: it keeps a record of the cluster\'s pods, and matches telemetry to one, by default through the IP address of the incoming connection. That lookup uses the Kubernetes API, which needs permissions.',
  },
];

// Step 5: the Dash0 tie-in.
const DASH0 = [
  {
    key: 'operator-adds',
    label: 'It instruments supported runtimes without code changes and adds Kubernetes attributes such as <code>k8s.pod.name</code>',
    right: true,
    why: 'In namespaces enabled for Dash0 monitoring, the operator instruments supported workloads for tracing, and improves the OpenTelemetry resource attributes: <code>k8s.namespace.name</code>, <code>k8s.pod.name</code>, <code>k8s.pod.uid</code> and <code>k8s.container.name</code> are added to the workload\'s resource attributes, so you do not set them by hand. Resource attributes are detected for every runtime, with a few exceptions such as libc-free binaries.',
  },
  {
    key: 'nothing',
    label: 'Nothing, until you add an SDK to each app and set <code>k8s.pod.name</code> and <code>k8s.namespace.name</code> yourself in each app\'s configuration',
    why: 'That is the work the operator takes off you: it instruments supported runtimes and sets the Kubernetes resource attributes for the workload.',
  },
  {
    key: 'logs-only',
    label: 'It only collects pod logs and metrics; the <code>k8s.*</code> resource attributes stay yours to set by hand in each app\'s environment',
    why: 'The operator does collect pod logs, and metrics too, but it also instruments workloads and adds Kubernetes resource attributes to them.',
  },
];

export default {
  id: 'detectors-and-kubernetes',
  no: '1.3',
  name: 'Detectors and Kubernetes',
  sub: 'Which pod is this?',
  icon: '\u{2638}\u{FE0F}',
  rewardTitle: 'Pod identifier',
  cards: ['k8sattributes-in-collector'],
  lights: ['redis'],
  scoring: { parMs: null },
  play: {
    prefix: 'det',
    steps: [
      {
        intro:
          'Recommendations now sets <code>service.name</code>, but its telemetry still does not say which pod ' +
          'or node it came from. SDKs ship <b>resource detectors</b> that fill in some of that from the environment.',
        question: 'When do an SDK\'s resource detectors run?',
        qid: 'det-q-when',
        choice: { id: 'det-when', choices: WHEN },
      },
      {
        intro:
          'Kettle &amp; Co runs dozens of services on Kubernetes, in several languages. Every one of them ' +
          'should carry its pod, namespace and node.',
        question: 'Where is it better to add that metadata?',
        qid: 'det-q-where',
        choice: { id: 'det-where', choices: WHERE },
      },
      {
        intro:
          'The platform team started the Collector config, and its traces pipeline already lists the ' +
          'processor. The Collector would not start.',
        question: 'Fix the config so the <code>k8sattributes</code> processor is defined and the traces pipeline flows.',
        qid: 'det-q-config',
        configure: CONFIG,
      },
      {
        intro:
          'The config is right and the Collector runs inside the cluster, yet the processor can only add ' +
          'metadata if it can find the pods.',
        question: 'What does the processor need to look pods up?',
        qid: 'det-q-rbac',
        choice: { id: 'det-rbac', choices: RBAC },
      },
      {
        intro:
          'Another team runs on the Dash0 operator instead of a Collector of their own. Their namespace is ' +
          'enabled for Dash0 monitoring.',
        question: 'What does the operator do for their workloads?',
        qid: 'det-q-dash0',
        choice: { id: 'det-dash0', choices: DASH0 },
      },
    ],
    finish:
      'You know detectors run once at SDK start, and that pod metadata is better added in the Collector with k8sattributes, defined and listed in the pipeline.',
  },
};
