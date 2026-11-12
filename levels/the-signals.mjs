// Level 0.2: The signals. The player sorts telemetry, then questions, into metric, log,
// trace and profile, and names the newest, still-maturing signal (profiles: spec Alpha,
// OTLP Development, checked 2026-10-30). Spec: docs/M1-DESIGN.md §6 Act 0.
// Spec: https://opentelemetry.io/docs/concepts/signals/profiles/
import { actions, finishButton, nextButton, question, step } from '../lib/ui/index.mjs';
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountSort, renderSort } from '../lib/widgets/sort-it-view.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';

const SIGNALS = [
  { id: 'metric', label: 'Metric' },
  { id: 'log', label: 'Log' },
  { id: 'trace', label: 'Trace' },
  { id: 'profile', label: 'Profile' },
];

// Step 1: telemetry. Items do not follow the bucket order.
const DATA = {
  id: 'sig-data',
  helps: { hints: true },
  hint: 'Ask what one piece of this data holds, and how you would read it.',
  buckets: SIGNALS,
  items: [
    {
      id: 'duration',
      label: '<code>http.server.request.duration</code> histogram point',
      bucket: 'metric',
      why: 'A histogram point sums up many requests\' durations over an interval: numbers you aggregate and chart.',
    },
    {
      id: 'declined',
      label: '<code>{severity_text:"ERROR", body:"payment declined"}</code>',
      bucket: 'log',
      why: 'A severity and a body: one log record, describing one event as it happened.',
    },
    {
      id: 'stacks',
      label: 'CPU stack samples per function',
      bucket: 'profile',
      why: 'Stack samples that show where CPU time goes, function by function, are a profile.',
    },
    {
      id: 'cpu-time',
      label: '<code>process.cpu.time</code> counter',
      bucket: 'metric',
      why: 'A counter is a metric: a number that only goes up, recorded over time.',
    },
    {
      id: 'checkout-span',
      label: 'Span <code>POST /checkout</code> with trace_id, span_id and parent',
      bucket: 'trace',
      why: 'The trace ID, span ID and parent place this operation in one request\'s tree of spans: a trace.',
    },
  ],
};

// Step 2: questions, each best answered by one signal.
const ASK = {
  id: 'sig-ask',
  helps: { hints: true },
  hint: 'Ask whether the answer is a number over time, one event\'s exact contents, one request\'s path, or where code spends its time.',
  buckets: SIGNALS,
  items: [
    {
      id: 'rps',
      label: 'Requests per second over the last 30 days',
      bucket: 'metric',
      why: 'A metric aggregates as it goes, so a long range stays cheap to keep and to chart.',
    },
    {
      id: 'provider',
      label: 'What exactly did the payment provider return?',
      bucket: 'log',
      why: 'A log record keeps the exact message an event produced.',
    },
    {
      id: 'cpu-fn',
      label: 'Which function burns CPU in inventory?',
      bucket: 'profile',
      why: 'A profile attributes CPU time to the functions in the code.',
    },
    {
      id: 'slow-call',
      label: 'Which downstream call made this request slow?',
      bucket: 'trace',
      why: 'A trace shows every call in the request with its own start and duration.',
    },
  ],
};

// Step 3: the newest signal. `why` follows "Right." or "Not quite.".
const NEWEST = [
  {
    key: 'metrics',
    label: 'Metrics',
    why: 'Traces, metrics and logs all came before profiles, the fourth signal.',
  },
  {
    key: 'logs',
    label: 'Logs',
    why: 'Logs came before profiles, the fourth signal.',
  },
  {
    key: 'traces',
    label: 'Traces',
    why: 'Traces were there before profiles, the fourth signal.',
  },
  {
    key: 'profiles',
    label: 'Profiles',
    right: true,
    why: 'Profiles are OTel\'s fourth signal and the newest. The profiles spec is Alpha, and profiles in OTLP are still in Development, so expect changes.',
  },
];

/** The level's answer tables, in play order (pinned by test/act-0.test.mjs). */
export const CONTENT = {
  steps: [{ sort: DATA }, { sort: ASK }, { id: 'sig', choices: NEWEST }],
};

export default {
  id: 'the-signals',
  no: '0.2',
  name: 'The signals',
  sub: 'Metrics, logs, traces and profiles',
  icon: '\u{1F4E1}',
  rewardTitle: 'Signal reader',
  mechanics: ['sort'],
  widgets: ['sort', 'choice'],
  cards: ['profiles-signal'],
  lights: [],
  scoring: { parMs: null },
  run(ctx) {
    const bar = ctx.ovActions;
    const next = () => bar.querySelector('#sig-next');
    const unlock = (btn) => () => {
      btn.disabled = false;
      return btn;
    };

    const sortStep = (spec, intro, questionHtml, then) => {
      ctx.renderStep(
        step({
          wide: true,
          bodyHtml: `${ctx.speech(intro)}${question({ id: `${spec.id}-q`, html: questionHtml })}${renderSort(spec, newSortState(spec), { escapeHtml: ctx.escapeHtml, labelledBy: `${spec.id}-q` })}`,
        }),
        actions({ wide: true, buttonsHtml: nextButton('sig-next', 'Sort every item to continue.') }),
      );
      mountSort(ctx, spec, { onComplete: unlock(next()) });
      next().onclick = then;
    };

    const stepData = () =>
      sortStep(
        DATA,
        'OpenTelemetry carries four kinds of telemetry, called signals: metrics, logs, traces ' +
          'and profiles. Here is a little of each from the shop.',
        'Which signal is each one?',
        stepAsk,
      );

    const stepAsk = () =>
      sortStep(
        ASK,
        'Each signal is good at some questions. Match each question to the signal that answers it best.',
        'Which signal answers each question?',
        stepNewest,
      );

    const stepNewest = () => {
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech('One of the four is still settling.')}${question({ id: 'sig-q-new', html: 'Which signal is the newest and still maturing?' })}${choiceHtml(ctx, NEWEST, { id: 'sig', labelledBy: 'sig-q-new' })}`,
        }),
        actions({ wide: false, buttonsHtml: finishButton('sig-finish', 'Pick the right answer to finish the level.') }),
      );
      const finish = bar.querySelector('#sig-finish');
      mountChoice(ctx, NEWEST, { id: 'sig', onRight: unlock(finish) });
      finish.onclick = () =>
        ctx.finish({
          text: 'You can match telemetry and questions to the signal that fits, and you know profiles are still settling.',
          cards: ['profiles-signal'],
        });
    };

    stepData();
  },
};
