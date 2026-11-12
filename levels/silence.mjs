// Act 5 boss: Silence. One cluster's telemetry stops arriving, all three signals at the same minute. The
// player follows it from the data-arrival view (eu-west is flat at zero, the other clusters are normal), to
// the Collector pods in that cluster (restarting, never ready), to the Collector's own log (the config is
// invalid: a pipeline lists an exporter that is not configured), to the config diff and the rollout time
// (the rollout renamed the exporter `otlp_grpc/dash0` to `otlp_grpc/dash0-eu` in `exporters` and left the three
// pipelines listing `otlp_grpc/dash0`). Four views hold the chain (clues); two are red herrings; three are
// neutral. Scored. A plain-data Scenario for the incident engine, played through one declarative
// `incident` step (lib/widgets/incident.mjs, docs/M1-DESIGN.md §4.3, docs/DECLARATIVE-LEVELS.md §2),
// then one closing Choice on the rule that was broken.
// The scenario is designed for this game: docs/OUTLINE.md §4 defines no boss for Act 5 (decided on #16).
// Spec: docs/OUTLINE.md §4 Act 5.
// Spec: https://opentelemetry.io/docs/collector/configuration/#service , https://opentelemetry.io/docs/collector/configuration/#pipelines
// Spec: https://opentelemetry.io/docs/collector/configuration/#configuration-structure
// Spec: https://opentelemetry.io/docs/specs/semconv/registry/attributes/k8s/ , https://opentelemetry.io/docs/specs/semconv/system/k8s-metrics/
// Docs (GitHub, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector/blob/main/otelcol/config.go , https://github.com/open-telemetry/opentelemetry-collector/blob/main/otelcol/collector.go
// Docs (GitHub, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector/blob/main/confmap/README.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/README.md
// Docs (GitHub, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/documentation.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlpexporter/README.md
// Dash0 tie-in: n/a. No Dash0 docs page was found that says what a Collector does with a config whose pipeline
// lists an exporter that is not defined, and OUTLINE §4 gives the Act 5 levels 5.1, 5.2, 5.4 and 5.6 no
// Dash0 tie-in either; nothing below names a Dash0 feature.
//
// Facts used, each from the sources above:
// - Component ids follow `type[/name]`; the same type can be defined more than once as long as the ids are
//   unique, so `otlp_grpc/dash0` and `otlp_grpc/dash0-eu` are two different exporters (configuration docs).
// - Before a receiver, processor or exporter goes into a pipeline its configuration must be defined in its
//   own section, and a component that is configured but not listed under `service` is not enabled
//   (configuration docs, Service section; the same rules 5.1 teaches).
// - A pipeline that lists an id nothing defines makes the whole configuration invalid. otelcol/config.go
//   returns `service::pipelines::<pipeline>: references exporter "<id>" which is not configured` (the same
//   form for a receiver or a processor), and otelcol/collector.go validates the configuration in
//   setupConfigurationComponents, before it creates or starts the service (so before any pipeline runs).
//   confmap/README.md quotes the form the player sees:
//   `Error: invalid configuration: service::pipelines::traces: references processor "nop" which is not configured`
//   and then `collector server run finished with error: invalid configuration: ...`.
// - memory_limiter refuses data by returning a non-permanent error to the component before it, and
//   receivers are expected to retry (memory limiter README); its refusals are counted by
//   `otelcol_processor_memory_limiter_refused_spans` (its documentation.md).
// - `k8s.cluster.name` is a resource attribute, `k8s.container.restart.count` is a metric, and
//   `k8s.container.status.last_terminated_reason` has `Error` among its example values (Kubernetes semconv).
// - The gRPC exporter takes a `host:port` endpoint; a wrong port is not a config validation error, so it
//   would show up while the Collector runs (otlp_grpc exporter README). Not used as a fact beyond that.
//
// Invented for the game: the clusters, pod names, counts, times, the PR title and the Helm-style rollout; the
// timestamps on the two log lines (the lines themselves use the forms quoted above, with `exporter` and
// `otlp_grpc/dash0` in place of the README's processor and `nop`); that the rollout starts the new pods only after
// stopping the old ones (a Deployment can be set to do that), which is why eu-west goes to zero and not to half.
// The Collector's error names one pipeline, not all three: the validation returns at the first error it finds, and
// it walks the pipelines in a Go map, whose iteration order is random, so Go map iteration order picks which of
// the three (traces, metrics or logs) is named. The shown line, with traces, is one valid instance.

const POD_A = 'otel-collector-7c8d9b6f5-4xk2p';
const POD_B = 'otel-collector-7c8d9b6f5-q8w7n';

