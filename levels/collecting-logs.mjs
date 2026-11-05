// Level 4.3: Collecting logs. The player says how a service they own should send its logs (an OTLP
// appender, not a tailed file), fixes a Collector config so the `filelog/shipping` receiver is defined
// and feeds the logs pipeline, says how to keep a stack trace in one record (`multiline`), says where
// to parse a plain text line into a severity (a `regex_parser` operator in the Collector), and says
// what Dash0 does for unstructured logs nobody parsed (Log AI).
// Spec: docs/OUTLINE.md §4 Act 4.
// Spec: https://opentelemetry.io/docs/specs/otel/logs/ , https://opentelemetry.io/docs/specs/otel/logs/data-model/
// Spec: https://opentelemetry.io/docs/collector/components/receiver/ , https://opentelemetry.io/docs/collector/configuration/#receivers
// Spec: https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/
// Collector contrib docs (not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/filelogreceiver/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/regex_parser.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/json_parser.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/types/parsers.md
// RE2 syntax (not an allowed Spec host): https://github.com/google/re2/wiki/Syntax
// Dash0 docs: https://www.dash0.com/docs/dash0/telemetry/logging/log-ai-processing , https://www.dash0.com/docs/dash0/telemetry/logging/log-severities , https://www.dash0.com/docs/dash0/telemetry/logging/patterns , https://www.dash0.com/docs/dash0/telemetry/logging/json-log-processing
//
// Facts used, each from the pages above. The logs spec describes two ways to collect the logs of an
// application: via files or standard output, and direct to the Collector over OTLP. The first needs
// no change to the app but needs file reading, tailing, rotation and parsing, which "may also be not
// reliable if the output format is not well-defined", and application logs read that way "often lack
// request context" and can be enriched with resource context; the second emits "well-defined, formal,
// highly structured" records, removes "all complexity associated with file logs, such as parsers, log
// tailing and rotation", at the cost of changing the app and of the local file. Correlation by time is
// "the most basic form"; by trace context needs TraceId and SpanId in the record. A non-OTLP format
// records them as trace_id and span_id fields. The filelog receiver README: `include` is required,
// `start_at` is `end` or `beginning` (default `end`), `multiline` holds exactly one of
// `line_start_pattern` or `line_end_pattern` and "instructs the file_input operator to split log
// entries on a pattern other than newlines", `operators` chain parsers such as `json_parser` and
// `regex_parser` (named capture groups become attributes; an embedded `severity` block sets the
// severity), it is in the contrib and Kubernetes distributions, and its stability is beta for logs;
// without a storage extension offsets are kept in memory only. Go (RE2) regular expressions: the `s`
// flag lets `.` match a newline, and it is off by default. The Collector configuration page names
// components `type` or `type/name`. Dash0: Log AI infers a severity for unstructured messages and
// extracts patterns with named attributes, does not override a severity already set, does not modify
// structured JSON logs, and depends on resource attributes (the k8sattributes processor for Kubernetes
// workloads); records collected without a severity number get the UNSPECIFIED range, which is common
// for pod logs read with the filelog receiver.
//
// The configure step grades the config through COLLECTOR_SCHEMA (docs/M1-DESIGN.md §4.8), which does not
// model component settings. A schema that knew filelog's settings would need per-component-type schemas,
// keyed by the type part of an id such as `filelog/shipping`, which is a change to the schema format and
// the checker for one level, so the step grades the wiring (defined, the Collector would start, and
// `uses` requires the logs pipeline to list `filelog/shipping` and `otlp_grpc/dash0`) and the settings
// (`multiline`, `operators`) are taught in the Choice steps, as level 1.3 does for k8sattributes.

