// Level 5.5: OTTL and transforms. The player says how a rename is written in OTTL (a set then a
// delete_key), spots the statements that would still let a customer email leave on a span, wires a
// transform processor that redacts it into the traces and the logs pipeline so the Collector starts,
// and says why a Dash0 spam filter is not the way to redact: it drops whole points at ingestion.
// Spec: docs/OUTLINE.md §4 Act 5.
// Spec: https://opentelemetry.io/docs/collector/transforming-telemetry/ , https://opentelemetry.io/docs/collector/components/processor/
// Docs (GitHub READMEs, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/transformprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/attributesprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/redactionprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/ottlfuncs/README.md
// Docs (filter processor, the Collector-side drop checked in step 4): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/filterprocessor/README.md
// Dash0 docs: https://www.dash0.com/docs/dash0/cost-control/spam-filters
//
// What is graded. The configure step grades the wiring through COLLECTOR_SCHEMA (docs/M1-DESIGN.md
// §4.8), which does not model component settings: an OTTL statement list is `any` to it. A schema
// extension that parsed OTTL would be a second language for one level, so the statement shapes are
// taught in the choice and the spot steps instead, and the configure step requires the transform
// processor in the traces and the logs pipeline (`uses`). A processor sits between receivers and
// exporters, so listed in a pipeline it runs before the exporter sends. Where it sits among the other
// processors is level 5.2. The statements are written with the context-prefixed paths of the
// transform processor README (span.attributes, log.attributes, resource.attributes).
//
// Distribution: the transform and redaction processors are shipped in the contrib distribution (and
// k8s); the level does not say more, because the core list has grown and the pages differ.

// Step 1: rename. `why` follows "Right." or "Not quite.".
const RENAME = [
  {
    key: 'set-only',
    label: 'One statement: <code>set(span.attributes["app.customer.id"], span.attributes["cust"])</code>',
    why: 'That copies the value. The old key is not touched, so every span ends up with both <code>cust</code> and <code>app.customer.id</code>.',
  },
  {
    key: 'set-then-delete',
    label: 'Two statements, in this order: <code>set</code> the new key from the old one, then <code>delete_key</code> the old key',
    right: true,
    why: 'The OTTL function list has no rename function, so a rename is a copy followed by a delete. The statements run in the order they are listed, so the copy has to come first.',
  },
  {
    key: 'delete-then-set',
    label: 'Two statements, the other way round: <code>delete_key</code> the old key, then <code>set</code> the new key from the old value',
    why: 'Statements run in the order listed. After the delete there is nothing left to copy, so the value is lost.',
  },
];

// Step 2: spot the statements that leave the email on the exported span. `user.email` is a span attribute.
const SPOT = {
  id: 'ottl-spot',
  target: 'config',
  helps: { hints: false },
  lines: [
    { id: 'delete-email', text: 'delete_key(span.attributes, "user.email")' },
    { id: 'resource-map', text: 'delete_key(resource.attributes, "user.email")' },
    { id: 'copy-only', text: 'set(span.attributes["customer.email"], span.attributes["user.email"])' },
    { id: 'mask-set', text: 'set(span.attributes["user.email"], "REDACTED")' },
    { id: 'keep-keys', text: 'keep_keys(span.attributes, ["http.route", "http.request.method", "url.path"])' },
    { id: 'admin-only', text: 'delete_key(span.attributes, "user.email") where span.attributes["http.route"] == "/admin"' },
    { id: 'delete-matching', text: 'delete_matching_keys(span.attributes, "(?i).*email.*")' },
    { id: 'typo-key', text: 'set(span.attributes["user.mail"], "REDACTED")' },
  ],
  faults: ['resource-map', 'copy-only', 'admin-only', 'typo-key'],
  whyNot: {
    'delete-email': 'It removes the key from the span attributes, where the email is. After it runs the span has no <code>user.email</code>.',
    'mask-set': 'A redaction does not have to delete: this overwrites the value, so the span keeps the key and loses the email.',
    'keep-keys': 'An allowlist: only the three listed keys stay, so <code>user.email</code> goes with everything else. It is heavy-handed, but nothing leaks.',
    'delete-matching': 'It deletes every span attribute whose key matches the pattern, <code>user.email</code> included, and any other key with email in it.',
  },
  explain:
    'Four statements leave the email on the span. <code>delete_key(resource.attributes, ...)</code> is valid but deletes from another map: the ' +
    'email is in <code>span.attributes</code>. The <code>set</code> that makes a copy under <code>customer.email</code> is half a rename, so the email now ' +
    'sits under two keys. The <code>where</code> clause on the admin route makes the delete run only for those spans, and every other span keeps ' +
    'it. And <code>user.mail</code> is a misspelled key: the statement runs without an error and sets a new attribute, while ' +
    '<code>user.email</code> stays. Statements do not fail when they miss, so a leak only shows when you read what is exported.',
};

