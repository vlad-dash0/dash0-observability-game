// Level 9.1: Filter, sampler, or both? Act 9 "Live Demo" (docs/LIVE-DEMO.md). The player hears a confident answer to a customer,
// "yes, a filter in your Collector keeps only the traces with an error", and says whether it holds (Choice), then sorts nine goals
// by what they take: a filter processor, a tail sampler, or both (Sort it). The answer is wrong: a filter judges one span at a
// time, so it keeps the failed spans and drops the healthy spans of the same trace. The presenter has no name and no affiliation.
// Source: an anonymised call question (docs/LIVE-DEMO.md). Nothing below identifies a customer, a person or a product.
// Spec: https://opentelemetry.io/docs/concepts/sampling/#tail-sampling , https://opentelemetry.io/docs/collector/transforming-telemetry/
// Docs (GitHub READMEs, not an allowed Spec host): the tailsamplingprocessor README and the filterprocessor README in
// https://github.com/open-telemetry/opentelemetry-collector-contrib
//
// Facts used (read on the pages above, 2026-11-05): the filter processor evaluates its conditions on each span, span event, log
// record or data point alone. Tail sampling decides on all or most of the spans of a trace. Its policies include status_code,
// latency (earliest start to latest end), string_attribute (resource and span attributes) and span_count. The sampler keeps or
// drops whole traces, and traces only. deployment.environment.name is a resource attribute.
//
// Invented for the game: the trace table below and the scenario, and the nine goals. No Dash0 claim is made. No YAML. No pricing.

// One failed checkout trace as it reaches the Collector: span, service, status.
const TRACE = [
  ['POST /checkout', 'storefront', 'Error'],
  ['GET /cart/{id}', 'cart', 'Unset'],
  ['POST /orders', 'checkout', 'Error'],
  ['reserve stock', 'inventory', 'Unset'],
  ['UPDATE stock', 'inventory', 'Unset'],
  ['charge card', 'payments', 'Error'],
  ['SELECT payment_methods', 'payments', 'Unset'],
];
const SPANS = TRACE.length;
const ERRORS = TRACE.filter(([, , status]) => status === 'Error').length;
const DROPPED = SPANS - ERRORS;

const ROWS = TRACE.map(([span, service, status]) => `<tr><td>${span}</td><td>${service}</td><td>${status}</td></tr>`).join('');

// Step 1: does the presenter's answer hold? `why` follows "Right." or "Not quite.".
const VERDICT = [
  {
    key: 'holds',
    label: 'It holds: the filter keeps every span with status Error, so every trace with an error is still kept',
    why: `The filter does keep every span with status Error, but only those spans. It judges one span at a time, so it drops the ${DROPPED} healthy spans of the same trace: the cart read, the stock reservation and its update, and the payment-method lookup that show what led up to the failure.`,
  },
  {
    key: 'wrong',
    label: 'It is wrong: the filter judges each span alone, so it keeps the failed spans, not their traces',
    right: true,
    why:
      `A filter processor checks each span against its condition on its own and never sees the rest of the trace. Of the ${SPANS} spans in this failed checkout it keeps the ${ERRORS} with status Error and drops the other ${DROPPED}, so the backend gets pieces of the trace, not the trace. ` +
      'Keeping whole traces that contain an error takes a sampler that waits for the trace and decides on all of it: a tail sampler.',
  },
  {
    key: 'follow-up',
    label: 'Ask first: do all the spans of one trace reach the same Collector before the filter processor runs',
    why:
      'That matters for a tail sampler, which needs every span of a trace in one Collector to decide. ' +
      `A filter judges each span alone, so where the other spans go changes nothing: it still drops the ${DROPPED} healthy spans of the failed trace.`,
  },
];

