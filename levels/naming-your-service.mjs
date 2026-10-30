// Level 1.2: Naming your service. The checkout service ships without a name and shows
// up as unknown_service:node; the player spots the fallback, fixes the .env with the
// level 1.2 checker (lib/widgets/env-config.mjs), then answers which name wins when
// OTEL_SERVICE_NAME and service.name in OTEL_RESOURCE_ATTRIBUTES disagree.
// Spec: docs/FOUNDATION.md §5 and §6 F6. Player text reaches HTML only via escapeHtml.
import { checkConfig, effectiveResource, parseEnv, renderIssues } from '../lib/widgets/env-config.mjs';

const TARGET = { serviceName: 'checkout', environment: 'production' };
const PROCESS = { processName: 'node' };

const GIVEN_ENV = [
  'OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318',
  'OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production',
].join('\n');

const CLASH_ENV = [
  'OTEL_SERVICE_NAME=checkout',
  'OTEL_RESOURCE_ATTRIBUTES=service.name=cart,service.version=1.4.2,deployment.environment.name=production',
].join('\n');

// Step 1: what the given config shows up as. `why` follows "Right." or "Not quite.".
const SHOWS_UP_AS = [
  {
    key: 'name',
    label: '<code>checkout</code>',
    why: 'Nothing in this config says checkout. The SDK does not guess a name from the repository, the image or the host.',
  },
  {
    key: 'fallback',
    label: '<code>unknown_service:node</code>',
    right: true,
    why: 'With no <code>OTEL_SERVICE_NAME</code> and no <code>service.name</code> in <code>OTEL_RESOURCE_ATTRIBUTES</code>, the SDK falls back to <code>unknown_service:&lt;executable&gt;</code>. For Node that is <code>unknown_service:node</code>, the same name every other unnamed Node service gets.',
  },
  {
    key: 'bare',
    label: '<code>unknown_service</code>',
    why: 'Plain <code>unknown_service</code> is the fallback only when the SDK cannot tell which executable is running. Node can, so it appends it: <code>unknown_service:&lt;executable&gt;</code>.',
  },
  {
    key: 'env',
    label: '<code>production</code>',
    why: '<code>deployment.environment.name</code> says where the service runs, not what it is called. It never stands in for <code>service.name</code>.',
  },
];

