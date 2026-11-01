// Level 4.2: Correlation. The player attaches six log records to the spans they were written in (Build it
// in logs mode: a record is a standalone record that carries a trace_id and a span_id, never a child span),
// then says why three have no link (the log call ran outside an active span, or through a logger that is
// not bridged), how to get a worker's records linked (run the call inside a span), and what Dash0 shows
// for an unlinked record. The Spot it step of #91 is replaced by the Build it step, which grades the same
// nuance on more evidence; the three Choice steps are kept.
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

// Step 1: Build it in logs mode. Four spans (two orders at checkout, one charge at payments) and six
// records from Kettle & Co, none real. The player attaches each record to the span it was written in, or
// to none: the record's trace_id and span_id then fill in from that span. Three records get a span: the
// cart check (the innermost span, started as the current span), the neighbour order's record (same service
// and time as order 8841's spans, told apart by order.id) and the slow-provider warning. Three stay
// unlinked: startup (before any request), the retry worker (inside the charge span's window and service,
// but another thread wrote it, so no span was current) and the email (no notifications span on the board).
// Records are standalone: never a span row, never a child.
const T1 = '4bf92f3577b34da6a3ce929d0e0e4736';
const T2 = '0af7651916cd43dd8448eb211c80319c';
const CHECKOUT = 'b1a2c3d4e5f60718';
const CART = '00f067aa0ba902b7';
const CHARGE = '3ee05e5bb0f1ae0c';
const OTHER = 'b7ad6b7169203331';

const span = (spanId, traceId, parentId, name, service, kind, startMs, endMs, attributes = {}) => ({
  spanId, traceId, parentId, name, service, kind, startMs, endMs, status: 'UNSET', attributes, events: [], links: [],
});
const log = (id, timeMs, severity, service, body, attributes) => ({ id, timeMs, severity, service, body, traceId: null, spanId: null, attributes });

const BUILD = {
  id: 'cor-build',
  edit: ['logs'],
  spans: [
    span(CHECKOUT, T1, null, 'POST /checkout', 'checkout', 'SERVER', 0, 120, { 'order.id': '8841' }),
    span(CART, T1, CHECKOUT, 'validate cart', 'checkout', 'INTERNAL', 20, 40),
    span(CHARGE, T1, CHECKOUT, 'POST /charge', 'payments', 'SERVER', 50, 110, { 'thread.name': 'http-exec-1' }),
    span(OTHER, T2, null, 'POST /checkout', 'checkout', 'SERVER', 30, 100, { 'order.id': '8842' }),
  ],
  logs: [
    log('startup', -120, 'INFO', 'checkout', 'Listening on port 8080', { 'thread.name': 'main' }),
    log('cart', 30, 'DEBUG', 'checkout', 'Cart validated', { 'order.id': '8841' }),
    log('other-order', 60, 'INFO', 'checkout', 'Order accepted', { 'order.id': '8842' }),
    log('provider-slow', 70, 'WARN', 'payments', 'Provider slow, retrying charge', { 'thread.name': 'http-exec-1' }),
    log('retry-worker', 95, 'ERROR', 'payments', 'Retry worker gave up on charge', { 'thread.name': 'retry-worker-2' }),
    log('email', 130, 'ERROR', 'notifications', 'Email not sent for order 8841', { 'thread.name': 'mail-pool-1' }),
  ],
  answer: { startup: null, cart: CART, 'other-order': OTHER, 'provider-slow': CHARGE, 'retry-worker': null, email: null },
  hint: 'A record belongs to a span only if that span was the current one when the log call ran: look at the record\'s service, its time and its attributes, and at the span\'s.',
  explain:
    'Three records get a span. The cart check was written inside <code>validate cart</code>, the innermost span of order 8841, ' +
    'started as the current span. The neighbour order\'s record shares checkout and the time with order 8841\'s spans; its ' +
    '<code>order.id</code> says which trace it is in. The provider warning ran on the charge request\'s thread. Three stay ' +
    'unlinked: startup ran before any request, the email has no span on the board, and the retry worker\'s record falls inside ' +
    'the charge span\'s window but a different thread wrote it, so no span was current.',
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
    why: 'A backend links records through the TraceId and SpanId fields of the record, or for non-OTLP logs through recognised attribute names. Text inside the Body is neither, so the record stays unlinked.',
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
          '<code>trace_id</code> and a <code>span_id</code>, and a log call gets them only from the span that is the ' +
          'current span when it runs. Kettle &amp; Co logged these six records while order 8841 was paid, with order 8842 ' +
          'in flight at checkout. When spans nest, the innermost span that was current is the one the call ran in. ' +
          'Attach each record to the span it was written in, or to none.',
        build: BUILD,
      },
      {
        intro: 'Checkout is instrumented and runs a bridged logger. Yet three records have no link.',
        question: 'Why do they have no trace link?',
        qid: 'cor-q-why',
        choice: { id: 'cor-why', choices: WHY },
      },
      {
        intro:
          'The payments retry worker picks failed charges off a queue on its own thread pool and logs through the ' +
          'same bridged logger. Its record is one of the unlinked ones.',
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
