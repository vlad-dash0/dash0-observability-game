// Level 4.2: Correlation. The player spots, among eight log lines, the records with no trace link
// (blank ids or an all-zero id), says why they have none (the log call ran outside an active span,
// or through a logger that is not bridged), says how to get a worker's records linked (run the call
// inside a span), and says what Dash0 shows for an unlinked record. There is no Build it step: a log
// record is a standalone record that carries a trace_id and a span_id, not a child of a span
// (issue #91 design note), so the level uses Spot it with `target: 'config'` and Choice.
// Spec: docs/OUTLINE.md §4 Act 4.
// Spec: https://opentelemetry.io/docs/specs/otel/logs/data-model/ , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-traceid , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-spanid , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-traceflags
// Spec: https://opentelemetry.io/docs/specs/otel/logs/api/ , https://opentelemetry.io/docs/specs/otel/logs/ , https://opentelemetry.io/docs/concepts/signals/logs/
// Spec: https://www.w3.org/TR/trace-context/#trace-id , https://www.w3.org/TR/trace-context/#parent-id
// Dash0 docs (not an allowed Spec host): https://www.dash0.com/docs/dash0/telemetry/logging/log-sidebar , https://www.dash0.com/docs/dash0/telemetry/logging/related-logs , https://www.dash0.com/docs/dash0/telemetry/tracing/span-sidebar , https://www.dash0.com/docs/dash0/telemetry/tracing/view
//
// Facts used, each from the pages above: TraceId and SpanId are fields of the log record, set "for logs
// that are part of request processing" (the data model); the Logs API call takes a Context that, when
// implicit context is supported and none is passed, MUST be the current context (logs API); the concepts
// page says an SDK or auto-instrumentation correlates existing logs with the active trace and span, and
// that this goes through the log appender; an all-zero trace id and an all-zero span id are invalid
// (W3C Trace Context). Dash0: the Log Sidebar shows the span a log was created in (its Span Context);
// it reads TraceId and SpanId from the OTLP fields, and for other paths from recognised attribute
// names; the span's Related Logs & Events tab lists, by default, the logs and span events of the same
// trace, and can list by Resource (within 30 minutes of the span), which suits logs outside the trace
// such as background jobs. Nothing below says Dash0 matches an unlinked record any other way.

// Step 1. Each line is what a debug view prints for one record: time, level, service, the record's
// trace_id and span_id fields, then the message. Eight records from Kettle & Co, none real. Three
// have no trace link: blank ids (startup code, a retry worker) and all-zero ids. One blank record
// mentions a trace id in its message; the fields are what link a record, not the text. `whyNot` is
// shown for a picked line that is linked.
const SPOT = {
  id: 'cor-spot',
  target: 'config',
  lines: [
    { id: 'checkout-startup', text: '09:00:02 INFO checkout trace_id= span_id= Listening on port 8080' },
    {
      id: 'checkout-cart',
      text: '09:14:07 INFO checkout trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7 Cart validated for order 8841',
    },
    {
      id: 'payments-retry',
      text: '09:14:08 WARN payments trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=3ee05e5bb0f1ae0c Provider slow, retrying charge',
    },
    {
      id: 'payments-worker',
      text: '09:14:12 ERROR payments trace_id= span_id= Retry worker gave up on charge (trace 4bf92f3577b34da6a3ce929d0e0e4736)',
    },
    {
      id: 'orders-stored',
      text: '09:14:13 INFO orders trace_id=0af7651916cd43dd8448eb211c80319c span_id=b7ad6b7169203331 Order 8841 stored',
    },
    {
      id: 'notifications-email',
      text: '09:14:14 ERROR notifications trace_id=00000000000000000000000000000000 span_id=0000000000000000 Email not sent for order 8841',
    },
    {
      id: 'cart-emptied',
      text: '09:14:15 INFO cart trace_id=5b8efff798038103d269b633813fc60c span_id=eee19b7ec3c1b174 Cart emptied',
    },
    {
      id: 'inventory-reserve',
      text: '09:14:16 DEBUG inventory trace_id=0af7651916cd43dd8448eb211c80319c span_id=a3ce929d0be4d2c1 Reserved 2 items',
    },
  ],
  faults: ['checkout-startup', 'payments-worker', 'notifications-email'],
  whyNot: {
    'checkout-cart': 'Both fields hold real ids: this record links to span 00f067aa0ba902b7 of trace 4bf92f35.... Its level and message do not matter.',
    'payments-retry': 'It carries the same trace_id as the checkout record, so the two services\' records belong to one request, and its own span_id says which span of payments it was written in.',
    'orders-stored': 'Real ids in both fields: a linked record.',
    'cart-emptied': 'Both ids are set and valid. It belongs to a different trace, but it does belong to one.',
    'inventory-reserve': 'Real ids in both fields, whatever the level: even a DEBUG record carries them when it is written inside a span.',
  },
  explain:
    'Three records have no trace link. Two have blank ids: the log call ran outside any span, in startup code and in a retry ' +
    'worker. The email record has all-zero ids, which W3C Trace Context treats as invalid, and some formats print zeros when ' +
    'there is no valid span context. The worker\'s message mentions a trace id, but only the <code>trace_id</code> and ' +
    '<code>span_id</code> fields link a record. The other five are linked, at any level.',
};

