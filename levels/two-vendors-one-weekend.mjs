// Level 9.7: Two vendors, one weekend. Act 9 "Live Demo" (docs/LIVE-DEMO.md). A teammate says, with confidence, "add Dash0 and
// the old vendor stops getting data, so we have to pick one" and the player says whether that holds (Choice), then fixes the
// Collector config so both vendors get traces, metrics and logs (Configure it). The claim is wrong: a pipeline that lists two
// exporters sends each of them a copy. The presenter has no name and no affiliation.
// Source: an anonymised call question shape (docs/LIVE-DEMO.md): trying a second backend beside the first. Nothing below
// identifies a customer, a person or a product; the old vendor is a made-up host on the reserved .example domain.
// Spec: https://opentelemetry.io/docs/collector/architecture/ , https://opentelemetry.io/docs/collector/configuration/
// Docs (GitHub README, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector/blob/v0.164.0/config/configgrpc/README.md
//
// Facts used (each read on the pages above, 2026-11-08). Architecture page: "This continues until the last processor in the pipeline
// pushes the data to the exporters. Each exporter gets a copy of each data element." Configuration page:
// "Configuring an exporter does not enable it. Exporters are enabled by adding them to the appropriate pipelines within the service section."
// and "The use and expansion of environment variables is supported in the Collector configuration", with `${env:DB_KEY}` as the example.
// gRPC client settings README at v0.164.0: `headers` is "name/value pairs added to the request". The exporter type is otlp_grpc (the names
// since Collector v0.144.0, 5.1), so the ids are otlp_grpc/oldvendor and otlp_grpc/dash0. Dash0 is claimed only to need an endpoint and a
// token, both read from environment variables here; no real hostname, no product or pricing claim.
//
// Invented for the game: the scenario, the old vendor and its host, and the variable names DASH0_ENDPOINT and DASH0_AUTH_TOKEN.
//
// COLLECTOR_SCHEMA (docs/M1-DESIGN.md §4.8) does not model component settings, so the configure step grades the wiring (`uses`
// requires both exporters in traces, metrics and logs) and says so; the header form is not graded, and the explain shows it.
// Accepted gap: pipelines are graded by name, so a separate pipeline (say `traces/dash0`) that sends traces to otlp_grpc/dash0
// is valid in a real Collector, as the architecture page's `traces/2` shows, but fails here. The question says "in the existing
// pipelines" and the explain says why.

// Step 1: does the teammate's answer hold? `why` follows "Right." or "Not quite.".
const VERDICT = [
  {
    key: 'replaces',
    label: 'It holds: a pipeline sends to one exporter, so a new one takes the old vendor\'s place',
    why: 'A pipeline\'s <code>exporters</code> is a list, not a single slot. Adding a second exporter to it does not remove the first.',
  },
  {
    key: 'sdk',
    label: 'It is wrong: the apps also send to the old vendor, so it gets data whatever the Collector does',
    why: 'Here the apps send OTLP only to the Collector, and nothing else leaves them. Whatever the old vendor receives, it receives from the Collector\'s exporters.',
  },
  {
    key: 'copy',
    label: 'It is wrong: a pipeline that lists both exporters sends each of them a copy of the data',
    right: true,
    why: 'The architecture page says it: the last processor pushes the data to the exporters, and "each exporter gets a copy of each data element". Listing the old vendor and Dash0 in one pipeline feeds both.',
  },
];

// Step 2: the config. The given lists otlp_grpc/dash0 in traces, which nobody defined (the Collector would refuse to start);
// metrics and logs go to the old vendor only.
const GIVEN = [
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  '        endpoint: 0.0.0.0:4317',
  '      http:',
  '        endpoint: 0.0.0.0:4318',
  'processors:',
  '  memory_limiter:',
  '    check_interval: 1s',
  '    limit_mib: 400',
  '  batch:',
  'exporters:',
  '  otlp_grpc/oldvendor:',
  '    endpoint: otlp.oldvendor.example:4317',
  'service:',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, batch]',
  '      exporters: [otlp_grpc/oldvendor, otlp_grpc/dash0]',
  '    metrics:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, batch]',
  '      exporters: [otlp_grpc/oldvendor]',
  '    logs:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, batch]',
  '      exporters: [otlp_grpc/oldvendor]',
  '',
].join('\n');

