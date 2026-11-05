// Level 0.1: Monitoring vs observability. Day one on call: the player sorts questions
// into the ones a dashboard was built for and the new ones nobody planned, then names
// what makes the new kind answerable. Spec: docs/M1-DESIGN.md §6 Act 0.
// Spec: https://opentelemetry.io/docs/concepts/observability-primer/#what-is-observability
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountSort, renderSort } from '../lib/widgets/sort-it-view.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';

// Step 1. Label wording must not give the bucket away (test/sort-tells.test.mjs).
const SORT = {
  id: 'mvo-sort',
  buckets: [
    { id: 'known', label: 'Known question' },
    { id: 'new', label: 'New question' },
  ],
  items: [
    {
      id: 'cpu',
      label: 'Is CPU on db-1 above 90%?',
      bucket: 'known',
      why: 'Someone picked that threshold before anything broke, and a dashboard or an alert checks it all the time. That is monitoring.',
    },
    {
      id: 'ios',
      label: 'Why are only iOS 5.2 checkouts from Germany slow since 14:05 UTC?',
      bucket: 'new',
      why: 'Nobody builds a dashboard for iOS 5.2 in Germany. You answer it by slicing telemetry by app version, country and time after the fact.',
    },
    {
      id: '5xx',
      label: 'Has the checkout API 5xx rate stayed under 1% for the last 5 minutes?',
      bucket: 'known',
      why: 'An error-rate threshold is a classic alert: decided in advance, checked all the time.',
    },
    {
      id: 'cust',
      label: 'Is this one user hitting API timeouts?',
      bucket: 'new',
      why: 'No chart follows one user. You need telemetry that carries the user ID, so you can filter by it when the question comes up.',
    },
    {
      id: 'disk',
      label: 'Is the log disk down to 8 GB free space?',
      bucket: 'known',
      why: 'A disk running out of space is a failure mode you know about, with a number you can watch. A dashboard answers it.',
    },
    {
      id: 'coupon',
      label: 'Is the coupon path slowing over 10% of carts with 20+ items?',
      bucket: 'new',
      why: 'This combines two details, the coupon path and the cart size, that nobody thought to chart together. You ask it of the telemetry itself.',
    },
  ],
};

// Step 2: what makes the second kind answerable. `why` follows "Right." or "Not quite.".
const ANSWERABLE = [
  {
    key: 'rich',
    label: 'Telemetry with many attributes you can slice after the fact',
    right: true,
    why: 'New questions need data that still carries the details, such as app version, country, user ID and cart size, so you can group and filter by them once the question exists.',
  },
  {
    key: 'dash',
    label: 'More dashboards',
    why: 'A dashboard answers a question someone thought of in advance. The second kind are questions nobody had thought of yet.',
  },
  {
    key: 'alerts',
    label: 'More alerts',
    why: 'An alert is a known question checked all the time. It can tell you something is wrong, not why only some requests are slow.',
  },
  {
    key: 'retention',
    label: 'Keeping data for longer',
    why: 'Keeping data longer helps only if it has the detail you need. Months of CPU averages still cannot say whether that user timed out.',
  },
];

/** The level's answer tables, in play order (pinned by test/act-0.test.mjs). */
export const CONTENT = {
  steps: [{ sort: SORT }, { id: 'mvo', choices: ANSWERABLE }],
};

export default {
  id: 'monitoring-vs-observability',
  no: '0.1',
  name: 'Monitoring vs observability',
  sub: 'Known questions and new ones',
  icon: '\u{1F52D}',
  rewardTitle: 'Question asker',
  mechanics: ['sort'],
  cards: [],
  lights: [],
  scoring: { parMs: null },
  run(ctx) {
    const actions = ctx.ovActions;

    const stepSort = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Day one on call. Before your first page, sort the questions people ask about a ' +
            'system: the ones a dashboard was built for in advance, and the new ones nobody planned for.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="mvo-q-sort">Pick a question, then the kind it is.</h3>
          ${renderSort(SORT, newSortState(SORT), { escapeHtml: ctx.escapeHtml, labelledBy: 'mvo-q-sort' })}
        </div>`,
        '<button class="btn" id="mvo-next" disabled>Next</button>',
      );
      const next = actions.querySelector('#mvo-next');
      mountSort(ctx, SORT, {
        onComplete: () => {
          next.disabled = false;
          return next;
        },
      });
      next.onclick = stepAnswerable;
    };

    const stepAnswerable = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Monitoring answers the known questions. Observability is being able to answer the ' +
            'new ones from the telemetry your system already sends, without shipping new code.',
        )}</div>
        <div class="lesson-stage">
          <h3 class="q" id="mvo-q-why">What makes the second kind answerable?</h3>
          ${choiceHtml(ctx, ANSWERABLE, { id: 'mvo', labelledBy: 'mvo-q-why' })}
        </div>`,
        '<button class="btn" id="mvo-finish" data-finish disabled>Finish</button>',
      );
      const finish = actions.querySelector('#mvo-finish');
      mountChoice(ctx, ANSWERABLE, {
        id: 'mvo',
        onRight: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'You can tell a question someone planned for from a new one, and you know the new kind needs telemetry rich enough to slice.',
          cards: [],
        });
    };

    stepSort();
  },
};
