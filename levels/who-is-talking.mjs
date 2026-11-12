// Act 1 boss: Who is talking? An alert fires for a service called unknown_service:node, which no runbook
// names. The player reads the alert's resource (the SDK fell back to unknown_service plus the executable
// name, while the Collector's k8s attributes still name the deployment that owns the pod), then the
// deploy that removed OTEL_SERVICE_NAME, then the running pod's env to confirm. Three views hold the chain
// (clues); two are red herrings; the rest are neutral. Scored. A plain-data Scenario for the incident
// engine, played through one declarative `incident` step (lib/widgets/incident.mjs, docs/M1-DESIGN.md §4.3,
// docs/DECLARATIVE-LEVELS.md §2). The scenario is designed for this game: docs/OUTLINE.md §4 Act 1 defines
// no boss (decided on #16); it exercises 1.1 (resource attributes identify the producer), 1.2 (the fallback
// and OTEL_SERVICE_NAME) and 1.3 (the k8s attributes come from the Collector, not the SDK).
// Spec: docs/OUTLINE.md §4 Act 1.
// Spec: https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/ , https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/
// Spec: https://opentelemetry.io/docs/concepts/resources/ , https://opentelemetry.io/docs/specs/semconv/resource/k8s/#pod
// Dash0 docs: https://www.dash0.com/docs/dash0/monitoring/resources/about-resources , https://www.dash0.com/docs/dash0/monitoring/resources/explore-resources
//
// Facts used, each from the pages above: service.name, when not specified, falls back to "unknown_service:"
// plus the process executable name, the value of the process.executable.name resource attribute, for example
// unknown_service:bash (semantic conventions, service attributes); OTEL_SERVICE_NAME sets the service.name
// resource attribute and, if service.name is also in OTEL_RESOURCE_ATTRIBUTES, OTEL_SERVICE_NAME takes
// precedence (SDK environment variables). Dash0: each signal carries resource metadata, a resource is made
// of resource attributes such as k8s.pod.uid, k8s.namespace.name and service.name; the Resources Explorer
// lists Kubernetes pods and deployments and filters by resource attributes. Nothing below claims how Dash0
// names or groups a service that has no service.name.
// The names, versions, times and the pod are invented for this game.

const SCENARIO = {
  id: 'who-is-talking',
  alert: {
    title: 'Who is unknown_service:node?',
    html:
      '<p>PAGE 14:20: the error-rate alert fired for a service named <code>unknown_service:node</code>, 8% of its spans since 14:11. ' +
      'No runbook, no team and no dashboard uses that name, so the page went to the default on-call. ' +
      'Find who owns it and why it has that name before the error budget runs out.</p>',
  },
  budget: { startPct: 100, burnPctPerMin: 5 },
  views: [
    {
      id: 'alert-resource',
      label: 'Resource of the alert\'s spans',
      costMin: 4,
      kind: 'clue',
      html:
        '<p>The resource on a span from the alerting service:</p>' +
        '<table><caption>Resource attributes</caption>' +
        '<thead><tr><th scope="col">Attribute</th><th scope="col">Value</th></tr></thead>' +
        '<tbody>' +
        '<tr><td><code>service.name</code></td><td><code>unknown_service:node</code></td></tr>' +
        '<tr><td><code>process.executable.name</code></td><td><code>node</code></td></tr>' +
        '<tr><td><code>telemetry.sdk.language</code></td><td><code>nodejs</code></td></tr>' +
        '<tr><td><code>service.namespace</code></td><td><code>comms</code></td></tr>' +
        '<tr><td><code>service.version</code></td><td><code>5.2.0</code></td></tr>' +
        '<tr><td><code>deployment.environment.name</code></td><td><code>production</code></td></tr>' +
        '<tr><td><code>k8s.namespace.name</code></td><td><code>comms</code></td></tr>' +
        '<tr><td><code>k8s.deployment.name</code></td><td><code>notifications</code></td></tr>' +
        '<tr><td><code>k8s.pod.name</code></td><td><code>notifications-7c5d8f6b9-q4m2x</code></td></tr>' +
        '</tbody></table>' +
        '<p>The name is the fallback, <code>unknown_service:</code> plus <code>process.executable.name</code>, yet the <code>k8s.*</code> attributes, ' +
        'added by the Collector\'s <code>k8sattributes</code> processor, still name the deployment <code>notifications</code>.</p>',
    },
    {
      id: 'deploy-history',
      label: 'Deploys of notifications',
      costMin: 4,
      kind: 'clue',
      html:
        '<p>Last 24 hours: notifications 5.2.0 rolled out at 14:09, replacing 5.1.3 (last Tuesday). Changelog: "tidy container env". ' +
        'The diff of the container env:</p>' +
        '<pre>- OTEL_SERVICE_NAME=notifications\n' +
        '~ OTEL_RESOURCE_ATTRIBUTES: service.version=5.1.3 -> service.version=5.2.0</pre>' +
        '<p>No other deployment in the cluster changed in that window.</p>',
    },
    {
      id: 'pod-env',
      label: 'Env of a running pod',
      costMin: 4,
      kind: 'clue',
      html:
        '<p>Pod <code>notifications-7c5d8f6b9-q4m2x</code> in namespace comms, container command <code>node dist/server.js</code>, env:</p>' +
        '<pre data-wrap>NODE_ENV=production\n' +
        'OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318\n' +
        'OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,service.namespace=comms,service.version=5.2.0</pre>' +
        '<p><code>OTEL_SERVICE_NAME</code> is not set and <code>service.name</code> is not in <code>OTEL_RESOURCE_ATTRIBUTES</code>, ' +
        'so the only name the SDK can build comes from the process, <code>node</code>.</p>',
    },
    {
      id: 'collector-restart',
      label: 'Collector restarts',
      costMin: 3,
      kind: 'neutral',
      html:
        '<p>The gateway Collector restarted once, at 14:03, for a node upgrade. Its config is unchanged and it dropped no data. ' +
        'Every other service kept its name.</p>',
    },
    {
      id: 'message-volume',
      label: 'Notification volume',
      costMin: 2,
      kind: 'neutral',
      html: '<p>The notifications topic carries 120 messages a second, the same as yesterday at 14:00. There is no spike.</p>',
    },
    {
      id: 'pod-health',
      label: 'Pod health',
      costMin: 2,
      kind: 'neutral',
      html: '<p>All three replicas of the deployment that owns this pod are ready, with no restarts since the rollout finished at 14:12.</p>',
    },
    {
      id: 'catalog-rename',
      label: 'Renamed services',
      costMin: 4,
      kind: 'herring',
      html:
        '<p>The only service rename in the last day: <code>catalog</code> became <code>catalog-api</code> at 14:05, on purpose, by its team. ' +
        'Under its new name it reports normally, with 0.2% errors, and it appears only under that name. ' +
        '<code>unknown_service:node</code> is a separate entry with no history.</p>',
    },
    {
      id: 'k8s-warnings',
      label: 'Collector k8sattributes warnings',
      costMin: 3,
      kind: 'herring',
      html:
        '<p>The Collector logs <code>pod association failed</code> about 40 times a day for spans from a batch job that sends no pod identity. ' +
        'It has done so for a month. The alerting service\'s spans were associated with their pod.</p>',
    },
  ],
  hypotheses: [
    {
      id: 'name-dropped',
      label: 'The latest deploy dropped OTEL_SERVICE_NAME so the SDK used its fallback name',
      right: true,
      why: 'The resource has no service.name, only the fallback unknown_service:node, built from process.executable.name node. The deploy at 14:09 removed OTEL_SERVICE_NAME, the running pod does not have it, and the first spans under the new name arrived at 14:11. The k8s attributes from the Collector were never the problem: they are what led you to the owner, the notifications deployment.',
    },
    {
      id: 'new-service',
      label: 'A new service nobody told us about has started running in the cluster under its own name',
      right: false,
      why: 'The pod belongs to the notifications deployment, which has been deployed for a long time (5.1.3 last Tuesday). It is an old service that lost its name, not a new one.',
    },
    {
      id: 'detector-broken',
      label: 'The Kubernetes resource attributes such as k8s.pod.name are broken',
      right: false,
      why: 'They are all there: k8s.deployment.name, k8s.namespace.name and k8s.pod.name identify the pod. What is missing is service.name, and the deploy diff shows the variable that sets it was removed.',
    },
    {
      id: 'collector-renamed',
      label: 'The Collector restart renamed the service on its way to the backend',
      right: false,
      why: 'The restart was at 14:03 with an unchanged config, before the 14:09 deploy, and no other service changed name. A Collector would have to have been configured to rewrite service.name; nothing says it was.',
    },
  ],
  answerAfterViews: 2,
  hint:
    '<p>Start with what the telemetry says about itself, then ask what changed shortly before the alert began. Confirm it where the service actually runs.</p>',
};

