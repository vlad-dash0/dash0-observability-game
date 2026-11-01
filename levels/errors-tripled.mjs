// Act 6 boss: Errors tripled overnight. The error ratio on the checkout dashboard went from 4.0% to 12.2% at 02:05 while the
// load balancer's request rate stayed flat and the error count stayed at 40 a second. The player compares the two request
// rates (span metrics fell 67%, the load balancer did not), sees the error count did not move, and finds the Collector change
// that put tail_sampling in the traces pipeline that feeds the span_metrics connector: the policies keep every error and 30% of
// the rest, so the connector counts all 40 errors but only 328 of 1,000 requests. Three views hold the chain (clues); two are
// red herrings; two are neutral. Scored. A plain-data Scenario for the incident engine, played through one declarative
// `incident` step (lib/widgets/incident.mjs, docs/M1-DESIGN.md §4.3, docs/DECLARATIVE-LEVELS.md §2), then one closing Choice
// on why the ratio moved when the count did not, which grades the nuance of 6.1 and 6.2 (a uniform sampler leaves a ratio alone,
// a sampler that keeps every error does not; compute span metrics before sampling).
// Spec: docs/OUTLINE.md §4 Act 6.
// Spec: https://opentelemetry.io/docs/concepts/sampling/#tail-sampling , https://opentelemetry.io/docs/collector/configuration/#connectors
// Docs (GitHub READMEs, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/README.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/connector/README.md
// Dash0 tie-in: n/a. No Dash0 docs page was checked for this scenario, and nothing below names a Dash0 feature.
//
// Facts used (each read on the pages above): tail sampling decides on all or most of the spans of a trace, and one thing it can
// do is always sample traces that contain an error (sampling concepts). The tail_sampling processor has a `status_code` policy
// (`status_codes: [ERROR]`) and a `probabilistic` policy (`sampling_percentage`), and a trace that another policy sampled is not
// dropped by the probabilistic one (processor README, paraphrased), so errors plus a percentage of the rest keeps both. A connector is an
// exporter at the end of a pipeline and a receiver at the start of another, and is enabled through the pipelines in `service`
// (configuration page), so span_metrics receives what leaves the processors of the traces pipeline that lists it. The connector
// counts the spans it receives into `traces.span.metrics.calls`, with `status.code` as a dimension, and error counts are the
// calls with an Error status code (connector README). The component was renamed from spanmetrics to span_metrics (same README).
// The config shown is the whole gateway config (the + and - lines are the change), and a test assembles and checks it: every component
// defined, nothing unused, span_metrics exported by one traces pipeline and received by one metrics pipeline, and exactly one span_metrics
// instance (the spanmetrics README's Single Writer Principle), so no other pipeline feeds the same connector unsampled.
//
// Invented for the game: all the figures (one table below: 1,000 requests a second, 40 of them failed, a policy that keeps every
// error and 30% of the rest), the times, the services, the deploy and the provider incident. The table is arranged so the title is
// true: 40 of 1,000 is 4.0%, 40 of 328 is 12.2%, about 3x. With errors all kept and only 10% of the rest, the same arithmetic gives
// about 7x for a 4% error rate; 30% is what makes it 3x. Counting one request as one span of the entry service is a simplification.

const REQUESTS = 1000; // a second, at the load balancer, before and after
const ERRORS = 40; // a second, before and after
const KEEP_PCT = 30; // the probabilistic policy keeps this share of the traces that did not fail
const HEALTHY = REQUESTS - ERRORS;
const KEPT_HEALTHY = Math.round((HEALTHY * KEEP_PCT) / 100);
const KEPT = ERRORS + KEPT_HEALTHY;
const DROP = Math.round((1 - KEPT / REQUESTS) * 100);
const n = (x) => x.toLocaleString('en-US');
const pct = (x) => `${((x * 100)).toFixed(1)}%`;
const BEFORE = pct(ERRORS / REQUESTS);
const AFTER = pct(ERRORS / KEPT);

