// Level 9.3: Connect the game to Dash0. The player works out the two things a sender needs, the
// endpoint of an organization (the one a browser can use) and an auth token that may only ingest, enters
// them in a connect form, and sends one test span. The game connects to the player's own Dash0
// (live, not open until INGRESS_HOSTS is filled) or to a simulated one (practice, scored the same:
// a wrong permission, a bad form and a rejected token each cost one mistake, once per distinct cause).
// The token is typed into a secret field, handed to ctx.telemetry.connect and cleared from the
// DOM in the same click; it is never kept, shown or logged by this file (docs/DASH0-LAB.md).
// Spec: https://www.dash0.com/docs/dash0/miscellaneous/glossary/auth-tokens , https://www.dash0.com/docs/dash0/miscellaneous/glossary/endpoints , https://www.dash0.com/docs/dash0/miscellaneous/glossary/datasets , https://opentelemetry.io/docs/specs/otlp/
// Dash0 docs: auth tokens are `auth_...`, belong to one organization and are created by Admins in
// Settings -> Auth Tokens; the Permissions options are All permissions, Ingesting and Reading;
// "Restrict tokens to Ingesting whenever you distribute them publicly, for example in
// OpenTelemetry instrumentation running in web browsers" (glossary/auth-tokens). The endpoint
// reference is in the organization's settings and its hosts name the region (glossary/endpoints).
// Teaching copy only: the endpoint row labels and the Create token button of the practice panel,
// and the 401 and 403 behaviour practice simulates, are marked VERIFY (#195) below and listed for
// owner sign-off.
import { PRACTICE_HOSTS, REASONS, TOKEN_PREFIX } from '../lib/dash0/ingress.mjs';
import { OUTCOME, TIMEOUT_MS } from '../lib/otlp/send.mjs';
import { MODE, STATE } from '../lib/telemetry.mjs';
import { actions as actionsBar, button, chip, feedback, field, note, panel, prose, radio, setFeedback, step } from '../lib/ui/index.mjs';

// The Permissions options of an auth token (glossary/auth-tokens). Only Ingesting is right. The
// keys are the telemetry session's PRACTICE_SCOPE values (it mints the practice token per key).
const SCOPES = [
  {
    key: 'all',
    label: 'All permissions',
    wrong:
      'That token works, but it can also query your data and change your configuration. ' +
      'Dash0 recommends Ingesting-only tokens whenever you distribute a token publicly, ' +
      'for example in browser instrumentation.',
  },
  {
    key: 'ingest',
    label: 'Ingesting',
    right:
      'Right. An Ingesting token can only send telemetry. It cannot read your data back or ' +
      'change your configuration, so a leaked one does little harm.',
  },
  {
    key: 'read',
    label: 'Reading',
    wrong:
      'A Reading token can only query data. It cannot send telemetry, so Dash0 will refuse the ' +
      'test span. Create an Ingesting token instead.',
  },
];

const FIELD_NAME = { endpoint: 'Endpoint', token: 'Token', dataset: 'Dataset' };

// Why a send failed, by what came back. `auth` rejections are the token's fault; the rest are
// the network's or Dash0's, which never costs a star.
const UNREACHABLE = {
  network:
    'The request never got an answer. In a browser that can be a wrong host, a CORS refusal or ' +
    "the page's Content Security Policy, and the browser cannot tell them apart.",
  timeout: `There was no answer within ${TIMEOUT_MS / 1000} seconds.`,
  opaque: 'Something answered, but not with a usable HTTP response.',
  aborted: 'The request was cancelled before it finished.',
};
const UNREACHABLE_FALLBACK = 'The game is not connected, so the test span was not sent.';

/** The feedback for a failed connect: {field, reason} from ctx.telemetry.connect, as plain words. */
function connectProblem(e, { field: which, reason }) {
  if (which === 'mode') {
    return reason === 'unavailable'
      ? 'Live mode is not open yet. Use practice: it works the same way.'
      : 'That mode is not known.';
  }
  const why = REASONS[reason] ?? 'That could not be checked.';
  return `${FIELD_NAME[which] ?? 'Input'}: ${e(why)}`;
}

