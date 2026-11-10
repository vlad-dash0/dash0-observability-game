// Level 1.2: Naming your service. The checkout service ships without a name and shows
// up as unknown_service:node; the player spots the fallback, fixes the .env with the
// level 1.2 checker (lib/widgets/env-config.mjs), then answers which name wins when
// OTEL_SERVICE_NAME and service.name in OTEL_RESOURCE_ATTRIBUTES disagree.
// Spec: https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/ , https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/ , https://opentelemetry.io/docs/specs/otel/resource/sdk/#specifying-resource-information-via-an-environment-variable , https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/
// Design: docs/FOUNDATION.md §5 and §6 F6. Player text reaches HTML only via escapeHtml.
import { actions, codeBlock, finishButton, helpChips, nextButton, prose, question, setFeedback, sideColumn, split, step } from '../lib/ui/index.mjs';
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { canFocus } from '../lib/widgets/focus.mjs';
import { editorPanel, fitEditor, lockEditor } from '../lib/widgets/editor.mjs';
import { mountHintLadder, ruleText } from '../lib/widgets/help-ladder.mjs';
import { normalizeConfig } from '../lib/widgets/configure-it.mjs';
import { checkConfig, effectiveResource, parseEnv, renderIssues } from '../lib/widgets/env-config.mjs';
import { GIVEN, PROCESS, TARGET, hintFor } from '../lib/widgets/env-config-help.mjs';
import { playSwirl } from '../lib/swirl-render.mjs';

// Step 2's score card follows the penalty rules of Configure it (lib/widgets/configure-it-view.mjs).
const RULE = ruleText({
  costs: 'a config that Check reports as wrong, a hint',
  free: 'Checking a config you already checked is free.',
});

const ENV_NOTE =
  '<code>OTEL_RESOURCE_ATTRIBUTES</code> is a comma-separated list of <code>key=value</code> pairs. ' +
  'If one pair is malformed, the spec says the whole value should be discarded and an error reported, so check every pair.';

const CLASH_ENV = [
  'OTEL_SERVICE_NAME=checkout',
  'OTEL_RESOURCE_ATTRIBUTES=service.name=cart,service.version=1.4.2,deployment.environment.name=production',
].join('\n');

