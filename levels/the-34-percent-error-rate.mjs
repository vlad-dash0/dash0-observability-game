// Level 9.2: The 34% error rate. Act 9 "Live Demo" (docs/LIVE-DEMO.md). The player hears a confident answer to a customer, "yes, 34% of
// checkout requests fail, the numbers come from the spans", and says whether it holds (Choice), then picks the setup that keeps
// every error and a true error rate inside a cap on what is sent to the backend (Trade-off). The answer is
// wrong: with tail sampling that keeps every error plus a share of the rest, the ratio of errors to kept spans is not the ratio
// of errors to requests. The presenter has no name and no affiliation.
// Source: an anonymised call question (docs/LIVE-DEMO.md). Nothing below identifies a customer, a person or a product.
// Spec: https://opentelemetry.io/docs/concepts/sampling/#tail-sampling , https://opentelemetry.io/docs/collector/configuration/#connectors
// Dash0 docs: https://www.dash0.com/docs/dash0/telemetry/signal-control/sample-traces , https://www.dash0.com/docs/dash0/telemetry/signal-control/edge/about-signalcontrol-edge
//
// Facts used (each read on the pages above, 2026-11-05): tail sampling decides on all or most of the spans of a trace, so it can
// always keep traces with an error (the sampling concepts page). A connector is an exporter at the end of one pipeline and a receiver
// at the start of another, and processors run in the order listed (the Collector configuration page). Dash0 computes RED metrics before
// sampling when it samples traces (SignalControl, the sample-traces page), and the SignalControl Edge `dash0redmetrics` connector runs in
// the pre-sampling pipeline, from 100% of spans before sampling (the Edge page). Not claimed: what a Dash0 RED view shows when the
// customer samples in their own Collector before sending, which neither page documents.
// The Collector pipeline fix (a pipeline of its own with no sampling processor) is level 6.2 and is only pointed back to here.
//
// Invented for the game: every figure, from the one table below (1,000 requests a second, 50 of them failed, a policy that keeps every
// error and 10% of the rest, a cap of 200 spans a second), and the scenario. Counting one request as one span of the entry service is
// a simplification. No pricing is stated.

const REQUESTS = 1000; // a second, at the load balancer
const ERRORS = 50; // a second, failed requests
const KEEP_PCT = 10; // the probabilistic policy keeps this share of the traces that did not fail
const CAP = 200; // spans a second the backend takes
const HEALTHY = REQUESTS - ERRORS;
const KEPT_HEALTHY = Math.round((HEALTHY * KEEP_PCT) / 100);
const STORED = ERRORS + KEPT_HEALTHY;
const UNIFORM = Math.round((REQUESTS * KEEP_PCT) / 100);
const UNIFORM_ERRORS = Math.round((ERRORS * KEEP_PCT) / 100); // failed traces a uniform sample keeps each second
const DECOY_PCT = 18; // a dearer random policy that still fits the cap
const DECOY = Math.round((REQUESTS * DECOY_PCT) / 100);
const DECOY_ERRORS = Math.round((ERRORS * DECOY_PCT) / 100);
const MORE_PCT = 20; // every error plus a larger share of the rest
const STORED_MORE = ERRORS + Math.round((HEALTHY * MORE_PCT) / 100);
const STORED_PCT = Math.round((ERRORS / STORED) * 100);
const TRUE_PCT = Math.round((ERRORS / REQUESTS) * 100);

const TIMES_OVER = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 10: 'ten' }[REQUESTS / CAP] ?? String(REQUESTS / CAP); // keep-all against the cap
const n = (x) => x.toLocaleString('en-US');
const WRONG_SUM = `${ERRORS} / ${STORED} = ${STORED_PCT}%`;
const TRUE_SUM = `${ERRORS} / ${n(REQUESTS)} = ${TRUE_PCT}%`;

// Step 1: does the presenter's answer hold? `why` follows "Right." or "Not quite.".
const VERDICT = [
  {
    key: 'holds',
    label: `It holds: the backend counts every span it receives, so ${STORED_PCT}% of requests fail`,
    why: `The ${STORED_PCT}% is a share of the spans that were kept, not of the requests. Most healthy spans were dropped on purpose, and the errors were all kept.`,
  },
  {
    key: 'wrong',
    label: `It is wrong: ${STORED_PCT}% is a share of the kept spans, not a share of the requests`,
    right: true,
    why:
      `The policy keeps every error and ${KEEP_PCT}% of the rest, so the numerator is complete and the denominator is small. ` +
      `${WRONG_SUM} is a share of kept spans. Of ${n(REQUESTS)} requests a second, ${ERRORS} failed: ${TRUE_SUM}.`,
  },
  {
    key: 'follow-up',
    label: `Ask first: ${ERRORS} errors in ${STORED} spans is a small sample, so get a week of spans`,
    why:
      `A bigger sample does not help, because the bias comes from the policy, not from noise. Keeping every error and ${KEEP_PCT}% of the rest overweights errors at any size. ` +
      'The question to ask is what the ratio is a share of.',
  },
];