/** The tone, words and whether to offer a retry for an outcome of the test span. */
function describeOutcome(outcome, mode) {
  const where = mode === MODE.practice ? 'The simulated Dash0' : 'Dash0';
  switch (outcome.kind) {
    case OUTCOME.accepted:
      return { tone: 'success', html: `${where} accepted the test span.`, retry: false };
    case OUTCOME.rejected:
      if (outcome.auth) {
        // VERIFY (#195): that live Dash0 answers 401 for an unknown token and 403 for a token that
        // may not ingest. Practice simulates both; no Dash0 page says it, so the copy does not
        // split them: either way the remedy is the same three checks.
        return {
          tone: 'error',
          html: `${where} refused this token and would not take the test span. Check that you copied all of ` +
            'the token, that it is from this organization, and that it has the Ingesting permission.',
          retry: false,
        };
      }
      return {
        tone: 'error',
        html: `${where} refused the test span (HTTP ${Number(outcome.status)}).`,
        retry: true,
        message: outcome.message,
      };
    case OUTCOME.unreachable:
      return { tone: 'error', html: UNREACHABLE[outcome.cause] ?? UNREACHABLE_FALLBACK, retry: true };
    default:
      return { tone: 'error', html: UNREACHABLE_FALLBACK, retry: true };
  }
}

