// Level 5.2: Order matters. The player spots the pipelines whose processor list is misordered
// (memory_limiter not first, batch before a processor that drops data or reads the request
// context), says why memory_limiter goes first, and where batch goes, with the note that the
// processor docs now prefer an exporter's own batching where it has one.
// Spec: docs/OUTLINE.md §4 Act 5.
// Spec: https://opentelemetry.io/docs/collector/configuration/#processors , https://opentelemetry.io/docs/collector/components/processor/
// Docs (GitHub READMEs, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/README.md#recommended-processors , https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/batchprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/k8sattributesprocessor/README.md , https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/exporterhelper/README.md
//
// What is taught is the part of the recommended order that is stated without a condition:
// memory_limiter first; batch after the processors that drop or change data and after those that
// read the request context (k8sattributes); the order between those middle processors is not
// graded, so no line depends on it. A pipeline without batch is fine.

// Step 1. Eight pipelines, one processor list each. The debug view prints `<pipeline>: processors: [...]`.
const SPOT = {
  id: 'order-spot',
  target: 'config',
  helps: { hints: false },
  lines: [
    { id: 'traces', text: 'traces: processors: [memory_limiter, k8sattributes, transform/redact, batch]' },
    { id: 'metrics', text: 'metrics: processors: [batch, memory_limiter]' },
    { id: 'logs', text: 'logs: processors: [memory_limiter, filter/health-checks, batch]' },
    { id: 'traces-checkout', text: 'traces/checkout: processors: [memory_limiter, batch, k8sattributes]' },
    { id: 'logs-audit', text: 'logs/audit: processors: [k8sattributes, memory_limiter, batch]' },
    { id: 'metrics-infra', text: 'metrics/infra: processors: [memory_limiter, batch]' },
    { id: 'logs-noisy', text: 'logs/noisy: processors: [memory_limiter, batch, filter/health]' },
    { id: 'traces-edge', text: 'traces/edge: processors: [memory_limiter]' },
  ],
  faults: ['metrics', 'traces-checkout', 'logs-audit', 'logs-noisy'],
  whyNot: {
    traces: 'memory_limiter is first, k8sattributes (which reads the request context) and the transform run before batch, and batch comes last.',
    logs: 'memory_limiter is first, the filter that drops health-check logs runs before batch, so batch only collects what is kept.',
    'metrics-infra': 'The same two processors as the faulty metrics pipeline, in the right order for this pipeline: memory_limiter first, batch last.',
    'traces-edge': 'memory_limiter is first and there is nothing after it. batch is recommended, not required, and an exporter can batch on its own.',
  },
  explain:
    'Four pipelines are misordered, and each has its own list: the Collector gives every pipeline its own processor instances, so ' +
    '<code>metrics</code> is wrong while <code>metrics/infra</code> lists the same two processors correctly. In <code>metrics</code> and ' +
    '<code>logs/audit</code>, <code>memory_limiter</code> is not first, so something else handles data before the limiter can refuse it. ' +
    'In <code>traces/checkout</code>, <code>k8sattributes</code> comes after <code>batch</code>, and batching clears the request context it reads. ' +
    'In <code>logs/noisy</code>, <code>batch</code> comes before the filter, so it batches logs that are discarded straight afterwards.',
};

// Step 2: why first. `why` follows "Right." or "Not quite.".
const WHY = [
  {
    key: 'cleans-data',
    label: 'So it can clean up the data before the other processors see it',
    why: 'The memory limiter does not change telemetry. It checks the Collector\'s memory use at intervals and, when it is too high, refuses data.',
  },
  {
    key: 'refuse-early',
    label: 'So it can refuse data before anything else has spent memory on it, and receivers can retry or slow their senders',
    right: true,
    why: 'When memory is over the soft limit, the processor returns a non-permanent error to the component before it, so receivers can retry the data and can apply backpressure to their senders. The best practice is to make it the first processor in a pipeline, so backpressure reaches the receivers and fewer data are dropped when the limiter triggers.',
  },
  {
    key: 'any-position',
    label: 'It does not matter: it only watches memory, so it works anywhere in the list',
    why: 'It watches memory, but it can only refuse what passes through it. Placed after other processors, those handle and may hold the data first, which makes it likelier that data is dropped when the limiter triggers.',
  },
];

// Step 3: where batch goes. `why` follows "Right." or "Not quite.".
const BATCH = [
  {
    key: 'early',
    label: 'Early, right after memory_limiter, so everything after it handles fewer, bigger batches',
    why: 'Batching before the processors that drop or change data batches telemetry that may be discarded or changed straight afterwards. It also clears the request context, which a processor like k8sattributes reads.',
  },
  {
    key: 'late',
    label: 'Late, after the processors that drop, change or enrich data, and the exporter may batch too',
    right: true,
    why: 'Batching helps compress data and reduces the number of outgoing connections, and it belongs after memory_limiter and after anything that drops or changes data, so it never batches what is discarded afterwards. Processors that read the request context, such as k8sattributes, go before it. The processor docs also say to prefer an exporter\'s own batching where it has one, for example the <code>batch</code> setting of an exporter\'s <code>sending_queue</code>, which is off unless you turn it on.',
  },
  {
    key: 'removed',
    label: 'Nowhere: the batch processor was removed from the Collector',
    why: 'The batch processor is still there: it is part of the core, contrib and Kubernetes distributions. What changed is the advice to prefer batching in the exporter where the exporter supports it.',
  },
];

export default {
  id: 'order-matters',
  no: '5.2',
  name: 'Order matters',
  sub: 'First and last',
  icon: '\u{1F522}',
  rewardTitle: 'Order keeper',
  cards: ['memory-limiter-first'],
  lights: ['collector'],
  scoring: { parMs: null },
  play: {
    prefix: 'order',
    steps: [
      {
        intro:
          'The Collector now has a pipeline for every team. The processors in a pipeline run in the order they are listed, ' +
          'and every pipeline has its own list. The infra team pasted the same processors into eight of them, and ' +
          'the Collector still runs out of memory on some.',
        question: 'Spot the pipelines whose processors are in the wrong order.',
        qid: 'order-q-spot',
        spot: SPOT,
      },
      {
        intro:
          '<code>memory_limiter</code> measures the Collector\'s memory use and, above its limit, refuses data. The usual advice is to list it first in every pipeline.',
        question: 'Why first?',
        qid: 'order-q-why',
        choice: { id: 'order-why', choices: WHY },
      },
      {
        intro:
          'The other half of the advice is about <code>batch</code>, which groups telemetry into batches before it is sent.',
        question: 'Where does <code>batch</code> go, and is the processor the only way to batch?',
        qid: 'order-q-batch',
        choice: { id: 'order-batch', choices: BATCH },
      },
    ],
    finish:
      'You know the order in a pipeline is the processing order, per pipeline: memory_limiter first, drops and context readers before batch, batch late.',
  },
};
