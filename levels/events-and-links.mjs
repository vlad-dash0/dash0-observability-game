// Level 2.6: Events and links. The player learns that an exception record, a span event or
// a log record, never sets a span's status, sets the statuses of three spans by what
// happened in them, then links a batch consumer to the three messages it handled, one
// from each of three traces. Spec: docs/M1-DESIGN.md §6 Act 2.
// Spec: https://opentelemetry.io/docs/specs/otel/trace/api/#record-exception , https://opentelemetry.io/docs/specs/semconv/general/recording-errors/ , https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountBuild, renderBuild } from '../lib/widgets/build-it-view.mjs';
import { newBuildState } from '../lib/widgets/build-it.mjs';
import { actions, codeBlock, finishButton, nextButton, prose, question, step } from '../lib/ui/index.mjs';

const CHARGE = '8f14e45fceea167a';
const RETRY = '45c48cce2e2d7fbd';
const STOCK = 'a87ff679a2f3e71d';
const P1 = '1679091c5a880faf';
const P2 = '8e296a067a375633';
const P3 = 'a5771bce93e200c3';
const SEND = 'd67d8ab4f4c10bf2';

const span = (spanId, traceId, service, name, kind, startMs, endMs, status = 'UNSET', events = []) => ({
  spanId, traceId, name, service, kind, startMs, endMs, status,
  attributes: {}, events, parentId: null, links: [],
});

// Step 1: an exception recorded, then the span ended. `why` follows "Right." or "Not quite.".
const RECORDED = [
  {
    key: 'error',
    label: 'Error: recording the exception marked the span as failed',
    why: 'Recording an exception only records it. The status is a separate field, and nothing in this code sets it.',
  },
  {
    key: 'event-only',
    label: 'Error if it was recorded as a span event, Unset if it was logged',
    why: 'Neither way of recording it touches the status. A span event and a log record both leave the status as it was.',
  },
  {
    key: 'unset',
    label: 'Unset: nothing set the status',
    right: true,
    why: 'An exception record, whether a span event or a log record, does not change the status. The code or instrumentation that ends the span sets it, and this code never does, so the failure is invisible to anything that counts errors by status.',
  },
];

// Step 2: what happened in each span (authored), and the statuses as recorded. charge's
// exception escaped and was recorded, yet its status is Unset; a helper set Error on
// charge with retry, a span over the whole charge, retries included, although the code
// there handled the reset, retried, and the charge went through.
const ERRORS = {
  id: 'evl-errors',
  spans: [
    span(CHARGE, 'c9f0f895fb98ab9159f51fd0297e236d', 'payments', 'charge', 'INTERNAL', 0, 80, 'UNSET', [
      { name: 'exception', atMs: 78, attributes: { 'exception.type': 'CardDeclinedError' } },
    ]),
    span(RETRY, 'd3d9446802a44259755d38e6d163e820', 'payments', 'charge with retry', 'INTERNAL', 10, 40, 'ERROR'),
    span(STOCK, 'e4da3b7fbbce2345d7772b0674a318d5', 'inventory', 'GET /stock', 'SERVER', 50, 60),
  ],
  edit: ['status'],
  answer: { [CHARGE]: { status: 'ERROR' }, [RETRY]: { status: 'UNSET' } },
  helps: {}, // the help ladder's last rung (docs/M1-DESIGN.md §4.2): no helps, a Check button, no hints
};

const STORIES = [
  ['charge', 'payments', 'The provider declined the card. <code>CardDeclinedError</code> was recorded and escaped the span: the charge failed.'],
  ['charge with retry', 'payments', 'The span covers the whole charge, retries included. The first try hit a connection reset; the code caught it and retried, and the second try went through. Nothing was recorded, but a helper set Error.'],
  ['GET /stock', 'inventory', 'Answered 200. No exception.'],
];

