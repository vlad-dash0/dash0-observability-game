// Act 9 boss: It's us. The game holds an incident of its own, a failing save in the player's session, as
// one trace. Connected to the player's Dash0 it sends that incident once and the player finds it there
// (filter by their session id, open the trace, read the span in error); not connected, or in practice,
// the game renders the same spans in a simulated trace view. Either way the questions are graded by
// gradeAnswer against the spans themselves (lib/incident-lab.mjs, docs/DASH0-LAB.md invariant I5).
// The fault code is only ever in the attributes of the failing span, as in Dash0: live shows no trace
// at all, so it is nowhere on the page; practice shows it only after that span is opened.
// Spec: https://opentelemetry.io/docs/specs/otel/trace/api/#add-events , https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-spans/
// Spec: https://www.dash0.com/docs/dash0/telemetry/tracing/about-tracing , https://www.dash0.com/docs/dash0/telemetry/tracing/view , https://www.dash0.com/docs/dash0/telemetry/tracing/span-sidebar
// Spec: https://www.dash0.com/docs/dash0/telemetry/tracing/span-events , https://www.dash0.com/docs/dash0/miscellaneous/glossary/filtering
// Dash0 docs: the Trace Explorer has a Filter (pick a key, an operator and a value), a Time Picker and a
// Span Table; the Trace View shows one trace as a Waterfall; selecting a span opens the Span Sidebar with
// its Attributes; span events (exception, retry) are records on a span (telemetry/tracing/*, glossary/filtering).
// Not on a Dash0 page, so marked VERIFY (#195) below: that the span's events are listed in the sidebar's
// "Related Logs & Events" tab, and that a session.id attribute set by the sender is filterable as a key.
// The practice view is the game's own simulation of those pages and says so on every screen.
//
// The token never comes into this file: connecting is level 9.3's job (and the game is connected
// or it is not). The boss reads ctx.telemetry.status(), sends with sendBatch and shows what came back.
import { isErrorStatus, SESSION_ATTR } from '../lib/otlp/encode.mjs';
import { OUTCOME, TIMEOUT_MS } from '../lib/otlp/send.mjs';
import { answersFrom, EXCEPTION_EVENT, gradeAnswer, GRADE, QUESTION, RETRY_EVENT } from '../lib/incident-lab.mjs';
import { MODE, STATE } from '../lib/telemetry.mjs';
import { actions as actionsBar, button, chip, feedback, field, finishButton, note, panel, prose, setFeedback, step, table } from '../lib/ui/index.mjs';

// Incidents already accepted by a Dash0 in this page's session (one per telemetry session). Keyed by
// the incident object the session caches, so a second open of the boss does not send again.
const SENT = new WeakSet();

const SIMULATED = 'Practice: a simulated Dash0, not your account';

// What each question asks, how to find it, and what to say when the input cannot be checked.
const QUESTIONS = [
  {
    key: QUESTION.operation,
    label: 'Which operation failed?',
    note: 'The name of the span in error.',
    nudge: 'Type the name of the span in error.',
    wrong: 'That is not the operation that failed.',
  },
  {
    key: QUESTION.faultCode,
    label: 'What is its fault code?',
    note: "Read it from that span's attributes, exactly as shown. Case does not matter.",
    nudge: 'Type the fault code from the span.',
    wrong: 'That is not the fault code on the failing span. Check each character.',
  },
  {
    key: QUESTION.retryCount,
    label: 'How many times was it retried?',
    note: 'Count the retry events on that span.',
    nudge: 'Type a whole number.',
    wrong: 'That is not the number of retries. Count them again.',
  },
  {
    key: QUESTION.traceId,
    label: 'What is the trace id?',
    note: 'The id of the whole trace: 32 hexadecimal characters.',
    nudge: 'A trace id is 32 characters, 0 to 9 and a to f.',
    wrong: 'That is not the id of this trace.',
  },
];

// Why a send failed, by what came back. The network's and Dash0's faults never cost a star.
const UNREACHABLE = {
  network:
    'The request never got an answer. In a browser that can be a wrong host, a CORS refusal or ' +
    "the page's Content Security Policy, and the browser cannot tell them apart.",
  timeout: `There was no answer within ${TIMEOUT_MS / 1000} seconds.`,
  opaque: 'Something answered, but not with a usable HTTP response.',
  aborted: 'The request was cancelled before it finished.',
  invalid: 'The game could not build the request, so nothing was sent.',
};
const UNREACHABLE_FALLBACK = 'The game is not connected, so the incident was not sent.';
const DUPLICATE_NOTE =
  ' If an earlier attempt did get through, Dash0 may show the trace twice. Your answers are the same either way.';

