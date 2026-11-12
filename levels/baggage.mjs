// Level 2.5: Baggage. Storefront wants to put entries in baggage; the player sorts what
// may travel with every request from what never should, then says whether a downstream
// service's spans carry a baggage entry on their own.
// Spec: docs/M1-DESIGN.md §6 Act 2.
// Spec: https://opentelemetry.io/docs/concepts/signals/baggage/ , https://www.w3.org/TR/baggage/
import { actions, finishButton, nextButton, question, step } from '../lib/ui/index.mjs';
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountSort, renderSort } from '../lib/widgets/sort-it-view.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';

// Step 1. Label wording must not give the bucket away (test/sort-tells.test.mjs).
const SORT = {
  id: 'bag-sort',
  helps: { hints: false },
  buckets: [
    { id: 'ok', label: 'Fine in baggage' },
    { id: 'never', label: 'Never in baggage' },
  ],
  items: [
    {
      id: 'variant',
      label: '<code>experiment.variant=redesign-B</code>',
      bucket: 'ok',
      why: 'An experiment arm is no secret, and every service on the path can use it, for example to tag its own spans with the variant.',
      whyNot: {
        never: 'An experiment arm names no person and unlocks nothing. Nothing in it is private or reusable, and downstream services can use it.',
      },
    },
    {
      id: 'email',
      label: '<code>user.email=ana@example.com</code>',
      bucket: 'never',
      why: 'An email address identifies a person. Baggage goes out in a plain <code>baggage</code> header to every downstream, third-party APIs included, and anyone inspecting the traffic can read it.',
      whyNot: {
        ok: 'An email address identifies a person. Baggage goes out in a plain header to every downstream service, third parties too, and anyone watching the traffic can read it.',
      },
    },
    {
      id: 'tier',
      label: '<code>tenant.tier=gold</code>',
      bucket: 'ok',
      why: 'A coarse tier says nothing about one person, and downstream services can use it, for example to route or prioritise.',
      whyNot: {
        never: 'A coarse tier says nothing about one person, and nobody can reuse it. There is nothing here to protect.',
      },
    },
    {
      id: 'token',
      label: '<code>session.token=eyJhbGciOiJIUzI1NiJ9</code>',
      bucket: 'never',
      why: 'A session token is a credential. Anyone who reads the <code>baggage</code> header, a third party included, could reuse it.',
      whyNot: {
        ok: 'A session token is a credential. In a plain header it goes to every downstream service, and anyone who reads it could reuse it.',
      },
    },
    {
      id: 'last4',
      label: '<code>card.last4=4242</code>',
      bucket: 'never',
      why: 'Even part of a card number is payment data. Baggage can be passed on outside your network by downstream services, so keep it out.',
      whyNot: {
        ok: 'Even the last digits are payment data. Baggage can reach services outside your network, so it is a poor place for them.',
      },
    },
  ],
};

// Step 2: does baggage reach a downstream service's spans? `why` follows "Right." or "Not quite.".
const ON_SPANS = [
  {
    key: 'yes-auto',
    label: 'Yes: every span in the trace gets baggage as attributes',
    why: 'Baggage travels with the context, but nothing puts it on spans by default. Read the entry and set it as an attribute yourself, or add a baggage span processor.',
  },
  {
    key: 'root-only',
    label: 'Only storefront\'s spans, where it was set',
    why: 'No span gets it by default, not even in storefront. Baggage is a separate key/value store from span attributes until something copies one into the other.',
  },
  {
    key: 'only-if-copied',
    label: 'No, only if something copies it, such as a baggage span processor',
    right: true,
    why: 'Baggage is a separate key/value store. An entry reaches span attributes only when your code reads it and sets it, or a baggage span processor copies it as each span starts.',
  },
];

/** The level's answer tables, in play order (pinned by test/act-2.test.mjs). */
export const CONTENT = {
  steps: [{ sort: SORT }, { id: 'bag', choices: ON_SPANS }],
};

export default {
  id: 'baggage',
  no: '2.5',
  name: 'Baggage',
  sub: 'What travels with the request',
  icon: '\u{1F9F3}',
  rewardTitle: 'Light packer',
  mechanics: ['sort'],
  hintless: ['sort'], // its one sort has helps.hints off: no Hint button
  widgets: ['sort', 'choice'],
  cards: ['baggage-leaks'],
  lights: [],
  scoring: { parMs: null },
  run(ctx) {
    const bar = ctx.ovActions;

    const stepSort = () => {
      ctx.renderStep(
        step({
          wide: true,
          bodyHtml: `${ctx.speech(
          'Baggage is a set of key/value pairs that travels with a request\'s context, from ' +
            'service to service. Storefront wants to put a few entries in it so services ' +
            'further down can use them.',
        )}${question({ id: 'bag-q-sort', html: 'Pick an entry, then say whether it belongs in baggage.' })}${renderSort(SORT, newSortState(SORT), { escapeHtml: ctx.escapeHtml, labelledBy: 'bag-q-sort' })}`,
        }),
        actions({ wide: true, buttonsHtml: nextButton('bag-next', 'Sort every item to continue.') }),
      );
      const next = bar.querySelector('#bag-next');
      mountSort(ctx, SORT, {
        onComplete: () => {
          next.disabled = false;
          return next;
        },
      });
      next.onclick = stepOnSpans;
    };

    const stepOnSpans = () => {
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech(
          'Storefront puts <code>tenant.tier=gold</code> in baggage, and the request goes on to ' +
            'recommendations, which runs the usual SDK setup with automatic instrumentation.',
        )}${question({ id: 'bag-q-spans', html: 'Do recommendations\' spans carry <code>tenant.tier</code> from baggage?' })}${choiceHtml(ctx, ON_SPANS, { id: 'bag', labelledBy: 'bag-q-spans' })}`,
        }),
        actions({ wide: false, buttonsHtml: finishButton('bag-finish', 'Pick the right answer to finish the level.') }),
      );
      const finish = bar.querySelector('#bag-finish');
      mountChoice(ctx, ON_SPANS, {
        id: 'bag',
        onRight: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'You keep personal data and secrets out of baggage, and you know it reaches spans only when something copies it.',
          cards: ['baggage-leaks'],
        });
    };

    stepSort();
  },
};