// Step 1: the route for code the team owns. `why` follows "Right." or "Not quite.".
const ROUTE = [
  {
    key: 'otlp-appender',
    label: 'Add an OpenTelemetry log appender to orders\' logger, so its records are exported over OTLP',
    right: true,
    why: 'The records leave the app already structured, with TraceId and SpanId taken from the active span, and there are no files to tail, rotate or parse. The cost is a change to the app, and the log is no longer a local file you can read. Tailing standard output with the Collector is the other route, and it is the one for code you cannot change, like shipping\'s agent: it needs no change to the app, but the Collector has to parse every line back into fields, and that may not be reliable when the format is loose.',
  },
  {
    key: 'tail-adds-context',
    label: 'Tail its stdout file with <code>filelog</code>: the Collector can tell which trace each line belongs to',
    why: 'A line in a file has no execution context of its own. The Collector can add resource attributes such as the pod, but a trace id is there only if the application wrote it into the line, as a <code>trace_id</code> field in the JSON, and the Collector then parses it out. Matching by time alone is the most basic form of correlation, not the trace context.',
  },
  {
    key: 'otlp-no-logs',
    label: 'Logs cannot go over OTLP, only traces and metrics can, so orders has to keep writing files',
    why: 'OTLP carries logs as well as traces and metrics. The logs specification describes applications sending log records straight to the Collector over OTLP, through a log appender for their logging library.',
  },
];

// Step 2: the config. The logs pipeline lists `filelog`, but the receiver is defined as `filelog/shipping`:
// the Collector would refuse to start. The reference lists the defined id and carries the settings the
// next steps explain.
const GIVEN = [
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  '  filelog/shipping:',
  '    include: [/var/log/shipping/agent.log]',
  'processors:',
  '  batch:',
  'exporters:',
  '  otlp_grpc/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  'service:',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [batch]',
  '      exporters: [otlp_grpc/dash0]',
  '    logs:',
  '      receivers: [filelog]',
  '      processors: [batch]',
  '      exporters: [otlp_grpc/dash0]',
  '',
].join('\n');

const REFERENCE = [
  'receivers:',
  '  otlp:',
  '    protocols:',
  '      grpc:',
  '  filelog/shipping:',
  '    include: [/var/log/shipping/agent.log]',
  '    start_at: beginning',
  '    multiline:',
  '      line_start_pattern: ^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}',
  '    operators:',
  '      - type: regex_parser',
  "        regex: '(?s)^(?P<time>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}) (?P<sev>[A-Z]+) (?P<msg>.*)$'",
  '        severity:',
  '          parse_from: attributes.sev',
  'processors:',
  '  batch:',
  'exporters:',
  '  otlp_grpc/dash0:',
  '    endpoint: ${env:DASH0_ENDPOINT}',
  'service:',
  '  pipelines:',
  '    traces:',
  '      receivers: [otlp]',
  '      processors: [batch]',
  '      exporters: [otlp_grpc/dash0]',
  '    logs:',
  '      receivers: [filelog/shipping]',
  '      processors: [batch]',
  '      exporters: [otlp_grpc/dash0]',
  '',
].join('\n');

const CONFIG = {
  id: 'col-config',
  schema: 'collector',
  given: GIVEN,
  reference: REFERENCE,
  uses: { logs: ['filelog/shipping', 'otlp_grpc/dash0'] },
  hint: 'The logs pipeline lists a receiver called <code>filelog</code>. Compare it, letter for letter, with the id defined under <code>receivers</code>.',
  explain:
    'A receiver reads nothing until a pipeline lists it, and a pipeline can only list what is defined, spelled the same: ' +
    '<code>filelog</code> and <code>filelog/shipping</code> are different components, because the part after the slash names an ' +
    'instance. Defined but not listed, the receiver reads nothing; listed but not defined, the Collector refuses to start. ' +
    'Pointing the logs pipeline at <code>otlp</code> instead would start the Collector too, but shipping\'s file would never be read, ' +
    'so the task needs <code>filelog/shipping</code> in the logs pipeline, which exports to Dash0. The receiver produces logs, so it ' +
    'belongs in a logs pipeline, and it is a contrib component. Its settings do the reading: <code>include</code> says which files, ' +
    '<code>start_at</code> where to begin (the default is the end of the file, so lines already there are skipped), ' +
    '<code>multiline</code> where an entry starts and <code>operators</code> how to parse it. This game checks the wiring, not the ' +
    'settings; the next steps are about them.',
};

