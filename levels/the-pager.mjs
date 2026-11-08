// Act 0 boss: The pager, in two parts. Part 1 (blind): an alert fires with no context;
// every look the player takes finds no data and burns a quarter of the error budget,
// until they escalate or the budget hits 0. Part 2: the same four questions, each answered
// from a small instrumented view. It cannot be won and is not scored: it is the reason to
// The budget is a percent of the error budget, not minutes, in fixed 25% steps. The screen shows a kit meter of 4 cells, the percent left as the headline, and a Spent on chip per look. It is not the incident engine (§4.3). Spec: docs/M1-DESIGN.md §6 Boss the-pager.
// Spec: https://opentelemetry.io/docs/concepts/observability-primer/#what-is-observability

import {
  actions,
  button,
  chip,
  finishButton,
  feedback as feedbackRegion,
  meter,
  option,
  options,
  prose,
  question,
  setFeedback,
  step,
} from '../lib/ui/index.mjs';

const ALERT = 'PAGE: checkout p95 > 2 s (firing)';
const BUDGET = { startPct: 100, stepPct: 25 };
const REWARD = 'Blind, you could not answer one question. With telemetry, all four took seconds. Time to instrument.';
const INTRO =
  'Your pager goes off. Try the four questions below: you will find you cannot answer them, because nothing sends telemetry yet. Each try burns error budget. When you give up, press Escalate.';
const LIT_INTRO =
  'Same alert, now with telemetry. Ask the same four questions. The data is made up, for illustration. Ask all four to finish.';

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

// Part 2's answers. All figures, names and the trace ID are MADE UP for illustration.
// Each answer leans on one OpenTelemetry idea:
// service: the service.name resource attribute names the service producing telemetry.
//   Spec: https://opentelemetry.io/docs/concepts/resources/
// since: a metric (a latency percentile over time) shows when it changed; service.version
//   is a resource attribute. Spec: https://opentelemetry.io/docs/concepts/signals/metrics/
// customers: span attributes (here payment.provider) let you slice requests.
//   Spec: https://opentelemetry.io/docs/concepts/signals/traces/#attributes
// trace: a trace is the spans of one request; a span records its operation and duration.
//   Spec: https://opentelemetry.io/docs/concepts/signals/traces/
const ASKS = [
  {
    key: 'service',
    label: 'Which service?',
    answer: 'payment-api. Its p95 is 4.1 s; cart and storefront stay under 0.3 s.',
  },
  {
    key: 'since',
    label: 'Since when?',
    answer: 'Since 14:02, when p95 jumped from 0.2 s to 4.1 s. payment-api v2.31 started at 14:02.',
  },
  {
    key: 'customers',
    label: 'Which customers?',
    answer: 'Orders paid with payment.provider=acme-pay. Other providers stay fast.',
  },
  {
    key: 'trace',
    label: 'Show me a trace',
    answer:
      'Trace 4bf92f3577b34da6a3ce929d0e0e4736: checkout took 4.2 s, 3.9 s of it in payment-api POST /charge.',
  },
];

/** The boss's copy (pinned by test/the-pager.test.mjs). */
export const CONTENT = {
  alert: ALERT,
  looks: LOOKS,
  budget: BUDGET,
  reward: REWARD,
  intro: INTRO,
  telemetry: { intro: LIT_INTRO, asks: ASKS },
};

const budgetText = (pct) => `Error budget: ${pct}% left`;
const CELLS = BUDGET.startPct / BUDGET.stepPct;

/** The kit meter: spent cells fill as looks are taken; its text line counts the percent spent. */
const meterHtml = (left) =>
  meter({
    id: 'pager-meter',
    label: 'Error budget',
    value: BUDGET.startPct - left,
    max: BUDGET.startPct,
    cells: CELLS,
    unit: '% spent',
  });

/** One Spent on chip per look taken, in the order taken. */
const spentHtml = (taken) =>
  taken.length
    ? `Spent on: ${taken.map((l) => chip({ text: `${l.label} ${BUDGET.stepPct}%` })).join(' ')}`
    : '';

