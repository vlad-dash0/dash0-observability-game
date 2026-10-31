// Level 2.7: Auto vs manual. The player sorts what zero-code instrumentation covers in cart
// from what only their own code adds, finds why each of cart's fetch calls shows two CLIENT
// spans (an injected agent plus a tracing.js NodeSDK), and picks the fix.
// Spec: docs/M1-DESIGN.md §6 Act 2.
// Spec: https://opentelemetry.io/docs/zero-code/js/ , https://opentelemetry.io/docs/platforms/kubernetes/operator/automatic/
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountSort, renderSort } from '../lib/widgets/sort-it-view.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';

// Step 1. Items interleave the buckets so their order gives nothing away.
const SORT = {
  id: 'avm-sort',
  buckets: [
    { id: 'auto', label: 'Automatic' },
    { id: 'manual', label: 'Manual' },
  ],
  items: [
    {
      id: 'server',
      label: 'The HTTP server spans, one per route',
      bucket: 'auto',
      why: 'The HTTP server instrumentation starts a span for every request that reaches an Express route, with no code of yours.',
    },
    {
      id: 'loyalty',
      label: 'A span around <code>applyLoyaltyDiscount()</code>',
      bucket: 'manual',
      why: 'Instrumentation knows nothing about your business functions. You start that span yourself with the API.',
    },
    {
      id: 'redis',
      label: 'Redis command spans',
      bucket: 'auto',
      why: 'The Redis instrumentation wraps the client and starts a span for each command.',
    },
    {
      id: 'coupon',
      label: '<code>app.coupon.code</code> on the checkout span',
      bucket: 'manual',
      why: 'Only your code knows which coupon the customer used, so you set that attribute on the span yourself.',
    },
    {
      id: 'client',
      label: 'Outgoing HTTP client spans',
      bucket: 'auto',
      why: 'The HTTP client instrumentation starts a CLIENT span for each outgoing call, with no code of yours.',
    },
    {
      id: 'item-count',
      label: '<code>app.cart.item_count</code>',
      bucket: 'manual',
      why: 'That is a business number only your code can read, so you add it as an attribute yourself.',
    },
  ],
};

// Step 2: why does each fetch call show two CLIENT spans? `why` follows "Right." or "Not quite.".
const WHY = [
  {
    key: 'retries',
    label: 'Cart retries every fetch call once',
    why: 'A retry would show two spans with different start times, and cart does not retry. Here each call has a twin, and the twins start together.',
  },
  {
    key: 'two-setups',
    label: 'Two setups: the injected agent and <code>tracing.js</code> each instrument fetch',
    right: true,
    why: 'The operator\'s <code>NODE_OPTIONS</code> loads the auto-instrumentation agent, and <code>tracing.js</code> starts a second NodeSDK with the same instrumentations. Fetch instrumentation subscribes once per setup, so each call gets two CLIENT spans.',
  },
  {
    key: 'collector',
    label: 'The Collector copies each span on its way to Dash0',
    why: 'A Collector forwards the spans it receives. Both copies were already in what cart exported.',
  },
];

// Step 3: the fix.
const FIX = [
  {
    key: 'sample',
    label: 'Sample 50% of traces',
    why: 'Sampling drops whole traces. In the traces you keep, each fetch call still has two CLIENT spans.',
  },
  {
    key: 'keep-one',
    label: 'Keep one setup and add the business spans through the API',
    right: true,
    why: 'Run the agent or your own SDK, not both. Then add spans such as <code>applyLoyaltyDiscount()</code> and attributes such as <code>app.coupon.code</code> with the API, which the one setup exports.',
  },
  {
    key: 'dedupe',
    label: 'Dedupe the spans in the Collector',
    why: 'That hides the symptom and keeps both setups running, with twice the instrumentation work in every cart request.',
  },
];

/** The level's answer tables, in play order (pinned by test/act-2.test.mjs). */
export const CONTENT = {
  steps: [
    { sort: SORT },
    { id: 'avm-why', question: 'Why does each fetch call show two CLIENT spans?', choices: WHY },
    { id: 'avm-fix', question: 'What is the fix?', choices: FIX },
  ],
};

export default {
  id: 'auto-vs-manual',
  no: '2.7',
  name: 'Auto vs manual',
  sub: 'What the agent covers',
  icon: '\u{1F916}',
  rewardTitle: 'Hands-on instrumenter',
  mechanics: ['sort'],
  cards: ['double-instrumentation'],
  lights: ['cart'],
  scoring: { parMs: null },
  run(ctx) {
    const actions = ctx.ovActions;

    const stepSort = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Cart runs with zero-code instrumentation, so it already emits spans. Some of what ' +
            'you want to see in them comes with that, and some only your own code can add.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="avm-q-sort">Pick an item, then say whether it comes automatically or needs your code.</h3>
          ${renderSort(SORT, newSortState(SORT), { escapeHtml: ctx.escapeHtml, labelledBy: 'avm-q-sort' })}
        </div>`,
        '<button class="btn" id="avm-next" disabled>Next</button>',
      );
      const next = actions.querySelector('#avm-next');
      mountSort(ctx, SORT, {
        onComplete: () => {
          next.disabled = false;
          return next;
        },
      });
      next.onclick = stepWhy;
    };

    const stepWhy = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Now cart\'s traces look wrong: each outgoing <code>fetch</code> call shows two CLIENT ' +
            'spans. The operator injects ' +
            '<code>NODE_OPTIONS=--require @opentelemetry/auto-instrumentations-node/register</code> ' +
            'into the pod, and cart\'s own <code>tracing.js</code> starts a NodeSDK with ' +
            '<code>getNodeAutoInstrumentations()</code>.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="avm-q-why">${CONTENT.steps[1].question}</h3>
          ${choiceHtml(ctx, WHY, { id: 'avm-why', labelledBy: 'avm-q-why' })}
        </div>`,
        '<button class="btn" id="avm-next" disabled>Next</button>',
      );
      const next = actions.querySelector('#avm-next');
      mountChoice(ctx, WHY, {
        id: 'avm-why',
        onRight: () => {
          next.disabled = false;
          return next;
        },
      });
      next.onclick = stepFix;
    };

    const stepFix = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Cart still needs spans for <code>applyLoyaltyDiscount()</code> and the coupon, which ' +
            'no agent can add for you.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="avm-q-fix">${CONTENT.steps[2].question}</h3>
          ${choiceHtml(ctx, FIX, { id: 'avm-fix', labelledBy: 'avm-q-fix' })}
        </div>`,
        '<button class="btn" id="avm-finish" data-finish disabled>Finish</button>',
      );
      const finish = actions.querySelector('#avm-finish');
      mountChoice(ctx, FIX, {
        id: 'avm-fix',
        onRight: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'You know what zero-code instrumentation covers, and that a second setup can double some spans. Run one and add business spans through the API.',
          cards: ['double-instrumentation'],
        });
    };

    stepSort();
  },
};
