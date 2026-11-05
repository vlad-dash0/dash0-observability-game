// Level 4.1: Structured logs. The player sorts the fields of one log record into body, attributes,
// severity, resource and trace context, says how to record the facts of a payment decline (a short
// message in the Body, the facts as Attributes), says which severity to filter on (the number, not
// the text), and says what to do about the Logs Bridge API (keep the logger, add an appender).
// Spec: docs/OUTLINE.md §4 Act 4.
// Spec: https://opentelemetry.io/docs/specs/otel/logs/data-model/ , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-body , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-attributes
// Spec: https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitytext , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-resource
// Spec: https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-traceid , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-spanid , https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-traceflags
// Spec: https://opentelemetry.io/docs/specs/otel/logs/ , https://opentelemetry.io/docs/specs/otel/logs/api/ , https://opentelemetry.io/docs/concepts/signals/logs/
// Spec: https://www.w3.org/TR/trace-context/#trace-id
//
// Facts used, each from the pages above: the data model lists Timestamp, TraceId, SpanId, TraceFlags,
// SeverityText, SeverityNumber, Body, Resource, InstrumentationScope and Attributes; the Body is the
// message (a string, or structured data); Attributes are "additional information about the specific
// event occurrence" and can vary per record, unlike the Resource; SeverityText is "the original string
// representation of the severity as it is known at the source" and SeverityNumber is an integer from 1
// to 24 (TRACE 1-4, DEBUG 5-8, INFO 9-12, WARN 13-16, ERROR 17-20, FATAL 21-24), smaller meaning less
// severe; the Logs API "was primarily designed for library authors to build log appenders", and the
// concepts page says an application developer should not call the Logs Bridge API directly but use a
// preferred logging library with a log appender. The specification also says the Logs API can be used
// directly by applications (for instance to emit structured events), so the level says "keep your
// logger", not "never call the Logs API".
// Dash0 tie-in: none for this level (docs/OUTLINE.md §4 Act 4: n/a).