export default {
  id: 'its-us',
  no: null,
  name: "It's us",
  sub: 'Find your own incident in Dash0',
  icon: '\u{1F575}',
  rewardTitle: 'On-call',
  mechanics: ['spot'],
  // It builds its own screens from the UI kit; no shared widget is on them.
  widgets: [],
  cards: [],
  lights: ['collector'],
  scored: true,
  scoring: { parMs: null },
  run(ctx) {
    const tele = ctx.telemetry;
    const e = ctx.escapeHtml;
    const body = ctx.ovBody;
    const actions = ctx.ovActions;
    const $ = (sel) => body.querySelector(sel);
    const screen = (...parts) => step({ bodyHtml: parts.join('') });
    const bar = (buttonsHtml) => actionsBar({ buttonsHtml });

    // The incident is built here, on the first open of the boss, and cached by the session: it is the
    // one array that is sent, rendered and graded (invariant I5).
    const incident = tele ? tele.incident() : null;
    const key = incident ? answersFrom(incident.spans) : null;
    if (!tele || !incident || key === null) {
      ctx.renderStep(
        screen(ctx.speech(
          tele
            ? 'The game could not read its own incident, so there is nothing to find.'
            : 'The game has no telemetry session in this build, so there is no incident to find.',
        )),
        bar(button({ id: 'its-none', label: 'Close this level', variant: 'ghost', disabled: true })),
      );
      return;
    }
    const spans = incident.spans;

    // ---- the first screen depends on what the session is ----
    const stepStart = () => {
      const { state, mode } = tele.status();
      if (state === STATE.connected && mode === MODE.live) {
        if (SENT.has(incident)) stepFind(MODE.live);
        else stepSend();
        return;
      }
      if (state === STATE.connected) {
        stepFind(MODE.practice); // practice connection: the simulated Dash0 is the only Dash0 there is
        return;
      }
      stepNotConnected();
    };

    // ---- not connected: explain, offer practice ----
    const stepNotConnected = () => {
      const why = tele.liveAvailable()
        ? 'Your own Dash0 needs a connection from level 9.3 first. Connect there, then come back.'
        : 'Your own Dash0 needs a connection from level 9.3 first, and connecting to your own Dash0 is not open yet. Practice works the same way.';
      ctx.renderStep(
        screen(
          ctx.speech(
            'The game ran into a problem of its own. Your job is to find it, in Dash0, from the game\'s own telemetry. ' +
              'But the game is not connected to a Dash0: you skipped the connection in level 9.3, or the page was reloaded, which drops it.',
          ),
          chip({ text: 'Not connected', tone: 'attention' }),
          prose(
            '<p>Practice shows the same incident in a simulated Dash0 trace view, and it scores the same way as your own Dash0. ' +
              'Nothing leaves this page.</p>' + `<p id="its-live-why">${e(why)}</p>`,
          ),
        ),
        bar(
          button({ id: 'its-practice', label: 'Practice with a simulated Dash0', variant: 'primary' }) +
            button({ id: 'its-live', label: 'Use my own Dash0', variant: 'ghost', disabled: true, describedBy: 'its-live-why' }),
        ),
      );
      actions.querySelector('#its-practice').onclick = () => stepFind(MODE.practice);
    };

    // ---- connected live: send the incident once ----
    const stepSend = () => {
      const { host } = tele.status();
      ctx.renderStep(
        screen(
          ctx.speech(
            'The game keeps a trace of its own save path, and one step of it failed. It has not been sent yet. ' +
              'Send it to your Dash0, then find it there.',
          ),
          chip({ text: `Your own Dash0: ${host ?? ''}`, tone: 'success' }),
          prose(
            `<p>This sends one trace of five spans. Every span carries your session id, <code id="its-session">${e(tele.sessionId)}</code>, ` +
              'as <code>session.id</code>, so you can pick your own out of everything else in your Dash0. The game sends it once.</p>',
          ),
          feedback({ id: 'its-feedback' }),
        ),
        bar(button({ id: 'its-send', label: 'Send the incident to Dash0', variant: 'primary' })),
      );
      actions.querySelector('#its-send').onclick = send;
    };

    // The bar of the send screen: the send button (pending or not), plus the ways out of a failure.
    const setSendBar = ({ busy = false, retry = false, practice = false } = {}) => {
      actions.innerHTML = bar(
        button({ id: 'its-send', label: 'Send the incident to Dash0', variant: 'primary', disabled: busy || retry }) +
          (retry ? button({ id: 'its-retry', label: 'Send the incident again', variant: 'primary' }) : '') +
          (practice ? button({ id: 'its-switch', label: 'Practice instead', variant: 'ghost' }) : ''),
      );
      actions.querySelector('#its-send').onclick = send;
      const again = actions.querySelector('#its-retry');
      if (again) again.onclick = send;
      const sw = actions.querySelector('#its-switch');
      if (sw) sw.onclick = () => stepFind(MODE.practice);
    };

    // What came back, in plain words: the tone, the text, whether to offer a retry.
    const describe = (outcome) => {
      switch (outcome.kind) {
        case OUTCOME.rejected:
          if (outcome.auth) {
            // VERIFY (#195): whether live Dash0 answers 401 or 403 here; the copy splits neither.
            return {
              html: 'Dash0 refused the token and would not take the incident. Open level 9.3 to connect again with a ' +
                'token that has the Ingesting permission, or practice here.',
              retry: false,
            };
          }
          return {
            html: `Dash0 refused the incident (HTTP ${Number(outcome.status)}).${outcome.message ? ` Dash0 said: ${e(outcome.message)}` : ''}`,
            retry: true,
          };
        case OUTCOME.unreachable:
          return { html: `${UNREACHABLE[outcome.cause] ?? UNREACHABLE_FALLBACK}${DUPLICATE_NOTE}`, retry: true };
        default:
          return { html: UNREACHABLE_FALLBACK, retry: true };
      }
    };

    let sending = false;
    const send = async () => {
      if (sending) return; // one request at a time; the button is disabled too
      sending = true;
      setSendBar({ busy: true });
      const fb = $('#its-feedback');
      fb.removeAttribute('data-outcome');
      setFeedback(fb, 'neutral', 'Sending the incident.');
      let outcome;
      try {
        outcome = await tele.sendBatch(spans, { signal: ctx.signal });
      } catch {
        outcome = { kind: OUTCOME.unreachable, cause: 'invalid' }; // the spans were refused before any request
      }
      sending = false;
      if (ctx.signal.aborted) return; // the level was closed while the request was out
      if (outcome.kind === OUTCOME.accepted && tele.status().state === STATE.connected) {
        SENT.add(incident);
        stepFind(MODE.live);
        return;
      }
      const shown = describe(outcome.kind === OUTCOME.accepted ? { kind: OUTCOME.unreachable, cause: 'not-connected' } : outcome);
      setFeedback(fb, 'error', shown.html);
      fb.setAttribute('data-outcome', outcome.kind);
      setSendBar({ retry: shown.retry, practice: true });
      (shown.retry ? actions.querySelector('#its-retry') : actions.querySelector('#its-switch')).focus();
    };

    // ---- the simulated trace view (practice only): the same spans the game would have sent ----
    const rootStart = spans[0].startMs;
    const failed = (s) => isErrorStatus(s.status);
    const traceView = () => {
      const rows = spans.map((s, i) => [
        `${i === 0 ? '' : '└ '}${s.name}`,
        s.startMs - rootStart,
        s.endMs - s.startMs,
        failed(s) ? 'Error' : 'Unset',
      ]);
      const opens = spans.map((s, i) => button({ id: `its-open-${i}`, label: `Open ${s.name}`, variant: 'ghost' })).join('');
      return panel({
        headHtml: `${chip({ text: 'Simulated', tone: 'attention' })} Trace Explorer. Nothing here is your account.`,
        sections: [
          `<p>${chip({ text: `session.id is ${tele.sessionId}`, tone: 'neutral' })} Trace id: <code id="its-trace">${e(incident.traceId)}</code></p>`,
          table({
            caption: 'Spans of the trace',
            head: ['Span', 'Start (ms)', 'Duration (ms)', 'Status'],
            rows,
            numeric: [1, 2],
          }),
          bar(opens),
          `<div id="its-detail" aria-live="polite" tabindex="-1">${note('Open a span to see its attributes and events.')}</div>`,
        ],
      });
    };

    // The Span Sidebar of the simulation: the span's attributes and events. The one place a fault code is.
    const detail = (s) => {
      const attrs = Object.entries({ ...(s.attributes ?? {}), [SESSION_ATTR]: tele.sessionId }).map(([k, v]) => [k, String(v)]);
      const events = Array.isArray(s.events) ? s.events : [];
      const status = failed(s) ? `Error: ${s.status.message ?? ''}` : 'Unset';
      return panel({
        variant: 'inset',
        headHtml: `<h4 tabindex="-1" id="its-detail-title">${e(s.name)}</h4> ${chip({ text: status, tone: failed(s) ? 'error' : 'neutral' })}`,
        sections: [
          table({ caption: `Attributes of ${s.name}`, head: ['Attribute', 'Value'], rows: attrs }),
          events.length === 0
            ? note('This span has no events.')
            : table({
              caption: `Events of ${s.name}`,
              head: ['Event', 'At (ms)', 'Attributes'],
              rows: events.map((ev) => [
                ev.name,
                ev.timeMs - s.startMs,
                Object.entries(ev.attributes ?? {}).map(([k, v]) => `${k}=${v}`).join(', ') || '-',
              ]),
              numeric: [1],
            }),
        ],
      });
    };

    // ---- find it, then answer ----
    const stepFind = (mode) => {
      const practice = mode === MODE.practice;
      const findIt = practice
        ? traceView()
        : prose(
          '<h4>Find your incident in Dash0</h4>' +
            '<ol>' +
            '<li>Open the Trace Explorer.</li>' +
            `<li>Add a filter: the key <code>${e(SESSION_ATTR)}</code>, the operator <b>is</b>, and your session id <code id="its-session">${e(tele.sessionId)}</code> as the value. ` +
            'If nothing matches, widen the time picker.</li>' +
            '<li>Open the trace in the Trace View. The Waterfall lists its spans; one is in error.</li>' +
            // VERIFY (#195): that the events are listed in the sidebar's "Related Logs & Events" tab.
            '<li>Select that span. The Span Sidebar shows its attributes, and its events under Related Logs &amp; Events.</li>' +
            '</ol>',
        );
      ctx.renderStep(
        screen(
          ctx.speech(
            practice
              ? 'This is the game\'s own save path, as a trace. One of its steps failed. Open the spans and read what is on them.'
              : 'The incident is in your Dash0. Find it the way you would find any trace, then answer from what you read there.',
          ),
          chip(practice ? { text: SIMULATED, tone: 'attention' } : { text: 'Your own Dash0', tone: 'success' }),
          findIt,
          ...QUESTIONS.map((qn) =>
            field({ id: `its-q-${qn.key}`, label: qn.label, autocompleteOff: true, noteHtml: e(qn.note) }) +
            feedback({ id: `its-q-${qn.key}-feedback` })),
          feedback({ id: 'its-feedback' }),
        ),
        bar(
          button({ id: 'its-check', label: 'Check my answers', variant: 'ghost' }) +
            finishButton('its-finish'),
        ),
      );
      if (practice) {
        spans.forEach((s, i) => {
          $(`#its-open-${i}`).onclick = () => {
            const box = $('#its-detail');
            box.innerHTML = detail(s);
            box.querySelector('#its-detail-title').focus();
          };
        });
      }

      const passed = new Set();
      const charged = new Set();
      const check = () => {
        for (const qn of QUESTIONS) {
          if (passed.has(qn.key)) continue;
          const input = $(`#its-q-${qn.key}`);
          const fb = $(`#its-q-${qn.key}-feedback`);
          const value = input.value;
          const grade = gradeAnswer(spans, qn.key, value);
          if (grade === GRADE.pass) {
            passed.add(qn.key);
            input.disabled = true;
            setFeedback(fb, 'success', 'Right.');
          } else if (grade === GRADE.fail) {
            // Each distinct wrong value costs once; pressing Check again over the same value is free.
            const cause = `${qn.key}:${String(value).trim().toLowerCase()}`;
            if (!charged.has(cause)) {
              charged.add(cause);
              ctx.mistake();
            }
            setFeedback(fb, 'error', e(qn.wrong));
          } else {
            setFeedback(fb, 'neutral', e(qn.nudge));
          }
        }
        if (passed.size === QUESTIONS.length) {
          actions.querySelector('#its-check').disabled = true;
          actions.querySelector('#its-finish').disabled = false;
          setFeedback($('#its-feedback'), 'success', 'All four answers are right. That was the game\'s own incident.');
        }
      };
      actions.querySelector('#its-check').onclick = check;
      actions.querySelector('#its-finish').onclick = () =>
        ctx.finish({
          text: practice
            ? 'You found the failing span in a simulated Dash0 trace view, read its fault code and retries and named the trace. Your own Dash0 shows the same thing: filter by your session id, open the trace, read the span in error.'
            : 'You found the game\'s own incident in your own Dash0: you filtered by your session id, opened the trace and read the span in error.',
          cards: [],
        });
      $('#its-q-operation').focus();
    };

    stepStart();
  },
};
