// Level 9.8: Edge of the platform. Act 9 "Live Demo" (docs/LIVE-DEMO.md), Samoa. Kettle & Co's order function runs on a serverless platform that
// suspends its environment right after a handler returns, with a batch span processor. Its spans never arrive. The player picks
// the fix that gets every invocation's spans out before the handler returns (Choice: ForceFlush on the tracer provider; lowering the batch delay
// and calling Shutdown each time are the two that sound right and fail), then connects the worker's batch span to the three messages it handled
// (Build it, `edit: ['links']`), one from each of three traces, with two decoys: a publish span whose message is not in this batch, and the
// request span that is one publish span's parent. The step 2 board is solvable only from the batch's message list.
// Spec: https://opentelemetry.io/docs/specs/otel/trace/sdk/#forceflush-1 , https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/ , https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/
//
// Facts used (each read on the page named, 2026-11-08). Trace SDK, "ForceFlush" on the TracerProvider: it "provides a way for provider to
// immediately export all spans that have not yet been exported for all the internal processors", and it "MUST invoke ForceFlush on all
// registered SpanProcessors". Trace SDK, SpanProcessor ForceFlush: "ForceFlush SHOULD only be called in cases where it is absolutely necessary,
// such as when using some FaaS providers that may suspend the process after an invocation, but before the SpanProcessor exports the completed
// spans." Trace SDK, batching processor: it exports a batch "scheduledDelayMillis after the processor is constructed OR the first span is
// received by the span processor", or when the queue holds maxExportBatchSize spans, or when ForceFlush is called; `scheduledDelayMillis`
// "The default value is 5000". SDK environment variables: OTEL_BSP_SCHEDULE_DELAY is the "Delay interval (in milliseconds) between two
// consecutive exports", default 5000. Trace SDK, TracerProvider Shutdown: "Shutdown MUST be called only once for each TracerProvider instance.
// After the call to Shutdown, subsequent attempts to get a Tracer are not allowed." Shutdown "MUST be implemented at least by invoking Shutdown
// within all internal processors", and for a SpanProcessor "Shutdown MUST include the effects of ForceFlush". Messaging spans (semantic conventions 1.45.0, status Development): "A single
// "Process" or "Receive" span can account for a single message, for a batch of messages, or for no message at all", and "For each message it
// accounts for, the "Process" or "Receive" span SHOULD link to the message's creation context"; span links are "the only option to correlate
// producer and consumer(s) in batch scenarios as a span can only have a single parent".
//
// Stated as reasoning, with no source: that a lower delay cannot rescue the last span, because the root span ends as the handler returns and a
// timer can only fire after a span has ended, when this platform has already suspended the environment; that a warm environment is reused by
// later requests (the scenario says so); and that "Shutdown after each invocation" therefore breaks the later ones (the spec's only-once rule
// is the sourced part). The spec's FaaS sentence is the only place it mentions FaaS or short-lived environments; it is quoted, not paraphrased.
//
// Invented for the game: the company, the 120 ms handler, the suspension right after return, every id, trace id, name and time, the batch of
// three messages and the fourth message of another trace. No Dash0, hostname or pricing claim is made.
import { shortTrace } from '../lib/widgets/build-it-names.mjs';

const HANDLER_MS = 120; // the handler runs this long, then the platform suspends the environment
const DELAY_MS = 5000; // OTEL_BSP_SCHEDULE_DELAY default
const LOWER_MS = 1000; // the lowered delay of the first wrong choice: still longer than the handler
const START = 100; // the worker's batch span starts here on the Build board

const T_A = '5d41402abc4b2a76b9719d911017c592';
const T_B = '7b8b965ad4bca0e41ab51de7b31363a1';
const T_C = '098f6bcd4621d373cade4e832627b4f6';
const T_D = '1f3870be274f6c49b3e31a0c6728957f';
const T_E = '2cf24dba5fb0a30e26e83b2ac5b9e29e';
const REQ_A = 'b3e1f0a4c9d27685';
const P1 = '4a7d2c9e1f3b8065';
const P2 = 'c81e3a5d7f092b46';
const P3 = 'e2b5094a6c1d7f38';
const P4 = '7f1a6d3c2e9b0845';
const PROC = 'd09a4e7b2c5f1863';

const span = (spanId, traceId, service, name, kind, startMs, endMs, parentId = null) => ({
  spanId, traceId, name, service, kind, startMs, endMs, status: 'UNSET', attributes: {}, events: [], parentId, links: [],
});

