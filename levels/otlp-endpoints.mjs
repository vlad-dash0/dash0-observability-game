// Level 5.3: OTLP endpoints. The player says which port an OTLP/HTTP client uses (4318, not the gRPC 4317),
// where a per-signal endpoint variable sends traces (as is, with no /v1/traces added, unlike the general
// OTEL_EXPORTER_OTLP_ENDPOINT), wires the Collector's otlp/dash0 exporter into the traces and metrics
// pipelines so the Collector starts, and says where the Dash0 auth token goes (an Authorization: Bearer header).
// Spec: docs/OUTLINE.md §4 Act 5.
// Spec: https://opentelemetry.io/docs/specs/otel/protocol/exporter/ , https://opentelemetry.io/docs/specs/otlp/
// Docs (GitHub READMEs, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlpexporter/README.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlphttpexporter/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/headerssetterextension/README.md
// Dash0 docs (not an allowed Spec host): https://www.dash0.com/docs/dash0/monitoring/websites/proxying-the-ingestion-endpoint , https://www.dash0.com/docs/dash0/monitoring/kubernetes/dash0-operator/configuration , https://www.dash0.com/docs/dash0/opentelemetry/distributions/python/configuration , https://www.dash0.com/docs/dash0/miscellaneous/glossary/endpoints , https://www.dash0.com/docs/dash0/opentelemetry/distributions/python/exporters
//
// Facts used: OTLP/gRPC defaults to port 4317 and OTLP/HTTP to 4318 (the OTLP spec). With OTEL_EXPORTER_OTLP_ENDPOINT
// an OTLP/HTTP exporter adds /v1/traces, /v1/metrics or /v1/logs to the base URL; the per-signal variables
// (OTEL_EXPORTER_OTLP_TRACES_ENDPOINT and the others) are used without any change, and a URL with no path means the
// root path (the exporter spec, Example 2). A gRPC endpoint is a host and port with no path. Dash0 documents an
// OTLP/gRPC ingress endpoint per organization (the host shows the region) and the token in an Authorization: Bearer
// header, read from an environment variable in its Collector example. The only token shown is the made-up auth_token_example.
//
// COLLECTOR_SCHEMA (docs/M1-DESIGN.md §4.8) does not model component settings, so the configure step grades the wiring
// (`uses` requires otlp/dash0 in the traces and the metrics pipeline) and says so. A minimal schema extension to also
// grade `endpoint`, `auth` or `headers` was not worth it: those are free-form per component, so grading one key would
// special-case one component in the shared schema. The port and path nuances are graded by the Choice steps instead.

// Step 1: ports. `why` follows "Right." or "Not quite.".
const PORT = [
  {
    key: 'http-port',
    label: '4317 is the OTLP/gRPC port. OTLP/HTTP uses 4318, so the endpoint should be <code>http://collector:4318</code>',
    right: true,
    why: 'OTLP has two transports with their own default ports: 4317 for OTLP/gRPC and 4318 for OTLP/HTTP. An HTTP exporter pointed at the gRPC port is not understood by it. Also remember the difference in shape: a gRPC endpoint is a host and a port with no path, while an HTTP base endpoint gets the signal path added.',
  },
  {
    key: 'same-port',
    label: 'Nothing: port 4317 serves both protocols, so the cause is somewhere else',
    why: 'Each OTLP transport has its own default port, 4317 for gRPC and 4318 for HTTP. A client has to use the one that matches its protocol.',
  },
  {
    key: 'needs-path',
    label: 'The endpoint has to end in <code>/v1/traces</code>',
    why: 'With <code>OTEL_EXPORTER_OTLP_ENDPOINT</code> an OTLP/HTTP exporter adds the signal path itself, so the general variable is a base URL. The wrong port is the problem here.',
  },
];

// Step 2: the nuance. `why` follows "Right." or "Not quite.".
const SIGNAL = [
  {
    key: 'as-is',
    label: 'To <code>http://collector:4318/</code>, the root path: a per-signal URL is used as is',
    right: true,
    why: 'The per-signal variables are used as they are: the exporter adds no path, so a URL with no path means the root path. Only with the general <code>OTEL_EXPORTER_OTLP_ENDPOINT</code> does the exporter add <code>/v1/traces</code>, <code>/v1/metrics</code> or <code>/v1/logs</code> to the base URL. So a per-signal URL has to carry <code>/v1/traces</code> itself, because that is the path the receiver serves.',
  },
  {
    key: 'adds-path',
    label: 'To <code>http://collector:4318/v1/traces</code>, as it does for the general variable',
    why: 'The exporter adds <code>/v1/traces</code> only for the general variable, <code>OTEL_EXPORTER_OTLP_ENDPOINT</code>. A per-signal variable takes precedence over it and its URL is used without any change.',
  },
  {
    key: 'rejected',
    label: 'Nowhere: the exporter refuses a URL without a path',
    why: 'Nothing requires a path. The exporter accepts the URL and sends to it as it is, and a URL with no path means the root path.',
  },
];

// Step 3: the config. The given sends traces to the debug exporter only and names an exporter nobody defined in
// metrics (the Collector would refuse to start); otlp/dash0 is defined, with its auth, and listed nowhere.
const GIVEN = [
  'extensions:',
  '  headers_setter:',
  '    headers:',
  '      - action: insert',
  '        key: Authorization',
  '        value: "Bearer ${env:DASH0_TOKEN}"',
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  '        endpoint: 0.0.0.0:4317',
  '      http:',
  '        endpoint: 0.0.0.0:4318',
  'processors:',
  '  batch:',
  'exporters:',
  '  debug:',
  '  otlp/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  '    auth:',
  '      authenticator: headers_setter',
  'service:',
  '  extensions: [headers_setter]',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [batch]',
  '      exporters: [debug]',
  '    metrics:',
  '      receivers: [otlp]',
  '      processors: [batch]',
  '      exporters: [otlphttp/dash0]',
  '',
].join('\n');

