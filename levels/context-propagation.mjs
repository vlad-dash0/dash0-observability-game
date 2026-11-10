// Level 2.4: Context propagation. A checkout request shows up as two traces. The player
// reads the hop headers and finds the nginx proxy that drops `traceparent`, picks the one
// header a receiver would accept, then joins checkout's SERVER span to the parent its
// header names. Spec: docs/M1-DESIGN.md §6 Act 2.
// Spec: https://www.w3.org/TR/trace-context/#traceparent-header
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountBuild, renderBuild } from '../lib/widgets/build-it-view.mjs';
import { newBuildState } from '../lib/widgets/build-it.mjs';
import { actions, finishButton, nextButton, prose, question, step } from '../lib/ui/index.mjs';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const NEW_TRACE = '7f3a9c1e5b2d4f6a8c0e2b4d6f8a1c3e';
const STORE = 'e457b5a2e4d86bd1';
const CALL = '00f067aa0ba902b7';
const CHECKOUT = '6e0c63257de34c92';
const ORDERS_CALL = 'b9c7c989f97918e1';
const ORDERS = '4a5b6c7d8e9f0a1b';
const TRACEPARENT = `00-${TRACE}-${CALL}-01`;

const span = (spanId, service, name, kind, startMs, endMs, parentId) => ({
  spanId, traceId: TRACE, name, service, kind, startMs, endMs, status: 'UNSET',
  attributes: {}, events: [], parentId, links: [],
});

// Step 1: the headers on each hop of one request (data text, escaped when shown), and the
// two root spans the backend shows for it.
const HOPS = [
  { from: 'storefront', to: 'nginx', traceparent: TRACEPARENT },
  { from: 'nginx', to: 'checkout', traceparent: null },
];
const ROOTS = [
  { traceId: TRACE, service: 'storefront', name: 'POST /checkout' },
  { traceId: NEW_TRACE, service: 'checkout', name: 'POST /checkout' },
];

// `why` follows "Right." or "Not quite.".
const WHERE = [
  {
    key: 'storefront',
    label: 'storefront: it never sent the trace context',
    why: 'storefront did send it: the first hop carries a valid <code>traceparent</code>. The header goes missing after that.',
  },
  {
    key: 'proxy',
    label: 'The nginx proxy: it did not forward <code>traceparent</code>',
    right: true,
    why: 'The header reaches nginx and never leaves it. With no <code>traceparent</code> to continue, checkout starts a new trace, so one request shows up as two root spans.',
  },
  {
    key: 'checkout',
    label: 'checkout: its SDK ignored a valid header',
    why: 'checkout never saw a header to ignore: the hop from nginx carries no <code>traceparent</code>, so it had to start a new trace.',
  },
];

// Step 2: the traceparent format. Labels are authored constants.
const VALID = [
  {
    key: 'zero-trace',
    label: '<code data-token>00-00000000000000000000000000000000-00f067aa0ba902b7-01</code>',
    why: 'A trace ID of all zeros is invalid, and a receiver MUST ignore a <code>traceparent</code> with an invalid trace ID.',
  },
  {
    key: 'uppercase',
    label: '<code data-token>00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01</code>',
    why: 'The IDs are lowercase hex. A receiver MUST ignore a parent-id with non-lowercase hex characters.',
  },
  {
    key: 'valid',
    label: `<code data-token>${TRACEPARENT}</code>`,
    right: true,
    why: 'Version <code>00</code>, a 32-digit lowercase hex trace ID, a 16-digit lowercase hex parent-id (the caller\'s span ID), neither all zeros, and the flags <code>01</code>: sampled.',
  },
  {
    key: 'short-parent',
    label: '<code data-token>00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b-01</code>',
    why: 'The parent-id has 15 hex digits. It must have exactly 16, so a receiver ignores the header.',
  },
];

// Step 3: nginx now forwards the header, so checkout's spans carry trace 4bf9..., but its
// SERVER span still arrives as a root. The answer gives it the parent the parent-id names.
// Help ladder (docs/M1-DESIGN.md §4.2): no queue, guide or tint, a Check button, hints on.
const TREE = {
  id: 'prop-tree',
  spans: [
    span(STORE, 'storefront', 'POST /checkout', 'SERVER', 0, 100, null),
    span(CALL, 'storefront', 'POST checkout', 'CLIENT', 10, 90, STORE),
    span(CHECKOUT, 'checkout', 'POST /checkout', 'SERVER', 15, 85, null),
    span(ORDERS_CALL, 'checkout', 'POST orders', 'CLIENT', 30, 60, CHECKOUT),
    span(ORDERS, 'orders', 'POST /orders', 'SERVER', 32, 58, ORDERS_CALL),
  ],
  edit: ['parent'],
  answer: { [CHECKOUT]: { parentId: CALL } },
  helps: { hints: true },
};