// Step 3: notifications handles one batch of three order messages, each published in its
// own request (its own trace). The consumer span is a root; the answer links all three.
const BATCH = {
  id: 'evl-batch',
  spans: [
    span(P1, '6512bd43d9caa6e02c990b0a82652dca', 'orders', 'orders publish', 'PRODUCER', 0, 5),
    span(P2, 'c20ad4d76fe97759aa27a0c99bff6710', 'orders', 'orders publish', 'PRODUCER', 10, 15),
    span(P3, 'c51ce410c124a10e0db5e4b97fc2af39', 'orders', 'orders publish', 'PRODUCER', 20, 25),
    span(SEND, 'aab3238922bcc25a6f606eb525ffdc56', 'notifications', 'send batch', 'CONSUMER', 40, 70),
  ],
  edit: ['links'],
  answer: { [SEND]: { links: [P1, P2, P3] } },
  helps: {}, // no helps, a Check button, no hints
};

/** The level's answer tables, in play order (pinned by test/act-2.test.mjs). */
export const CONTENT = {
  steps: [
    { id: 'evl', question: 'What status does the span end with?', choices: RECORDED },
    { build: ERRORS },
    { build: BATCH },
  ],
};

export default {
  id: 'events-and-links',
  no: '2.6',
  name: 'Events and links',
  sub: 'Errors and batches',
  icon: '\u{1F4CE}',
  rewardTitle: 'Link keeper',
  mechanics: ['build'],
  widgets: ['choice', 'build'],
  hintless: ['build'], // both builds have helps: {}: a Check button, no Hint button
  cards: ['exception-no-status', 'batch-links'],
  lights: [],
  scoring: { parMs: null },
  run(ctx) {
    const bar = ctx.ovActions;
    const e = ctx.escapeHtml;
    const next = (onclick) => {
      const btn = bar.querySelector('#evl-next');
      btn.onclick = onclick;
      return btn;
    };

    const stepRecorded = () => {
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech(
          'In payments, a handler catches the provider\'s error, records it, and rethrows. Nothing else touches the span:',
          )}${codeBlock('catch (err) {\n  span.recordException(err);\n  throw err;\n} finally {\n  span.end();\n}')}${question({ id: 'evl-q', html: 'What status does the span end with?' })}${choiceHtml(ctx, RECORDED, { id: 'evl', labelledBy: 'evl-q' })}`,
        }),
        actions({ wide: false, buttonsHtml: nextButton('evl-next') }),
      );
      const btn = next(stepErrors);
      mountChoice(ctx, RECORDED, {
        id: 'evl',
        onRight: () => {
          btn.disabled = false;
          return btn;
        },
      });
    };

    const stepErrors = () => {
      const stories = STORIES.map(([name, service, what]) => `<li><code>${e(name)}</code> (${e(service)}): ${what}</li>`).join('');
      ctx.renderStep(
        step({
          wide: true,
          bodyHtml: `${ctx.speech(
          'Here is what happened in three spans. Set each status by the outcome: Error when ' +
            'the operation failed, Unset when it completed, even if it handled an error on the way.',
          )}${prose(`<ul>${stories}</ul>`)}${question({ html: 'Give each span the status its outcome calls for.' })}${renderBuild(ERRORS, newBuildState(ERRORS), { escapeHtml: e })}`,
        }),
        actions({ wide: true, buttonsHtml: nextButton('evl-next') }),
      );
      const btn = next(stepBatch);
      mountBuild(ctx, ERRORS, {
        onComplete: () => {
          btn.disabled = false;
          return btn;
        },
      });
    };

    const stepBatch = () => {
      ctx.renderStep(
        step({
          wide: true,
          bodyHtml: `${ctx.speech(
          'notifications reads three order messages in one batch and sends one email run for ' +
            'them. Each message was published by a different request, so each ' +
            '<code>orders publish</code> span sits in its own trace. <code>send batch</code> can ' +
            'have only one parent, so it stays a root.',
          )}${question({ html: 'Connect <code>send batch</code> to every message it handled.' })}${renderBuild(BATCH, newBuildState(BATCH), { escapeHtml: e })}`,
        }),
        actions({ wide: true, buttonsHtml: finishButton('evl-finish') }),
      );
      const finish = bar.querySelector('#evl-finish');
      mountBuild(ctx, BATCH, {
        onComplete: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'You set status by outcome, not by what was recorded, and you link a batch to every message in it.',
          cards: ['exception-no-status', 'batch-links'],
        });
    };

    stepRecorded();
  },
};
