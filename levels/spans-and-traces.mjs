// Level 2.1: Spans and traces. The player names what makes spans one trace (a shared trace
// ID, not a trace object), rebuilds one request's span tree in Build it, and explains the
// overlapping span that stays a root: it is another request. Its trace is fixture B1
// (test/fixtures/build-b1.mjs reuses TREE). Spec: docs/M1-DESIGN.md §6 Act 2.
// Spec: https://opentelemetry.io/docs/specs/otel/overview/#traces , https://opentelemetry.io/docs/specs/otel/trace/sdk/#span-processor
// Spec: https://opentelemetry.io/docs/specs/semconv/http/http-spans/ (span B: an HTTP client span is named "{method} {target}"
// only when a low-cardinality target such as url.template is available, else "{method}"; storefront's call names no
// template, so it is "POST", not "POST api-gateway". No other span here is named POST, so labels stay distinct, #69.)
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountBuild, renderBuild } from '../lib/widgets/build-it-view.mjs';
import { newBuildState } from '../lib/widgets/build-it.mjs';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const OTHER_TRACE = '0af7651916cd43dd8448eb211c80319c';
const A = '00f067aa0ba902b7';
const B = 'b7ad6b7169203331';
const C = '53995c3f42cd8ad8';
const D = '1d5c3a2f8e4b6a90';
const E = '9e1f2a3b4c5d6e7f';

const span = (spanId, traceId, service, name, kind, startMs, endMs) => ({
  spanId, traceId, name, service, kind, startMs, endMs, status: 'UNSET',
  attributes: {}, events: [], parentId: null, links: [],
});

// Step 1: what makes these spans one trace. `why` follows "Right." or "Not quite.".
const ONE_TRACE = [
  {
    key: 'trace-id',
    label: 'They share one trace ID',
    right: true,
    why: 'Every span carries the trace ID of the request it belongs to, and a backend groups the spans that share one. There is nothing else to group by.',
  },
  {
    key: 'trace-object',
    label: 'The SDK sends a trace object at the end',
    why: 'There is no trace object. The SDK hands each span on when that span ends, and spans from different services arrive separately.',
  },
];

// Step 2: the spans arrive one at a time in start order (the queue), A already placed; the
// answer gives B, C and D their parents. E overlaps C in time on purpose: parenting it there
// is a cross-trace parent. Every help is on (docs/M1-DESIGN.md §4.2, the help ladder).
const TREE = {
  id: 'sat-tree',
  spans: [
    span(A, TRACE, 'storefront', 'POST /checkout', 'SERVER', 0, 100),
    span(B, TRACE, 'storefront', 'POST', 'CLIENT', 10, 90),
    span(C, TRACE, 'api-gateway', 'POST /checkout', 'SERVER', 15, 85),
    span(D, TRACE, 'api-gateway', 'validate cart', 'INTERNAL', 20, 30),
    span(E, OTHER_TRACE, 'storefront', 'GET /products', 'SERVER', 40, 60),
  ],
  edit: ['parent'],
  answer: { [B]: { parentId: A }, [C]: { parentId: B }, [D]: { parentId: C } },
  helps: { queue: true, tint: true, guide: true, instant: true, hints: true },
  closing: '<code>GET /products</code> stays a root. The next step asks why.',
};

// Step 3: the span that stays a root.
const OTHER = [
  {
    key: 'late-child',
    label: "A child of api-gateway's <code>POST /checkout</code>, because it runs inside that span's time",
    why: 'Running at the same time says nothing about parents. Only a parent ID makes a child, and a parent always shares its child\'s trace ID.',
  },
  {
    key: 'lost-parent',
    label: 'A child of this request whose parent ID was lost',
    why: 'A span that lost its parent ID would still carry this request\'s trace ID. This one carries a different trace ID.',
  },
  {
    key: 'other-request',
    label: 'A span from another request, in a trace of its own',
    right: true,
    why: 'Its trace ID is <code>0af76519</code>, not <code>4bf92f35</code>. It ran at the same time on the same service, but it belongs to another request, so no span of this trace can be its parent.',
  },
];

/** The level's answer tables, in play order (pinned by test/act-2.test.mjs). */
export const CONTENT = {
  steps: [
    { id: 'sat', question: 'What makes these spans one trace?', choices: ONE_TRACE },
    { build: TREE },
    { id: 'sat-e', choices: OTHER },
  ],
};

export default {
  id: 'spans-and-traces',
  no: '2.1',
  name: 'Spans and traces',
  sub: 'One request, many spans',
  icon: '\u{1F9F5}',
  rewardTitle: 'Trace reader',
  mechanics: ['build'],
  cards: ['no-trace-object'],
  lights: ['storefront', 'api-gateway'],
  scoring: { parMs: null },
  run(ctx) {
    const actions = ctx.ovActions;
    const next = (onclick) => {
      const btn = actions.querySelector('#sat-next');
      btn.onclick = onclick;
      return btn;
    };

    const stepOneTrace = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'A customer pays. The request passes through storefront and api-gateway, and each ' +
            'service records spans for its part of the work: one span per operation.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="sat-q-one">What makes these spans one trace?</h3>
          ${choiceHtml(ctx, ONE_TRACE, { id: 'sat', labelledBy: 'sat-q-one' })}
        </div>`,
        '<button class="btn" id="sat-next" disabled>Next</button>',
      );
      const btn = next(stepTree);
      mountChoice(ctx, ONE_TRACE, {
        id: 'sat',
        onRight: () => {
          btn.disabled = false;
          return btn;
        },
      });
    };

    const stepTree = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'The spans of trace <code>4bf92f35</code> reach the backend one by one, as each one ends. ' +
            'The first is already placed. Give each new span its parent as it arrives, so the ' +
            'request reads top to bottom. A trace id is the request\'s id: every span of one ' +
            'request carries it, so spans with different trace ids are never parent and child.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q">Rebuild the request's span tree.</h3>
          ${renderBuild(TREE, newBuildState(TREE), { escapeHtml: ctx.escapeHtml })}
        </div>`,
        '<button class="btn" id="sat-next" disabled>Next</button>',
      );
      const btn = next(stepOther);
      mountBuild(ctx, TREE, {
        onComplete: () => {
          btn.disabled = false;
          return btn;
        },
      });
    };

    const stepOther = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          '<code>GET /products</code> on storefront ran while api-gateway handled the checkout, ' +
            'yet it stays a root.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="sat-q-other">What is <code>GET /products</code>?</h3>
          ${choiceHtml(ctx, OTHER, { id: 'sat-e', labelledBy: 'sat-q-other' })}
        </div>`,
        '<button class="btn" id="sat-finish" data-finish disabled>Finish</button>',
      );
      const finish = actions.querySelector('#sat-finish');
      mountChoice(ctx, OTHER, {
        id: 'sat-e',
        onRight: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'You can read a trace: its spans share a trace ID, and each one points at its parent.',
          cards: ['no-trace-object'],
        });
    };

    stepOneTrace();
  },
};
