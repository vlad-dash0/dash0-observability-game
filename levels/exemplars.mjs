// Level 3.6: Exemplars. The player spots, among eight points of the payments latency histogram, the
// ones that carry an exemplar (a recorded measurement with the trace_id and span_id of the span it was
// recorded in), and says why the other points have none (no measurement in them was recorded inside a
// sampled span). There is no Query it step: the PromQL subset has no exemplar support (issue #109), so
// the level uses Spot it with `target: 'config'` and Choice. `target: 'metric'` was not used: it only
// accepts a line that reads `name{labels}` and ends at the closing brace, so it cannot carry a point
// and its exemplar.
// Spec: docs/OUTLINE.md §4 Act 3.
// Spec: https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exemplars
// Spec: https://opentelemetry.io/docs/specs/otel/metrics/sdk/#exemplar , https://opentelemetry.io/docs/specs/otel/metrics/sdk/#exemplarfilter , https://opentelemetry.io/docs/specs/otel/metrics/sdk/#exemplarreservoir
// Spec: https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/#exemplar
//
// Facts used, each from the pages above: an exemplar is a recorded value that associates OpenTelemetry
// context to a metric event, and one use is to link traces with metrics; it has the optional trace
// (trace_id, span_id), the time, the value and filtered attributes (data model). The SDK exemplar says
// that for synchronous instruments the trace ID and span ID are those of the active Span in the
// Context of the Measurement at API call time. A Metric SDK MUST provide the ExemplarFilter and
// ExemplarReservoir hooks, exemplar sampling SHOULD be on by default, the filter's default SHOULD be
// TraceBased, and the SDK MUST support AlwaysOn, AlwaysOff and TraceBased. The filter decides which
// measurements are eligible and the reservoir makes the final decision; TraceBased makes eligible the
// measurements recorded in the context of a sampled parent span; the reservoir MAY sample further
// than the filter. OTEL_METRICS_EXEMPLAR_FILTER takes always_on, always_off or trace_based, default
// trace_based (SDK environment variables).
// Dash0 tie-in: n/a. OUTLINE §4 Act 3 row 3.6 says "jump from a spike to a trace", but no page of the
// Dash0 docs (every page in https://www.dash0.com/sitemaps/docs.xml, 436 on 2026-11-01) describes
// exemplars in the UI; the only mention is the quota of 8 exemplars per data point on
// https://www.dash0.com/docs/dash0/cost-control/quotas-and-limits . So the level states no Dash0
// behaviour and has no Dash0 step. OUTLINE is not edited here.

// Step 1. Eight points of payments.charge.duration (a histogram, seconds), as a debug view would print
// them: time, series, the point's fields (count, sum, min and max of the window, two decimals) and its
// exemplar field. Six 15 s windows of one /pay series (09:14:00 to 09:15:15, the same label set on each)
// show a spike from 09:14:30 to 09:15:00: charges got slow, so fewer finish and the sums jump. A
// scheduler-run job (refund-batch) and a series that has a trace id and span id as labels are on the
// list too. The faults are the three points whose exemplar field holds a value, a trace_id and a
// span_id (the spike points hold two and three, one per recorded measurement, since a point can carry
// several; the quiet window holds one). `whyNot` is shown for a picked point that has none. The text
// never says why a point has none; step 2 asks.
// The numbers are placed so that no blind rule reads the answer off them (test/spot-tells.test.mjs):
// among the answers and the decoys, count, sum, min, max, length, digits, words and "=" signs
// interleave. The decoys that are not the /pay series carry extra labels so their length and token
// counts sit between the answers'. Exemplar values lie within the point's min and max; the pay-label
// decoy's ids appear nowhere else.
const SPOT = {
  id: 'exm-spot',
  target: 'config',
  helps: { hints: true },
  hint: 'An exemplar is not part of the series and does not come with a big number: ask where a point would carry one.',
  lines: [
    { id: 'pay-0914-00', text: '09:14:00 payments.charge.duration{route="/pay"} count=14 sum=4.31s min=0.19s max=0.52s exemplar: none' },
    { id: 'pay-0914-15', text: '09:14:15 payments.charge.duration{route="/pay"} count=13 sum=3.39s min=0.21s max=0.50s exemplar: value=0.28s trace_id=ae926589c1fd4adc8eeaeb2bfcb0d19c span_id=b7adcbfe6920dc31' },
    { id: 'refund-batch', text: '09:14:30 payments.charge.duration{route="/refund-batch", job="settlement-sweep", cloud_region="eu-west-1", instance_id="10.244.103.117:9464", build_id="20241102"} count=4 sum=17.38s min=2.31s max=6.80s exemplar: none' },
    { id: 'pay-0914-30', text: '09:14:30 payments.charge.duration{route="/pay"} count=11 sum=34.52s min=0.34s max=6.12s exemplar: value=0.41s trace_id=3b7e51d09a84c2f6e1470bd8a35c9f12 span_id=6e0d41a9c85b27f3 exemplar: value=6.12s trace_id=ecddaaffc7bfdda6a3ce9f9dcebec436 span_id=00f0c7aa0bacf2b7' },
    { id: 'pay-label', text: '09:14:45 payments.charge.duration{route="/pay", cloud_region="eu-west-1", build_id="2411", trace_id="7d1e0b6a94c2f35880ad41c6be92f07d", span_id="c4a1e5d27b903f68"} count=1 sum=5.40s min=5.40s max=5.40s exemplar: none' },
    { id: 'pay-0914-45', text: '09:14:45 payments.charge.duration{route="/pay"} count=10 sum=41.83s min=0.40s max=7.35s exemplar: none' },
    { id: 'pay-0915-00', text: '09:15:00 payments.charge.duration{route="/pay"} count=9 sum=36.17s min=0.47s max=5.47s exemplar: value=0.52s trace_id=91c4a8e2d7b6035f4ea1c9d82b70f6a3 span_id=d3159b6c0e7a48f2 exemplar: value=2.84s trace_id=5fa07d3c1e9b46a8b2d80c7f4136e95a span_id=08e6b2f4a1c937d5 exemplar: value=5.47s trace_id=fccad9972863abf3deeabec3b1afc60c span_id=eeeb9b7ec3cfb174' },
    { id: 'pay-0915-15', text: '09:15:15 payments.charge.duration{route="/pay"} count=12 sum=3.90s min=0.22s max=0.61s exemplar: none' },
  ],
  faults: ['pay-0914-15', 'pay-0914-30', 'pay-0915-00'],
  whyNot: {
    'pay-0914-00': 'The exemplar field says none: nothing here to follow to a trace. A point is linked only when that field holds a trace_id and a span_id, spike or no spike.',
    'pay-0914-45': 'This point is on the spike and its exemplar field says none. A high value does not bring an exemplar with it, so there is no trace to jump to from this point.',
    'pay-0915-15': 'The spike is over and the field says none: no exemplar, so no link from this point.',
    'refund-batch': 'A job started by a scheduler, not by a request, and its point says none: no exemplar, so no link.',
    'pay-label': 'The trace ID and span id here are labels of the series, not an exemplar: a label makes a series of its own for every value, and an exemplar sits beside the point, in its own field. This point\'s field says none.',
  },
  explain:
    'Three points carry exemplars. Each exemplar is one measurement recorded in that window, with its value, the <code>trace_id</code> and the ' +
    '<code>span_id</code> of the span it was recorded in, and a point can carry more than one: two of the spike points carry two and three. The value is one measurement, not the point\'s sum, and an exemplar can sit on an ' +
    'ordinary point as well as on the spike: the point at 09:14:15 has one, and the spike point at 09:14:45, with ten charges and a 7.35s slowest one, has none. The ' +
    'trace ID and span id in series labels do not link anything, and the scheduled job has no exemplar either.',
};

