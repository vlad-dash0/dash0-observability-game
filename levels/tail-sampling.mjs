// Level 6.2: Tail sampling. The player sets up a tail sampler for the memory it can hold (policies that keep the errors, the
// slow traces and a healthy baseline, and a decision wait long enough to see the whole trace but not longer than the memory
// allows), then spots the pipelines where a span_metrics connector is fed after tail_sampling, so the request and error rates
// it computes come from the kept traces only.
// Spec: docs/OUTLINE.md §4 Act 6.
// Spec: https://opentelemetry.io/docs/concepts/sampling/#tail-sampling , https://opentelemetry.io/docs/collector/configuration/#connectors
// Docs (GitHub READMEs, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/README.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/connector/README.md
// (the connector README shows one connector as the exporter of several pipelines, which then all feed that one connector; each traces pipeline here therefore names its own span_metrics connector)
//
// Facts used (each read on the page above): tail sampling decides on all or most of the spans of a trace, so it can always keep
// traces with an error or a high latency, and its downsides are that it is hard to implement and to operate, because the component
// is stateful and holds a lot of data (the sampling concepts page). The tail_sampling processor groups spans by trace ID, keeps them in
// memory while it waits for a decision, and needs every span of a trace in the same Collector instance; policies include
// status_code, latency and probabilistic; decision_wait defaults to 30s and num_traces, the number of traces kept in memory,
// to 50000; a trace that arrives when the buffer is full can be dropped before it is sampled, and a span that arrives after its
// trace was decided is late and "can cause different sampling decisions for different parts of the trace" (the processor README).
// The span_metrics connector (renamed from spanmetrics, the old name still works and is deprecated) counts the spans it receives
// into calls and duration metrics; a connector is an exporter at the end of one pipeline and a receiver at the start of another,
// processors run in the order listed, and a receiver may be used in more than one pipeline (the Collector configuration page).
//
// Widgets: Trade-off for the memory and decision-wait cost (an authored table, not a simulation), and Spot it for the placement.
// Spot it does not parse the config or check any wiring: it grades which of six pipeline lines the player selects against a seeded
// set. The seeded fault is a traces pipeline whose processors list tail_sampling and whose exporters list span_metrics. Configure it
// cannot grade this, because its `uses` can only require a component, never forbid one. There is no Configure it step.
// The numbers are one invented table: 400 traces a second, a gateway replica that holds each for the decision wait at 0.05 MiB a trace.
// Error and slow traces are taken as distinct sets, so the kept figures add up.

const TRACES = 400; // new traces a second reaching the replica
const MIB_PER_TRACE = 0.05;
const SLOWEST = 20; // seconds the slowest checkouts take end to end
const ERROR_RATE = 0.02;
const SLOW_RATE = 0.03;
const BASELINE = 0.05; // of the rest
const CAP = 1000; // MiB
const NUM_TRACES = 50000; // the processor's default

const n = (x) => x.toLocaleString('en-US');
const pct = (x) => `${Math.round(x * 100)}%`;
const held = (seconds) => TRACES * seconds;
const mib = (seconds) => Math.round(held(seconds) * MIB_PER_TRACE * 100) / 100;
const ERRORS = TRACES * ERROR_RATE;
const SLOW = TRACES * SLOW_RATE;
const REST = TRACES - ERRORS - SLOW;
const BASE = REST * BASELINE;
const KEPT = ERRORS + SLOW + BASE;
const RATIO_ONLY = TRACES * 0.1;
const ERROR_SHARE = Math.round((ERRORS / KEPT) * 100);

