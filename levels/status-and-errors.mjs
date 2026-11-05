// Level 2.3: Status and errors. Five spans from one shop, each with an HTTP code and the
// status its instrumentation set; the player sorts the right statuses from the wrong ones
// (a 4xx is Error only on the CLIENT span, a 5xx on either), then says what Ok followed by Error leaves.
// Spec: docs/M1-DESIGN.md §6 Act 2.
// Spec: https://opentelemetry.io/docs/specs/semconv/http/http-spans/#status , https://opentelemetry.io/docs/specs/otel/trace/api/#set-status
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountSort, renderSort } from '../lib/widgets/sort-it-view.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';

// Step 1. a and b are the two sides of one call: storefront asks catalog for a product
// that does not exist.
const SORT = {
  id: 'status-sort',
  buckets: [
    { id: 'ok', label: 'Status is right' },
    { id: 'wrong', label: 'Status is wrong' },
  ],
  items: [
    {
      id: 'a',
      label: 'storefront CLIENT span for <code>GET /products/999</code>: 404, status Error',
      bucket: 'ok',
      why: 'For a 4xx, the HTTP conventions say a CLIENT span SHOULD be Error: the call storefront made did not get what it asked for.',
    },
    {
      id: 'b',
      label: 'catalog SERVER span for <code>GET /products/999</code>: 404, status Error',
      bucket: 'wrong',
      why: 'For a 4xx, the HTTP conventions say a SERVER span MUST be left Unset. Only the caller\'s CLIENT span SHOULD be Error.',
    },
    {
      id: 'c',
      label: 'checkout SERVER span for <code>POST /checkout</code>: 500, status Unset',
      bucket: 'wrong',
      why: 'A 5xx SHOULD be Error, on the SERVER span too: checkout itself failed. Left Unset, the failure is invisible to anything that counts errors by span status.',
    },
    {
      id: 'd',
      label: 'inventory SERVER span for <code>GET /stock</code>: 200, status Unset',
      bucket: 'ok',
      why: 'A 2xx is a success, and instrumentation leaves it Unset. Unset is the normal status of a span that did not fail; nobody needs to set Ok.',
    },
    {
      id: 'e',
      label: 'payments SERVER span for <code>POST /v1/charge</code>: 503, status Error',
      bucket: 'ok',
      why: 'A 5xx on a SERVER span SHOULD be Error: the server failed the request.',
    },
  ],
};

// Step 2: Ok, then Error, on one span. `why` follows "Right." or "Not quite.".
const OK_THEN_ERROR = [
  {
    key: 'error',
    label: 'Error: the last call wins',
    why: 'Usually only the last call is recorded, but Ok is the exception: once a span is Ok, later attempts to change its status SHOULD be ignored.',
  },
  {
    key: 'stays-ok',
    label: 'Ok: it stays Ok',
    right: true,
    why: 'Ok is final. Once a span is Ok, later attempts to change its status SHOULD be ignored, so the Error is dropped. Set Ok only when you mean to override.',
  },
  {
    key: 'unset',
    label: 'Unset: the two calls cancel out',
    why: 'Nothing cancels out. The statuses are ordered Ok above Error above Unset, and Ok is final, so the span stays Ok.',
  },
];

/** The level's answer tables, in play order (pinned by test/act-2.test.mjs). */
export const CONTENT = {
  steps: [{ sort: SORT }, { id: 'status', choices: OK_THEN_ERROR }],
};

export default {
  id: 'status-and-errors',
  no: '2.3',
  name: 'Status and errors',
  sub: 'Unset, Error, Ok',
  icon: '\u{1F6A6}',
  rewardTitle: 'Status checker',
  mechanics: ['sort'],
  cards: ['span-status'],
  lights: ['catalog'],
  scoring: { parMs: null },
  run(ctx) {
    const actions = ctx.ovActions;

    const stepSort = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Every span\'s status starts as Unset. Instrumentation sets Error when an operation ' +
            'fails, following the semantic conventions, and for HTTP the rule depends on the ' +
            'span\'s kind. Check five spans from this morning.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="status-q-sort">Pick a span, then say whether its status is right.</h3>
          ${renderSort(SORT, newSortState(SORT), { escapeHtml: ctx.escapeHtml, labelledBy: 'status-q-sort' })}
        </div>`,
        '<button class="btn" id="status-next" disabled>Next</button>',
      );
      const next = actions.querySelector('#status-next');
      mountSort(ctx, SORT, {
        onComplete: () => {
          next.disabled = false;
          return next;
        },
      });
      next.onclick = stepOkThenError;
    };

    const stepOkThenError = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'In checkout, a handler validates the cart and calls ' +
            '<code>span.setStatus({ code: SpanStatusCode.OK })</code>. Later in the same span, ' +
            'a helper calls <code>span.setStatus({ code: SpanStatusCode.ERROR })</code>.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="status-q-final">What status does the span end with?</h3>
          ${choiceHtml(ctx, OK_THEN_ERROR, { id: 'status', labelledBy: 'status-q-final' })}
        </div>`,
        '<button class="btn" id="status-finish" data-finish disabled>Finish</button>',
      );
      const finish = actions.querySelector('#status-finish');
      mountChoice(ctx, OK_THEN_ERROR, {
        id: 'status',
        onRight: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'You know when a span should say Error, when it stays Unset, and why Ok is final.',
          cards: ['span-status'],
        });
    };

    stepSort();
  },
};
