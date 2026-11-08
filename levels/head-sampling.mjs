// Level 6.1: Head sampling. The player picks the sampler setup for three services that fits a span budget and keeps
// whole traces: the decision is made once, at the root, and a child service has to follow the parent's sampled flag
// (ParentBased), or its spans arrive for traces whose root was dropped and the traces have holes.
// Spec: docs/OUTLINE.md §4 Act 6.
// Spec: https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/ , https://opentelemetry.io/docs/specs/otel/trace/sdk/#parentbased , https://opentelemetry.io/docs/specs/otel/trace/sdk/#traceidratiobased
// Spec: https://www.w3.org/TR/trace-context-2/#sampled-flag , https://opentelemetry.io/docs/concepts/sampling/#head-sampling
//
// Facts used (each read on the page above): OTEL_TRACES_SAMPLER defaults to parentbased_always_on; parentbased_traceidratio is
// ParentBased(root=TraceIdRatioBased) and OTEL_TRACES_SAMPLER_ARG is its ratio, a number in [0..1]. ParentBased calls its root
// sampler only for a span with no parent; with a parent it uses the parent's sampled flag (defaults: sampled gives AlwaysOn, not
// sampled gives AlwaysOff). TraceIdRatioBased MUST ignore the parent's sampled flag. Both halves of what the spec says about its
// decision: the Stable text says it MUST be a deterministic hash of the trace ID, so a given trace ID is sampled or not
// independent of language and time; a Development warning says the exact algorithm was never specified and different SDKs or
// versions may differ. The spec recommends it only for root spans, in combination with ParentBased; this level does not
// teach the disagreement and makes no claim either way. The spec also marks TraceIdRatioBased as deprecated in favour of
// the ProbabilitySampler (Development), which this level does not teach. The sampled flag travels in the W3C traceparent header.
// Head sampling decides without looking at the whole trace, so it cannot ensure that traces with an error are kept (the sampling concepts page).
//
// Widget: Trade-off. It grades the option the player picks against authored costs and keeps; it does not simulate a
// sampler. A child's cost depends on the root's ratio and the widget adds the costs of the knobs, so the root is not a
// knob: storefront already runs the 1 in 10 ratio the team wants, and the two knobs are the settings of checkout and
// payments, whose costs are exact at that ratio. The "break" of a child that ignores its parent (always_on, or a plain
// traceidratio) is authored arithmetic from the one table below, shown in the copy, not something an engine runs.
// Spans per second is the unit; the table is invented but fixed, and every number in the copy is computed from it.

// The table. A trace through Kettle & Co's checkout makes 12 spans: 4 in storefront (the root), 5 in checkout, 3 in payments.
const TRACES = 400; // new traces a second
const SPANS = { storefront: 4, checkout: 5, payments: 3 };
const WHOLE = SPANS.storefront + SPANS.checkout + SPANS.payments;
const CAP = 760; // spans a second the backend budget allows

const n = (x) => x.toLocaleString('en-US');
const FULL = TRACES * WHOLE;
const TEN = TRACES * 0.1; // traces a second kept at 1 in 10
const DROPPED = TRACES - TEN; // traces whose root was dropped

const SAMPLER = 'OTEL_TRACES_SAMPLER';
const ARG = 'OTEL_TRACES_SAMPLER_ARG';

const STOREFRONT = TEN * SPANS.storefront;
const KIDS_CAP = CAP - STOREFRONT; // spans a second left for checkout and payments once storefront has its share
const forTen = (service) => TEN * SPANS[service]; // spans a second of a service that follows the root
const forAll = (service) => TRACES * SPANS[service]; // spans a second of a service that samples every trace itself
const forRatio = (service, r) => TRACES * r * SPANS[service]; // a service that applies its own ratio to every trace
const orphanTraces = (r) => TRACES * r - TEN; // traces a plain ratio keeps that the root dropped (a higher ratio keeps every trace a lower one does)
const ratioLine = (r) => `<code>${SAMPLER}=traceidratio</code> and <code>${ARG}=${r}</code>`;

