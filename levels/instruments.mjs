// Level 3.1: Instruments. The player sorts eight measurements from Kettle & Co's services into
// the instrument that fits (Counter, UpDownCounter, Gauge, Histogram), picks how to report a
// heap size you can read at any time (an asynchronous instrument), then says what a Gauge
// used for a count costs: the sum and start time a rate needs.
// Spec: docs/OUTLINE.md §4 Act 3.
// Spec: https://opentelemetry.io/docs/specs/otel/metrics/api/#synchronous-and-asynchronous-instruments , https://opentelemetry.io/docs/specs/otel/metrics/api/#updowncounter , https://opentelemetry.io/docs/specs/otel/metrics/api/#gauge
// Spec: https://opentelemetry.io/docs/specs/otel/metrics/data-model/#sums , https://opentelemetry.io/docs/specs/otel/metrics/data-model/#gauge

// Step 1. Two measurements per instrument. Label wording must not give the bucket away (test/sort-tells.test.mjs).
const SORT = {
  id: 'instr-sort',
  helps: { hints: false },
  buckets: [
    { id: 'counter', label: 'Counter' },
    { id: 'up-down-counter', label: 'UpDownCounter' },
    { id: 'gauge', label: 'Gauge' },
    { id: 'histogram', label: 'Histogram' },
  ],
  items: [
    {
      id: 'orders-placed',
      label: 'Orders placed',
      bucket: 'counter',
      why: 'It only ever goes up: a Counter takes non-negative increments, here <code>add(1)</code> per order.',
      whyNot: {
        'up-down-counter': 'Nothing ever subtracts from it: an order that was placed stays placed.',
        gauge: 'A gauge records a reading. Orders are counted, so a gauge would lose the rate math.',
      },
    },
    {
      id: 'warehouse-temp',
      label: 'Temperature in the warehouse, in °C',
      bucket: 'gauge',
      why: 'A current reading that makes no sense to add up: two rooms at 20 °C are not 40 °C. That is a Gauge.',
      whyNot: {
        'up-down-counter': 'An UpDownCounter is for values you add up across sources. Adding two room temperatures tells you nothing.',
      },
    },
    {
      id: 'queue-length',
      label: 'Orders waiting in the order queue',
      bucket: 'up-down-counter',
      why: 'It goes up when an order is queued and down when one is taken, and the lengths from several pods add up to the total waiting. That is an UpDownCounter.',
      whyNot: {
        counter: 'A queue shrinks, and a Counter can only add non-negative amounts.',
      },
    },
    {
      id: 'checkout-duration',
      label: 'How long each checkout request took',
      bucket: 'histogram',
      why: 'Many separate values where the spread matters, such as the slowest 1%. A Histogram keeps that spread.',
      whyNot: {
        gauge: 'A gauge keeps one sampled value, so a slow tail would vanish behind the last request.',
      },
    },
    {
      id: 'payment-declines',
      label: 'Payments declined',
      bucket: 'counter',
      why: 'Declines are events you count, and the total only grows. That is a Counter.',
      whyNot: {
        gauge: 'A gauge records a reading. Declines are counted, so a gauge would lose the rate math.',
      },
    },
    {
      id: 'cache-hit-ratio',
      label: 'Cache hit ratio of recommendations, from 0 to 1',
      bucket: 'gauge',
      why: 'A ratio is a reading, and adding two ratios gives nonsense. That is a Gauge.',
      whyNot: {
        histogram: 'It is one current value, not a spread of individual values.',
      },
    },
    {
      id: 'active-requests',
      label: 'Requests being handled right now (+1 when one starts, -1 when it ends)',
      bucket: 'up-down-counter',
      why: 'You add and subtract at the edges of each request, and the counts from three pods add up to what is in flight. That is an UpDownCounter.',
      whyNot: {
        gauge: 'A gauge is for values that make no sense to sum. In-flight requests from three pods do sum.',
      },
    },
    {
      id: 'response-bytes',
      label: 'Size of each response, in bytes',
      bucket: 'histogram',
      why: 'Many separate values where the spread matters, such as the largest responses. A Histogram keeps that spread.',
    },
  ],
};

