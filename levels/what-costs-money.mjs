// Level 6.3: What costs money. The player compares how a vendor can meter telemetry: per host (the
// bill follows hosts, not telemetry), per GB (bytes, so the size of each record counts) and per signal
// (spans, log records and metric data points, so the count counts and the size does not). A Choice
// covers per host; two Trade-off steps price the same kind of plan under per-GB and per-signal
// metering. The drivers are volume, cardinality, retention and sampling, taught without a price.
// Spec: docs/OUTLINE.md §4 Act 6.
// Spec: https://opentelemetry.io/docs/concepts/sampling/ , https://prometheus.io/docs/practices/instrumentation/#do-not-overuse-labels
// Docs (Dash0, not an allowed Spec host): https://www.dash0.com/pricing , https://www.dash0.com/docs/dash0/cost-control , https://www.dash0.com/docs/dash0/cost-control/spam-filters , https://www.dash0.com/docs/dash0/cost-control/install-forecast
//
// Every number here is illustrative and invented for Kettle & Co: the units are not a price list and
// the three models are generic, not a description of any one vendor. The one product claim is
// Dash0's: it meters spans, log records and metric data points, charges ingest on every signal sent
// (before filtering) and index only on what is kept, and its cost-control docs describe dashboards
// that rank services by telemetry volume. No price, plan name or per-service cost is stated.

// Step 1: a per-host model. `why` follows "Right." or "Not quite.".
const HOST = [
  {
    key: 'drop-debug',
    label: 'Drop the debug logs: the vendor bills per host, so fewer log lines cost less',
    why: 'Under per-host metering the bill follows the number of hosts, not the telemetry each one sends, so fewer log lines change nothing on the invoice. They can still cost you elsewhere: network, a Collector that has to process them, and a slower search.',
  },
  {
    key: 'fewer-hosts',
    label: 'Run the same workload on fewer, larger hosts',
    right: true,
    why: 'The bill counts hosts, so consolidating them is the lever. The flip side is that a host can send as much telemetry as it likes at no extra charge, so nothing in the bill pushes you to trim volume.',
  },
  {
    key: 'sample',
    label: 'Sample 10% of traces: fewer spans lower a per-host bill',
    why: 'Sampling reduces what is sent and stored, which matters when the price follows volume. A per-host price does not move with it.',
  },
  {
    key: 'short-keys',
    label: 'Shorten the attribute names: smaller records lower a per-host bill',
    why: 'Size matters when bytes are metered. A per-host price ignores both the size and the number of records.',
  },
];

// Step 2: per-GB metering. Cost is bytes sent per day, in GB (illustrative).
const GB = {
  id: 'wcm-gb',
  unit: 'GB per day',
  cap: 100,
  knobs: [
    {
      id: 'traces',
      label: 'Traces',
      options: [
        { id: 'all', label: 'Send every span', cost: 120, keeps: ['slow-traces'] },
        { id: 'tail', label: 'Tail-sample in the Collector: keep errors and slow traces, a small share of the rest', cost: 25, keeps: ['slow-traces'] },
        { id: 'head', label: 'Head-sample 1% at the SDK', cost: 2 },
      ],
    },
    {
      id: 'logs',
      label: 'Logs',
      options: [
        { id: 'full', label: 'Every request and response body in every log line', cost: 80, keeps: ['incident-logs'] },
        { id: 'trimmed', label: 'Every log line, with the bodies cut out', cost: 30, keeps: ['incident-logs'] },
        { id: 'none', label: 'No logs', cost: 0 },
      ],
    },
  ],
  needs: [
    { id: 'slow-traces', label: 'the trace of every slow or failed request' },
    { id: 'incident-logs', label: 'enough log lines to explain an incident' },
  ],
  answer: { traces: 'tail', logs: 'trimmed' },
  whyNot: {
    'traces:head': 'A fixed 1% is picked without looking at the trace, so almost every slow or failed request is thrown away with the healthy ones.',
    'logs:full': 'The bodies are most of the bytes. When bytes are the meter, a few large fields cost more than many short lines.',
  },
  explain:
    'When the meter is bytes, size is the lever as much as count: cutting the bodies out of the logs takes them from 80 to 30 GB with every line kept, where halving the number of lines would only take them from 80 to 40. ' +
    'Sampling is the other lever, and the OpenTelemetry docs call it one of the most effective ways to reduce the cost of observability, with costs of its own. ' +
    'Retention multiplies all of it: data kept for ninety days is stored three times as long as data kept for thirty, so what you store is the daily volume times the days you keep it. ' +
    'The numbers are made up for this level.',
};