// Step 2: why the other points have none. `why` follows "Right." or "Not quite.".
const WHY = [
  {
    key: 'errors-only',
    label: 'SDKs only keep exemplars for slow or failing requests, so ordinary points have none',
    why: 'The filters an SDK has to support are AlwaysOn, AlwaysOff and TraceBased, and none of them looks at errors or at how slow a measurement is. The first exemplar on the list is an ordinary 0.28 s charge, and a spike point has none.',
  },
  {
    key: 'unsampled-or-no-span',
    label: 'Those measurements were recorded outside any span, or inside a span that was not sampled',
    right: true,
    why: 'Exemplar sampling is on by default with the TraceBased filter: only a measurement recorded in the context of a sampled span is eligible to become an exemplar. A measurement from a scheduled job has no active span, and one from a request whose trace was not sampled has a span that is not sampled, so neither is eligible. The reservoir then makes the final decision and may keep fewer still. <code>OTEL_METRICS_EXEMPLAR_FILTER</code> can be set to <code>always_on</code> or <code>always_off</code>, and the default is <code>trace_based</code>.',
  },
  {
    key: 'backend-dropped',
    label: 'The backend dropped the exemplars after the points arrived, to keep the metric small',
    why: 'Exemplars are chosen in the SDK while measurements are recorded: the filter decides which measurements are eligible and the reservoir which are kept, and the kept ones leave the SDK in the metric data point. A point that left the SDK with none has none to lose.',
  },
];

export default {
  id: 'exemplars',
  no: '3.6',
  name: 'Exemplars',
  sub: 'From a point to a trace',
  icon: '\u{1F3AF}',
  rewardTitle: 'Exemplar spotter',
  cards: ['exemplars-need-sampled-spans'],
  lights: ['payments'],
  scoring: { parMs: null },
  play: {
    prefix: 'exm',
    steps: [
      {
        intro:
          'Charges got slow on Kettle &amp; Co at 09:14:30. The payments histogram <code>payments.charge.duration</code> shows ' +
          'the spike, and an engineer wants to jump from a point to a trace of one slow charge. A point can link to traces ' +
          'through its exemplars: each is a recorded measurement with the <code>trace_id</code> and <code>span_id</code> of the span it was ' +
          'recorded in. Payments traces are sampled, so only some requests are recorded. A debug view prints each point and its exemplar field.',
        question: 'Spot the points that carry an exemplar.',
        qid: 'exm-q-spot',
        spot: SPOT,
      },
      {
        intro:
          'Payments runs a current SDK with its exemplar settings left alone. Yet most points, on the spike too, have no exemplar.',
        question: 'Why do the other points have none?',
        qid: 'exm-q-why',
        choice: { id: 'exm-why', choices: WHY },
      },
    ],
    finish:
      'You can tell a point with an exemplar from one without: an exemplar is one recorded measurement with the ids of its span, and by default only a measurement recorded in a sampled span can become one.',
  },
};
