// Level 6.2: Tail sampling. The player sets up a tail sampler for the memory it can hold (policies that keep the errors, the
// slow traces and a healthy baseline, and a decision wait long enough to see the whole trace but not longer than the memory
// allows), then spots the pipeline where the span_metrics connector is fed after tail_sampling, so the request and error rates
// it computes come from the kept traces only.
// Spec: docs/OUTLINE.md §4 Act 6.
// Spec: https://opentelemetry.io/docs/concepts/sampling/#tail-sampling , https://opentelemetry.io/docs/collector/configuration/#connectors
// Docs (GitHub READMEs, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/README.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/connector/README.md
// (the connector README shows one connector as the exporter of several pipelines, which then all feed that one connector; the spanmetrics README's "Known Limitation: the Single Writer Principle" warns that several pipelines using one instance, or several instances writing the same streams, can conflict or drop series, so the config here has one pipeline exporting to exactly one span_metrics connector)
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
// Spot it does not parse the config or check any wiring: it grades which of five config lines the player selects against a seeded
// set. The seeded fault is the one traces pipeline whose processors list tail_sampling and whose exporters list span_metrics. Configure it
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

// Step 2: the placement, on the smallest config that shows it: one span_metrics connector (the spanmetrics README's single writer
// rule: two connectors writing the same metrics conflict). The `traces` pipeline lists tail_sampling and span_metrics together,
// which is the one fault; the other four lines are correct. Together the five lines are one config the Collector accepts (the
// connector is exported by a traces pipeline and received by a metrics one); the fix the explain describes is a valid one-connector
// config too. test/act-6.test.mjs assembles both and checks that.
const SPOT = {
  id: 'ts-spot',
  target: 'config',
  lines: [
    { id: 'traces', text: 'traces: receivers: [otlp] processors: [memory_limiter, tail_sampling, batch] exporters: [otlp_grpc/dash0, span_metrics]' },
    { id: 'metrics-spans', text: 'metrics/spans: receivers: [span_metrics] processors: [batch] exporters: [otlp_grpc/dash0]' },
    { id: 'logs', text: 'logs: receivers: [otlp] processors: [memory_limiter, batch] exporters: [otlp_grpc/dash0]' },
    { id: 'connector-def', text: 'connectors: span_metrics:' },
    { id: 'sampler-def', text: 'processors: tail_sampling: decision_wait: 30s' },
  ],
  faults: ['traces'],
  whyNot: {
    'metrics-spans': 'This is the receiving end of the connector, a metrics pipeline: a connector has to be received somewhere, or the Collector will not start. What the connector gives it depends on the traces pipeline that lists it, and that is where to look.',
    logs: 'A logs pipeline: the connector is not in it and there is no sampler, so nothing here touches the span metrics.',
    'connector-def': 'This only defines the connector. Defining a component does not decide what it receives: that is decided by the pipelines that list it.',
    'sampler-def': 'This only defines the sampler and its wait. What it does to the span metrics depends on which pipeline lists it next to the connector.',
  },
  explain:
    'A connector is an exporter at the end of one pipeline and a receiver at the start of another, so it receives what comes out of the processors of the traces pipeline that lists it. ' +
    `In <code>traces</code>, <code>tail_sampling</code> runs first and <code>span_metrics</code> gets only what it kept: ${n(KEPT)} of ${n(TRACES)} traces a second. ` +
    `The request rate it computes is ${n(KEPT)} a second, not ${n(TRACES)}, and the error ratio is ${n(ERRORS)} of ${n(KEPT)}, ${ERROR_SHARE}%, not the real ${pct(ERROR_RATE)}, because the sampler kept every error and few of the rest. ` +
    'Compute span metrics before sampling: give the connector its own traces pipeline with no sampling processor, <code>traces/metrics</code>, ' +
    'with <code>exporters: [span_metrics]</code>, and keep <code>tail_sampling</code> only on the <code>traces</code> pipeline that goes to the backend. ' +
    'It is still one span_metrics connector, received by <code>metrics/spans</code>: the README warns that several pipelines using one instance, or several instances writing the same metrics, can conflict or lose series. ' +
    'A receiver can be listed in more than one pipeline, so both traces pipelines can read the same <code>otlp</code> receiver. ' +
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
          'The same gateway computes request and error rates from spans with one <code>span_metrics</code> connector, and a metrics pipeline sends them to the dashboards. Since the <code>tail_sampling</code> processor went in, the dashboards are wrong: the request rate fell to a tenth and the error ratio jumped. ' +
          'Here is part of the gateway\'s config, one line each.',
        question: 'Spot the line that makes the connector count the wrong spans.',
        qid: 'ts-q-spot',
        spot: SPOT,
      },
    ],
    finish:
      'You know tail sampling keeps what is wrong by deciding on the whole trace, and that the wait and the traces held in memory are its price. And you compute span metrics before sampling, in a pipeline with no sampling processor, or your rates are wrong.',
  },
};