// Step 3: the processor is listed in both pipelines. The given's error is the logs list naming
// `transform/redact` while the processor is defined as `transform/pii`: the Collector would not start.
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
  '  transform/pii:',
  '    error_mode: ignore',
  '    trace_statements:',
  '      - delete_key(span.attributes, "user.email")',
  '    log_statements:',
  '      - delete_key(log.attributes, "user.email")',
  '  batch:',
  'exporters:',
  '  otlp_grpc/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  'service:',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, batch]',
  '      exporters: [otlp_grpc/dash0]',
  '    logs:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, transform/redact, batch]',
  '      exporters: [otlp_grpc/dash0]',
  '',
].join('\n');

const REFERENCE = [
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  'processors:',
  '  memory_limiter:',
  '    check_interval: 1s',
  '    limit_mib: 400',
  '    spike_limit_mib: 100',
  '  transform/pii:',
  '    error_mode: ignore',
  '    trace_statements:',
  '      - delete_key(span.attributes, "user.email")',
  '    log_statements:',
  '      - delete_key(log.attributes, "user.email")',
  '  batch:',
  'exporters:',
  '  otlp_grpc/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  'service:',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, transform/pii, batch]',
  '      exporters: [otlp_grpc/dash0]',
  '    logs:',
  '      receivers: [otlp]',
  '      processors: [memory_limiter, transform/pii, batch]',
  '      exporters: [otlp_grpc/dash0]',
  '',
].join('\n');

const CONFIG = {
  id: 'ottl-config',
  schema: 'collector',
  given: GIVEN,
  reference: REFERENCE,
  uses: { traces: ['transform/pii'], logs: ['transform/pii'] },
  helps: { hints: true },
  hint: 'A processor changes data only in the pipelines that list it, and a pipeline can only list a processor that is defined, spelled exactly. The email travels in more than one signal, so check every pipeline\'s processor list, not only the one that stops the Collector.',
  explain:
    'A processor works on the data between the receivers and the exporters, so it has to be listed in every pipeline that carries what it removes, ' +
    'or that pipeline sends the data as it is. Here the email is on spans and in logs, so <code>transform/pii</code> goes in <code>traces</code> and ' +
    '<code>logs</code>, before the exporter sends anything out of the cluster. The given lists <code>transform/redact</code> in logs, which is ' +
    'not defined, so the Collector will not start; fixing only that name leaves traces unredacted. Defining <code>transform/redact</code> as well, ' +
    'deleting the processor, or putting it in a new pipeline beside the old ones would all leave a pipeline exporting the email. The statements ' +
    'are not graded here (this game checks the wiring, not the settings), which is why the spot step checked them, and where the processor sits ' +
    'among the others is the order level.',
};