// Step 3: multiline. The sample is what the vendor's agent writes: one stack trace between two records.
const SAMPLE = [
  '2026-11-01 03:07:41 ERROR label printer offline: port 9100 refused',
  'java.net.ConnectException: Connection refused',
  '    at com.labelco.agent.Printer.open(Printer.java:88)',
  '    at com.labelco.agent.Queue.flush(Queue.java:41)',
  '2026-11-01 03:07:46 INFO reconnecting to printer',
].join('\n');

const MULTILINE = [
  {
    key: 'line-start',
    label: 'Set <code>multiline</code> on the receiver, with a <code>line_start_pattern</code> that matches the beginning of an entry: the timestamp',
    right: true,
    why: 'By default the receiver ends an entry at every newline. With <code>multiline</code> it ends an entry where the pattern says the next one starts, so the lines that do not begin with a timestamp stay with the entry before them. The block takes exactly one of <code>line_start_pattern</code> and <code>line_end_pattern</code>. The split happens as the file is read, before any operator runs, so the parser then sees the whole stack trace as one entry.',
  },
  {
    key: 'frame-pattern',
    label: 'Set <code>line_start_pattern</code> to the stack frames: <code>^\\s+at </code>',
    why: 'The start pattern has to match the line an entry begins with, and a frame is not where an entry begins. A pattern that matches frames starts a new entry at every frame, so the trace is still cut into pieces, and the next record\'s timestamp line is glued onto the last frame.',
  },
  {
    key: 'parser-joins',
    label: 'Add a <code>regex_parser</code> operator for the first line, and the lines under it will follow',
    why: 'Operators work on entries that are already split. With no <code>multiline</code>, every line is an entry of its own by the time a parser sees it, so a parser cannot join them.',
  },
];

// Step 4: parsing. `why` follows "Right." or "Not quite.".
const PARSE = [
  {
    key: 'collector-regex',
    label: 'In the Collector: add a <code>regex_parser</code> operator to the receiver, with a <code>severity</code> block that reads the level from a named group',
    right: true,
    why: 'Operators run on each entry inside the receiver. The named groups of the regular expression become attributes, and the <code>severity</code> block sets the record\'s severity from the group it names, here the level. The entry is several lines long, so the expression turns on the <code>s</code> flag, <code>(?s)</code>, to let <code>.</code> match a newline; without it the message group stops at the first line break. Shipping\'s agent cannot be changed, so the Collector is the only place to parse it. Where you own the code, the better place is the source: write JSON, or export over OTLP with the severity already set.',
  },
  {
    key: 'agent-config',
    label: 'In the vendor\'s agent: change its log format to JSON',
    why: 'Nobody can change the vendor\'s agent, which is why the Collector reads its file at all. Where you do own the code, writing JSON, or exporting over OTLP, beats parsing text back into fields.',
  },
  {
    key: 'receiver-knows',
    label: 'Nowhere: the <code>filelog</code> receiver reads the word <code>ERROR</code> and sets the severity on its own',
    why: 'The receiver reads text and does nothing with it. With no operator that parses the level, the record has no severity number: the line is the Body. Dash0 documents UNSPECIFIED as the severity range of records that arrive without one, which is common for pod logs read with the filelog receiver.',
  },
];