// Step 1: the trade-off. Every wait costs the traces held for it; the policies cost nothing extra, because the processor
// holds every trace until it decides, whichever policies are set.
const BUDGET = {
  id: 'ts-budget',
  unit: 'MiB',
  cap: CAP,
  knobs: [
    {
      id: 'policies',
      label: 'What the <code>tail_sampling</code> policies keep',
      options: [
        {
          id: 'probabilistic',
          label: `A <code>probabilistic</code> policy at 10%: ${n(RATIO_ONLY)} of ${n(TRACES)} traces/s, chosen at random`,
          cost: 0,
          keeps: ['baseline-kept'],
        },
        {
          id: 'errors-slow',
          label: `<code>status_code</code> ERROR and <code>latency</code> above 2 seconds: ${n(ERRORS + SLOW)} of ${n(TRACES)} traces/s (${n(ERRORS)} failed and ${n(SLOW)} slow)`,
          cost: 0,
          keeps: ['errors-kept', 'slow-kept'],
        },
        {
          id: 'errors-slow-baseline',
          label:
            `<code>status_code</code> ERROR, <code>latency</code> above 2 seconds and a <code>probabilistic</code> policy at 5% of the rest: ` +
            `${n(ERRORS)} + ${n(SLOW)} + ${n(BASE)} = ${n(KEPT)} of ${n(TRACES)} traces/s`,
          cost: 0,
          keeps: ['errors-kept', 'slow-kept', 'baseline-kept'],
        },
      ],
    },
    {
      id: 'wait',
      label: 'How long <code>decision_wait</code> holds a trace before it decides',
      options: [
        {
          id: 'wait-10s',
          label: `10 seconds: ${n(TRACES)} traces/s × 10 s × ${MIB_PER_TRACE} MiB = ${n(mib(10))}`,
          cost: mib(10),
        },
        {
          id: 'wait-30s',
          label: `30 seconds, the default: ${n(TRACES)} × 30 × ${MIB_PER_TRACE} MiB = ${n(mib(30))}`,
          cost: mib(30),
          keeps: ['whole-traces'],
        },
        {
          id: 'wait-120s',
          label: `120 seconds: ${n(TRACES)} × 120 × ${MIB_PER_TRACE} MiB = ${n(mib(120))}`,
          cost: mib(120),
          keeps: ['whole-traces'],
        },
      ],
    },
  ],
  needs: [
    { id: 'errors-kept', label: 'every failed trace' },
    { id: 'slow-kept', label: 'every slow trace' },
    { id: 'baseline-kept', label: 'a sample of healthy traces to compare against' },
    { id: 'whole-traces', label: `a decision made on the whole trace, even one that takes ${SLOWEST} seconds` },
  ],
  answer: { policies: 'errors-slow-baseline', wait: 'wait-30s' },
  whyNot: {
    'policies:probabilistic':
      'A random 10% is head sampling again, done later: it keeps 1 in 10 of the failed traces and 1 in 10 of the slow ones, and tail sampling exists to do better than that.',
    'policies:errors-slow':
      'It keeps what is wrong and nothing that is fine, so there is no healthy trace to compare a failing one with. A small probabilistic policy next to the other two adds one.',
    'wait:wait-10s':
      `A trace that takes ${SLOWEST} seconds is still running when the 10 seconds are up, so the processor decides on part of it, and the rest arrives late. ` +
      'A late span can cause different sampling decisions for different parts of the same trace.',
    'wait:wait-120s':
      `It sees every trace whole, and holds ${n(held(120))} traces to do it, ${n(mib(120))} MiB: far more than the ${n(CAP)} MiB the replica has, for traces that were whole after ${SLOWEST} seconds anyway.`,
  },
  explain:
    `The plan costs ${n(mib(30))} of ${n(CAP)} MiB: ${n(TRACES)} new traces a second, each held for the 30-second <code>decision_wait</code>, is ${n(held(30))} traces at once, under the default <code>num_traces</code> of ${n(NUM_TRACES)}. ` +
    `The policies cost nothing extra in this table, because the processor holds every trace until it decides, whichever policies you set. ` +
    `Waiting is what costs: ${n(held(30))} traces held is the price of seeing the slowest traces (${SLOWEST} seconds) whole, and the decision is made on the whole trace, ` +
    `which is how it can keep ${n(ERRORS)} failed and ${n(SLOW)} slow traces a second and ${n(BASE)} healthy ones, ${n(KEPT)} of ${n(TRACES)}, a saving of about ${pct(1 - KEPT / TRACES)} of the traces. ` +
    'The price is a stateful component that all spans of a trace must reach, which is why 5.4 sent them there by trace ID. ' +
    'A span that arrives after the decision is late, and can get a different decision from the rest of its trace. ' +
    'These figures come from one authored table, not a measurement; the real per-trace size depends on your spans.',
};