// Step 1. One record from Kettle & Co's payments service, as twelve pieces. Buckets are the fields of the
// data model. Labels must not give the bucket away (test/sort-tells.test.mjs). `whyNot` is shown for the buckets an item is
// likely to be confused with.
const SORT = {
  id: 'sl-sort',
  buckets: [
    { id: 'body', label: 'Body' },
    { id: 'attributes', label: 'Attributes' },
    { id: 'severity', label: 'Severity' },
    { id: 'resource', label: 'Resource' },
    { id: 'trace', label: 'Trace context' },
  ],
  items: [
    {
      id: 'msg-declined',
      label: '"Payment declined by provider"',
      bucket: 'body',
      why: 'The message a person reads. The Body holds the message of the record: a human-readable string, or structured data.',
      whyNot: {
        attributes: 'Attributes carry facts about the event, as key and value pairs. This is the message itself, which is the Body.',
      },
    },
    {
      id: 'order-id',
      label: 'order.id = 8841',
      bucket: 'attributes',
      why: 'A fact about this one event, as a key and a value. Attributes hold additional information about the specific event occurrence, and they can differ from record to record.',
      whyNot: {
        body: 'The message says what happened. The order is a fact about it, so it is better as an attribute you can filter on than as text inside the message.',
        resource: 'A Resource describes the source and is the same for every record from it. Orders differ from record to record.',
      },
    },
    {
      id: 'severity-text',
      label: 'SeverityText: WARN',
      bucket: 'severity',
      why: 'The level as the source wrote it, the original string. It is one of the two severity fields of a record.',
      whyNot: {
        attributes: 'Severity has fields of its own, SeverityText and SeverityNumber, so it does not go into the attributes.',
      },
    },
    {
      id: 'service-name',
      label: 'service.name = payments',
      bucket: 'resource',
      why: 'It says which service emitted the record, and it is the same on every record the service emits. The Resource describes the source of the log.',
      whyNot: {
        attributes: 'It does not describe this event. It describes the source, the same for every record from it, which is what the Resource is for.',
      },
    },
    {
      id: 'trace-id',
      label: 'TraceId: 4bf92f3577b34da6a3ce929d0e0e4736',
      bucket: 'trace',
      why: 'The ID of the trace the record was written in, as defined by W3C Trace Context. It is a field of the record, set for logs that are part of request processing.',
      whyNot: {
        attributes: 'TraceId is a field of the record itself, not an attribute you add. That is how a backend can link the record to its trace.',
      },
    },
    {
      id: 'msg-retry',
      label: '"Retrying in 2 seconds"',
      bucket: 'body',
      why: 'Another message for a person to read: the Body.',
      whyNot: {
        attributes: 'Attributes are key and value facts. A sentence for a reader is the Body.',
      },
    },
    {
      id: 'payment-method',
      label: 'payment.method = card',
      bucket: 'attributes',
      why: 'Another fact about this one event. It can be card on one record and another method on the next, which is what attributes are for.',
      whyNot: {
        body: 'It is a fact you may want to filter and count by. As an attribute it is a field you can query, as words in a message it is text to search.',
        resource: 'It varies from record to record. A Resource stays the same for the source.',
      },
    },
    {
      id: 'severity-number',
      label: 'SeverityNumber: 13',
      bucket: 'severity',
      why: 'The normalised level: an integer from 1 to 24. 13 is the first number of the WARN range, 13 to 16.',
      whyNot: {
        attributes: 'It is the other half of severity, a field of the record, not a key you add as an attribute.',
      },
    },
    {
      id: 'pod-name',
      label: 'k8s.pod.name = payments-6c5d9',
      bucket: 'resource',
      why: 'The pod is part of the source that emits the record, and it stays the same for the life of the producer. That is a resource attribute.',
      whyNot: {
        attributes: 'The pod is the same for every record the process emits. It describes the producer, not this event, so it goes on the Resource.',
      },
    },
    {
      id: 'span-id',
      label: 'SpanId: 00f067aa0ba902b7',
      bucket: 'trace',
      why: 'The ID of the span the record was written in. Like TraceId, it is a field of the record.',
      whyNot: {
        attributes: 'SpanId is a field of the record, next to TraceId, not a key in the attributes.',
      },
    },
    {
      id: 'retry-attempt',
      label: 'retry.attempt = 1',
      bucket: 'attributes',
      why: 'The attempt this record is about, a fact about this one event. The next record can say 2.',
      whyNot: {
        body: 'A number you may want to filter on is better as an attribute than as a word in a sentence.',
        resource: 'It changes from one record to the next, and a Resource does not.',
      },
    },
    {
      id: 'trace-flags',
      label: 'TraceFlags: 01',
      bucket: 'trace',
      why: 'The trace flags of the trace the record belongs to, as defined by W3C Trace Context. 01 is the sampled flag. It is a field of the record, with TraceId and SpanId.',
      whyNot: {
        attributes: 'TraceFlags is a field of the record, like TraceId and SpanId, not an attribute.',
      },
    },
  ],
};

// Step 2: body vs attributes. `why` follows "Right." or "Not quite.".
const ATTRS = [
  {
    key: 'all-in-body',
    label: 'One sentence with everything in it: <code>Payment declined for order 8841 by card, attempt 1</code>',
    why: 'It reads well, but to count declines by payment method someone has to take the sentence apart again, and a reworded message breaks that. Facts you want to filter on are better as attributes.',
  },
  {
    key: 'short-message',
    label: 'A short message in the Body, with <code>order.id</code> and <code>payment.method</code> as Attributes',
    right: true,
    why: 'The Body holds the message and the Attributes hold additional information about this specific event, which can vary from record to record. Support can then filter by <code>order.id</code> and group by <code>payment.method</code> without taking a sentence apart. Structured logs mean a consistent schema of named, typed fields, not only text that happens to be JSON.',
  },
  {
    key: 'on-resource',
    label: 'As resource attributes, so every record has them',
    why: 'A Resource is fixed for a source: every record from it has the same Resource. An order and a payment method differ from record to record, so they cannot be set once on the source.',
  },
];