// Step 2: nine goals, three buckets. Sizes 3 / 4 / 2 (tail, filter, both). Labels must not give the bucket away
// (test/sort-tells.test.mjs).
const SORT = {
  id: 'fos-sort',
  helps: { hints: false },
  buckets: [
    { id: 'filter', label: 'A filter processor' },
    { id: 'tail', label: 'A tail sampler' },
    { id: 'both', label: 'Both: a filter and a tail sampler' },
  ],
  items: [
    {
      id: 'errors-whole',
      label: 'Keep only the traces that have an error, with all their spans',
      bucket: 'tail',
      why: 'Whether a trace has an error is known only once its spans are in. A <code>status_code</code> policy decides on the whole trace and keeps every span of it.',
      whyNot: {
        filter: 'A filter keeps the spans with status Error and drops the healthy spans of the same trace, as in step 1.',
        both: 'Nothing has to go from inside the kept traces, so the sampler alone does it.',
      },
    },
    {
      id: 'healthz',
      label: 'Drop the spans of the <code>/healthz</code> probe',
      bucket: 'filter',
      why: 'A probe request is a small trace of its own, and every one of its spans carries the <code>/healthz</code> path, so each span can be judged and dropped alone.',
      whyNot: {
        tail: 'A tail sampler could drop those traces, but it would hold each one for the whole decision wait to learn what any one of its spans already says.',
        both: 'Nothing here keeps a trace by what the rest of it holds, so there is no work for a sampler.',
      },
    },
    {
      id: 'slow-no-cache',
      label: 'Keep only the slow traces, minus their cache-lookup spans',
      bucket: 'both',
      why: "Which traces are slow is the sampler's decision, made on whole traces. Dropping the cache-lookup spans inside the kept ones is the filter's: a tail sampler keeps or drops a trace whole, never part of it.",
      whyNot: {
        filter: 'A filter can drop the cache-lookup spans, but it cannot tell which traces are slow.',
        tail: 'A tail sampler keeps or drops a whole trace. It cannot keep a trace and drop some of its spans.',
      },
    },
    {
      id: 'slow',
      label: 'Keep only the traces that take over 2 seconds end to end',
      bucket: 'tail',
      why: "End to end runs from the first span's start to the last span's end, so only the whole trace knows it. A <code>latency</code> policy decides on that.",
      whyNot: {
        filter: "A filter sees one span's duration, not the trace's, and it cannot keep the fast spans of a slow trace.",
        both: 'Every span of a slow trace is kept, so there is nothing for a filter to drop.',
      },
    },
    {
      id: 'debug-logs',
      label: 'Drop the debug-level log records from checkout',
      bucket: 'filter',
      why: 'Each log record carries its own severity, so a filter can drop it alone.',
      whyNot: {
        tail: 'A tail sampler groups spans by trace ID and samples traces only. Log records never pass through it.',
        both: 'Log records never pass through a tail sampler, so only the filter does anything here.',
      },
    },
    {
      id: 'many-spans',
      label: 'Keep only the traces with more than 50 spans',
      bucket: 'tail',
      why: 'How many spans a trace has is a fact about the trace, not about any one span. A <code>span_count</code> policy counts them before it decides.',
      whyNot: {
        filter: 'One span does not know how many other spans its trace has.',
        both: 'Every span of the kept traces stays, so a filter has nothing to do.',
      },
    },
    {
      id: 'production-only',
      label: 'Keep only the spans from production, none from the load test',
      bucket: 'filter',
      why: 'The environment is a resource attribute, so every span from the load test carries it. Dropping span by span drops those traces whole anyway.',
      whyNot: {
        tail: 'It would work, but every span already says where it came from, so holding each trace for the decision wait buys nothing.',
        both: 'One attribute on every span decides it, so the filter alone is enough.',
      },
    },
    {
      id: 'via-payments',
      label: 'Keep only the traces that pass through payments, whole',
      bucket: 'tail',
      why: 'Only the payments spans name payments, so the decision needs the whole trace: a <code>string_attribute</code> policy on <code>service.name</code> keeps every span of a trace in which any span matches.',
      whyNot: {
        filter: 'A filter on <code>service.name</code> keeps the payments spans and drops the storefront and checkout spans of the same trace.',
        both: 'Nothing has to go from inside the kept traces, so the sampler alone does it.',
      },
    },
    {
      id: 'errors-no-keepalive',
      label: 'Keep only the failed traces, minus their keep-alive <code>SELECT 1</code> spans',
      bucket: 'both',
      why: "Keeping only the failed traces is a decision on the whole trace, the sampler's. Dropping the <code>SELECT 1</code> spans is one span at a time, the filter's.",
      whyNot: {
        filter: 'A filter drops the <code>SELECT 1</code> spans, but it cannot keep a trace because another span in it failed.',
        tail: 'The sampler keeps each failed trace with every span in it, <code>SELECT 1</code> included.',
      },
    },
  ],
};

export default {
  id: 'filter-or-sampler',
  no: '9.1',
  name: 'Filter, sampler, or both?',
  sub: 'Does that answer hold?',
  icon: '\u{1F4E2}',
  rewardTitle: 'Trace keeper',
  cards: [],
  lights: ['collector'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'fos',
    steps: [
      {
        intro:
          'On a call, a customer asks: "We only want to keep the traces that have an error. Can a filter in our Collector do that?" ' +
          'The presenter answers straight away: "Yes. Add a filter processor that drops every span whose status is not Error. What reaches the backend is exactly your traces with errors."',
        show:
          '<p>Here is one failed checkout trace as it reaches the Collector, before the filter:</p>' +
          `<table><caption>One failed checkout trace, ${SPANS} spans</caption><thead><tr><th scope="col">Span</th><th scope="col">Service</th><th scope="col">Status</th></tr></thead><tbody>${ROWS}</tbody></table>`,
        question: "Does the presenter's answer hold?",
        qid: 'fos-q-verdict',
        choice: { id: 'fos-verdict', choices: VERDICT },
      },
      {
        intro:
          'The customer has more goals for the same Collector. A <b>filter processor</b> judges each span, log record or data point on its own and drops the ones its condition matches. ' +
          'A <b>tail sampler</b> holds the spans of each trace for its decision wait, then keeps or drops the whole trace; it samples traces only. ' +
          'Where a goal says <i>only</i>, everything else may go. Use the least that does the job: a tail sampler is stateful and holds every trace in memory while it waits.',
        question: 'Pick a goal, then say what it takes.',
        qid: 'fos-q-sort',
        sort: SORT,
      },
    ],
    finish:
      'You did not take the yes on trust: a filter judges one span or record at a time, so it can drop the probe, the debug logs and the load test, but it cannot keep a trace because one of its spans failed. ' +
      'That takes a tail sampler, and dropping spans inside a kept trace takes both.',
  },
};