// The root keeps 1 in 10 (storefront, fixed); two knobs set what checkout and payments do with the root's decision.
// The cards show costs and not what an option keeps until a Check: the player has to know that ParentBased, the
// default, follows the sampled flag, and what always_on and a plain ratio do instead. No blind rule finds the plan
// (test/trade-off-balance.test.mjs probes them). Checkout and payments are two knobs; only checkout has a
// need (its spans in every kept trace), because every payments option would keep a payments need: payments is
// decided by the cap, where a plain ratio or always_on is over it. A checkout ratio below the root's keeps only
// part of the root's traces (a higher ratio samples every trace a lower one does), so it keeps no need.
const PLAN = {
  id: 'hs-plan',
  unit: 'spans/s',
  cap: KIDS_CAP,
  helps: { hints: true },
  hint:
    'The decision is made once, at the root, and the sampled flag travels to the children. Ask what each setting makes a child do with a trace whose root was dropped, and how many spans a second that is.',
  knobs: [
    {
      id: 'checkout',
      label: 'The sampler setting of <code>checkout</code>',
      options: [
        {
          id: 'always-on',
          label: `<code>${SAMPLER}=always_on</code>, so every trace is sampled: ${n(TRACES)} × ${SPANS.checkout} = ${n(forAll('checkout'))}`,
          cost: forAll('checkout'),
          keeps: ['checkout-whole'],
        },
        {
          id: 'ratio-5pct',
          label: `${ratioLine(0.05)}: ${n(TRACES * 0.05)} traces/s × ${SPANS.checkout} = ${n(forRatio('checkout', 0.05))}`,
          cost: forRatio('checkout', 0.05),
        },
        {
          id: 'ratio',
          label: `${ratioLine(0.25)}: ${n(TRACES * 0.25)} traces/s × ${SPANS.checkout} = ${n(forRatio('checkout', 0.25))}`,
          cost: forRatio('checkout', 0.25),
          keeps: ['checkout-whole'],
        },
        {
          id: 'follow',
          label: `The default, <code>${SAMPLER}=parentbased_always_on</code>: ${n(TEN)} traces/s × ${SPANS.checkout} = ${n(forTen('checkout'))}`,
          cost: forTen('checkout'),
          keeps: ['checkout-whole'],
        },
        { id: 'always-off', label: `<code>${SAMPLER}=always_off</code>: no spans`, cost: 0 },
      ],
    },
    {
      id: 'payments',
      label: 'The sampler setting of <code>payments</code>',
      options: [
        {
          id: 'follow',
          label: `The default, <code>${SAMPLER}=parentbased_always_on</code>: ${n(TEN)} traces/s × ${SPANS.payments} = ${n(forTen('payments'))}`,
          cost: forTen('payments'),
        },
        {
          id: 'ratio',
          label: `${ratioLine(0.5)}: ${n(TRACES * 0.5)} traces/s × ${SPANS.payments} = ${n(forRatio('payments', 0.5))}`,
          cost: forRatio('payments', 0.5),
        },
        {
          id: 'always-on',
          label: `<code>${SAMPLER}=always_on</code>, so every trace is sampled: ${n(TRACES)} × ${SPANS.payments} = ${n(forAll('payments'))}`,
          cost: forAll('payments'),
        },
      ],
    },
  ],
  needs: [
    { id: 'checkout-whole', label: 'every kept trace has its checkout spans' },
  ],
  answer: { checkout: 'follow', payments: 'follow' },
  whyNot: {
    'checkout:always-on':
      `Storefront drops ${n(DROPPED)} of every ${n(TRACES)} traces a second at the root, and checkout, set to <code>always_on</code>, ignores that and samples its spans anyway: ` +
      `${n(forAll('checkout'))} spans a second against the ${n(forTen('checkout'))} of the traces the root kept, and ${n(DROPPED * SPANS.checkout)} of them belong to traces whose root is gone.`,
    'checkout:ratio':
      `A plain <code>traceidratio</code> must ignore the parent's sampled flag, and a higher ratio samples every trace a lower one does, so checkout keeps the root's ${n(TEN)} traces a second and ${n(orphanTraces(0.25))} more whose root was dropped: ` +
      `${n(forRatio('checkout', 0.25))} spans, ${n(orphanTraces(0.25) * SPANS.checkout)} of them with no root above them.`,
    'checkout:ratio-5pct':
      `A plain <code>traceidratio</code> must ignore the parent's sampled flag, and a lower ratio samples only some of the traces a higher one does, so checkout at ${n(TRACES * 0.05)} traces a second keeps only half of the root's ${n(TEN)}: ` +
      `${n(forRatio('checkout', 0.05))} spans, and the other half of the root's traces have no checkout spans.`,
    'checkout:always-off': 'It records nothing, so checkout has no spans in the traces the root kept, and every one of them has a hole where checkout should be.',
    'payments:ratio':
      `A plain <code>traceidratio</code> must ignore the parent's sampled flag, and a higher ratio samples every trace a lower one does, so payments keeps the root's ${n(TEN)} traces a second and ${n(orphanTraces(0.5))} more whose root was dropped: ` +
      `${n(forRatio('payments', 0.5))} spans, ${n(orphanTraces(0.5) * SPANS.payments)} of them with no root above them.`,
    'payments:always-on':
      `Payments, set to <code>always_on</code>, samples every trace's spans whatever the root decided: ${n(forAll('payments'))} spans a second against the ${n(forTen('payments'))} of the traces the root kept, ` +
      `and ${n(DROPPED * SPANS.payments)} of them belong to traces whose root is gone.`,
  },
  explain:
    `Storefront keeps ${n(TEN)} of ${n(TRACES)} traces a second, ${n(STOREFRONT)} spans, and checkout and payments follow it. ` +
    `The default, <code>${SAMPLER}=parentbased_always_on</code>, is ParentBased: for a span with a parent it uses the parent's sampled flag, which travels in the <code>traceparent</code> header, so a trace is kept whole or not at all. ` +
    'A ratio on a child would never run under ParentBased, because the ratio belongs to the root sampler, which is used only for a span with no parent. ' +
    'These figures are authored from one table, not run by an engine. What head sampling cannot do is look at the trace: it decides at the root, before any error or slow request has happened, ' +
    'so it keeps 1 in 10 of the failures too. Keeping the errors is the job of tail sampling, next.',
};