// Step 4: why not a spam filter. `why` follows "Right." or "Not quite.".
const BACKEND = [
  {
    key: 'spam-strip',
    label: 'Add a Dash0 spam filter on the spans that carry <code>user.email</code>: it strips that attribute and keeps the rest of each span',
    why: 'A spam filter does not strip one attribute and keep the span. It matches whole spans, logs or data points and drops them, so you would lose the spans as well.',
  },
  {
    key: 'pipeline',
    label: 'Redact in the Collector pipeline, before the exporter sends it. A spam filter drops whole points after they arrive and cannot edit one attribute',
    right: true,
    why: 'The transform processor changes the data before it leaves the cluster. A Dash0 spam filter is the backend-side drop: it drops whole spans, logs or data points that match, at ingestion, so it cannot remove one attribute. The data has already left the cluster by then, a drop cannot be recovered, and filtered telemetry still carries the ingest charge. In the Collector, dropping whole telemetry is the filter processor\'s job, which drops what matches before anything is sent.',
  },
  {
    key: 'filter-processor',
    label: 'Add the filter processor to the Collector with a condition on <code>user.email</code>: it removes the attribute from the matching spans and keeps the spans',
    why: 'The filter processor is the Collector-side drop: it drops whole spans, logs or data points that match its conditions, before anything is sent. It does not edit one attribute, so the spans would be lost with the email. Changing an attribute is the transform processor\'s job.',
  },
  {
    key: 'spam-drop-all',
    label: 'Add a spam filter for those spans: they are dropped, and nothing about the customer is kept, and dropped data costs nothing',
    why: 'The spans have already reached Dash0, and filtered telemetry still passes through ingest and carries the ingest charge: a spam filter reduces what is stored, not what you send. It also drops the whole span, not only the email.',
  },
];

export default {
  id: 'ottl-and-transforms',
  no: '5.5',
  name: 'OTTL and transforms',
  sub: 'Before it leaves',
  icon: '\u{1F9FD}',
  rewardTitle: 'Data scrubber',
  cards: ['redact-in-the-pipeline'],
  lights: ['collector'],
  scoring: { parMs: null },
  play: {
    prefix: 'ottl',
    steps: [
      {
        intro:
          'The Collector can change telemetry on its way through. The <b>transform processor</b> does it with statements in OTTL, the ' +
          'OpenTelemetry Transformation Language: a function, such as <code>set</code> or <code>delete_key</code>, and optionally a ' +
          '<code>where</code> condition. Statements run in the order they are listed. The checkout spans carry a custom attribute ' +
          '<code>cust</code>, and the data team wants it called <code>app.customer.id</code>.',
        question: 'Which statements rename an attribute?',
        qid: 'ottl-q-rename',
        choice: { id: 'ottl-rename', choices: RENAME },
      },
      {
        intro:
          'Now the part legal cares about. Checkout puts the customer\'s email on every span as <code>user.email</code>, and it must not ' +
          'leave the cluster. Eight statements were proposed for the span context of the transform processor, and some of them do not ' +
          'remove it.',
        question: 'Spot the statements that would leave the email on the exported span.',
        qid: 'ottl-q-spot',
        spot: SPOT,
      },
      {
        intro:
          'The email is in logs too, so the platform team wrote a processor, <code>transform/pii</code>, that deletes it from spans and from log records. ' +
          'The Collector will not start, and nothing is redacted yet.',
        question: 'Fix the config so the Collector starts and <code>transform/pii</code> runs in both the traces and the logs pipeline.',
        qid: 'ottl-q-config',
        configure: CONFIG,
      },
      {
        intro:
          'The new config is rolling out, but spans with the email are already in Dash0. Someone suggests a spam filter, the backend-side drop, instead of the Collector change.',
        question: 'Can a Dash0 spam filter do the redaction?',
        qid: 'ottl-q-backend',
        choice: { id: 'ottl-backend', choices: BACKEND },
      },
    ],
    finish:
      'You can rename, redact and drop in the Collector with OTTL and the filter processor. Redact before the exporter sends: a Dash0 spam filter drops whole points at ingestion, and it cannot edit one attribute.',
  },
};
