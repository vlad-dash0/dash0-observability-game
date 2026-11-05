// Level 0.3: Why OpenTelemetry. The player sorts the parts of OTel (API, SDK, OTLP,
// Collector, semantic conventions), then picks what a shared library depends on: only
// the API, a no-op until the application installs an SDK. Spec: docs/M1-DESIGN.md §6 Act 0.
// Spec: https://opentelemetry.io/docs/concepts/instrumentation/libraries/#opentelemetry-api
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountSort, renderSort } from '../lib/widgets/sort-it-view.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';

// Step 1. Items do not follow the bucket order.
const PARTS = {
  id: 'otel-parts',
  helps: { hints: true },
  hint: 'Ask who writes code against it: a library author, an app that installs it, or nobody at all.',
  buckets: [
    { id: 'api', label: 'API' },
    { id: 'sdk', label: 'SDK' },
    { id: 'otlp', label: 'OTLP' },
    { id: 'collector', label: 'Collector' },
    { id: 'semconv', label: 'Semantic conventions' },
  ],
  items: [
    {
      id: 'wire',
      label: 'The wire format sent to port 4318',
      bucket: 'otlp',
      why: '4318 is the default port for OTLP over HTTP, the protocol that carries telemetry between SDKs, Collectors and backends.',
    },
    {
      id: 'start-span',
      label: "<code>tracer.startActiveSpan('charge')</code> in a shared library",
      bucket: 'api',
      why: 'Starting a span is an API call. The library makes it without knowing which SDK, if any, the application installs.',
    },
    {
      id: 'method',
      label: 'The name <code>http.request.method</code>',
      bucket: 'semconv',
      why: 'Semantic conventions fix attribute names like this one, so every library and backend means the same thing by them.',
    },
    {
      id: 'pipeline',
      label: 'A separate process that receives, filters and forwards telemetry',
      bucket: 'collector',
      why: 'That is the Collector: it runs as its own process between your services and a backend.',
    },
    {
      id: 'batch',
      label: 'Batch span processor and sampler settings',
      bucket: 'sdk',
      why: 'Batching and sampling are SDK work, set up by the application that installs the SDK.',
    },
  ],
};

// Step 2: what a shared library depends on. `why` follows "Right." or "Not quite.".
const DEPENDS_ON = [
  {
    key: 'sdk',
    label: 'The SDK',
    why: 'The SDK is the application\'s choice: how to sample, batch and export. A library that brings it makes those choices for all 30 services.',
  },
  {
    key: 'api',
    label: 'Only the API (<code>@opentelemetry/api</code>)',
    right: true,
    why: 'Libraries depend only on the OTel API; only the application installs the SDK. Without an SDK, API calls are no-ops: they record nothing and cost almost nothing. Each of the 30 services picks its own SDK.',
  },
  {
    key: 'exporter',
    label: 'An OTLP exporter',
    why: 'Exporting is SDK work, set up by the application. A library that exports on its own decides for all 30 services where their telemetry goes.',
  },
  {
    key: 'collector',
    label: 'The Collector',
    why: 'The Collector is a separate process, not a package a library depends on.',
  },
];

/** The level's answer tables, in play order (pinned by test/act-0.test.mjs). */
export const CONTENT = {
  steps: [{ sort: PARTS }, { id: 'otel', choices: DEPENDS_ON }],
};

export default {
  id: 'why-opentelemetry',
  no: '0.3',
  name: 'Why OpenTelemetry',
  sub: 'API, SDK, OTLP, Collector and conventions',
  icon: '\u{1F9E9}',
  rewardTitle: 'Part namer',
  mechanics: ['sort'],
  cards: ['api-vs-sdk'],
  lights: [],
  scoring: { parMs: null },
  run(ctx) {
    const actions = ctx.ovActions;

    const stepParts = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'OpenTelemetry is not one thing but a set of vendor-neutral parts. Before you ' +
            'instrument anything, learn which part does what.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="otel-q-parts">Which part of OpenTelemetry is each one?</h3>
          ${renderSort(PARTS, newSortState(PARTS), { escapeHtml: ctx.escapeHtml, labelledBy: 'otel-q-parts' })}
        </div>`,
        '<button class="btn" id="otel-next" disabled>Next</button>',
      );
      const next = actions.querySelector('#otel-next');
      mountSort(ctx, PARTS, {
        onComplete: () => {
          next.disabled = false;
          return next;
        },
      });
      next.onclick = stepDependsOn;
    };

    const stepDependsOn = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'The payments team ships <code>kettle-payments-client</code>, a library used by 30 ' +
            'services. They want it to emit spans.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="otel-q-dep">Which OpenTelemetry package should the library depend on?</h3>
          ${choiceHtml(ctx, DEPENDS_ON, { id: 'otel', labelledBy: 'otel-q-dep' })}
        </div>`,
        '<button class="btn" id="otel-finish" data-finish disabled>Finish</button>',
      );
      const finish = actions.querySelector('#otel-finish');
      mountChoice(ctx, DEPENDS_ON, {
        id: 'otel',
        onRight: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'You know which part of OpenTelemetry does what, and why a shared library depends only on the API.',
          cards: ['api-vs-sdk'],
        });
    };

    stepParts();
  },
};