// Step 2: the placement. `traces` and `traces/checkout` list tail_sampling and span_metrics together. The others each get one
// half right, or are the receiving end of the connector.
const SPOT = {
  id: 'ts-spot',
  target: 'config',
  lines: [
    { id: 'traces', text: 'traces: processors: [memory_limiter, tail_sampling, batch] exporters: [otlp_grpc/dash0, span_metrics/web]' },
    { id: 'traces-checkout', text: 'traces/checkout: processors: [memory_limiter, tail_sampling] exporters: [span_metrics/checkout]' },
    { id: 'traces-metrics', text: 'traces/metrics: processors: [memory_limiter] exporters: [span_metrics/all]' },
    { id: 'traces-sampled', text: 'traces/sampled: processors: [memory_limiter, tail_sampling, batch] exporters: [otlp_grpc/dash0]' },
    { id: 'traces-audit', text: 'traces/audit: processors: [memory_limiter, batch] exporters: [otlp_grpc/dash0, span_metrics/audit]' },
    { id: 'metrics-spans', text: 'metrics/spans: receivers: [span_metrics/all] processors: [batch] exporters: [otlp_grpc/dash0]' },
  ],
  faults: ['traces', 'traces-checkout'],
  whyNot: {
    'traces-metrics': 'The connector is fed straight from the receiver side of the pipeline, with only the memory limiter in between, so it counts every span. This is the shape to aim for.',
    'traces-sampled': 'It samples, and it has no connector to feed, so nothing is counted from the kept traces. The backend gets the sampled traces from here.',
    'traces-audit': 'It lists the connector, and there is no sampling processor in this pipeline, so the connector counts every span that reaches it.',
    'metrics-spans': 'This is the receiving end of the connector, a metrics pipeline. What it gets depends on the traces pipeline that lists the connector, and that is where to look.',
  },
  explain:
    'A connector is an exporter at the end of one pipeline and a receiver at the start of another, so it receives what comes out of the processors of the traces pipeline that lists it. ' +
    'Each pipeline here has its own connector, named after it, because a connector that is the exporter of several pipelines counts the spans of all of them together. ' +
    `In <code>traces</code> and <code>traces/checkout</code> the connector gets what <code>tail_sampling</code> kept. For a pipeline whose connector sees only the sampled spans of the ${n(TRACES)} traces a second, ` +
    `the request rate it computes is ${n(KEPT)} a second, not ${n(TRACES)}, and the error ratio is ${n(ERRORS)} of ${n(KEPT)}, ${ERROR_SHARE}%, not the real ${pct(ERROR_RATE)}, because the sampler kept every error and few of the rest. ` +
    'Compute span metrics before sampling: give the connector a traces pipeline with no sampling processor, as <code>traces/metrics</code> does, and let a pipeline like <code>traces/sampled</code> send the sampled traces to the backend. ' +
    'A receiver can be listed in more than one pipeline, so both can read the same <code>otlp</code> receiver. ' +
    'The connector was renamed from <code>spanmetrics</code> to <code>span_metrics</code>; the old name still works and is deprecated. ' +
    'This step grades the lines you select, not a parsed config: it does not check that the pipelines are wired.',
};

export default {
  id: 'tail-sampling',
  no: '6.2',
  name: 'Tail sampling',
  sub: 'Decide at the end',
  icon: '\u{23F3}',
  rewardTitle: 'Patient sampler',
  cards: ['spanmetrics-before-sampling'],
  lights: ['collector'],
  scoring: { parMs: null },
  play: {
    prefix: 'ts',
    steps: [
      {
        intro:
          `Head sampling kept 1 in 10 of the failures too, so the team moves to tail sampling in the gateway: the <code>tail_sampling</code> processor holds the spans of each trace until it can decide on the whole trace. ` +
          `One gateway replica gets ${n(TRACES)} new traces a second. The team wants every failed trace (${pct(ERROR_RATE)} of them) and every slow one (${pct(SLOW_RATE)}, above 2 seconds, the slowest take ${SLOWEST} seconds), ` +
          `and a healthy baseline. The processor's <code>decision_wait</code> is 30 seconds by default. Each trace held costs ${MIB_PER_TRACE} MiB, and the replica has ${n(CAP)} MiB for it.`,
        question: 'Pick the policies and the wait: keep what the team wants and stay within the memory.',
        qid: 'ts-q-budget',
        tradeoff: BUDGET,
      },
      {
        intro:
          'The same gateway computes request and error rates from spans with the <code>span_metrics</code> connector, and since the <code>tail_sampling</code> processor went in the dashboards are wrong: the request rate fell to a tenth and the error ratio jumped. ' +
          'Here are the gateway\'s pipelines, one line each.',
        question: 'Spot the pipelines where the connector counts the wrong spans.',
        qid: 'ts-q-spot',
        spot: SPOT,
      },
    ],
    finish:
      'You know tail sampling keeps what is wrong by deciding on the whole trace, and that the wait and the traces held in memory are its price. And you compute span metrics before sampling, in a pipeline with no sampling processor, or your rates are wrong.',
  },
};
