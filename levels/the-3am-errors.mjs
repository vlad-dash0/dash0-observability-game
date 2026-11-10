// Act 4 boss: The 3 a.m. errors. Orders starts logging a burst of errors and the error budget burns while
// the player investigates: from the error logs (one pattern, one record with a trace_id), to the trace
// that record points at (the call to inventory succeeded, orders failed to read the reply), to the deploy
// that changed the reply (inventory 3.1.0 renamed a field). Three views hold the chain (clues); two are red
// herrings; the rest are neutral. Scored. A plain-data Scenario for the incident engine, played through one
// declarative `incident` step (lib/widgets/incident.mjs, docs/M1-DESIGN.md §4.3, docs/DECLARATIVE-LEVELS.md §2).
// The scenario is designed for this game: docs/OUTLINE.md §4 Act 4 gives only "error burst; correlate logs to
// the trace to the deploy", with the Dash0 tie-in "one query language across signals".
// Spec: docs/OUTLINE.md §4 Act 4.
// Spec: https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-traceid , https://opentelemetry.io/docs/specs/otel/logs/
// Spec: https://opentelemetry.io/docs/concepts/signals/traces/ , https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/
// Dash0 docs: https://www.dash0.com/docs/dash0/telemetry/query-data/query-builder/about-query-builder , https://www.dash0.com/docs/dash0/telemetry/query-data/query-builder/analyze-logs
// Dash0 docs: https://www.dash0.com/docs/dash0/telemetry/logging/patterns , https://www.dash0.com/docs/dash0/telemetry/logging/log-ai-processing
//
// Facts used, each from the pages above: TraceId and SpanId are fields of a log record, which is what lets a
// backend go from a log to the trace it was written in (logs data model); a trace is the spans that share a
// trace id, and a span's service.version is a resource attribute (traces concept, semantic conventions).
// Dash0: the Patterns view clusters similar log messages into templates with a record count and the severity
// breakdown, and Log AI extracts the variable parts as named attributes; PromQL is the query language of
// Dash0, and the Query Builder has tabs for logging, tracing and metrics that show the PromQL they build.
// Nothing below claims more than that a filter such as service.name reads the same in each of them.
// The closing Choice step uses the logs specification's three dimensions of correlation: by time ("the most basic
// form"), by trace context (TraceId and SpanId in the record) and by origin (the Resource).

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