const SCENARIO = {
  id: 'errors-tripled',
  alert: {
    title: 'Error ratio tripled overnight',
    html:
      `<p>PAGE 07:30: the checkout error ratio is ${AFTER}, up from ${BEFORE} yesterday: it tripled overnight, since 02:05. ` +
      'The alert names no cause. Find it before the error budget runs out.</p>',
  },
  budget: { startPct: 100, burnPctPerMin: 6 },
  views: [
    {
      id: 'rate-vs-lb',
      label: 'Request rate: load balancer and span metrics',
      costMin: 3,
      kind: 'clue',
      html:
        '<p>Requests a second, at 01:00 and at 06:00:</p>' +
        '<table><caption>Requests a second</caption>' +
        '<thead><tr><th scope="col">Source</th><th scope="col">01:00</th><th scope="col">06:00</th></tr></thead>' +
        '<tbody>' +
        `<tr><td>Load balancer</td><td>${n(REQUESTS)}</td><td>${n(REQUESTS)}</td></tr>` +
        `<tr><td>Span metrics (<code>traces.span.metrics.calls</code>)</td><td>${n(REQUESTS)}</td><td>${n(KEPT)}</td></tr>` +
        '</tbody></table>' +
        `<p>The load balancer is flat, and the span-metric rate fell ${DROP}% at 02:05.</p>`,
    },
    {
      id: 'error-count',
      label: 'Error count and error ratio',
      costMin: 3,
      kind: 'clue',
      html:
        '<p>Failed requests a second (span metrics, <code>status.code</code> Error), and the ratio, at 01:00 and at 06:00:</p>' +
        '<table><caption>Errors</caption>' +
        '<thead><tr><th scope="col">Measure</th><th scope="col">01:00</th><th scope="col">06:00</th></tr></thead>' +
        '<tbody>' +
        `<tr><td>Failed requests a second</td><td>${ERRORS}</td><td>${ERRORS}</td></tr>` +
        `<tr><td>Error ratio</td><td>${BEFORE}</td><td>${AFTER}</td></tr>` +
        '</tbody></table>' +
        '<p>The error count did not move; only the ratio did.</p>',
    },
    {
      id: 'collector-diff',
      label: 'Collector config change',
      costMin: 3,
      kind: 'clue',
      html:
        '<p>Gateway Collector config, applied at 02:04:</p>' +
        '<pre><code>   receivers:\n' +
        '     otlp:\n' +
        '       protocols:\n' +
        '         grpc:\n' +
        '   processors:\n' +
        '     memory_limiter: {check_interval: 1s, limit_mib: 400, spike_limit_mib: 100}\n' +
        '     batch:\n' +
        '+    tail_sampling:\n' +
        '+      policies:\n' +
        '+        - {name: errors, type: status_code, status_code: {status_codes: [ERROR]}}\n' +
        `+        - {name: rest, type: probabilistic, probabilistic: {sampling_percentage: ${KEEP_PCT}}}\n` +
        '   exporters:\n' +
        '     otlp_grpc/dash0:\n' +
        '       endpoint: ${env:DASH0_ENDPOINT}\n' +
        '   connectors:\n' +
        '     span_metrics:\n' +
        '   service:\n' +
        '     pipelines:\n' +
        '       traces:\n' +
        '         receivers: [otlp]\n' +
        '-        processors: [memory_limiter, batch]\n' +
        '+        processors: [memory_limiter, tail_sampling, batch]\n' +
        '         exporters: [otlp_grpc/dash0, span_metrics]\n' +
        '       metrics/spans:\n' +
        '         receivers: [span_metrics]\n' +
        '         processors: [batch]\n' +
        '         exporters: [otlp_grpc/dash0]</code></pre>',
    },
    {
      id: 'collector-health',
      label: 'Gateway Collector health',
      costMin: 3,
      kind: 'neutral',
      html: '<p>2 of 2 gateway pods are Ready, with no restarts in 24 hours and memory at 38% of the limit. The Collector is healthy.</p>',
    },
    {
      id: 'backend-ingest',
      label: 'Ingestion at the backend',
      costMin: 3,
      kind: 'neutral',
      html: '<p>The backend shows no rejected requests and no errors. It accepts everything the gateway sends.</p>',
    },
    {
      id: 'payments-deploy',
      label: 'Payments deploys',
      costMin: 3,
      kind: 'herring',
      html: '<p><code>payments</code> v2.14 was deployed at 02:20. The error ratio had already jumped at 02:05.</p>',
    },
    {
      id: 'provider-blip',
      label: 'Payment provider status',
      costMin: 4,
      kind: 'herring',
      html:
        `<p>The provider reported an incident from 03:30 to 03:40: failed requests rose to 52 a second and were back to ${ERRORS} by 03:45. ` +
        `The ratio at 03:00 was already ${AFTER}.</p>`,
    },
  ],
  hypotheses: [
    {
      id: 'metrics-after-sampling',
      label: `The <code>span_metrics</code> connector now counts after <code>tail_sampling</code>: it sees every error but only ${KEEP_PCT}% of the other requests`,
      right: true,
      why:
        `The change at 02:04 put <code>tail_sampling</code> in the pipeline that feeds <code>span_metrics</code>. Its policies keep all ${ERRORS} errors a second and ${KEEP_PCT}% of the other ${n(HEALTHY)}, ` +
        `so the connector counts ${KEPT} of ${n(REQUESTS)} requests: the rate falls ${DROP}%, the ratio is ${ERRORS} / ${KEPT} = ${AFTER}, and the load balancer, which sees all ${n(REQUESTS)}, has not moved. ` +
        `The sampler drops ${100 - KEEP_PCT}% of the healthy traces.`,
    },
    {
      id: 'payments-regression',
      label: 'The payments deploy added errors',
      right: false,
      why: `The error count is ${ERRORS} a second before and after, and the deploy was at 02:20, fifteen minutes after the ratio moved.`,
    },
    {
      id: 'traffic-fell',
      label: 'Real traffic fell by two thirds',
      right: false,
      why: `The load balancer shows ${n(REQUESTS)} requests a second, flat. Only the span-metric rate fell.`,
    },
    {
      id: 'provider-failing',
      label: 'The payment provider is failing more requests',
      right: false,
      why: `Its incident ended at 03:40 and the ratio did not come down. The error count is ${ERRORS} a second before and after.`,
    },
  ],
  answerAfterViews: 3,
};