// Step 3: per-signal metering. Cost is the number of signals, in cost units per day (illustrative).
const SIGNAL = {
  id: 'wcm-signal',
  unit: 'cost units per day',
  cap: 40,
  knobs: [
    {
      id: 'interval',
      label: 'Metric export interval',
      options: [
        { id: 's10', label: 'Every 10 seconds', cost: 30, keeps: ['fast-alerts'] },
        { id: 's60', label: 'Every 60 seconds', cost: 5, keeps: ['fast-alerts'] },
        { id: 'm5', label: 'Every 5 minutes', cost: 1 },
      ],
    },
    {
      id: 'records',
      label: 'Log records',
      options: [
        { id: 'per-line', label: 'One record for each log line', cost: 40, keeps: ['request-detail'] },
        { id: 'per-line-trimmed', label: 'One record for each log line, with the bodies cut out', cost: 40, keeps: ['request-detail'] },
        { id: 'per-request', label: 'One record for each request, the lines as attributes of it', cost: 10, keeps: ['request-detail'] },
        { id: 'none', label: 'No logs', cost: 0 },
      ],
    },
    {
      id: 'spans',
      label: 'Traces',
      options: [
        { id: 'all', label: 'Send every span', cost: 50, keeps: ['slow-traces'] },
        { id: 'tail', label: 'Tail-sample in the Collector before sending', cost: 12, keeps: ['slow-traces'] },
        { id: 'head', label: 'Head-sample 1% at the SDK', cost: 1 },
      ],
    },
  ],
  needs: [
    { id: 'fast-alerts', label: 'an alert within two minutes of a failure' },
    { id: 'request-detail', label: 'the detail of each request in the logs' },
    { id: 'slow-traces', label: 'the trace of every slow or failed request' },
  ],
  answer: { interval: 's60', records: 'per-request', spans: 'tail' },
  whyNot: {
    'interval:s10': 'A metric sends one data point for each series at every interval, so six times as often is six times the data points for the same information.',
    'interval:m5': 'It is cheap, and a failure can go unseen for several minutes before the next point arrives.',
    'records:per-line': 'The same text in many records. When the meter counts records and not bytes, packing a request\'s lines into one record keeps the detail and cuts the count.',
    'records:per-line-trimmed': 'Smaller records, same count: the meter counts records, so the bill did not move.',
    'spans:head': 'A fixed 1% is picked without looking at the trace, so most slow or failed requests are lost.',
  },
  explain:
    'When the meter counts signals, what matters is how many spans, log records and metric data points you send, and how big each one is does not. ' +
    'That reverses the last step: cutting the bodies saves nothing here, because every line is still one record, and packing a request\'s lines into one record does. ' +
    'A metric makes one data point per series per interval, so cardinality times frequency is what you pay for, which is why the 3.5 rules for attributes matter here too. ' +
    'Dash0 meters spans, log records and metric data points. Its bill has two parts: ingest on every signal you send, before any filtering, and index on the signals you keep. ' +
    'A spam filter drops after ingest, so filtered telemetry still carries the ingest charge, and sampling in the Collector means those spans are never sent at all. ' +
    'Dash0 also has dashboards that rank services by telemetry volume, which show where the count comes from. The numbers are made up for this level.',
};

export default {
  id: 'what-costs-money',
  no: '6.3',
  name: 'What costs money',
  sub: 'Know what the meter counts',
  icon: '\u{1F4B8}',
  rewardTitle: 'Bill reader',
  cards: [],
  lights: ['collector'],
  scoring: { parMs: null },
  play: {
    prefix: 'wcm',
    steps: [
      {
        intro:
          'Kettle & Co is choosing where to send its telemetry, and the price lists differ in what they count. ' +
          'Whatever the meter counts is what you optimise, so the first thing to find out is what that is. ' +
          'Three drivers sit behind every model: how much you send (volume), how many series your metrics make (cardinality) and how long you keep it (retention). ' +
          'Sampling is the lever on volume. The first vendor charges a flat amount for each <b>host</b> that sends telemetry.',
        question: 'Under per-host pricing, which change lowers the bill?',
        qid: 'wcm-q-host',
        choice: { id: 'wcm-host', choices: HOST },
      },
      {
        intro:
          'The second vendor charges per <b>GB</b> sent. The budget is ' +
          `${GB.cap} GB sent a day. The costs are invented, and each option shows the GB it adds.`,
        question: 'Pick a setting for each of the two: keep every need and stay within the budget.',
        qid: 'wcm-q-gb',
        tradeoff: GB,
      },
      {
        intro:
          'The third vendor charges per <b>signal</b>: each span, log record and metric data point is one, however large. ' +
          `The budget is ${SIGNAL.cap} cost units a day. The costs are invented, and each option shows the units it adds.`,
        question: 'Pick a setting for each of the three: keep every need and stay within the budget.',
        qid: 'wcm-q-signal',
        tradeoff: SIGNAL,
      },
    ],
    finish:
      'You know what each pricing model counts: hosts, bytes or signals. Volume, cardinality and retention drive the bill, sampling is the lever on volume, and the model decides whether size or count is the thing to cut.',
  },
};
