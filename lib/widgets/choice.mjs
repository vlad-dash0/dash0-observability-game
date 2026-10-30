// Choice widget: one multiple-choice question (docs/M1-DESIGN.md §4.0, extracted from
// level 1.2). The only home of "a wrong pick costs one mistake and passes focus to the
// next enabled choice". Choice = { key, label, why, right? }; `label` and `why` are
// trusted authored HTML, `key` and `id` plain tokens. DOM-free at import time.

const ID = /^[A-Za-z][\w-]*$/;

/** Markup for question `id`: its choices in ctx.shuffle order, then its feedback region. */
export function choiceHtml(ctx, choices, { id }) {
  const e = ctx.escapeHtml;
  const buttons = ctx
    .shuffle(choices)
    .map((c) => `<button class="choice" data-pick="${e(c.key)}">${c.label}</button>`)
    .join('');
  return (
    `<div class="choices" data-choice="${e(id)}">${buttons}</div>` +
    `<div class="feedback" id="${e(id)}-feedback" role="status" aria-live="polite" tabindex="-1"></div>`
  );
}

/**
 * Wire question `id` (rendered by choiceHtml into ctx.ovBody) and focus its first choice.
 * A wrong pick: ctx.mistake(), marked `wrong` and disabled, "Not quite. <why>", focus to
 * the next enabled choice (wrapping), else the feedback. The right pick: marked
 * `correct`, every choice disabled, "Right. <why>", focus to what onRight() returns
 * (the feedback if nothing). Throws TypeError unless exactly one choice is right.
 */
export function mountChoice(ctx, choices, { id, onRight }) {
  const rights = choices.filter((c) => c.right).length;
  if (rights !== 1) throw new TypeError(`choice "${id}" needs exactly one right answer, has ${rights}`);
  if (!ID.test(id)) throw new TypeError(`choice id "${id}" must be a plain token`);
  const box = ctx.ovBody.querySelector(`[data-choice="${id}"]`);
  const fb = ctx.ovBody.querySelector(`#${id}-feedback`);
  const buttons = [...box.querySelectorAll('[data-pick]')];
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };
  buttons.forEach((b, i) => {
    const c = choices.find((x) => x.key === b.dataset.pick);
    b.onclick = () => {
      if (c.right) {
        b.classList.add('correct');
        for (const x of buttons) x.disabled = true;
        say('good', `Right. ${c.why}`);
        (onRight() ?? fb).focus();
        return;
      }
      ctx.mistake();
      b.classList.add('wrong');
      b.disabled = true;
      say('info', `Not quite. ${c.why}`);
      const rest = [...buttons.slice(i + 1), ...buttons.slice(0, i)];
      (rest.find((x) => !x.disabled) ?? fb).focus();
    };
  });
  buttons[0].focus();
}
