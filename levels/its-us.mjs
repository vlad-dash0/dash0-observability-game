// Act 9 boss: It's us. The game holds an incident of its own, a failing save in the player's session, as
// one trace. Connected to the player's Dash0 it sends that incident once and the player finds it there
// (filter by their session id, open the trace, read the span in error). Not connected, or in practice,
// the game simulates a Trace Explorer: six traces from six sessions, the player's among them, and the
// player filters by their session id to find theirs. Either way the questions are graded by
// gradeAnswer against the player's own spans (lib/incident-lab.mjs, docs/DASH0-LAB.md invariant I5).
// The fault code is only ever in the attributes of the failing span, as in Dash0: live shows no trace
// at all, so it is nowhere on the page; practice shows it only after that span is opened, and the trace
// id only inside an opened trace.
// Spec: https://opentelemetry.io/docs/specs/otel/trace/api/#add-events , https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-spans/
// Spec: https://opentelemetry.io/docs/specs/semconv/registry/attributes/session/ (session.id)
// Spec: https://www.dash0.com/docs/dash0/telemetry/tracing/about-tracing , https://www.dash0.com/docs/dash0/telemetry/tracing/view , https://www.dash0.com/docs/dash0/telemetry/tracing/span-sidebar
// Spec: https://www.dash0.com/docs/dash0/telemetry/tracing/span-events , https://www.dash0.com/docs/dash0/miscellaneous/glossary/filtering
// Dash0 docs: the Trace Explorer has a Filter (pick a key, an operator and a value), a Time Picker and a
// Span Table; the Trace View shows one trace as a Waterfall ("Visualize the full trace"); selecting a span
// opens the Span Sidebar with its Attributes and its span events (telemetry/tracing/*, glossary/filtering).
// Not on a Dash0 page, so marked VERIFY (#195) below: that a session.id attribute set by the sender is
// filterable as a key.
// The practice view is the game's own simulation of those pages and says so on every screen.
//
// The token never comes into this file: connecting is level 9.3's job (and the game is connected
// or it is not). The boss reads ctx.telemetry.status(), sends with sendBatch and shows what came back.
import { isErrorStatus, RESOURCE_ATTRIBUTES, SESSION_ATTR } from '../lib/otlp/encode.mjs';
import { OUTCOME, TIMEOUT_MS } from '../lib/otlp/send.mjs';
import {
  answersFrom, buildTraceList, FILTER_KEY, FILTER_OP, gradeAnswer, GRADE, matchTraces, normaliseAnswer, QUESTION,
} from '../lib/incident-lab.mjs';
import { MODE, STATE } from '../lib/telemetry.mjs';
import {
  actions as actionsBar, button, chip, feedback, field, finishButton, note, panel, prose, radio, radioGroup, reason, setFeedback, step, table,
} from '../lib/ui/index.mjs';

// Incidents already accepted by a Dash0 in this page's session (one per telemetry session), and the
// host that took them. Keyed by the incident object the session caches, so a second open of the boss
// does not send again to the same Dash0, and a different Dash0 is offered the send.
const SENT = new WeakMap(); // incident -> Set of the hosts that took it
// Incidents a send was ever started for. An attempt may have got through (the level can close before the
// answer), so a later send screen must not say "not sent yet".
const ATTEMPTED = new WeakSet();

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
    label: 'What is the trace ID?',
    note: 'The id of the whole trace: 32 hexadecimal characters.',
    nudge: 'A trace ID is 32 characters, 0 to 9 and a to f.',
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
  ' If an earlier attempt did get through, Dash0 may list each span of the trace twice, with the same ids; read one copy. Your answers are the same either way.';