const REFERENCE = GIVEN.replace('exporters: [debug]', 'exporters: [debug, otlp/dash0]').replace('exporters: [otlphttp/dash0]', 'exporters: [otlp/dash0]');

const CONFIG = {
  id: 'otlp-config',
  schema: 'collector',
  given: GIVEN,
  reference: REFERENCE,
  uses: { traces: ['otlp/dash0'], metrics: ['otlp/dash0'] },
  hint: 'Two things are off. Which exporter does the <code>metrics</code> pipeline name, and is it defined? And which exporters does <code>traces</code> list: does any of them reach Dash0?',
  explain:
    'A pipeline sends data only to the exporters it lists, and an exporter that is defined but not listed does nothing: <code>otlp/dash0</code> was defined and listed nowhere, ' +
    'while <code>metrics</code> named an <code>otlphttp/dash0</code> that nobody defined, so the Collector would not start. ' +
    '<code>otlp</code> is the Collector\'s OTLP/gRPC exporter: its <code>endpoint</code> is a host and a port with no path, and it sends the token in an <code>Authorization</code> header that the ' +
    '<code>headers_setter</code> extension adds, read from an environment variable. <code>otlphttp</code> is the HTTP exporter, another component: its endpoint is a base URL that gets the signal path, ' +
    'and <code>traces_endpoint</code> is used as is. Pointing the pipelines at the debug exporter or deleting a pipeline would leave a pipeline without Dash0, ' +
    'and a second Dash0 exporter under another name would be a different component, so this task asks for <code>otlp/dash0</code> in both. This game checks the wiring, not the settings, so the headers and endpoints are the next question\'s business.',
};

// Step 4: the token. `why` follows "Right." or "Not quite.".
const TOKEN = [
  {
    key: 'header',
    label: 'In an <code>Authorization: Bearer</code> header: <code>OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer auth_token_example</code> in an SDK, the <code>headers_setter</code> extension in a Collector',
    right: true,
    why: 'Dash0 reads the auth token from an <code>Authorization: Bearer</code> header. The OTLP exporter has a headers setting for exactly this: <code>OTEL_EXPORTER_OTLP_HEADERS</code> in an SDK, a list of key=value pairs, and the <code>headers_setter</code> extension with the exporter\'s <code>auth</code> setting in a Collector. Read the value from an environment variable or a secret instead of writing it into a file.',
  },
  {
    key: 'url',
    label: 'In the endpoint URL, for example as a query parameter',
    why: 'The endpoint is only an address. Dash0 reads the token from the <code>Authorization</code> header, and a token in a URL tends to end up in logs and config files.',
  },
  {
    key: 'resource',
    label: 'As a resource attribute on the service\'s Resource',
    why: 'Resource attributes describe what produces the telemetry and travel with it as data, so the token would be sent along with every batch. Authentication is a header on the request, not part of the data.',
  },
];

export default {
  id: 'otlp-endpoints',
  no: '5.3',
  name: 'OTLP endpoints',
  sub: 'Ports and paths',
  icon: '\u{1F50C}',
  rewardTitle: 'Endpoint tuner',
  cards: ['otlp-ports-and-paths'],
  lights: [],
  scoring: { parMs: null },
  play: {
    prefix: 'otlp',
    steps: [
      {
        intro:
          'The checkout service at Kettle &amp; Co is a Node app. Its environment says <code>OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf</code> and ' +
          '<code>OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317</code>. The Collector is running, and nothing arrives.',
        question: 'What is wrong?',
        qid: 'otlp-q-port',
        choice: { id: 'otlp-port', choices: PORT },
      },
      {
        intro:
          'The port is fixed. In staging the team sets only the traces variable, <code>OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://collector:4318</code>, ' +
          'for an OTLP/HTTP exporter, and leaves the general variable unset.',
        question: 'Where do the traces go?',
        qid: 'otlp-q-signal',
        choice: { id: 'otlp-signal', choices: SIGNAL },
      },
      {
        intro:
          'The Collector in front of the apps accepts both transports, on 4317 and 4318, and should send to Dash0 through the exporter <code>otlp/dash0</code>. ' +
          'Its config is half done: traces go to the debug exporter only, and metrics name an exporter nobody defined, so it will not start.',
        question: 'Fix the config so the Collector starts and both traces and metrics go to Dash0 through <code>otlp/dash0</code>.',
        qid: 'otlp-q-config',
        configure: CONFIG,
      },
      {
        intro:
          'The Collector config reads the Dash0 token from an environment variable. The checkout service\'s SDK needs it as well, and the team is arguing about where it goes. ' +
          'In the examples the token is the made-up <code>auth_token_example</code>.',
        question: 'Where does the Dash0 auth token go?',
        qid: 'otlp-q-token',
        choice: { id: 'otlp-token', choices: TOKEN },
      },
    ],
    finish:
      'You know OTLP/gRPC is 4317 and OTLP/HTTP is 4318, that the general endpoint variable gets /v1/traces added while a per-signal one is used as is, and that the Dash0 token travels in an Authorization header.',
  },
};