export default {
  id: 'the-pager',
  no: null,
  name: 'The pager',
  sub: 'An alert with no context',
  icon: '\u{1F4DF}',
  rewardTitle: 'First page',
  mechanics: ['incident'],
  // No help card: its intro explains the board (it is not scored).
  widgets: [],
  cards: [],
  lights: [],
  scored: false,
  scoring: { parMs: null },
  run(ctx) {
    const e = ctx.escapeHtml;
    // The rows so far: a plain full-width kit block, not live. Only the newest row is announced, in the feedback region.
    const rowsList = (id) => `<div id="${id}"></div>`;
    const alert = question({ id: 'pager-alert', html: e(ALERT) });
    const choices = (list, attr) =>
      options({
        labelledBy: 'pager-alert',
        itemsHtml: list.map((x) => option({ attr, value: x.key, labelHtml: e(x.label) })).join(''),
      });
    /** The newest row is announced in the kit feedback region (neutral: information only); the row it replaces moves into the plain (not live) list, so each row is on screen once. */
    const addRow = (list, region, key, attr, label, body) => {
      if (region.newestHtml) {
        list.rowsHtml = `${list.rowsHtml ?? ''}${region.newestHtml}`;
        list.innerHTML = prose(list.rowsHtml);
      }
      region.newestHtml = `<p data-${attr}="${key}"><strong>${label}</strong> ${body}</p>`;
      setFeedback(region, 'neutral', region.newestHtml);
    };
    const askAnswers = () => {
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech(LIT_INTRO)}${alert}${choices(ASKS, 'ask')}${rowsList('pager-answer-rows')}${feedbackRegion({ id: 'pager-answers' })}`,
        }),
        actions({ wide: false, buttonsHtml: finishButton('pager-finish') }),
      );
      const finish = ctx.ovActions.querySelector('#pager-finish');
      const answers = ctx.ovBody.querySelector('#pager-answers');
      const answerRows = ctx.ovBody.querySelector('#pager-answer-rows');
      const buttons = [...ctx.ovBody.querySelectorAll('[data-ask]')];
      buttons.forEach((b, i) => {
        const ask = ASKS[i];
        b.onclick = () => {
          if (b.disabled) return;
          b.disabled = true;
          addRow(answerRows, answers, ask.key, 'answer', ask.label, ask.answer);
          finish.disabled = buttons.some((x) => !x.disabled);
          const rest = [...buttons.slice(i + 1), ...buttons.slice(0, i)];
          (rest.find((x) => !x.disabled) ?? finish).focus();
        };
      });
      finish.onclick = () => ctx.finish({ text: REWARD, cards: [] });
      buttons[0].focus();
    };

    ctx.renderStep(
      step({
        wide: false,
        bodyHtml: `${ctx.speech(INTRO)}${alert}
        <p id="pager-budget" role="status" aria-live="polite">${budgetText(BUDGET.startPct)}</p>
        <div id="pager-meter-slot">${meterHtml(BUDGET.startPct)}</div>
        <p id="pager-spent"></p>
        ${choices(LOOKS, 'look')}${rowsList('pager-said-rows')}${feedbackRegion({ id: 'pager-feedback' })}`,
      }),
      actions({
        wide: false,
        buttonsHtml: button({ id: 'pager-escalate', label: 'Escalate', variant: 'primary', disabled: true }),
      }),
    );
    const body = ctx.ovBody;
    const escalate = ctx.ovActions.querySelector('#pager-escalate');
    const budgetEl = body.querySelector('#pager-budget');
    const meterSlot = body.querySelector('#pager-meter-slot');
    const spentEl = body.querySelector('#pager-spent');
    const feedback = body.querySelector('#pager-feedback');
    const saidRows = body.querySelector('#pager-said-rows');
    const taken = [];
    const buttons = [...body.querySelectorAll('[data-look]')];
    let left = BUDGET.startPct;

    buttons.forEach((b, i) => {
      const look = LOOKS[i];
      b.onclick = () => {
        if (b.disabled) return;
        b.disabled = true;
        left = Math.max(0, left - BUDGET.stepPct);
        budgetEl.textContent = budgetText(left);
        taken.push(look);
        meterSlot.innerHTML = meterHtml(left);
        spentEl.innerHTML = spentHtml(taken);
        addRow(saidRows, feedback, look.key, 'said', look.label, look.reason);
        escalate.disabled = false;
        if (left === 0) return askAnswers();
        const rest = [...buttons.slice(i + 1), ...buttons.slice(0, i)];
        (rest.find((x) => !x.disabled) ?? escalate).focus();
      };
    });
    escalate.onclick = askAnswers;
    // The app moves focus to Back after run() (docs/DESIGN-SYSTEM.md, Focus); this keeps the step's own focus order.
    buttons[0].focus();
  },
};