const SCENARIO = {
  id: 'silence',
  alert: {
    title: 'Silence from eu-west',
    html:
      '<p>PAGE 14:21: no telemetry from the eu-west cluster for 19 minutes. Its services are missing from every dashboard. ' +
      'The other three clusters are normal. The data stopped at 14:02. The alert names no cause. Find it before the error budget runs out.</p>',
  },
  budget: { startPct: 100, burnPctPerMin: 5 },
  views: [
    {
      id: 'arrival-by-cluster',
      label: 'Data arriving, by cluster',
      costMin: 3,
      kind: 'clue',
      html:
        '<p>Spans a minute, grouped by the resource attribute <code>k8s.cluster.name</code>, at 14:00 and at 14:20:</p>' +
        '<table><caption>Spans a minute by cluster</caption>' +
        '<thead><tr><th scope="col">Cluster</th><th scope="col">14:00</th><th scope="col">14:20</th></tr></thead>' +
        '<tbody>' +
        '<tr><td>us-east</td><td>41,200</td><td>40,900</td></tr>' +
        '<tr><td>us-west</td><td>38,600</td><td>38,900</td></tr>' +
        '<tr><td>ap-south</td><td>12,900</td><td>12,700</td></tr>' +
        '<tr><td>eu-west</td><td>9,800</td><td>0</td></tr>' +
        '</tbody></table>' +
        '<p>eu-west falls to exactly 0 at 14:02 and stays there: the data stopped, it did not thin out. ' +
        'Its traces, metrics and logs all stop in the same minute, and the last eu-west record arrived at 14:01.</p>',
    },
    {
      id: 'collector-pods',
      label: 'Collector pods in eu-west',
      costMin: 3,
      kind: 'clue',
      html:
        '<p>Namespace <code>observability</code>, deployment <code>otel-collector</code>, eu-west:</p>' +
        '<ul>' +
        `<li><code>${POD_A}</code>: Ready 0/1, started 14:02, <code>k8s.container.restart.count</code> 7, last terminated reason: Error</li>` +
        `<li><code>${POD_B}</code>: Ready 0/1, started 14:02, <code>k8s.container.restart.count</code> 7, last terminated reason: Error</li>` +
        '</ul>' +
        '<p>Neither pod has stayed up for more than a few seconds since 14:02. The Collector pods in us-east, us-west and ap-south ' +
        'show no restarts in 24 hours.</p>',
    },
    {
      id: 'collector-log',
      label: 'Collector log, eu-west',
      costMin: 3,
      kind: 'clue',
      html:
        `<p>The log of the last terminated container of <code>${POD_A}</code>. A restart prints these two lines and nothing else, naming one of the three pipelines (traces, metrics or logs) each time:</p>` +
        '<pre data-wrap><code>Error: invalid configuration: service::pipelines::traces: references exporter "otlp_grpc/dash0" which is not configured\n' +
        '2026/11/01 14:21:07 collector server run finished with error: invalid configuration: service::pipelines::traces: references exporter "otlp_grpc/dash0" which is not configured</code></pre>' +
        '<p>The Collector reads its configuration, finds it invalid and exits. It never gets as far as receiving data.</p>',
    },
    {
      id: 'config-diff',
      label: 'Collector config change',
      costMin: 3,
      kind: 'clue',
      html:
        '<p>ConfigMap <code>otel-collector-config</code>. The change "Name the exporter by region" was merged at 14:01 and ' +
        'applied to eu-west at 14:02, the first cluster in the rollout. us-east, us-west and ap-south are scheduled for tomorrow and still run the previous config.</p>' +
        '<pre><code>   exporters:\n' +
        '-    otlp_grpc/dash0:\n' +
        '+    otlp_grpc/dash0-eu:\n' +
        '       endpoint: ${env:DASH0_ENDPOINT}\n' +
        '   service:\n' +
        '     pipelines:\n' +
        '       traces:\n' +
        '         receivers: [otlp]\n' +
        '         processors: [memory_limiter, batch]\n' +
        '         exporters: [otlp_grpc/dash0]\n' +
        '       metrics:\n' +
        '         receivers: [otlp]\n' +
        '         processors: [memory_limiter, batch]\n' +
        '         exporters: [otlp_grpc/dash0]\n' +
        '       logs:\n' +
        '         receivers: [otlp]\n' +
        '         processors: [memory_limiter, batch]\n' +
        '         exporters: [otlp_grpc/dash0]</code></pre>' +
        '<p>Nothing else changed: the receivers, the endpoint and the processors are as before.</p>',
    },
    {
      id: 'app-pods',
      label: 'Application pods in eu-west',
      costMin: 2,
      kind: 'neutral',
      html: '<p>The eu-west application pods are Running with no restarts in 24 hours, and none has been deployed since Tuesday. They are healthy.</p>',
    },
    {
      id: 'nodes',
      label: 'Nodes in eu-west',
      costMin: 2,
      kind: 'neutral',
      html: '<p>12 of 12 nodes are Ready, at 41% CPU and 58% memory. No node is under pressure.</p>',
    },
    {
      id: 'backend-ingest',
      label: 'Ingestion at the backend',
      costMin: 3,
      kind: 'neutral',
      html: '<p>The backend shows no rejected requests and no errors for any cluster. It is accepting everything it is sent, and it is sent nothing from eu-west.</p>',
    },
    {
      id: 'network-blip',
      label: 'Network between eu-west and the internet',
      costMin: 4,
      kind: 'herring',
      html:
        '<p>A 90-second period of packet loss between eu-west and the internet began at 13:12 and recovered at 13:14. ' +
        'Telemetry from eu-west dipped by 8% for those two minutes and then returned to normal. Nothing happened at 14:02.</p>',
    },
    {
      id: 'memory-limiter-refusals',
      label: 'Memory limiter refusals',
      costMin: 3,
      kind: 'herring',
      html:
        '<p><code>otelcol_processor_memory_limiter_refused_spans</code>, last 24 hours: us-east refused 1,900 spans between 12:40 and 12:44, ' +
        'during a traffic peak, and none since. The senders retried. The other clusters show none, and eu-west reports nothing at all after 14:01.</p>',
    },
  ],
  hypotheses: [
    {
      id: 'exporter-renamed',
      label: 'The exporter was renamed but pipelines list the old id so the eu-west Collector sends no data',
      right: true,
      why: 'All three signals stopped in eu-west at 14:02 and nowhere else, the Collector pods there restart and are never ready, and their log says the configuration is invalid: a pipeline references exporter "otlp_grpc/dash0", which is not configured. The diff, merged at 14:01 and applied to eu-west at 14:02, renamed that exporter to otlp_grpc/dash0-eu and left the three pipelines listing the old id. An id a pipeline lists must be defined, so the Collector exits at validation.',
    },
    {
      id: 'memory-limiter',
      label: 'The memory_limiter processor in eu-west is refusing spans after a traffic peak',
      right: false,
      why: 'A memory_limiter refuses data while the Collector is running, and the sender is expected to retry. These pods never get that far: they exit at startup, before any pipeline runs, and the diff does not touch memory_limiter. The one refusal burst, in us-east, was at 12:40.',
    },
    {
      id: 'wrong-port',
      label: 'The otlp_grpc/dash0 exporter in eu-west sends data to the wrong OTLP port and nothing ever arrives',
      right: false,
      why: 'The endpoint line is not in the diff. A wrong port would still be a valid configuration: the Collector would start and show send errors while running, and its pods would not restart. These pods exit with a configuration error.',
    },
    {
      id: 'apps-stopped',
      label: 'The applications in eu-west stopped sending their traces and metrics and logs',
      right: false,
      why: 'The application pods are Running with no restarts and have not been deployed since Tuesday. Traces, metrics and logs from every service in the cluster stopped in the same minute, which points at the one thing they all send through.',
    },
  ],
  answerAfterViews: 3,
  hint:
    '<p>Silence is a symptom with many causes. Work out first whether the data stopped or only thinned, then follow it back along its path toward the source, and ask what touched that path last.</p>',
};

