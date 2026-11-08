import { option } from '../../lib/ui/index.mjs';

// A tiny level in real level style, used to prove the play-through harness has teeth.
// Step 1: one question (a wrong pick is a mistake), Next unlocks on the right pick.
// Step 2: Finish. Not registered in levels/index.mjs.
export default {
  id: 'fixture-level',
  no: '0.1',
  name: 'Fixture level',
  icon: '*',
  rewardTitle: 'Fixture finisher',
  mechanics: ['query'],
  cards: ['fixture-card'],
  run(ctx) {
    ctx.renderStep(
      `${ctx.speech('Which signal tells you <b>where</b> a request spent its time?')}
       ${option({ attr: 'pick', value: 'trace', labelHtml: 'A trace' })}
       ${option({ attr: 'pick', value: 'metric', labelHtml: 'A metric' })}
       <p id="fx-feedback"></p>`,
      '<button id="fx-next" disabled>Next</button>',
    );
    const next = ctx.ovActions.querySelector('#fx-next');
    for (const btn of ctx.ovBody.querySelectorAll('[data-pick]')) {
      btn.onclick = () => {
        const fb = ctx.ovBody.querySelector('#fx-feedback');
        if (btn.dataset.pick === 'trace') {
          fb.textContent = 'Right: spans carry timing.';
          next.disabled = false;
        } else {
          ctx.mistake();
          fb.textContent = 'A metric aggregates; it has no per-request timing.';
        }
      };
    }
    next.onclick = () => {
      ctx.renderStep(
        '<p>A trace is a tree of spans.</p>',
        '<button id="fx-finish" data-finish>Finish</button>',
      );
      ctx.ovActions.querySelector('#fx-finish').onclick = () =>
        ctx.finish({ text: 'You picked the trace for request timing.', cards: ['fixture-card'] });
    };
  },
};

export const FIXTURE_CARD = {
  id: 'fixture-card',
  front: 'Traces show where a request spent its time.',
  back: 'Each span has a start and an end.',
  specUrl: 'https://opentelemetry.io/docs/concepts/signals/traces/',
  dash0Angle: null,
};