// Step 1: what the given config shows up as. `why` follows "Right." or "Not quite.".
const SHOWS_UP_AS = [
  {
    key: 'name',
    label: '<code>checkout</code>',
    why: 'Nothing in this config says checkout, and nothing here lets the SDK work it out: it does not read the repository, the image or the host name. (SDKs can fall back to language- or platform-specific sources, but on a plain VM there is nothing to find.)',
  },
  {
    key: 'fallback',
    label: '<code>unknown_service:node</code>',
    right: true,
    why: 'With no <code>OTEL_SERVICE_NAME</code> and no <code>service.name</code> in <code>OTEL_RESOURCE_ATTRIBUTES</code>, the SDK falls back to <code>unknown_service:&lt;executable&gt;</code>. For a process started as <code>node</code>, that is <code>unknown_service:node</code>, the same name every other unnamed service started that way gets.',
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
  // Its .env step is the env checker (lib/widgets/env-config.mjs), which follows the penalty rules of Configure it.
  widgets: ['choice', 'configure'],
  cards: ['unknown-service'],
  lights: ['checkout'],
  run(ctx) {
    const body = ctx.ovBody;
    const bar = ctx.ovActions;

    const stepShowsUpAs = () => {
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech(
            'Your first ticket: checkout went live last week and nobody can find its traces. ' +
              'Its code sets no service name and it runs on a plain Linux VM, so this environment ' +
              'is all its SDK has to go on. The process is started as <code>node</code>.',
          )}<div id="nys-config">${codeBlock(GIVEN)}</div>${question({ id: 'nys-q-name', html: 'What service name does its telemetry show up under?' })}${choiceHtml(ctx, SHOWS_UP_AS, { id: 'nys', labelledBy: 'nys-q-name' })}`,
        }),
        actions({ wide: false, buttonsHtml: nextButton('nys-next') }),
      );
      const next = bar.querySelector('#nys-next');
      mountChoice(ctx, SHOWS_UP_AS, {
        id: 'nys',
        onRight: () => {
          next.disabled = false;
          return next;
        },
      });
      next.onclick = stepFix;
    };

    const stepFix = () => {
      const editor = editorPanel({
        inputId: 'nys-env',
        label: 'checkout .env',
        rows: 6,
        wrap: true,
        value: GIVEN,
        noteHtml: ENV_NOTE,
        actionId: 'nys-check',
        actionLabel: 'Check',
        feedbackId: 'nys-feedback',
      });
      const chips = helpChips('nys', [
        { key: 'instant', label: 'Instant feedback', on: true },
        { key: 'hints', label: 'Hints', on: true },
      ]);
      const side = sideColumn({ id: 'nys', titleHtml: 'Config solved', counts: [{ key: 'wrong', label: '' }], hints: true, ruleHtml: RULE });
      ctx.renderStep(
        step({
          wide: true,
          bodyHtml: `${ctx.speech(
            'Fix it. Set <code>OTEL_SERVICE_NAME</code> to <code>checkout</code>, add a ' +
              '<code>service.version</code> to <code>OTEL_RESOURCE_ATTRIBUTES</code> (any version, ' +
              'say 1.4.2) so you can tell deploys apart, and keep ' +
              '<code>deployment.environment.name=production</code>. Use that key, not the ' +
              'deprecated <code>deployment.environment</code>.',
          )}<div data-env-config>${split({ mainHtml: chips + editor, sideHtml: side })}</div>`,
        }),
        actions({ wide: true, buttonsHtml: nextButton('nys-next') }),
      );
      const box = body.querySelector('[data-env-config]');
      const input = body.querySelector('#nys-env');
      const check = body.querySelector('#nys-check');
      const fb = body.querySelector('#nys-feedback');
      const next = bar.querySelector('#nys-next');
      const say = (tone, html) => setFeedback(fb, tone, html);
      const fit = fitEditor(input, { max: 16 });
      const tried = new Set(); // normalised failing configs, as in Configure it
      ctx.widget?.('configure'); // this step is the env checker, a Configure it board (how to play follows it)
      const ladder = mountHintLadder(ctx, box, 'nys', {
        swirl: playSwirl,
        fallback: () => input,
        wrongNouns: ['failed Check', 'failed Checks'],
        hint: (tier) => hintFor(input.value, tier),
        fill: (text) => {
          input.value = text;
          fit();
          run({ hinted: true });
        },
      });

      /** Check `input.value`. `hinted` marks the tier 3 run: the right answer is then not earned. */
      function run({ hinted = false } = {}) {
        if (ladder.done) return;
        const text = input.value;
        if (!hinted && text.trim() === '') return void say('neutral', 'Type a config first.');
        const result = checkConfig(text, TARGET, PROCESS);
        if (!result.ok) {
          // Only a new failing config costs a mistake; any config already checked (same after normalising) is free.
          // A .env parses the same without indentation or blank lines, so the key ignores both.
          const norm = normalizeConfig(text).split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
          const same = tried.has(norm);
          tried.add(norm);
          const n = plural(result.issues.length, 'problem', 'problems');
          const issues = prose(renderIssues(result.issues, ctx.escapeHtml));
          if (same) return void say('neutral', `You already checked this config. Nothing new was counted.${issues}`);
          ladder.miss();
          say('error', `Not yet: ${n}.${issues}`);
          return;
        }
        const { attributes: attrs, source } = effectiveResource(parseEnv(text).vars, PROCESS);
        const e = ctx.escapeHtml;
        ladder.complete();
        lockEditor(input, check);
        say(
          hinted ? 'neutral' : 'success',
          `${hinted ? 'Filled in for you. ' : ''}Config passes. The SDK now reports <code>service.name</code> ${e(attrs['service.name'])}, ` +
            `<code>service.version</code> ${e(attrs['service.version'])} and ` +
            `<code>deployment.environment.name</code> ${e(attrs['deployment.environment.name'])}.` +
            (source === 'OTEL_RESOURCE_ATTRIBUTES'
              ? prose(
                  'Note: the name comes from the attribute list. That works, but <code>OTEL_SERVICE_NAME</code> is the dedicated variable and wins if both are set.',
                )
              : ''),
        );
        next.disabled = false;
        ladder.succeed();
      }

      check.onclick = () => {
        if (check.disabled) return;
        run();
      };
      next.onclick = stepWhoWins;
      (canFocus(input) ? input : fb).focus();
    };

    const stepWhoWins = () => {
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech(
            'Checkout has a name. A week later a teammate pastes settings copied from the cart ' +
              'service into the deploy, and now both are set.',
          )}${codeBlock(CLASH_ENV)}${question({ id: 'nys-q-wins', html: 'Which service name does the SDK report?' })}${choiceHtml(ctx, WHO_WINS, { id: 'nys', labelledBy: 'nys-q-wins' })}`,
        }),
        actions({ wide: false, buttonsHtml: finishButton('nys-finish') }),
      );
      const finish = bar.querySelector('#nys-finish');
      mountChoice(ctx, WHO_WINS, {
        id: 'nys',
        onRight: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'Checkout now reports as checkout instead of unknown_service:node, so its traces now show up under the right name.',
          cards: ['unknown-service'],
        });
    };

    stepShowsUpAs();
  },
};