// Step 2: the rule that was broken. `why` follows "Right." or "Not quite.".
const RULE = [
  {
    key: 'listed-must-be-defined',
    label:
      'Every id listed in <code>service.pipelines</code> must be defined in its own section: the pipelines listed <code>otlp_grpc/dash0</code>, which the config no longer defined, so validation failed',
    right: true,
    why: 'The Collector checks every receiver, processor and exporter a pipeline lists against the config and returns "references exporter ... which is not configured", an error, before it starts anything. Renaming the definition to <code>otlp_grpc/dash0-eu</code> without changing the three pipelines left every exporter list pointing at nothing.',
  },
  {
    key: 'defined-not-listed',
    label: 'The new <code>otlp_grpc/dash0-eu</code> exporter is defined but listed in no pipeline, so it does nothing and the pipelines keep running without it',
    why: 'The first half is true: a component that is defined but not listed does nothing (level 5.1). It is not what stopped the data. The pipelines also list <code>otlp_grpc/dash0</code>, which nothing defines, and an id that is listed but not defined is an error that stops the Collector, not an exporter that is skipped.',
  },
  {
    key: 'same-exporter',
    label: 'The part after the slash is only a label, so <code>otlp_grpc/dash0</code> and <code>otlp_grpc/dash0-eu</code> are the same exporter and the rename changes nothing for the pipelines or for the config check',
    why: 'Ids follow <code>type[/name]</code>, and the full id is what identifies a component: the same type can be defined many times as long as the ids are different. <code>otlp_grpc/dash0</code> and <code>otlp_grpc/dash0-eu</code> are different exporters, and only the second is defined.',
  },
];

export default {
  id: 'silence',
  no: null,
  name: 'Silence',
  sub: 'One cluster goes quiet',
  icon: '\u{1F507}',
  rewardTitle: 'Plumber',
  cards: [],
  lights: ['collector'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'sil',
    steps: [
      {
        intro: 'The eu-west cluster has gone quiet: no traces, metrics or logs since 14:02. Find out why it went quiet.',
        incident: SCENARIO,
      },
      {
        intro: 'The incident is explained. In the review, someone asks which rule the rollout broke.',
        question: 'What did the config change break?',
        qid: 'sil-q-rule',
        choice: { id: 'sil-rule', choices: RULE },
      },
    ],
    finish:
      'The silence came from Collector pods that kept restarting: a rename left the pipelines pointing at an exporter that was ' +
      'no longer defined, and the error was in the pod log. An id a pipeline lists must be defined, or the ' +
      'Collector will not start; the config can be checked before a rollout with the Collector\'s validate command.',
  },
};
