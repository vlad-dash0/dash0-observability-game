// Fixture variants for the harness-teeth tests in test/levels-play.test.mjs: one valid
// unscored level and five levels the harness must reject. Not registered anywhere.
import fixtureLevel from './fixture-level.mjs';

const base = (id, no, extra) => ({
  id,
  no,
  name: `Fixture ${id}`,
  icon: '*',
  rewardTitle: `Fixture ${id}`,
  mechanics: ['query'],
  cards: ['fixture-card'],
  ...extra,
});
const REWARD = 'A long enough reward text.';

/** Same flow as the fixture level, but unscored: every run earns 0 stars. */
export const UNSCORED = base('fx-unscored', '0.2', { scored: false, run: fixtureLevel.run });

/** Broken: the first screen already shows an enabled Finish. */
export const FINISH_ON_FIRST_SCREEN = base('fx-first-finish', '0.3', {
  run(ctx) {
    ctx.renderStep('<p>Done already?</p>', '<button id="ff" data-finish>Finish</button>');
    ctx.ovActions.querySelector('#ff').onclick = () => ctx.finish({ text: REWARD });
  },
});

/** Broken: finishes from a plain button while a disabled Finish sits next to it. */
export const FINISH_FROM_OTHER = base('fx-other-button', '0.4', {
  run(ctx) {
    ctx.renderStep(
      '<p>Pick one.</p><button id="go">Go</button>',
      '<button id="fin" data-finish disabled>Finish</button>',
    );
    ctx.ovBody.querySelector('#go').onclick = () => ctx.finish({ text: REWARD });
  },
});

/** Broken: finishes inside run(), before the player clicks anything. */
export const FINISH_IN_RUN = base('fx-run-finish', '0.5', {
  run(ctx) {
    ctx.renderStep('<p>Hi.</p>', '<button id="fin" data-finish disabled>Finish</button>');
    ctx.finish({ text: REWARD });
  },
});

/** Broken: awards a card its level does not list. */
export const CARD_OUTSIDE = base('fx-card-outside', '0.6', {
  run(ctx) {
    ctx.renderStep('<p>Ready?</p>', '<button id="go">Go</button>');
    ctx.ovActions.querySelector('#go').onclick = () => {
      ctx.renderStep('<p>Done.</p>', '<button id="fin" data-finish>Finish</button>');
      ctx.ovActions.querySelector('#fin').onclick = () =>
        ctx.finish({ text: REWARD, cards: ['other-card'] });
    };
  },
});

/** Broken: its Finish button never appears in a rendered step; the text only names it. */
export const FINISH_OUTSIDE_RENDER = base('fx-outside-render', '0.7', {
  run(ctx) {
    ctx.renderStep('<p>Look for data-finish later.</p>', '<button id="go">Go</button>');
    ctx.ovActions.querySelector('#go').onclick = () => {
      ctx.ovActions.innerHTML = '<button id="fin" data-finish>Finish</button>';
      ctx.ovActions.querySelector('#fin').onclick = () => ctx.finish({ text: REWARD });
    };
  },
});
