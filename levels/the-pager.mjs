// Act 0 boss: The pager. An alert fires with no context; every look the player takes
// finds no data and burns a quarter of the error budget, until they escalate. It cannot
// be won and is not scored: it is the reason to instrument. The budget is plain text in
// fixed 25% steps, not the incident engine (§4.3). Spec: docs/M1-DESIGN.md §6 Boss the-pager.
// Spec: https://opentelemetry.io/docs/concepts/observability-primer/#what-is-observability

const ALERT = 'PAGE: checkout p95 > 2 s (firing)';
const BUDGET = { startPct: 100, stepPct: 25 };
const REWARD = 'You could not answer one question. Time to instrument.';

// The four looks in play order. `reason` is what the look reveals.
const LOOKS = [
  {
    key: 'service',
    label: 'Which service?',
    reason: 'No data. No service sends telemetry yet, so nothing says which one is slow.',
  },
  {
    key: 'since',
    label: 'Since when?',
    reason: 'No data. The alert only says it is firing now; nothing was recorded before it.',
  },
  {
    key: 'customers',
    label: 'Which customers?',
    reason: 'No data. Requests carry no customer details, so there is nothing to slice by.',
  },
  {
    key: 'trace',
    label: 'Show me a trace',
    reason: 'No data. No service records traces, so there is no request to follow.',
  },
];

/** The boss's copy (pinned by test/the-pager.test.mjs). */
export const CONTENT = {
  alert: ALERT,
  looks: LOOKS,
  budget: BUDGET,
  reward: REWARD,
};

const budgetText = (pct) => `Error budget: ${pct}% left`;

export default {
  id: 'the-pager',
  no: null,
  name: 'The pager',
  sub: 'An alert with no context',
  icon: '\u{1F4DF}',
  rewardTitle: 'First page',
  mechanics: ['incident'],
  cards: [],
  lights: [],
  scored: false,
  scoring: { parMs: null },
  run(ctx) {
    const looks = LOOKS.map(
      (l) => `<button class="choice" data-look="${l.key}">${l.label}</button>`,
    ).join('');
    ctx.renderStep(
      `<div class="lesson-intro">${ctx.speech(
        'Day one, and your pager goes off. Find out what is wrong before the error budget runs out.',
      )}</div>
      <div class="lesson-stage">
        <h3 class="q" id="pager-alert">${ctx.escapeHtml(ALERT)}</h3>
        <p id="pager-budget" role="status" aria-live="polite">${budgetText(BUDGET.startPct)}</p>
        <div class="choices" role="group" aria-labelledby="pager-alert">${looks}</div>
        <div id="pager-feedback" role="status" aria-live="polite"></div>
      </div>`,
      '<button class="btn" id="pager-escalate" data-finish disabled>Escalate</button>',
    );
    const body = ctx.ovBody;
    const escalate = ctx.ovActions.querySelector('#pager-escalate');
    const budgetEl = body.querySelector('#pager-budget');
    const feedback = body.querySelector('#pager-feedback');
    const buttons = [...body.querySelectorAll('[data-look]')];
    let left = BUDGET.startPct;

    buttons.forEach((b, i) => {
      const look = LOOKS[i];
      b.onclick = () => {
        if (b.disabled) return;
        b.disabled = true;
        left = Math.max(0, left - BUDGET.stepPct);
        budgetEl.textContent = budgetText(left);
        feedback.insertAdjacentHTML(
          'beforeend',
          `<p class="feedback info show" data-said="${look.key}"><strong>${look.label}</strong> ${look.reason}</p>`,
        );
        escalate.disabled = false;
        const rest = [...buttons.slice(i + 1), ...buttons.slice(0, i)];
        (rest.find((x) => !x.disabled) ?? escalate).focus();
      };
    });
    escalate.onclick = () => ctx.finish({ text: REWARD, cards: [] });
    buttons[0].focus();
  },
};