// Step 2: the setup. Two knobs: five sampling policies and two places to compute the rate (the answer first).
// Ten plans, one passes. Costs are spans a second sent to the backend. Every whyNot is a whole sentence that names its own option, so it holds
// with either option of the other knob.
const PLAN = {
  id: 'ser-plan',
  unit: 'spans/s sent to the backend',
  cap: CAP,
  knobs: [
    {
      id: 'sampler',
      label: 'Sampling policy',
      options: [
        {
          id: 'keep-all',
          label: `Keep every trace: ${n(REQUESTS)} spans/s`,
          cost: REQUESTS,
          keeps: ['every-error', 'true-rate'],
        },
        {
          id: 'probabilistic-10pct',
          label: `A probabilistic policy at ${KEEP_PCT}% of all traces: about ${n(UNIFORM)} spans/s, chosen at random`,
          cost: UNIFORM,
          keeps: ['true-rate'],
        },
        {
          id: 'errors-10pct',
          label: `Every error plus ${KEEP_PCT}% of the rest: ${n(STORED)} spans/s`,
          cost: STORED,
          keeps: ['every-error'],
        },
        {
          id: 'probabilistic-18pct',
          label: `A probabilistic policy at ${DECOY_PCT}% of all traces: about ${n(DECOY)} spans/s, chosen at random`,
          cost: DECOY,
          keeps: ['true-rate'],
        },
        {
          id: 'errors-20pct',
          label: `Every error plus ${MORE_PCT}% of the rest: ${n(STORED_MORE)} spans/s`,
          cost: STORED_MORE,
          keeps: ['every-error'],
        },
      ],
    },
    {
      id: 'rate',
      label: 'Where the error rate is computed',
      options: [
        {
          id: 'red-before',
          label: 'From RED metrics computed before sampling: data points, no extra spans',
          cost: 0,
          keeps: ['true-rate'],
        },
        {
          id: 'stored-spans',
          label: 'From the spans the backend keeps: no extra spans',
          cost: 0,
        },
      ],
    },
  ],
  needs: [
    { id: 'every-error', label: 'every failed trace' },
    { id: 'true-rate', label: 'an error rate that matches the requests' },
  ],
  answer: { sampler: 'errors-10pct', rate: 'red-before' },
  whyNot: {
    'sampler:probabilistic-10pct': `This policy keeps an honest ratio, but only about ${UNIFORM_ERRORS} of the ${ERRORS} failed traces a second, so most failures can't be opened.`,
    'sampler:probabilistic-18pct': `This policy keeps an honest ratio, but only about ${DECOY_ERRORS} of the ${ERRORS} failed traces a second, so most failures can't be opened.`,
    'sampler:keep-all': `Keeping every trace sends ${n(REQUESTS)} spans/s, ${TIMES_OVER} times the cap of ${CAP}.`,
    'sampler:errors-20pct': `This policy keeps every error and a larger share of the healthy traces: ${n(STORED_MORE)} spans/s, over the cap of ${CAP}.`,
    'rate:stored-spans': `The rate from the spans the backend keeps is a share of kept spans. With every error kept and ${KEEP_PCT}% of the rest, that reads ${WRONG_SUM}, not ${TRUE_PCT}%.`,
  },
  explain:
    `The plan sends ${n(STORED)} of ${CAP} spans/s: all ${ERRORS} errors and ${KEPT_HEALTHY} of the ${n(HEALTHY)} healthy traces. The rate comes from RED metrics computed before sampling, from all ${n(REQUESTS)} requests, so it reads ${TRUE_SUM}; those metrics are data points, not spans, so they add nothing to the spans sent. ` +
    `Computed from the kept spans it would read ${WRONG_SUM}. Sampling and the rate answer different questions: sampling decides which traces you keep to look at, the rate must count everything. ` +
    'Dash0 computes RED metrics before sampling when it samples your traces (SignalControl), and at the edge the <code>dash0redmetrics</code> connector runs in the pre-sampling pipeline, on 100% of spans. ' +
    'If you sample in your own Collector, the pipeline fix is the one in 6.2: compute span metrics before the sampler. ' +
    'These figures come from one authored table, not a measurement.',
};

export default {
  id: 'the-34-percent-error-rate',
  no: '9.2',
  name: 'The 34% error rate',
  sub: 'Does that answer hold?',
  icon: '\u{1F399}',
  rewardTitle: 'Ratio sceptic',
  cards: [],
  lights: ['collector'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'ser',
    steps: [
      {
        intro:
          'On a call, a customer asks: "Does checkout really fail 34% of requests?" The presenter answers without a pause: ' +
          '"Yes. That number comes straight from the spans, so it is real."',
        show:
          `<p>Here is the setup behind the number. The load balancer sees ${n(REQUESTS)} requests a second. ` +
          `Tail sampling keeps every trace with an error plus ${KEEP_PCT}% of the rest. The backend gets this many spans a second:</p>` +
          '<table><caption>Spans a second reaching the backend</caption><thead><tr><th scope="col">Spans</th><th scope="col">Per second</th></tr></thead><tbody>' +
          `<tr><td>With status Error</td><td>${ERRORS}</td></tr>` +
          `<tr><td>Healthy, kept at ${KEEP_PCT}%</td><td>${KEPT_HEALTHY}</td></tr>` +
          `<tr><td>Total reaching the backend</td><td>${STORED}</td></tr></tbody></table>`,
        question: 'Does the presenter\'s answer hold?',
        qid: 'ser-q-verdict',
        choice: { id: 'ser-verdict', choices: VERDICT },
      },
      {
        intro:
          `The honest answer needs a setup that keeps the failed traces you want to open and an error rate that matches the requests. ` +
          `A sampling policy decides which traces are kept: a random share of all of them, every trace, or every error plus a share of the rest. The backend takes ${CAP} spans a second.`,
        question: 'Pick the setup: keep what the team needs and stay within the cap.',
        qid: 'ser-q-plan',
        tradeoff: PLAN,
      },
    ],
    finish:
      `You did not take ${STORED_PCT}% on trust: ${WRONG_SUM} is a share of kept spans, and the request error rate is ${TRUE_SUM}. ` +
      'Keep the errors you want to open, but compute the rate before sampling.',
  },
};