// Step 5: the Dash0 tie-in, bounded to what its documentation says. `why` follows "Right." or "Not quite.".
const DASH0 = [
  {
    key: 'log-ai',
    label: 'Log AI infers a severity for them and groups similar messages into patterns, keeping the variable parts as named attributes',
    right: true,
    why: 'Log AI works on unstructured messages as they are ingested. It infers a severity where none is set, and it extracts patterns: the variable parts, such as order numbers, become placeholders in the pattern and named attributes you can filter and group by (the Patterns view, and the <code>dash0.log.pattern</code> attribute). It never overrides a severity that is already set, and it leaves structured logs such as JSON to JSON log processing. It relies on resource attributes, so on Kubernetes the <code>k8sattributes</code> processor still matters. A parser in the Collector stays the precise fix; Log AI is for text nobody parsed.',
  },
  {
    key: 'rewrites-all',
    label: 'Log AI rewrites the severity of every record, JSON logs and severities you set in the Collector included',
    why: 'It does not. A severity that is explicitly set is respected, and structured logs are handled separately, by JSON log processing.',
  },
  {
    key: 'needs-parser',
    label: 'Nothing: without a parser in the Collector the records stay plain text with no severity until someone writes one',
    why: 'Dash0 does not wait for a parser. Log AI infers a severity and extracts patterns from unstructured messages as they are ingested. A parser in the Collector is still the better fix when you can write one.',
  },
];

export default {
  id: 'collecting-logs',
  no: '4.3',
  name: 'Collecting logs',
  sub: 'Files, lines and records',
  icon: '\u{1F4C4}',
  rewardTitle: 'Log collector',
  cards: ['filelog-tails-files'],
  lights: ['shipping'],
  scoring: { parMs: null },
  play: {
    prefix: 'col',
    steps: [
      {
        intro:
          'Two Kettle &amp; Co services log in different ways. Orders is the team\'s own code and prints one JSON object ' +
          'per line to standard output. Shipping runs a vendor\'s label-printer agent that nobody can change: it writes ' +
          'plain text lines to <code>/var/log/shipping/agent.log</code>. The platform team wants both in Dash0, and wants ' +
          'orders\' records linked to their traces.',
        question: 'How should orders\' logs reach Dash0?',
        qid: 'col-q-route',
        choice: { id: 'col-route', choices: ROUTE },
      },
      {
        intro:
          'Shipping\'s file has to be read by the Collector. The platform team defined a <code>filelog/shipping</code> ' +
          'receiver and wired a <code>logs</code> pipeline to Dash0, but no shipping record arrives: the Collector would not start.',
        question: 'Fix the config so <code>filelog/shipping</code> feeds the logs pipeline, which exports to Dash0.',
        qid: 'col-q-config',
        configure: CONFIG,
      },
      {
        intro:
          'The config is right and shipping\'s lines are flowing. Then the agent crashes and prints a stack trace, and ' +
          'Dash0 shows every line of it as a record of its own. This is what is in the file:',
        code: SAMPLE,
        question: 'How do you keep one stack trace together as one record?',
        qid: 'col-q-multiline',
        choice: { id: 'col-multiline', choices: MULTILINE },
      },
      {
        intro:
          'Shipping\'s records now arrive whole, but each one is a single long line of text with no severity number: ' +
          'nothing reads the <code>ERROR</code> in it. The first line of an entry looks like this: ' +
          '<code>2026-11-01 03:07:41 ERROR label printer offline: port 9100 refused</code>.',
        question: 'Where do you parse the level out of the line?',
        qid: 'col-q-parse',
        choice: { id: 'col-parse', choices: PARSE },
      },
      {
        intro:
          'The notifications team never wrote a parser either. Their plain text lines reach Dash0 with no severity ' +
          'number, and one message repeats thousands of times with a different order number in it.',
        question: 'What does Dash0 do with those unstructured records?',
        qid: 'col-q-dash0',
        choice: { id: 'col-dash0', choices: DASH0 },
      },
    ],
    finish:
      'You can get logs into the pipeline: an appender and OTLP for code you own, the filelog receiver for files you cannot change, wired into a logs pipeline, split with multiline and parsed with operators.',
  },
};