// Step 2: sync vs async. `why` follows "Right." or "Not quite.".
const ASYNC = [
  {
    key: 'sync-updown',
    label: 'A synchronous UpDownCounter: call <code>add()</code> with the change at every allocation and release',
    why: 'An UpDownCounter you call yourself is for when the current value is not already known, or reading it takes extra effort. Here the runtime already has the number, so reading it on demand is simpler.',
  },
  {
    key: 'async-updown',
    label: 'An asynchronous UpDownCounter: register a callback that reads the heap size when the SDK collects',
    right: true,
    why: 'Heap sizes from several processes add up to the total heap in use, so the value is additive, and an asynchronous (observable) instrument runs your callback only when metrics are collected. Additive and readable on demand is an asynchronous UpDownCounter.',
  },
  {
    key: 'async-gauge',
    label: 'An asynchronous Gauge: register a callback that reads the heap size when the SDK collects',
    why: 'The callback part is right, but a Gauge is for values that make no sense to add up. Heap sizes from several processes add up to the total heap in use, so the API points additive values to an asynchronous UpDownCounter.',
  },
];

// Step 3: the nuance. `why` follows "Right." or "Not quite.".
const GAUGE = [
  {
    key: 'same-data',
    label: 'Nothing: a running total is the same data whichever instrument you pick, only the name differs',
    why: 'The instrument decides the kind of data point. A Gauge point is a sampled value, while a Counter produces a monotonic Sum with a start time, and backends treat the two differently.',
  },
  {
    key: 'sampled-not-sum',
    label: 'The meaning: the backend sees sampled values, so rate math built for counts does not apply',
    right: true,
    why: 'A gauge point is a sampled value with no aggregation semantic. A monotonic Sum also carries a start time, which lets a backend compute a rate that notices restarts, and a sum can be added across series. Report orders with a Counter and call <code>add(1)</code> per order.',
  },
  {
    key: 'lost-between',
    label: 'Orders: a gauge keeps one value per interval, so orders between two samples are lost',
    why: 'Nothing is lost that way: the value recorded is the running total, so the last sample still includes every earlier order. What the gauge lacks is meaning, not data.',
  },
];

export default {
  id: 'instruments',
  no: '3.1',
  name: 'Instruments',
  sub: 'Which one fits',
  icon: '\u{1F4CF}',
  rewardTitle: 'Instrument picker',
  cards: ['gauge-not-count'],
  lights: ['kafka'],
  scoring: { parMs: null },
  play: {
    prefix: 'instr',
    steps: [
      {
        intro:
          'Metrics start in code, with an instrument you pick. Each one tells the SDK what a number ' +
          'means: whether it only goes up, whether you add it up across pods, whether it is a ' +
          'reading, or one of many values. Kettle & Co\'s dashboards need eight of them.',
        question: 'Pick a measurement, then say which instrument fits it.',
        qid: 'instr-q-sort',
        sort: SORT,
      },
      {
        intro:
          'Instruments come in two kinds. Synchronous ones you call where the event happens, ' +
          'such as <code>add()</code> or <code>record()</code>. Asynchronous (observable) ones ' +
          'take a callback that the SDK runs when it collects. Orders\' runtime already keeps its ' +
          'heap size, and you can read it at any time.',
        question: 'How do you report the heap size?',
        qid: 'instr-q-async',
        choice: { id: 'instr-async', choices: ASYNC },
      },
      {
        intro:
          'A teammate reports orders placed with a Gauge that is set to the running total, ' +
          '<code>gauge.record(totalOrders)</code>, and says it works: the number goes up.',
        question: 'What does reporting a count with a Gauge cost you?',
        qid: 'instr-q-gauge',
        choice: { id: 'instr-gauge', choices: GAUGE },
      },
    ],
    finish:
      'You can pick the instrument by what the number means, and you know a count belongs in a Counter, not a Gauge.',
  },
};