const SCENARIO = {
  id: 'the-3am-errors',
  alert: {
    title: 'The 3 a.m. errors',
    html:
      '<p>PAGE 03:07: orders is logging about 1,240 errors a minute, 60 times its normal rate, and 14% of order requests fail. ' +
      'It began at 03:02. The alert names no cause. Find it before the error budget runs out.</p>',
  },
  budget: { startPct: 100, burnPctPerMin: 5 },
  views: [
    {
      id: 'error-patterns',
      label: 'Error log patterns',
      costMin: 4,
      kind: 'clue',
      html:
        '<p>Orders logs at severity ERROR, last 10 minutes, in the Patterns view:</p>' +
        '<table><caption>Patterns in orders ERROR logs</caption>' +
        '<thead><tr><th scope="col">Pattern</th><th scope="col">Records</th></tr></thead>' +
        '<tbody>' +
        '<tr><td><code>Cannot read stock reservation: missing field &lt;field&gt;</code></td><td>12,380</td></tr>' +
        '<tr><td><code>Order &lt;order_id&gt; rejected: invalid coupon &lt;code&gt;</code></td><td>21</td></tr>' +
        '</tbody></table>' +
        '<p>The first pattern is 99.8% of the errors, and its extracted attribute <code>field</code> is <code>reserved_qty</code> on every record. ' +
        `One record, opened, has <code>trace_id</code> <code>${TRACE_ID}</code>.</p>`,
    },
    {
      id: 'trace-of-error',
      label: 'The trace behind one error',
      costMin: 5,
      kind: 'clue',
      html:
        `<p>The trace of that record's <code>trace_id</code>, <code>${TRACE_ID}</code>, 310 ms in all:</p>` +
        '<ul>' +
        '<li>orders <code>POST /orders</code> SERVER, ERROR</li>' +
        '<li>orders <code>POST /reserve</code> CLIENT, 38 ms, OK</li>' +
        '<li>inventory <code>POST /reserve</code> SERVER, status 200, 31 ms, <code>service.version</code> 3.1.0</li>' +
        '<li>orders <code>parse reservation</code> INTERNAL, ERROR, exception: missing field <code>reserved_qty</code></li>' +
        '</ul>' +
        '<p>The call to inventory succeeded and the failure comes after it, in the orders code that reads the reply. ' +
        'No database span appears: the request fails before it writes the order.</p>',
    },
    {
      id: 'deploys',
      label: 'Deploys',
      costMin: 3,
      kind: 'clue',
      html:
        '<p>Last 24 hours: inventory 3.1.0 deployed at 03:01. Changelog: the <code>POST /reserve</code> reply field ' +
        '<code>reserved_qty</code> is renamed <code>reserved_quantity</code>.</p>' +
        '<p>No other service changed. The orders service was last deployed on Thursday (2.8.4).</p>',
    },
    {
      id: 'db-metrics',
      label: 'Database metrics',
      costMin: 3,
      kind: 'neutral',
      html: '<p>Postgres CPU is 21%, connections are steady and no query is slow. Nothing is saturated.</p>',
    },
    {
      id: 'gateway-traffic',
      label: 'Gateway traffic',
      costMin: 2,
      kind: 'neutral',
      html: '<p>The gateway sees 38 requests a second, the same as last Tuesday at 3 a.m. There is no spike.</p>',
    },
    {
      id: 'orders-pods',
      label: 'Orders pods',
      costMin: 2,
      kind: 'neutral',
      html: '<p>Orders pods use 17% CPU and steady memory, with no restarts in 24 hours. The pods are healthy.</p>',
    },
    {
      id: 'warn-noise',
      label: 'Top WARN pattern',
      costMin: 4,
      kind: 'herring',
      html:
        '<p>The most common WARN pattern is <code>Slow consumer on &lt;topic&gt;</code>, 9,400 a day for a month. ' +
        'Kafka lag is zero. It is not new, and it is not an error.</p>',
    },
    {
      id: 'provider-errors',
      label: 'Payment provider errors',
      costMin: 3,
      kind: 'herring',
      html: '<p>The payment provider error rate is 0.3%, the same as every night this week. None of the ERROR records come from payments.</p>',
    },
  ],
  hypotheses: [
    {
      id: 'inventory-reply',
      label: 'Inventory renamed a field in its reply and orders cannot read it',
      right: true,
      why: 'Every ERROR record says orders is missing field reserved_qty, the trace shows the call to inventory succeeded and the failure is in orders\' parse reservation step, and inventory 3.1.0, deployed at 03:01, one minute before the burst, renamed that field. The log led to the trace, and the trace led to the deploy.',
    },
    {
      id: 'orders-release',
      label: 'A bad orders release introduced a bug in the code that reads replies',
      right: false,
      why: 'Orders was last deployed on Thursday. Its code failed on a reply that arrived with status 200: what changed is the reply it reads, not orders.',
    },
    {
      id: 'database',
      label: 'The database is failing and orders cannot save the order',
      right: false,
      why: 'Postgres is healthy (21% CPU, steady connections), and the request fails before it writes the order, so no database span runs.',
    },
    {
      id: 'traffic-spike',
      label: 'A traffic spike overloaded orders and made it fail',
      right: false,
      why: 'Traffic is the same as last Tuesday and the pods are at 17% CPU. The errors are one parse failure, not timeouts or load.',
    },
  ],
  answerAfterViews: 2,
  hint:
    '<p>Do not guess from the symptom. Follow one failing request from where it was recorded to where it went wrong, then ask what changed in what it received.</p>',
};

// Step 2: what linked the views. `why` follows "Right." or "Not quite.".
const LINK = [
  {
    key: 'trace-and-resource',
    label: 'The <code>trace_id</code> on the log record, which names the trace, and resource attributes such as <code>service.name</code> and <code>service.version</code>, which describe the same producer on every signal',
    right: true,
    why: 'A log record has TraceId and SpanId fields, so a backend can go from a log to the trace it was written in. Logs, traces and metrics each carry a Resource too, and the same attribute names and values for the same producer let a backend line them up by origin: here, inventory 3.1.0 on the trace and in the deploy list. The logs specification names three ways to correlate: by time, by trace context and by origin.',
  },
  {
    key: 'time-only',
    label: 'Only the clock: the errors, the call and the deploy all happened around 03:00',
    why: 'Time is the most basic form of correlation, and a fragile one: many things happen in the same minute. The trace id and the resource are what tie these three views to each other exactly.',
  },
  {
    key: 'message-text',
    label: 'The message text: the same words appear in the log, the trace and the deploy notes',
    why: 'Words in a message are not a link. A record is tied to a trace through its TraceId field, and to a producer through its Resource.',
  },
];

export default {
  id: 'the-3am-errors',
  no: null,
  name: 'The 3 a.m. errors',
  sub: 'From a log line to a deploy',
  icon: '\u{1F319}',
  rewardTitle: 'Night shift',
  cards: [],
  lights: ['orders'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'tae',
    steps: [
      {
        intro: 'It is 3 a.m. and orders is throwing errors. Start from the logs, follow a record to its trace, and the trace to what changed.',
        incident: SCENARIO,
      },
      {
        intro:
          'The incident is explained. In the review, someone asks what let you hop from a log line to a trace to a deploy in minutes.',
        question: 'What linked the three views?',
        qid: 'tae-q-link',
        choice: { id: 'tae-link', choices: LINK },
      },
    ],
    finish:
      'You followed one request from the error logs to its trace to the deploy that changed it: inventory 3.1.0 renamed a ' +
      'field and orders could not read the reply.\n\n' +
      'Dash0 uses PromQL as its query language for logs, traces and metrics alike, ' +
      'with a Query Builder tab for each, so a filter on service.name is written the same way in all three.',
  },
};