// Step 1: the fix. `why` follows "Right." or "Not quite.". Labels are of one length and each names its own mechanism.
const FIX = [
  {
    key: 'lower-delay',
    label: `Set OTEL_BSP_SCHEDULE_DELAY to ${LOWER_MS} ms in the function\'s environment`,
    why:
      `A shorter delay is still a timer. The invocation takes ${HANDLER_MS} ms and the root span ends as the handler returns, so the timer cannot fire before the last span exists, ` +
      `and from then on the environment is suspended. ${LOWER_MS} ms is longer than the whole invocation, and no value of the delay changes the order: span ends, handler returns, environment suspended, timer due. (This is reasoning from the numbers, not a quote.)`,
  },
  {
    key: 'shutdown',
    label: 'Call Shutdown on the tracer provider at the end of each request',
    why:
      'Shutdown does export what is pending (a SpanProcessor\'s Shutdown "MUST include the effects of ForceFlush"), but the SDK spec says it "MUST be called only once for each TracerProvider instance" and that after it "subsequent attempts to get a Tracer are not allowed". ' +
      'The same environment serves the next request, and a shut-down provider can no longer give it a tracer. (The last part is reasoning from the scenario, not a quote.)',
  },
  {
    key: 'force-flush',
    label: 'Call ForceFlush on the tracer provider before each handler returns',
    right: true,
    why:
      'ForceFlush on the provider exports every span that has not been exported yet, so the spans are out before the handler returns and before the platform suspends the environment, and the provider stays usable for the next request. ' +
      'The SDK spec names this case: ForceFlush "SHOULD only be called in cases where it is absolutely necessary, such as when using some FaaS providers that may suspend the process after an invocation, but before the SpanProcessor exports the completed spans". ' +
      `Without it the batch processor waits for its ${DELAY_MS} ms delay (the default) or a full batch.`,
  },
];

// Step 2: the batch. The consumer is a root in a trace of its own. Four publish spans: three are the messages of the batch, one is the message
// of the next batch. PUBLISH ids and times are chosen so no ordering rule (start, span id, row) picks the three: the fourth message is
// published between the second and the third, and its span id lies between the first's and the second's.
const SPANS = [
  span(REQ_A, T_A, 'checkout', 'POST /orders', 'SERVER', 0, 40),
  span(P1, T_A, 'orders', 'orders publish', 'PRODUCER', 5, 15, REQ_A),
  span(P2, T_B, 'orders', 'orders publish', 'PRODUCER', 20, 30),
  span(P4, T_D, 'orders', 'orders publish', 'PRODUCER', 35, 45),
  span(P3, T_C, 'orders', 'orders publish', 'PRODUCER', 50, 60),
  span(PROC, T_E, 'orders-worker', 'orders process', 'CONSUMER', START, START + HANDLER_MS),
];
const BATCH = {
  id: 'eop-batch',
  spans: SPANS,
  edit: ['links'],
  answer: { [PROC]: { links: [P1, P2, P3] } },
  helps: {}, // no helps, a Check button, no hints
};

/** The batch's messages in delivery order: message, the span that created it, and that span's trace as the board names it. */
const MESSAGES = [['m-1', P1], ['m-2', P2], ['m-3', P3]].map(([message, spanId]) => {
  const s = SPANS.find((x) => x.spanId === spanId);
  return { message, spanId, trace: shortTrace(s.traceId) };
});

const messageTable =
  '<table><caption>Messages in this batch</caption><thead><tr><th scope="col">Message</th><th scope="col">In trace</th></tr></thead><tbody>' +
  MESSAGES.map((m) => `<tr><td>${m.message}</td><td><code>${m.trace}</code></td></tr>`).join('') +
  '</tbody></table>';

/** The level's answer tables (pinned by test/edge-of-the-platform.test.mjs). */
export const CONTENT = { choices: FIX, build: BATCH, messages: MESSAGES, ids: { P1, P2, P3, P4, REQ_A, PROC } };

export default {
  id: 'edge-of-the-platform',
  no: '9.8',
  name: 'Edge of the platform',
  sub: 'Before the function freezes',
  icon: '\u{1F9CA}',
  rewardTitle: 'Flush keeper',
  cards: [],
  lights: ['orders'],
  scoring: { parMs: null },
  play: {
    prefix: 'eop',
    steps: [
      {
        intro:
          'Kettle &amp; Co\'s order function runs on a serverless platform, with a batch span processor. In the trace backend, almost no span from the function ever shows up. ' +
          `Each request takes ${HANDLER_MS} ms, and the platform suspends the environment right after the handler returns, as some FaaS platforms do. A later request may land on the same environment.`,
        show:
          '<table><caption>One request, in time</caption><thead><tr><th scope="col">Time</th><th scope="col">What happens</th></tr></thead><tbody>' +
          '<tr><td>0 ms</td><td>The request arrives; the first span starts</td></tr>' +
          `<tr><td>${HANDLER_MS} ms</td><td>The handler returns; the platform suspends the environment</td></tr>` +
          `<tr><td>${DELAY_MS} ms</td><td>The default delay of the batch span processor</td></tr></tbody></table>`,
        question: 'Which change gets the spans of every request out?',
        qid: 'eop-q-fix',
        choice: { id: 'eop-fix', choices: FIX },
      },
      {
        intro:
          `The spans arrive now. At ${START} ms the platform hands the worker a batch of three messages, and <code>orders process</code> handles all three in one invocation. ` +
          'Each message was published by a different request. The worker\'s span starts a trace of its own.',
        show: messageTable,
        question: 'Connect <code>orders process</code> to the messages of this batch, and only those.',
        qid: 'eop-q-batch',
        build: BATCH,
      },
    ],
    finish:
      'A function can be suspended before a timer fires, so a handler on such a platform exports its spans itself: ForceFlush on the tracer provider before it returns, ' +
      'not a shorter delay, and not Shutdown, which a provider gets once. A consumer span that handles a batch links to the creation context of each message it accounts for.',
  },
};
