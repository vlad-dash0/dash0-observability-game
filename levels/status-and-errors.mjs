// Level 2.3: Status and errors. Five spans from one shop, each with an HTTP code and the
// status its instrumentation set; the player sorts the right statuses from the wrong ones
// (a 4xx is Error only on the CLIENT span, a 5xx is Error on either span), then says what Ok followed by Error leaves.
// Spec: docs/M1-DESIGN.md §6 Act 2.
// Spec: https://opentelemetry.io/docs/specs/semconv/http/http-spans/#status , https://opentelemetry.io/docs/specs/otel/trace/api/#set-status
import { actions, finishButton, nextButton, question, step } from '../lib/ui/index.mjs';
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountSort, renderSort } from '../lib/widgets/sort-it-view.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';

// Step 1. a and b are the two sides of one call: storefront asks catalog for a product
// that does not exist.
const SORT = {
  id: 'status-sort',
  helps: { hints: true },
  hint: 'Ask which side of the call this span is on. A 4xx can be an error for the caller and fine for the server.',
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
      whyNot: {
        wrong: 'Look at which side this span is on. A 404 is a failure for the caller that asked for a missing product, so Error is what its span should show.',
      },
    },
    {
      id: 'b',
      label: 'catalog SERVER span for <code>GET /products/999</code>: 404, status Error',
      bucket: 'wrong',
      why: 'For a 4xx, the HTTP conventions say a SERVER span MUST be left Unset. Only the caller\'s CLIENT span SHOULD be Error.',
      whyNot: {
        ok: 'Look at which side this span is on. For catalog, a 404 for a missing product is a normal answer, so Error here is too much.',
      },
    },
    {
      id: 'c',
      label: 'checkout SERVER span for <code>POST /checkout</code>: 500, status Unset',
      bucket: 'wrong',
      why: 'A 5xx SHOULD be Error, on the SERVER span too: checkout itself failed. Left Unset, the failure is invisible to anything that counts errors by span status.',
      whyNot: {
        ok: 'The request ended in a 500. Unset tells anything that counts errors by status that checkout did fine.',
      },
    },
    {
      id: 'd',
      label: 'inventory SERVER span for <code>GET /stock</code>: 200, status Unset',
      bucket: 'ok',
      why: 'A 2xx is a success, and instrumentation leaves it Unset. Unset is the normal status of a span that did not fail; nobody needs to set Ok.',
      whyNot: {
        wrong: 'Nothing failed, so there is no failure to mark. A 200 is an ordinary success.',
      },
    },
    {
      id: 'e',
      label: 'payments SERVER span for <code>POST /v1/charge</code>: 503, status Error',
      bucket: 'ok',
      why: 'A 5xx on a SERVER span SHOULD be Error: the server failed the request.',
      whyNot: {
        wrong: 'A 503 means the server could not do the job, and this is the server\'s own span. Error is what it should show.',
      },
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
  widgets: ['sort', 'choice'],
  cards: ['span-status'],
  lights: ['catalog'],
  scoring: { parMs: null },
  run(ctx) {
    const bar = ctx.ovActions;

    const stepSort = () => {
      ctx.renderStep(
        step({
          wide: true,
          bodyHtml: `${ctx.speech(
          'Every span\'s status starts as Unset. Instrumentation sets Error when an operation ' +
            'fails, following the semantic conventions, and for HTTP the rule depends on the ' +
            'span\'s kind. Check five spans from this morning.',
        )}${question({ id: 'status-q-sort', html: 'Pick a span, then say whether its status is right.' })}${renderSort(SORT, newSortState(SORT), { escapeHtml: ctx.escapeHtml, labelledBy: 'status-q-sort' })}`,
        }),
        actions({ wide: true, buttonsHtml: nextButton('status-next', 'Sort every item to continue.') }),
      );
      const next = bar.querySelector('#status-next');
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
        step({
          wide: false,
          bodyHtml: `${ctx.speech(
          'In checkout, a handler validates the cart and calls ' +
            '<code>span.setStatus({ code: SpanStatusCode.OK })</code>. Later in the same span, ' +
            'a helper calls <code>span.setStatus({ code: SpanStatusCode.ERROR })</code>.',
        )}${question({ id: 'status-q-final', html: 'What status does the span end with?' })}${choiceHtml(ctx, OK_THEN_ERROR, { id: 'status', labelledBy: 'status-q-final' })}`,
        }),
        actions({ wide: false, buttonsHtml: finishButton('status-finish', 'Pick the right answer to finish the level.') }),
      );
      const finish = bar.querySelector('#status-finish');
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