const REFERENCE = GIVEN.replace(
  '    endpoint: otlp.oldvendor.example:4317\n',
  [
    '    endpoint: otlp.oldvendor.example:4317',
    '  otlp_grpc/dash0:',
    '    endpoint: ${env:DASH0_ENDPOINT}',
    '    headers:',
    '      Authorization: "Bearer ${env:DASH0_AUTH_TOKEN}"',
    '',
  ].join('\n'),
)
  .replace(/exporters: \[otlp_grpc\/oldvendor\]/g, 'exporters: [otlp_grpc/oldvendor, otlp_grpc/dash0]');

const BOTH = ['otlp_grpc/oldvendor', 'otlp_grpc/dash0'];

const CONFIG = {
  id: 'tvw-config',
  schema: 'collector',
  given: GIVEN,
  reference: REFERENCE,
  uses: { traces: BOTH, metrics: BOTH, logs: BOTH },
  helps: { hints: true },
  hint: 'Read each pipeline against the definitions above it. A name can be listed without being defined, and a component that is defined does nothing until a pipeline lists it. Check all three signals, not only the one that stops the Collector from starting.',
  explain:
    'A pipeline can only list an exporter that is defined, so the Collector would not start while <code>traces</code> named <code>otlp_grpc/dash0</code> and nobody had defined it. ' +
    'Defining it is not enough either: configuring an exporter does not enable it, it works only when a pipeline lists it. ' +
    'With both exporters in a pipeline, each gets a copy of each data element, so the old vendor keeps its data while Dash0 gets the same. ' +
    'Traces alone would leave metrics and logs with one vendor, and replacing the old vendor would end the comparison, so the task needs both in all three pipelines. ' +
    'The Dash0 exporter reads its endpoint and token from environment variables with <code>${env:...}</code>, which the Collector expands in its configuration, so no secret is written in the file. ' +
    'The token travels in <code>headers</code>, the name/value pairs added to each request: the name is <code>Authorization</code> and the value is <code>Bearer</code>, a space and the token. ' +
    'A separate pipeline such as <code>traces/dash0</code> that sends to the new exporter is also valid in a real Collector. This game reads the lists of the existing pipelines, which is why the task says so. ' +
    'It checks the wiring, not the settings.',
};

export default {
  id: 'two-vendors-one-weekend',
  no: '9.7',
  name: 'Two vendors, one weekend',
  sub: 'Does that answer hold?',
  icon: '\u{1F91D}',
  rewardTitle: 'Fan-out engineer',
  cards: [],
  lights: ['collector'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'tvw',
    steps: [
      {
        intro:
          'Kettle &amp; Co wants to try Dash0 for a weekend and keep its current vendor running beside it. The apps send OTLP to one Collector, and nothing else leaves them. ' +
          'A teammate says, without a pause: "The moment we add Dash0 to the Collector, the old vendor stops getting data. We would have to switch over in one go."',
        question: 'Does the teammate\'s answer hold?',
        qid: 'tvw-q-verdict',
        choice: { id: 'tvw-verdict', choices: VERDICT },
      },
      {
        intro:
          'The platform team started the change. The Collector\'s config names an exporter for Dash0 in its traces pipeline, and nobody defined it, so the Collector will not start. ' +
          'Dash0 needs an endpoint and a token: both are in environment variables, <code>DASH0_ENDPOINT</code> and <code>DASH0_AUTH_TOKEN</code>.',
        question: 'Fix the config so it starts and both the old vendor and Dash0 get traces, metrics and logs, in the existing pipelines. Send the token in an <code>Authorization</code> header as <code>Bearer</code>, a space, then the token.',
        qid: 'tvw-q-config',
        configure: CONFIG,
      },
    ],
    finish:
      'A pipeline that lists two exporters sends each a copy, so trying a second vendor does not take the first one away: define the new exporter, read its endpoint and token from the environment, and list it beside the old one.',
  },
};