/** The level's answer tables, in play order (pinned by test/act-2.test.mjs). */
export const CONTENT = {
  steps: [
    { id: 'prop', question: 'Where did the trace break?', choices: WHERE, hops: HOPS, roots: ROOTS },
    { id: 'prop-tp', question: 'Which traceparent would checkout accept?', choices: VALID },
    { build: TREE },
  ],
};

export default {
  id: 'context-propagation',
  no: '2.4',
  name: 'Context propagation',
  sub: 'Pass it on',
  icon: '\u{1F517}',
  rewardTitle: 'Header hunter',
  mechanics: ['build'],
  widgets: ['choice', 'build'],
  cards: ['broken-propagation'],
  lights: ['orders'],
  scoring: { parMs: null },
  run(ctx) {
    const bar = ctx.ovActions;
    const e = ctx.escapeHtml;
    const next = (onclick) => {
      const btn = bar.querySelector('#prop-next');
      btn.onclick = onclick;
      return btn;
    };

    const stepWhere = () => {
      const hops = HOPS.map(
        (h) =>
          `<li>${e(h.from)} → ${e(h.to)}: ${
            h.traceparent ? `<code data-token>traceparent: ${e(h.traceparent)}</code>` : 'no <code>traceparent</code> header'
          }</li>`,
      ).join('');
      const roots = ROOTS.map(
        (r) => `<li><code>${e(r.name)}</code> on ${e(r.service)}, trace <code>${e(r.traceId.slice(0, 8))}</code>, no parent</li>`,
      ).join('');
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech(
          'One checkout request went storefront → nginx → checkout, but the backend shows it ' +
            'as two traces. Each hop should pass the trace context on in the ' +
            '<code>traceparent</code> header.',
          )}${prose(`<p>Headers on each hop:</p><ul>${hops}</ul><p>Root spans for the request:</p><ul>${roots}</ul>`)}${question({ id: 'prop-q-where', html: 'Where did the trace break?' })}${choiceHtml(ctx, WHERE, { id: 'prop', labelledBy: 'prop-q-where' })}`,
        }),
        actions({ wide: false, buttonsHtml: nextButton('prop-next') }),
      );
      const btn = next(stepValid);
      mountChoice(ctx, WHERE, {
        id: 'prop',
        onRight: () => {
          btn.disabled = false;
          return btn;
        },
      });
    };

    const stepValid = () => {
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech(
          'The fix is one line of nginx config that forwards the header. Before you ship it, ' +
            'check the format: <code>version-traceid-parentid-flags</code>, and a receiver ' +
            'ignores a header that breaks the rules.',
          )}${question({ id: 'prop-q-tp', html: 'Which traceparent would checkout accept?' })}${choiceHtml(ctx, VALID, { id: 'prop-tp', labelledBy: 'prop-q-tp' })}`,
        }),
        actions({ wide: false, buttonsHtml: nextButton('prop-next') }),
      );
      const btn = next(stepTree);
      mountChoice(ctx, VALID, {
        id: 'prop-tp',
        onRight: () => {
          btn.disabled = false;
          return btn;
        },
      });
    };

    const stepTree = () => {
      ctx.renderStep(
        step({
          wide: true,
          bodyHtml: `${ctx.speech(
          `nginx now forwards <code data-token>traceparent: ${e(TRACEPARENT)}</code>, so checkout's spans ` +
            'join trace <code>4bf92f35</code>. Its SERVER span still shows as a root here: give it ' +
            'the parent that the header\'s parent-id names.',
          )}${question({ html: 'Join checkout to the request.' })}${renderBuild(TREE, newBuildState(TREE), { escapeHtml: e })}`,
        }),
        actions({ wide: true, buttonsHtml: finishButton('prop-finish') }),
      );
      const finish = bar.querySelector('#prop-finish');
      mountBuild(ctx, TREE, {
        onComplete: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'You can follow the trace context from hop to hop, and spot the hop that drops it.',
          cards: ['broken-propagation'],
        });
    };

    stepWhere();
  },
};