export default {
  id: 'connect-to-dash0',
  no: '9.3',
  name: 'Connect the game to Dash0',
  sub: 'The endpoint and a token that can only send',
  icon: '\u{1F50C}',
  rewardTitle: 'Connected',
  mechanics: ['configure'],
  // It builds its own form from the UI kit; none of the shared widgets is on a screen here.
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

    if (!tele) {
      ctx.renderStep(
        screen(ctx.speech('The game has no telemetry session in this build, so there is nothing to connect.')),
        bar(button({ id: 'ctd-none', label: 'Close this level', variant: 'ghost', disabled: true })),
      );
      return;
    }

    // ---- screen 1: practice or live ----
    const stepMode = () => {
      const live = tele.liveAvailable();
      ctx.renderStep(
        screen(
          ctx.speech(
            'Every level so far ran against a simulation. This one connects the game to a Dash0. ' +
              'A sender needs two things: the <b>endpoint</b> of your organization, and an <b>auth token</b>. ' +
              'The game sends from a browser tab. Then it sends one test span, and you will see whether it was accepted.',
          ),
          chip({ text: 'Practice: a simulated Dash0, not your account', tone: 'attention' }),
          prose(
            '<p>Practice shows a simulated Dash0 settings page to read the endpoint from and to create a token in. ' +
              'Nothing leaves this page, and it is scored the same way as your own Dash0.</p>' +
              (live
                ? '<p>Your own Dash0: the game sends one test span, and a level-complete span for each level you finish ' +
                  'until you reload the page, to the endpoint you enter. Nothing goes to the game\'s servers.</p>'
                : '<p>Your own Dash0 is not open yet. Practice works the same way.</p>'),
          ),
        ),
        bar(
          button({ id: 'ctd-practice', label: 'Practice with a simulated Dash0', variant: 'primary' }) +
            button({ id: 'ctd-live', label: 'Use my own Dash0', variant: 'ghost', disabled: !live }),
        ),
      );
      actions.querySelector('#ctd-practice').onclick = () => stepConnect(MODE.practice);
      actions.querySelector('#ctd-live').onclick = () => stepConnect(MODE.live);
    };

    // ---- screen 2: find the endpoint, make a token, connect ----
    const stepConnect = (mode) => {
      const practice = mode === MODE.practice;
      const host = PRACTICE_HOSTS[0];
      // VERIFY (#195): the row labels of the endpoint reference ("OTLP over gRPC", "OTLP over HTTP")
      // and the Create token button. The docs say the endpoint reference lives in the
      // organization's settings and that tokens are created in Settings -> Auth Tokens.
      const simulated = panel({
        headHtml:
          `${chip({ text: 'Simulated', tone: 'attention' })} Dash0 settings. Nothing here is your account.`,
        sections: [
          prose(
            '<h4>Settings, Endpoints</h4>' +
              '<table><caption>Endpoints of this organization</caption><thead><tr><th scope="col">Name</th><th scope="col">Address</th></tr></thead><tbody>' +
              `<tr><td>OTLP over gRPC</td><td><code id="ctd-ep-grpc">https://${e(host)}:4317</code></td></tr>` +
              `<tr><td>OTLP over HTTP</td><td><code id="ctd-ep-http">https://${e(host)}</code></td></tr>` +
              '</tbody></table>',
          ),
          '<h4>Settings, Auth Tokens: create a token</h4>' +
            '<p>Permissions</p>' +
            SCOPES.map((s) =>
              radio({ id: `ctd-scope-${s.key}`, name: 'ctd-scope', value: s.key, labelHtml: s.label })).join('') +
            `<p>${button({ id: 'ctd-mint', label: 'Create token', variant: 'ghost' })}</p>` +
            feedback({ id: 'ctd-mint-feedback' }) +
            '<div id="ctd-minted-row" hidden>Your new token: <code id="ctd-minted"></code></div>',
        ],
      });
      // Live: where to look, without naming the answer. Cited in the header: the endpoint
      // reference and Auth Tokens are in the organization's Settings, and only Admins create tokens.
      const guide =
        '<p>In Dash0, open the organization settings and find the endpoint reference. Copy the ' +
        'endpoint the game should send to. Then open Settings, Auth Tokens and create a token ' +
        'for this job. Only Admins can create tokens.</p>';
      // Live cannot see a token's permission, so the player says which one they gave it. It is
      // charged by the same rule as the practice mint (chargeScope below).
      const liveScope =
        '<p>Which permission did you give this token?</p>' +
        SCOPES.map((s) => radio({ id: `ctd-scope-${s.key}`, name: 'ctd-scope', value: s.key, labelHtml: s.label })).join('') +
        feedback({ id: 'ctd-scope-feedback' });
      ctx.renderStep(
        screen(
          ctx.speech(
            practice
              ? 'Find the endpoint the game should send to, and make a token for the job. ' +
                  'The token will sit in a browser tab that anyone can open with dev tools.'
              : 'Find your endpoint and make a token for the job. ' +
                  'The token will sit in a browser tab that anyone can open with dev tools.',
          ),
          chip(practice
            ? { text: 'Practice: a simulated Dash0, not your account', tone: 'attention' }
            : { text: 'Your own Dash0', tone: 'success' }),
          practice ? simulated : prose(guide),
          field({
            id: 'ctd-endpoint',
            label: 'Endpoint',
            autocompleteOff: true,
            noteHtml: 'The address of your organization, copied exactly as Dash0 shows it. The game adds the signal path itself.',
          }),
          field({
            id: 'ctd-token',
            label: 'Auth token',
            kind: 'secret',
            noteHtml: `A token looks like <code>${e(TOKEN_PREFIX)}abc123...</code>. The game keeps it only in this tab's ` +
              'memory and never saves it: it is cleared from this field the moment you press Connect and forgotten ' +
              'when you reload the page. Your browser may offer to save it. Decline.',
          }),
          practice ? '' : liveScope,
          field({
            id: 'ctd-dataset',
            label: 'Dataset (optional)',
            noteHtml: "Leave it empty to use the token's default ingestion dataset.",
          }),
          practice ? '' : note('The test span is named <code>connection.test</code>, and carries your session id and nothing you typed.'),
          feedback({ id: 'ctd-feedback' }),
        ),
        bar(button({ id: 'ctd-connect', label: 'Connect and send a test span', variant: 'primary' })),
      );

      const fb = $('#ctd-feedback');
      const say = (tone, html) => setFeedback(fb, tone, html);
      const endpointEl = $('#ctd-endpoint');
      const tokenEl = $('#ctd-token');
      const datasetEl = $('#ctd-dataset');
      const minted = practice ? $('#ctd-minted') : null;
      const mintedRow = practice ? $('#ctd-minted-row') : null;
      endpointEl.focus();

      // The shown practice token goes with the secret field: after Connect it is gone from the page.
      const scrub = () => {
        if (!practice) return;
        minted.textContent = '';
        mintedRow.setAttribute('hidden', '');
      };

      // The actions bar: Connect, plus a retry (a send that failed through no fault of the token)
      // and, for a live connection that could not be reached, a way into practice.
      const setActions = ({ busy = false, retry = false, toPractice = false } = {}) => {
        actions.innerHTML = bar(
          button({ id: 'ctd-connect', label: 'Connect and send a test span', variant: 'primary', disabled: busy }) +
            (retry ? button({ id: 'ctd-retry', label: 'Send the test span again', variant: 'ghost', disabled: busy }) : '') +
            (toPractice ? button({ id: 'ctd-switch', label: 'Practice instead', variant: 'ghost' }) : ''),
        );
        actions.querySelector('#ctd-connect').onclick = onConnect;
        const again = actions.querySelector('#ctd-retry');
        if (again) again.onclick = send;
        const sw = actions.querySelector('#ctd-switch');
        if (sw) sw.onclick = () => stepConnect(MODE.practice);
      };

      // One charge rule for everything the player gets wrong here: each distinct cause costs one
      // mistake, once. A cause is a permission (`scope:<key>`), a form error (`<field>:<reason>`) or a
      // rejected token (`rejected:<status>`).
      const charged = new Set();
      const charge = (cause) => {
        if (charged.has(cause)) return;
        charged.add(cause);
        ctx.mistake();
      };

      let scope = null;
      for (const s of SCOPES) $(`#ctd-scope-${s.key}`).onclick = () => { scope = s; };
      // A permission other than Ingesting is a mistake; `fbEl` says why.
      const declareScope = (fbEl) => {
        if (scope.wrong) charge(`scope:${scope.key}`);
        setFeedback(fbEl, scope.wrong ? 'error' : 'success', scope.wrong ?? scope.right);
      };

      // Practice: create a token. The token's name does not say what it can do.
      if (practice) {
        const mintFb = $('#ctd-mint-feedback');
        $('#ctd-mint').onclick = () => {
          if (!scope) {
            setFeedback(mintFb, 'neutral', 'Pick a permission first.');
            return;
          }
          minted.textContent = tele.practiceCredential(scope.key); // a public practice token, only ever shown here
          mintedRow.removeAttribute('hidden');
          declareScope(mintFb);
        };
      }

      // The last reason shown for a bad form or a rejected token, kept when the next press has
      // nothing new to say (an emptied token field).
      let lastProblem = false;

      const send = async () => {
        setActions({ busy: true });
        fb.removeAttribute('data-outcome');
        say('neutral', 'Sending the test span.');
        const outcome = await tele.sendTest({ signal: ctx.signal });
        if (ctx.signal.aborted) return; // the level was closed while the request was out
        // "Connected?" has one answer: the session's own state, never the outcome alone.
        if (outcome.kind === OUTCOME.accepted && tele.status().state === STATE.connected) {
          stepConnected();
          return;
        }
        const shown = describeOutcome(
          outcome.kind === OUTCOME.accepted ? { kind: OUTCOME.unreachable, cause: 'not-connected' } : outcome,
          mode,
        );
        // Only the player's own token counts against them: the network's and Dash0's faults do not.
        if (outcome.kind === OUTCOME.rejected && outcome.auth) charge(`rejected:${outcome.status}`);
        lastProblem = outcome.kind === OUTCOME.rejected && outcome.auth;
        const message = shown.message ? ` Dash0 said: ${e(shown.message)}` : '';
        say(shown.tone, `${shown.html}${message}`);
        fb.setAttribute('data-outcome', outcome.kind);
        setActions({ retry: shown.retry, toPractice: !practice && outcome.kind === OUTCOME.unreachable });
        (shown.retry ? actions.querySelector('#ctd-retry') : endpointEl).focus();
      };

      function onConnect() {
        // The token leaves the field before anything else happens, and never comes back.
        const token = tokenEl.value;
        tokenEl.value = '';
        scrub();
        const endpoint = endpointEl.value;
        const dataset = datasetEl.value;
        if (endpoint.trim() === '') {
          say('neutral', 'Enter the endpoint first. Nothing was sent.');
          return;
        }
        if (!practice) {
          if (!scope) {
            say('neutral', 'Say which permission you gave the token first. Nothing was sent.');
            return;
          }
          declareScope($('#ctd-scope-feedback'));
        }
        const verdict = tele.connect({ mode, endpoint, token, dataset });
        if (!verdict.ok) {
          // An emptied token field is a nudge, not a wrong answer, and keeps the last useful reason.
          if (verdict.reason === 'empty' && lastProblem) return;
          if (verdict.reason !== 'empty') {
            charge(`${verdict.field}:${verdict.reason}`);
            lastProblem = true;
          }
          fb.removeAttribute('data-outcome');
          say('error', `${connectProblem(e, verdict)} Nothing was sent.`);
          return;
        }
        lastProblem = false;
        send();
      }

      actions.querySelector('#ctd-connect').onclick = onConnect;
    };

    // ---- screen 3: connected ----
    const stepConnected = () => {
      const status = tele.status();
      const practice = status.mode === MODE.practice;
      ctx.renderStep(
        screen(
          ctx.speech(
            practice
              ? 'Connected to the simulated Dash0. The test span was accepted. Nothing left this page.'
              : 'Connected. Your Dash0 accepted the test span.',
          ),
          chip(practice
            ? { text: 'Practice: a simulated Dash0, not your account', tone: 'attention' }
            : { text: `Connected to ${status.host ?? ''}`, tone: 'success' }),
          prose(
            `<p>Session id: <code id="ctd-session">${e(tele.sessionId)}</code>. Every span the game sends carries it as ` +
              '<code>session.id</code>, so you can find your own among everyone else\'s.</p>' +
              '<p>The game keeps the token only in this tab\'s memory. It was cleared from the form, and a page reload drops the ' +
              'connection. Levels you finish from now on send a <code>level.complete</code> span to the same place.</p>',
          ),
        ),
        bar(button({ id: 'ctd-finish', label: 'Finish', variant: 'primary', finish: true })),
      );
      actions.querySelector('#ctd-finish').onclick = () =>
        ctx.finish({
          text: practice
            ? 'You read the endpoint off the settings page, created a token that can only ingest and got a test span accepted by a simulated Dash0. Your own Dash0 takes the same two steps.'
            : 'The game is connected to your Dash0: the endpoint was right, the token can only ingest and the test span was accepted.',
          cards: [],
        });
    };

    stepMode();
  },
};
