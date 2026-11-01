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
// sampler. The "break" of a child that ignores its parent (a child set to always_on) is therefore authored arithmetic from
// the one table below, shown in the copy, not something an engine runs. The costs are one knob of whole-system setups, not one
// knob per service, because a child's cost depends on the root's ratio and the widget adds the costs of the knobs.
// Spans per second is the unit; the table is invented but fixed, and every number in the copy is computed from it.

// The table. A trace through Kettle & Co's checkout makes 12 spans: 4 in storefront (the root), 5 in checkout, 3 in payments.
const TRACES = 400; // new traces a second
const SPANS = { storefront: 4, checkout: 5, payments: 3 };
const WHOLE = SPANS.storefront + SPANS.checkout + SPANS.payments;
const CHILDREN = SPANS.checkout + SPANS.payments;
const CAP = 600; // spans a second the backend budget allows

const n = (x) => x.toLocaleString('en-US');
const FULL = TRACES * WHOLE;
const TEN = TRACES * 0.1; // traces a second kept at 1 in 10
const ONE = TRACES * 0.01;
const AT_TEN = TEN * WHOLE;
const AT_ONE = ONE * WHOLE;
const DROPPED = TRACES - TEN; // traces whose root was dropped
const ORPHANS = DROPPED * CHILDREN; // their children's spans, exported by children that do not follow the root
const ALWAYS_ON_CHILDREN = AT_TEN + ORPHANS;

const SAMPLER = 'OTEL_TRACES_SAMPLER';
const ARG = 'OTEL_TRACES_SAMPLER_ARG';

const PLAN = {
  id: 'hs-plan',
  unit: 'spans/s',
  cap: CAP,
  knobs: [
    {
      id: 'sampler',
      label: 'The sampler setting of <code>storefront</code>, <code>checkout</code> and <code>payments</code>',
      options: [
        {
          id: 'defaults',
          label: `Nothing set: the default, <code>${SAMPLER}=parentbased_always_on</code> everywhere. Every trace is sampled: ${n(TRACES)} × ${WHOLE} = ${n(FULL)}`,
          cost: FULL,
          keeps: ['enough-traces', 'whole-traces'],
        },
        {
          id: 'ratio-1pct',
          label: `<code>${SAMPLER}=parentbased_traceidratio</code> and <code>${ARG}=0.01</code> everywhere: ${n(ONE)} traces/s × ${WHOLE} = ${n(AT_ONE)}`,
          cost: AT_ONE,
          keeps: ['whole-traces'],
        },
        {
          id: 'ratio-10pct',
          label: `<code>${SAMPLER}=parentbased_traceidratio</code> and <code>${ARG}=0.1</code> everywhere: ${n(TEN)} traces/s × ${WHOLE} = ${n(AT_TEN)}`,
          cost: AT_TEN,
          keeps: ['enough-traces', 'whole-traces'],
        },
        {
          id: 'children-always-on',
          label:
            `<code>parentbased_traceidratio</code> at <code>0.1</code> on storefront, and <code>${SAMPLER}=always_on</code> on checkout and payments: ` +
            `${n(AT_TEN)} + ${n(DROPPED)} traces/s × ${CHILDREN} = ${n(ALWAYS_ON_CHILDREN)}`,
          cost: ALWAYS_ON_CHILDREN,
          keeps: ['enough-traces'],
        },
      ],
    },
  ],
  needs: [
    { id: 'enough-traces', label: `about ${n(TEN)} traces a second to look at` },
    { id: 'whole-traces', label: 'every trace that is kept has all of its spans' },
  ],
  answer: { sampler: 'ratio-10pct' },
  whyNot: {
    'sampler:defaults':
      `It keeps everything, and that is the budget's whole point: ${n(FULL)} spans a second is ${n(FULL / CAP)} times the ${n(CAP)} the backend takes. Head sampling is how you stay under it.`,
    'sampler:ratio-1pct':
      `Whole traces, and cheap: ${n(AT_ONE)} spans a second. But ${n(ONE)} traces a second is too few to learn from, and a rare failure is unlikely to be among them.`,
    'sampler:children-always-on':
      `Storefront drops ${n(DROPPED)} of every ${n(TRACES)} traces a second at the root, and checkout and payments, set to <code>always_on</code>, ignore that and sample their spans anyway: ` +
      `${n(DROPPED)} traces/s × ${CHILDREN} spans = ${n(ORPHANS)} spans a second for traces whose root is gone. Those traces arrive with holes, and they cost ${n(ORPHANS)} spans a second of the budget.`,
  },
  explain:
    `The plan costs ${n(AT_TEN)} of ${n(CAP)} spans/s: ${n(TEN)} of ${n(TRACES)} traces a second, ${WHOLE} spans each. ` +
    `<code>${SAMPLER}=parentbased_traceidratio</code> with <code>${ARG}=0.1</code> is ParentBased with a TraceIdRatioBased root: the root decides from the trace ID, and every other span follows the parent's sampled flag, ` +
    'which travels in the <code>traceparent</code> header, so a trace is kept whole or not at all. The ratio is only used for a span with no parent; on a child it never runs. ' +
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
          'The arithmetic below is authored from this table, not run by a sampler.',
        question: 'Pick the sampler setup that fits the budget and keeps every kept trace whole.',
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