// Step 2: why the ids are missing. `why` follows "Right." or "Not quite.".
const WHY = [
  {
    key: 'stripped',
    label: 'Something in the pipeline stripped them: OpenTelemetry stamps a trace id on every log record',
    why: 'It does not. A record carries ids only when it was emitted with a context that holds a span. Outside any span there is nothing to stamp, so there is nothing to strip.',
  },
  {
    key: 'no-active-span',
    label: 'The log call ran outside an active span, or through a logger that is not bridged to OpenTelemetry, so nothing read a context',
    right: true,
    why: 'Correlation is automatic only when the log call happens inside an active span and the logger is bridged: the appender for your logging library hands the current context to the Logs API, which uses the current context when none is passed, and the record gets that span\'s TraceId and SpanId. Startup code, and a worker that does not carry the request\'s context over, log outside any span, so the ids stay empty.',
  },
  {
    key: 'errors-only',
    label: 'Only records at ERROR or above get trace ids',
    why: 'Severity plays no part. The ids come from the context at the moment of the call, so an INFO or DEBUG record written inside a span carries them, and an ERROR written outside one does not.',
  },
];

// Step 3: the fix for the worker. `why` follows "Right." or "Not quite.".
const FIX = [
  {
    key: 'zeros',
    label: 'Fill the two fields with zeros so they are never empty',
    why: 'All zeros is the invalid value: W3C Trace Context treats an all-zero trace id and an all-zero span id as invalid. A record of zeros links to nothing, and it hides that the context is missing.',
  },
  {
    key: 'run-in-span',
    label: 'Make the retry run inside a span: start one for each attempt, or carry the request\'s context over to the worker, and keep logging through the bridged logger',
    right: true,
    why: 'The ids come from the context at the moment of the log call. A span the worker starts for each attempt gives its records a span of their own, and carrying the request\'s context over to the worker thread gives them the request\'s trace. Either way the appender finds a valid span context and sets the fields.',
  },
  {
    key: 'in-message',
    label: 'Write the trace id into the message text',
    why: 'A backend links records through the TraceId and SpanId fields of the record, or for non-OTLP logs through recognised attribute names. Text inside the Body is neither, so the record stays unlinked, as the worker\'s record shows.',
  },
];

// Step 4: the Dash0 tie-in, bounded to what its documentation says. `why` follows "Right." or "Not quite.".
const DASH0 = [
  {
    key: 'by-time',
    label: 'Yes: by default the tab lists every log from the same service around the same time',
    why: 'By default the tab lists the logs and span events of the same trace as the span. Listing by resource, within 30 minutes of the span, is a mode you switch to.',
  },
  {
    key: 'resource-mode',
    label: 'No: the default lists logs of the same trace and this record has no trace id. The Resource mode lists logs of the same resource within 30 minutes, which can include it',
    right: true,
    why: 'In the Related Logs &amp; Events tab of a span, the default mode shows every log record and span event in the same trace. A record with blank ids is not in that trace. The Resource mode shows everything on the same resource within 30 minutes of the span, which Dash0 suggests for logs outside the span\'s trace, such as background jobs. From a log, the Log Sidebar shows the span the record was created in, and an unlinked record has none. Getting the log call inside a span is what makes the link exact.',
  },
  {
    key: 'by-text',
    label: 'Yes: Dash0 reads the trace id out of the message text',
    why: 'Dash0 takes the ids from the TraceId and SpanId fields of an OTLP record or, for other paths, from recognised attribute names such as <code>trace_id</code>. Text in the message is not one of them.',
  },
];

export default {
  id: 'correlation',
  no: '4.2',
  name: 'Correlation',
  sub: 'Which trace was this',
  icon: '\u{1F517}',
  rewardTitle: 'Log correlator',
  cards: ['logs-need-an-active-span'],
  lights: ['checkout'],
  scoring: { parMs: null },
  play: {
    prefix: 'cor',
    steps: [
      {
        intro:
          'From a log, an engineer wants to jump to its trace. That works when the record carries a ' +
          '<code>trace_id</code> and a <code>span_id</code>. A debug view prints each record\'s two fields, ' +
          'blank when the record has none. Kettle &amp; Co logged this while order 8841 was paid.',
        question: 'Spot the records with no trace link.',
        qid: 'cor-q-spot',
        spot: SPOT,
      },
      {
        intro: 'Checkout is instrumented and runs a bridged logger. Yet the three records have no link.',
        question: 'Why do they have no trace link?',
        qid: 'cor-q-why',
        choice: { id: 'cor-why', choices: WHY },
      },
      {
        intro:
          'The payments retry worker picks failed charges off a queue on its own thread pool and logs through the ' +
          'same bridged logger. Its records are the blank ones.',
        question: 'How do you get its records linked?',
        qid: 'cor-q-fix',
        choice: { id: 'cor-fix', choices: FIX },
      },
      {
        intro:
          'You open the trace of order 8841 in Dash0, select the payments span and open its ' +
          '<b>Related Logs &amp; Events</b> tab, left on its default. The worker\'s record has blank ids.',
        question: 'Is the worker\'s record in the list?',
        qid: 'cor-q-dash0',
        choice: { id: 'cor-dash0', choices: DASH0 },
      },
    ],
    finish:
      'You can tell a linked log record from an unlinked one: the ids are fields of the record, set only when the log call ran inside an active span through a bridged logger.',
  },
};