const KEY_ORDER = [FILTER_KEY.serviceName, FILTER_KEY.sessionId, FILTER_KEY.spanName];
const OP_ORDER = [FILTER_OP.is, FILTER_OP.isNot];
const clockOf = (ms) => new Date(ms).toISOString().slice(11, 19);
const slug = (v) => v.replace(/\W+/g, '-');

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
        ), note('Use Back to return to the map.')),
        bar(''),
      );
      return;
    }
    const spans = incident.spans;

    // ---- the first screen depends on what the session is ----
    const stepStart = () => {
      const { state, mode, host } = tele.status();
      if (state === STATE.connected && mode === MODE.live) {
        if (SENT.get(incident)?.has(host)) stepFind(MODE.live);
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
        : 'Your own Dash0 needs a connection from level 9.3 first, and connecting to your own Dash0 is not available in this browser. Practice works the same way.';
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
            button({ id: 'its-live', label: 'Use my own Dash0', variant: 'ghost', disabled: true }) +
            reason({ id: 'its-live-reason', text: tele.liveAvailable() ? 'Connect in level 9.3 first.' : 'Not available in this browser.' }),
        ),
      );
      actions.querySelector('#its-practice').onclick = () => stepFind(MODE.practice);
    };

    // ---- connected live: send the incident once ----
    const stepSend = () => {
      const { host } = tele.status();
      const elsewhere = [...(SENT.get(incident) ?? [])];
      let lead;
      if (elsewhere.length > 0) {
        lead = `The game sent this incident to ${elsewhere.map(e).join(' and ')} earlier. This is a different Dash0, so it has not got it yet. Send it here, then find it there.`;
      } else if (ATTEMPTED.has(incident)) {
        lead = 'The game keeps a trace of its own save path, and one step of it failed. An earlier attempt to send it may have got through; ' +
          'the game cannot tell. Send it to your Dash0, then find it there.';
      } else {
        lead = 'The game keeps a trace of its own save path, and one step of it failed. It has not been sent yet. ' +
          'Send it to your Dash0, then find it there.';
      }
      const duplicate = elsewhere.length === 0 && ATTEMPTED.has(incident);
      ctx.renderStep(
        screen(
          ctx.speech(lead),
          chip({ text: `Your own Dash0: ${host ?? ''}`, tone: 'success' }),
          prose(
            `<p>This sends one trace of five spans. Every span carries your session id, <code id="its-session">${e(tele.sessionId)}</code>, ` +
              'as <code>session.id</code>, so you can pick your own out of everything else in your Dash0. Press the button once; ' +
              'the game does not send it again on its own.</p>' +
              (duplicate ? `<p id="its-duplicate">${e(DUPLICATE_NOTE.trim())}</p>` : ''),
          ),
          feedback({ id: 'its-feedback' }),
        ),
        bar(button({ id: 'its-send', label: 'Send the incident to Dash0', variant: 'primary' })),
      );
      actions.querySelector('#its-send').onclick = send;
    };

    // The bar of the send screen: the send button (pending or not), plus the ways out of a failure.
    // After any failed outcome the send button stays disabled: the way on is a retry, if one is offered,
    // or practice, never the same press with the same refused token.
    const setSendBar = ({ busy = false, failed = false, retry = false } = {}) => {
      actions.innerHTML = bar(
        button({ id: 'its-send', label: 'Send the incident to Dash0', variant: 'primary', disabled: busy || failed }) +
          (retry ? button({ id: 'its-retry', label: 'Send the incident again', variant: 'primary' }) : '') +
          (failed ? button({ id: 'its-switch', label: 'Practice instead', variant: 'ghost' }) : ''),
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
      ATTEMPTED.add(incident); // from here an attempt may have got through, whatever the player sees next
      const target = tele.status().host;
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
      const now = tele.status();
      if (outcome.kind === OUTCOME.accepted && now.state === STATE.connected && now.host === target) {
        SENT.set(incident, new Set([...(SENT.get(incident) ?? []), target]));
        stepFind(MODE.live);
        return;
      }
      const shown = describe(outcome.kind === OUTCOME.accepted ? { kind: OUTCOME.unreachable, cause: 'not-connected' } : outcome);
      setFeedback(fb, 'error', shown.html);
      fb.setAttribute('data-outcome', outcome.kind);
      setSendBar({ failed: true, retry: shown.retry });
      (shown.retry ? actions.querySelector('#its-retry') : actions.querySelector('#its-switch')).focus();
    };

    // ---- the simulated Trace Explorer (practice only): several sessions' traces, the player's among them ----
    const failed = (s) => isErrorStatus(s.status);
    let traces = null; // built on the first practice screen; the same list for every redraw
    let applied = null; // the filter in force: {key, op, value}
    let form = { key: FILTER_KEY.serviceName, op: FILTER_OP.is, value: '' };
    let filtered = false; // the player did filter by their own session id
    const checked = (name) => [...body.querySelectorAll(`input[name="${name}"]`)].find((i) => i.checked)?.value;

    const filterForm = () => {
      const keys = KEY_ORDER.map((k) =>
        radio({ id: `its-fkey-${slug(k)}`, name: 'its-fkey', value: k, labelHtml: `<code>${e(k)}</code>`, checked: k === form.key })).join('');
      const ops = OP_ORDER.map((o) =>
        radio({ id: `its-fop-${slug(o)}`, name: 'its-fop', value: o, labelHtml: e(o), checked: o === form.op })).join('');
      return radioGroup({ legend: 'Filter: key', itemsHtml: keys }) +
        radioGroup({ legend: 'Filter: operator', itemsHtml: ops }) +
        field({ id: 'its-fvalue', label: 'Filter: value', autocompleteOff: true, value: form.value }) +
        feedback({ id: 'its-filter-feedback' }) +
        bar(
          button({ id: 'its-filter-apply', label: 'Apply filter', variant: 'primary' }) +
            (applied ? button({ id: 'its-filter-clear', label: 'Clear filter', variant: 'ghost' }) : ''),
        );
    };

    // The heading text is focusable (tabindex -1) so a screen-reader or keyboard user lands where the task is.
    const explorerHead = (what, id) => `${chip({ text: 'Simulated', tone: 'attention' })} <span id="${id}" tabindex="-1">${what}</span>. Nothing here is your account.`;

    const showList = () => {
      const shown = applied ? matchTraces(traces, applied) : traces;
      const rows = shown.map((t, i) => [
        i + 1,
        t.spans[0].name,
        clockOf(t.spans[0].startMs),
        t.spans[0].endMs - t.spans[0].startMs,
        t.spans.length,
        t.spans.some(failed) ? 'Error' : 'Unset',
      ]);
      const summary = applied
        ? `${shown.length} ${shown.length === 1 ? 'trace matches' : 'traces match'}: ${e(applied.key)} ${e(applied.op)} ${e(applied.value)}.`
        : `${shown.length} traces.`;
      const box = $('#its-explorer');
      box.innerHTML = panel({
        headHtml: explorerHead('Trace Explorer', 'its-explorer-title'),
        sections: [
          `<p>Your session id: <code id="its-session">${e(tele.sessionId)}</code></p>`,
          filterForm(),
          shown.length === 0
            ? `<p id="its-results" tabindex="-1" aria-live="polite">No traces match. Check the key, the operator and the value; nothing is charged for a filter.</p>`
            : `<p id="its-results" tabindex="-1" aria-live="polite">${summary}</p>` +
              table({
                caption: 'Traces',
                head: ['No.', 'Root operation', 'Start (UTC)', 'Duration (ms)', 'Spans', 'Status'],
                rows,
                numeric: [0, 2, 3, 4],
              }) +
              bar(shown.map((_, i) => button({ id: `its-open-trace-${i}`, label: `Open trace ${i + 1}`, variant: 'ghost' })).join('')),
        ],
      });
      $('#its-filter-apply').onclick = () => {
        const key = checked('its-fkey');
        const op = checked('its-fop');
        const value = $('#its-fvalue').value.trim();
        form = { key, op, value };
        if (value === '') {
          setFeedback($('#its-filter-feedback'), 'neutral', 'Type a value to filter by.');
          return;
        }
        applied = { key, op, value };
        if (key === FILTER_KEY.sessionId && op === FILTER_OP.is && value === tele.sessionId) filtered = true;
        showList();
        $('#its-results').focus();
      };
      const clear = $('#its-filter-clear');
      if (clear) {
        clear.onclick = () => {
          applied = null;
          form = { key: FILTER_KEY.serviceName, op: FILTER_OP.is, value: '' };
          showList();
          $('#its-results').focus();
        };
      }
      shown.forEach((t, i) => {
        $(`#its-open-trace-${i}`).onclick = () => showTrace(t);
      });
    };

    // The Trace View of the simulation: one trace's spans. The trace id is shown here, as in Dash0.
    const showTrace = (t) => {
      const root = t.spans[0];
      const rows = t.spans.map((s, i) => [
        s.name,
        i === 0 ? '-' : root.name,
        s.startMs - root.startMs,
        s.endMs - s.startMs,
        failed(s) ? 'Error' : 'Unset',
      ]);
      const opens = t.spans.map((s, i) => button({ id: `its-open-${i}`, label: `Open ${s.name}`, variant: 'ghost' })).join('');
      $('#its-explorer').innerHTML = panel({
        headHtml: explorerHead('Trace View', 'its-trace-title'),
        sections: [
          `<p>Trace ID: <code id="its-trace">${e(t.traceId)}</code></p>`,
          table({
            caption: 'Spans of the trace',
            head: ['Span', 'Parent', 'Start (ms)', 'Duration (ms)', 'Status'],
            rows,
            numeric: [2, 3],
          }),
          bar(opens),
          `<div id="its-detail" aria-live="polite" tabindex="-1">${note('Open a span to see its attributes and events.')}</div>`,
          bar(button({ id: 'its-back', label: 'Back to the trace list', variant: 'ghost' })),
        ],
      });
      $('#its-trace-title').focus();
      t.spans.forEach((s, i) => {
        $(`#its-open-${i}`).onclick = () => {
          const box = $('#its-detail');
          box.innerHTML = detail(s, t);
          box.querySelector('#its-detail-title').focus();
        };
      });
      $('#its-back').onclick = () => {
        showList();
        $('#its-results').focus();
      };
    };

    // The Span Sidebar of the simulation: the span's attributes and events. The one place a fault code is.
    const detail = (s, t) => {
      const attrs = Object.entries({ ...(s.attributes ?? {}), ...RESOURCE_ATTRIBUTES, [SESSION_ATTR]: t.sessionId }).map(([k, v]) => [k, String(v)]);
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
      if (practice && traces === null) traces = buildTraceList(incident, { sessionId: tele.sessionId });
      const findIt = practice
        ? '<div id="its-explorer"></div>'
        : prose(
          '<h4>Find your incident in Dash0</h4>' +
            '<ol>' +
            '<li>Open the Trace Explorer.</li>' +
            // VERIFY (#195): that a session.id span attribute set by the sender is offered as a filter key.
            `<li>Add a filter: the key <code>${e(SESSION_ATTR)}</code>, the operator <b>is</b>, and your session id <code id="its-session">${e(tele.sessionId)}</code> as the value. ` +
            'If nothing matches, widen the Time Picker.</li>' +
            '<li>Open the trace and choose Visualize the full trace. The Waterfall lists its spans; one is in error.</li>' +
            '<li>Choose that span. The Span Sidebar shows its attributes, and its span events.</li>' +
            '</ol>',
        );
      ctx.renderStep(
        screen(
          ctx.speech(
            practice
              ? 'Several sessions saved their progress, and in one of them a step of the save path failed. That session is yours. Find your trace, then open its spans and read what is on them.'
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
      if (practice) showList();

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
            const cause = `${qn.key}:${normaliseAnswer(qn.key, value)}`;
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
            ? (filtered
              ? 'You filtered a simulated Dash0 Trace Explorer by your session id, opened your trace and read the span in error. Your own Dash0 works the same way.'
              : 'You found your trace in a simulated Dash0 Trace Explorer without the filter. Filtering by session.id is quicker, and it is how you find your own telemetry in your own Dash0.')
            : 'You found the game\'s own incident in your own Dash0: you filtered by your session id, opened the trace and read the span in error.',
          cards: [],
        });
      // Practice: the task starts in the explorer, not in the first answer field.
      (practice ? $('#its-explorer-title') : $('#its-q-operation')).focus({ preventScroll: true }); // a new step opens at its top (#331)
    };

    stepStart();
  },
};