// Step 2: why the ratio moved when the count did not. `why` follows "Right." or "Not quite.".
const RULE = [
  {
    key: 'counted-after-sampling',
    label:
      `The <code>span_metrics</code> connector counts what <code>tail_sampling</code> keeps: all ${ERRORS} errors but only ${KEPT} of ${n(REQUESTS)} requests, ` +
      `so the ratio is ${ERRORS} / ${KEPT} = ${AFTER}, not ${ERRORS} / ${n(REQUESTS)} = ${BEFORE}`,
    right: true,
    why: 'The numerator is complete and the denominator is not, so the ratio is biased up. Compute span metrics before sampling, in a pipeline with no sampling processor.',
  },
  {
    key: 'uniform-sampling',
    label: `Sampling ${KEEP_PCT}% of traces thins errors and requests alike, so the ratio is unchanged and ${AFTER} is a dashboard fault`,
    why:
      `That is true of a sampler that keeps the same share of both, like the head sampler in 6.1: ${KEEP_PCT}% of ${ERRORS} over ${KEEP_PCT}% of ${n(REQUESTS)} is still ${BEFORE}. ` +
      `This policy keeps every error and ${KEEP_PCT}% of the rest, so the shares differ, and the dashboard shows what the connector counted.`,
  },
  {
    key: 'errors-undercounted',
    label: `The error count is flat because the sampler keeps only ${KEEP_PCT}% of errors, so the real count is higher`,
    why: `The <code>status_code</code> policy keeps every error, so the ${ERRORS} a second is the full count. It is the requests that are missing from the count.`,
  },
];

export default {
  id: 'errors-tripled',
  no: null,
  name: 'Errors tripled overnight',
  sub: 'The ratio moved, the errors did not',
  icon: '\u{1F4C8}',
  rewardTitle: 'Honest denominator',
  cards: [],
  lights: ['collector'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'eto',
    steps: [
      {
        intro:
          `The checkout dashboard shows the error ratio at ${AFTER}, three times yesterday's ${BEFORE}, and the load balancer's request rate is flat. ` +
          'Every look costs minutes of error budget. Start with the numbers, then find what changed. Open what you need, then name the cause.',
        incident: SCENARIO,
      },
      {
        intro: 'The incident is explained. In the review, someone asks how the ratio can triple when the error count did not move.',
        question: 'Why did the ratio move?',
        qid: 'eto-q-ratio',
        choice: { id: 'eto-ratio', choices: RULE },
      },
    ],
    finish:
      'You followed a ratio that tripled while the error count and the load balancer did not move, to a tail_sampling processor placed ahead of the span_metrics connector. ' +
      'A sampler that keeps every error and a share of the rest leaves the numerator complete and the denominator small, so compute span metrics before sampling.',
  },
};