// Step 2: what fixes it. `why` follows "Right." or "Not quite.".
const FIX = [
  {
    key: 'env-var',
    label: 'Set <code>OTEL_SERVICE_NAME=notifications</code> on the deployment again',
    right: true,
    why: '<code>OTEL_SERVICE_NAME</code> sets <code>service.name</code>, and it takes precedence over a <code>service.name</code> in <code>OTEL_RESOURCE_ATTRIBUTES</code> if both are set, so it is the one place to put the name. With neither, the SDK reports <code>unknown_service:&lt;process.executable.name&gt;</code>, here <code>unknown_service:node</code>.',
  },
  {
    key: 'executable-name',
    label: 'Start the app from an executable named <code>notifications</code>, so the fallback names it',
    why: 'The fallback would then read <code>unknown_service:notifications</code>: still a fallback, and still not the service name. The SDK never reads the deployment or the image name; the name has to be set.',
  },
  {
    key: 'k8s-attribute',
    label: 'Add <code>k8s.deployment.name=notifications</code> to the resource',
    why: 'It was already there, added by the Collector, and the service name was still <code>unknown_service:node</code>. <code>k8s.deployment.name</code> says which deployment the pod belongs to; <code>service.name</code> says which service is talking.',
  },
];

export default {
  id: 'who-is-talking',
  no: null,
  name: 'Who is talking?',
  sub: 'The service with no name',
  icon: '\u{1F575}',
  rewardTitle: 'Name tag',
  cards: [],
  lights: ['notifications'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'wit',
    steps: [
      {
        intro: 'An alert names a service nobody has heard of. Find out who owns it and why it has that name.',
        incident: SCENARIO,
      },
      {
        intro: 'The incident is explained. In the review, someone asks what to ship so it cannot happen quietly again.',
        question: 'Which change restores the name, and what does the fallback look like without it?',
        qid: 'wit-q-fix',
        choice: { id: 'wit-fix', choices: FIX },
      },
    ],
    finish:
      'A resource told you who was talking: the fallback name unknown_service:node gave away the missing service.name, and the k8s ' +
      'attributes still pointed at the notifications deployment.\n\n' +
      'Dash0 builds its Resources view from resource attributes: it lists ' +
      'Kubernetes pods and deployments and filters by resource attributes, so the pod could be found by its Kubernetes attributes even though ' +
      'its service name was no help.',
  },
};