// Step 3: severity. `why` follows "Right." or "Not quite.".
const SEVERITY = [
  {
    key: 'text',
    label: 'Filter on <code>SeverityText</code> equal to <code>WARN</code>',
    why: 'SeverityText is the original string from the source: one library writes <code>WARN</code>, another <code>warning</code>, another <code>Warn</code>. A filter on one spelling misses the others.',
  },
  {
    key: 'number',
    label: 'Filter on <code>SeverityNumber</code> of 13 or more',
    right: true,
    why: 'SeverityNumber is normalised to the same scale for every source, from 1 to 24, and smaller means less severe. WARN is 13 to 16, ERROR 17 to 20 and FATAL 21 to 24, so 13 or more is "warning or worse" whatever the source called it. The text stays as the original string the source wrote.',
  },
  {
    key: 'body',
    label: 'Search the Body for the word <code>warn</code>',
    why: 'The Body is the message, which can be any text and can say "warn" about something harmless, or not say it at all. Severity has fields of its own.',
  },
];

// Step 4: the nuance. `why` follows "Right." or "Not quite.".
const BRIDGE = [
  {
    key: 'call-bridge',
    label: 'Replace the logging calls with direct calls to the Logs Bridge API',
    why: 'The Logs Bridge API is provided for logging library authors, to build appenders. As an application developer you are not meant to call it directly for ordinary log lines.',
  },
  {
    key: 'keep-logger',
    label: 'Keep your logging library and configure a log appender (a bridge) that sends its records to OpenTelemetry',
    right: true,
    why: 'The Logs Bridge API is for logging library authors, who build appenders that map their library\'s records onto the OpenTelemetry log data model. You keep the logger your code already uses, and add the appender to your setup. The specification does say the Logs API can also be used directly by applications, for example to emit structured events, but that is not the usual route for the log lines you already write.',
  },
  {
    key: 'collector-only',
    label: 'Nothing in the application: logs only reach OpenTelemetry through the Collector reading files',
    why: 'Reading files or standard output with the Collector is one route. The other is an appender in the application, which sends records to OpenTelemetry and can attach the trace context.',
  },
];

export default {
  id: 'structured-logs',
  no: '4.1',
  name: 'Structured logs',
  sub: 'Fields, not sentences',
  icon: '\u{1F4DC}',
  rewardTitle: 'Log reader',
  cards: ['severity-number-not-text'],
  lights: ['payments'],
  scoring: { parMs: null },
  play: {
    prefix: 'sl',
    steps: [
      {
        intro:
          'Payments at Kettle &amp; Co declined a card, and the logs tell you. A log record is more than a line of ' +
          'text: the data model gives it separate fields. Here are twelve pieces of one record.',
        question: 'Pick a piece, then say which field of the record it belongs in.',
        qid: 'sl-q-sort',
        sort: SORT,
      },
      {
        intro:
          'Support wants every decline for order 8841, and a count of declines by payment method. The code ' +
          'currently writes one sentence per decline.',
        question: 'How should the decline be recorded?',
        qid: 'sl-q-attrs',
        choice: { id: 'sl-attrs', choices: ATTRS },
      },
      {
        intro:
          'The on-call dashboard should show "warning or worse" from every service. The Java services write ' +
          '<code>WARN</code>, the Python ones <code>warning</code>, and one team writes <code>Warn</code>.',
        question: 'What should the filter use?',
        qid: 'sl-q-severity',
        choice: { id: 'sl-severity', choices: SEVERITY },
      },
      {
        intro:
          'A teammate read about the Logs Bridge API and wants to rewrite every <code>logger.warn(...)</code> in ' +
          'checkout to call it directly, so that the logs reach OpenTelemetry.',
        question: 'What do you tell them?',
        qid: 'sl-q-bridge',
        choice: { id: 'sl-bridge', choices: BRIDGE },
      },
    ],
    finish:
      'You can read a log record by its fields: message in the Body, facts in Attributes, the source in the Resource, and the level as a number you can filter on. You keep your logger and add an appender.',
  },
};
