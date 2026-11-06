// Level 9.3: Connect the game to Dash0. The player works out the two things a sender needs, the
// OTLP over HTTP endpoint of an organization and an auth token that may only ingest, enters
// them in a connect form, and sends one test span. The game connects to the player's own Dash0
// (live, not open until INGRESS_HOSTS is filled) or to a simulated one (practice, same stars).
// The token is typed into a secret field, handed to ctx.telemetry.connect and cleared from the
// DOM in the same click; it is never kept, shown or logged by this file (docs/DASH0-LAB.md).
// Spec: https://www.dash0.com/docs/dash0/miscellaneous/glossary/auth-tokens , https://www.dash0.com/docs/dash0/miscellaneous/glossary/endpoints , https://opentelemetry.io/docs/specs/otlp/
// Dash0 docs: auth tokens are `auth_...`, belong to one organization and are created by Admins in
// Settings -> Auth Tokens; the Permissions options are All permissions, Ingesting and Reading;
// "Restrict tokens to Ingesting whenever you distribute them publicly, for example in
// OpenTelemetry instrumentation running in web browsers" (glossary/auth-tokens). The endpoint
// reference is in the organization's settings and its hosts name the region (glossary/endpoints).
// Teaching copy only: the 401 and 403 wording, the endpoint row labels and the Create token button
// of the practice panel are marked VERIFY (#195) below and listed for owner sign-off.
import { PRACTICE_HOSTS, REASONS, TOKEN_PREFIX } from '../lib/dash0/ingress.mjs';
import { OUTCOME, TIMEOUT_MS } from '../lib/otlp/send.mjs';
import { MODE, PRACTICE_READ_ONLY_TOKEN, PRACTICE_TOKEN, STATE } from '../lib/telemetry.mjs';
import { actions as actionsBar, button, chip, feedback, field, note, panel, prose, radio, setFeedback, step } from '../lib/ui/index.mjs';