// Step 3: which name wins when both are set.
const WHO_WINS = [
  {
    key: 'env-var',
    label: '<code>checkout</code>',
    right: true,
    why: '<code>OTEL_SERVICE_NAME</code> wins over <code>service.name</code> in <code>OTEL_RESOURCE_ATTRIBUTES</code>, so the SDK reports checkout. Delete the stray <code>service.name=cart</code> anyway: the next person to read this file will believe it.',
  },
  {
    key: 'resource-attr',
    label: '<code>cart</code>',
    why: '<code>service.name</code> in <code>OTEL_RESOURCE_ATTRIBUTES</code> only counts when <code>OTEL_SERVICE_NAME</code> is unset or empty. Here it is set, and it wins.',
  },
  {
    key: 'fallback',
    label: '<code>unknown_service:node</code>',
    why: 'Two names are not an error. The fallback applies only when no name is set at all, and <code>OTEL_SERVICE_NAME</code> takes precedence.',
  },
  {
    key: 'last-line',
    label: 'Whichever line comes last',
    why: 'These are two different variables, so their order in the file does not matter. <code>OTEL_SERVICE_NAME</code> takes precedence over <code>service.name</code> in <code>OTEL_RESOURCE_ATTRIBUTES</code>.',
  },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default {
  id: 'naming-your-service',
  no: '1.2',
  name: 'Naming your service',
  sub: 'Who is unknown_service:node?',
  icon: '\u{1F3F7}\u{FE0F}',
  rewardTitle: 'Service namer',
  mechanics: ['configure'],
  cards: ['unknown-service'],
  lights: ['checkout'],
  run(ctx) {
    const body = ctx.ovBody;
    const actions = ctx.ovActions;
    const fb = () => body.querySelector('#nys-feedback');
    const say = (cls, html) => {
      fb().className = `feedback ${cls} show`;
      fb().innerHTML = html;
    };

    // Wire a multiple-choice question: a wrong pick is a mistake and stays marked;
    // the right pick locks the question and calls onRight.
    const ask = (choices, onRight) => {
      for (const b of body.querySelectorAll('[data-pick]')) {
        const c = choices.find((x) => x.key === b.dataset.pick);
        b.onclick = () => {
          if (c.right) {
            b.classList.add('correct');
            for (const x of body.querySelectorAll('[data-pick]')) x.disabled = true;
            say('good', `Right. ${c.why}`);
            onRight();
          } else {
            ctx.mistake();
            b.classList.add('wrong');
            b.disabled = true;
            say('info', `Not quite. ${c.why}`);
          }
        };
      }
    };
    const choiceButtons = (choices) =>
      ctx
        .shuffle(choices)
        .map((c) => `<button class="choice" data-pick="${c.key}">${c.label}</button>`)
        .join('');
    const feedbackBox = '<div class="feedback" id="nys-feedback" role="status" aria-live="polite"></div>';

    const stepShowsUpAs = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Your first ticket: checkout went live last week and nobody can find its traces. ' +
            'Here is the whole environment its Node process starts with.',
        )}</div>
        <div class="lesson-stage">
          <pre id="nys-config"><code>${GIVEN_ENV}</code></pre>
          <h3 class="q">What service name does its telemetry show up under?</h3>
          <div class="choices">${choiceButtons(SHOWS_UP_AS)}</div>
          ${feedbackBox}
        </div>`,
        '<button class="btn" id="nys-next" disabled>Next</button>',
      );
      const next = actions.querySelector('#nys-next');
      ask(SHOWS_UP_AS, () => {
        next.disabled = false;
      });
      next.onclick = stepFix;
    };

    const stepFix = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Fix it. Set <code>OTEL_SERVICE_NAME</code> to <code>checkout</code>, add a ' +
            '<code>service.version</code> to <code>OTEL_RESOURCE_ATTRIBUTES</code> (any version, ' +
            'say 1.4.2) so you can tell deploys apart, and keep ' +
            '<code>deployment.environment.name=production</code>. Use that key, not the ' +
            'deprecated <code>deployment.environment</code>.',
        )}</div>
        <div class="lesson-stage">
          <label class="env-label" for="nys-env">checkout .env</label>
          <textarea class="env-editor" id="nys-env" rows="6" spellcheck="false"
            autocapitalize="off" autocomplete="off">${ctx.escapeHtml(GIVEN_ENV)}</textarea>
          <p class="env-note"><code>OTEL_RESOURCE_ATTRIBUTES</code> is a comma-separated list of
            <code>key=value</code> pairs. If one pair is malformed, the Node SDK drops the whole
            variable; the spec says SDKs should, and some languages keep the valid pairs instead.</p>
          <button class="btn" id="nys-check">Check</button>
          <button class="btn ghost small" id="nys-hint">Show a hint</button>
          <div class="feedback info" id="nys-hint-text"></div>
          ${feedbackBox}
        </div>`,
        '<button class="btn" id="nys-next" disabled>Next</button>',
      );
      const input = body.querySelector('#nys-env');
      const check = body.querySelector('#nys-check');
      const hint = body.querySelector('#nys-hint');
      const next = actions.querySelector('#nys-next');
      hint.onclick = () => {
        ctx.hint();
        hint.disabled = true;
        const box = body.querySelector('#nys-hint-text');
        box.classList.add('show');
        box.innerHTML =
          'Add a line <code>OTEL_SERVICE_NAME=checkout</code>, then append ' +
          '<code>,service.version=1.4.2</code> to the <code>OTEL_RESOURCE_ATTRIBUTES</code> value. ' +
          'Pairs are separated by commas.';
      };
      check.onclick = () => {
        const text = input.value;
        const result = checkConfig(text, TARGET, PROCESS);
        if (!result.ok) {
          ctx.mistake();
          const n = result.issues.length;
          say('info', `Not yet: ${plural(n, 'problem', 'problems')}.${renderIssues(result.issues, ctx.escapeHtml)}`);
          return;
        }
        const attrs = effectiveResource(parseEnv(text).vars, PROCESS).attributes;
        const e = ctx.escapeHtml;
        say(
          'good',
          `Config passes. The SDK now reports <code>service.name</code> ${e(attrs['service.name'])}, ` +
            `<code>service.version</code> ${e(attrs['service.version'])} and ` +
            `<code>deployment.environment.name</code> ${e(attrs['deployment.environment.name'])}.`,
        );
        input.disabled = true;
        check.disabled = true;
        hint.disabled = true;
        next.disabled = false;
      };
      next.onclick = stepWhoWins;
    };

    const stepWhoWins = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(
          'Checkout has a name. A week later a teammate pastes settings copied from the cart ' +
            'service into the deploy, and now both are set.',
        )}</div>
        <div class="lesson-stage">
          <pre><code>${CLASH_ENV}</code></pre>
          <h3 class="q">Which service name does the SDK report?</h3>
          <div class="choices">${choiceButtons(WHO_WINS)}</div>
          ${feedbackBox}
        </div>`,
        '<button class="btn" id="nys-finish" data-finish disabled>Finish</button>',
      );
      const finish = actions.querySelector('#nys-finish');
      ask(WHO_WINS, () => {
        finish.disabled = false;
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'Checkout now reports as checkout instead of unknown_service:node, so its traces have a home on the map.',
          cards: ['unknown-service'],
        });
    };

    stepShowsUpAs();
  },
};