// Step 2: the nuance in words. `why` follows "Right." or "Not quite.".
const WHY = [
  {
    key: 'header-lost',
    label: 'Setting a sampler on a service stops it propagating <code>traceparent</code>, so the children cannot see the root',
    why: 'The sampler decides whether a span is recorded and exported, and propagation is separate: the sampled flag still travels in <code>traceparent</code> to the children. The children saw the root\'s decision and did not use it.',
  },
  {
    key: 'own-decision',
    label: 'A child set to <code>always_on</code> ignores the parent\'s sampled flag and samples its spans anyway, so it keeps spans of traces whose root was dropped',
    right: true,
    why: 'Only ParentBased uses the parent\'s decision: for a span with a parent it follows the sampled flag in <code>traceparent</code>, so a trace is kept whole or not at all. <code>always_on</code> ignores the flag and records every span, so checkout and payments keep spans of traces whose root was dropped, and those traces have holes.',
  },
  {
    key: 'ratio-stacks',
    label: 'Each service applies its own ratio on top of the root\'s, so the chances multiply and the children keep too little',
    why: 'Ratios do not multiply. Under ParentBased the ratio belongs to the root sampler, which never runs for a span that has a parent, so a child follows the flag. A child set to <code>always_on</code> keeps too much, not too little.',
  },
];

export default {
  id: 'head-sampling',
  no: '6.1',
  name: 'Head sampling',
  sub: 'Decide at the root',
  icon: '\u{1F3B2}',
  rewardTitle: 'Root decider',
  cards: ['parent-based-sampling'],
  lights: ['storefront'],
  scoring: { parMs: null },
  play: {
    prefix: 'hs',
    steps: [
      {
        intro:
          `Kettle &amp; Co's checkout makes ${n(TRACES)} traces a second through three services: <code>storefront</code> is the root, then <code>checkout</code> and <code>payments</code>. ` +
          `A trace is ${WHOLE} spans (${SPANS.storefront} in storefront, ${SPANS.checkout} in checkout, ${SPANS.payments} in payments), so keeping everything is ${n(TRACES)} × ${WHOLE} = ${n(FULL)} spans a second, ` +
          `and the backend takes ${n(CAP)} spans a second. Head sampling decides when the root span starts, from the trace ID and a ratio, and passes the decision to the children in the sampled flag of the <code>traceparent</code> header. ` +
          `Storefront is already set to <code>${SAMPLER}=parentbased_traceidratio</code> and <code>${ARG}=0.1</code>: ${n(TEN)} traces a second, ${n(STOREFRONT)} spans, which leaves ${n(KIDS_CAP)} of the ${n(CAP)} for checkout and payments. ` +
          'The arithmetic below is authored from this table, not run by a sampler.',
        question: 'Pick the sampler setting of checkout and of payments: keep what the team needs and stay within the budget.',
        qid: 'hs-q-plan',
        tradeoff: PLAN,
      },
      {
        intro:
          'A teammate sets <code>OTEL_TRACES_SAMPLER=always_on</code> on checkout and payments "so we never lose a span", and leaves storefront on <code>parentbased_traceidratio</code>. ' +
          'Now checkout and payments spans turn up in the backend with no storefront span above them.',
        question: 'Why do the traces have holes?',
        qid: 'hs-q-why',
        choice: { id: 'hs-why', choices: WHY },
      },
    ],
    finish:
      'You know head sampling decides once, at the root, and that every other service must follow the parent\'s sampled flag (ParentBased): a child that decides on its own leaves traces with holes. It cannot keep the errors, because it never sees the whole trace.',
  },
};