// The Permissions options of an auth token (glossary/auth-tokens). Only Ingesting is right.
const SCOPES = [
  {
    key: 'all',
    label: 'All permissions',
    token: PRACTICE_TOKEN,
    wrong:
      'That token works, but it can also query your data and change your configuration. ' +
      'A token the game keeps in a browser tab should only send telemetry: Dash0 recommends ' +
      'restricting tokens to Ingesting whenever they sit in code that people can read.',
  },
  {
    key: 'ingest',
    label: 'Ingesting',
    token: PRACTICE_TOKEN,
    right:
      'Right. An Ingesting token can only send telemetry. It cannot read your data back or ' +
      'change your configuration, so a leaked one does little harm.',
  },
  {
    key: 'read',
    label: 'Reading',
    token: PRACTICE_READ_ONLY_TOKEN,
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
  const where = mode === MODE.practice ? 'the simulated Dash0' : 'Dash0';
  switch (outcome.kind) {
    case OUTCOME.accepted:
      return { tone: 'success', html: `${where} accepted the test span.`, retry: false };
    case OUTCOME.rejected:
      if (outcome.auth) {
        // VERIFY (#195): that live Dash0 answers 401 for an unknown token and 403 for a token
        // that may not ingest. Practice teaches this split; the live ingress is not confirmed.
        const html =
          outcome.status === 403
            ? `${where} knows this token but refused the test span (403). The token is not allowed to send telemetry. ` +
              'Create a token with the permission Ingesting.'
            : `${where} did not accept this token (${outcome.status}). Check that you copied all of it, ` +
              'and that it belongs to the organization of this endpoint.';
        return { tone: 'error', html, retry: false };
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
              'A sender needs two things: the <b>OTLP over HTTP endpoint</b> of your organization, and an ' +
              '<b>auth token</b>. Then the game sends one test span, and you will see whether it was accepted.',
          ),
          chip({ text: 'Practice: a simulated Dash0, not your account', tone: 'attention' }),
          prose(
            '<p>Practice shows a simulated Dash0 settings page to read the endpoint from and to create a token in. ' +
              'Nothing leaves this page, and it earns the same stars as your own Dash0.</p>' +
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
    const stepConnect = (mode, keep = {}) => {
      const practice = mode === MODE.practice;
      const host = PRACTICE_HOSTS[0];
      // VERIFY (#195): the row labels of the endpoint reference ("OTLP via gRPC", "OTLP via HTTP")
      // and the Create token button. The docs say the endpoint reference lives in the
      // organization's settings and that tokens are created in Settings -> Auth Tokens.
      const simulated = panel({
        headHtml:
          `${chip({ text: 'Simulated', tone: 'attention' })} Dash0 settings. Nothing here is your account.`,
        sections: [
          prose(
            '<h4>Settings, Endpoints</h4>' +
              '<table><caption>Endpoints of this organization</caption><thead><tr><th scope="col">Name</th><th scope="col">Address</th></tr></thead><tbody>' +
              `<tr><td>OTLP via gRPC</td><td><code id="ctd-ep-grpc">${e(host)}:4317</code></td></tr>` +
              `<tr><td>OTLP via HTTP</td><td><code id="ctd-ep-http">https://${e(host)}</code></td></tr>` +
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
      // VERIFY (#195): the name of the OTLP over HTTP row the live guide asks for.
      // Live: where to look. Cited in the header: the endpoint reference and Auth Tokens are in the
      // organization's Settings, and only Admins create tokens.
      const guide =
        '<p>In Dash0, open the organization settings and find the endpoint reference. Copy the ' +
        'OTLP over HTTP endpoint. Then open Settings, Auth Tokens and create a token ' +
        'with the permission <b>Ingesting</b>. Only Admins can create tokens.</p>';
      ctx.renderStep(
        screen(
          ctx.speech(
            practice
              ? 'Find the endpoint the game should send to, and make a token that can only send. ' +
                  'Two of the three permissions are wrong for this job.'
              : 'Find your endpoint and make a token that can only send.',
          ),
          chip(practice
            ? { text: 'Practice: a simulated Dash0, not your account', tone: 'attention' }
            : { text: 'Your own Dash0', tone: 'success' }),
          practice ? simulated : prose(guide),
          field({
            id: 'ctd-endpoint',
            label: 'OTLP over HTTP endpoint',
            value: keep.endpoint ?? '',
            noteHtml: 'The address of your organization, starting with https://. The game adds the signal path itself.',
          }),
          field({
            id: 'ctd-token',
            label: 'Auth token',
            kind: 'secret',
            noteHtml: `A token looks like <code>${e(TOKEN_PREFIX)}abc123...</code>. It is held in this tab's memory only, ` +
              'cleared from this field the moment you press Connect, and forgotten when you reload the page.',
          }),
          field({
            id: 'ctd-dataset',
            label: 'Dataset (optional)',
            value: keep.dataset ?? '',
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

      // Practice: create a token. A permission other than Ingesting costs one mistake, once each.
      if (practice) {
        let scope = null;
        const charged = new Set();
        const mintFb = $('#ctd-mint-feedback');
        for (const s of SCOPES) $(`#ctd-scope-${s.key}`).onclick = () => { scope = s; };
        $('#ctd-mint').onclick = () => {
          if (!scope) {
            setFeedback(mintFb, 'neutral', 'Pick a permission first.');
            return;
          }
          if (scope.wrong) {
            if (!charged.has(scope.key)) ctx.mistake();
            charged.add(scope.key);
          }
          minted.textContent = scope.token; // the public practice token, only ever shown here
          mintedRow.removeAttribute('hidden');
          setFeedback(mintFb, scope.wrong ? 'error' : 'success', scope.wrong ?? scope.right);
        };
      }

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
        // Only the player's own token counts against them, and only against a real account.
        if (outcome.kind === OUTCOME.rejected && outcome.auth && mode === MODE.live) ctx.mistake();
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
        const verdict = tele.connect({ mode, endpoint, token, dataset });
        if (!verdict.ok) {
          // An empty token is a nudge, not a wrong answer; any other bad input costs one mistake.
          if (verdict.reason !== 'empty') ctx.mistake();
          say('error', `${connectProblem(e, verdict)} Nothing was sent.`);
          return;
        }
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
              '<p>The token lives in this tab\'s memory only. It was cleared from the form, and a page reload drops the ' +
              'connection. Levels you finish from now on send a <code>level.complete</code> span to the same place.</p>',
          ),
        ),
        bar(button({ id: 'ctd-finish', label: 'Finish', variant: 'primary', finish: true })),
      );
      actions.querySelector('#ctd-finish').onclick = () =>
        ctx.finish({
          text: practice
            ? 'You read the OTLP over HTTP endpoint off the settings page, created a token that can only ingest and got a test span accepted by a simulated Dash0. Your own Dash0 takes the same two steps.'
            : 'The game is connected to your Dash0: the endpoint was right, the token can only ingest and the test span was accepted.',
          cards: [],
        });
    };

    stepMode();
  },
};
