// Choice widget: one multiple-choice question (docs/M1-DESIGN.md §4.0, extracted from
// level 1.2). The only home of "a wrong pick costs one mistake and passes focus to the
// next enabled choice". Choice = { key, label, why, right? }; `label` and `why` are
// trusted authored HTML, `key` and `id` plain tokens. DOM-free at import time.

import { canFocus } from './focus.mjs';

const ID = /^[A-Za-z][\w-]*$/;

/**
 * Markup for question `id`: its choices in ctx.shuffle order, then its feedback region.
 * With `labelledBy` (the id of the question heading, a plain token like `id`; TypeError
 * otherwise) the choices form a labelled group.
 * label/why are trusted authored HTML; never pass player or data text; escape with
 * ctx.escapeHtml first.
 */
export function choiceHtml(ctx, choices, { id, labelledBy }) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && ID.test(labelledBy))) {
    throw new TypeError(`choice "${String(id)}": labelledBy must be a plain token`);
  }
  const e = ctx.escapeHtml;
  const buttons = ctx
    .shuffle(choices)
    .map((c) => `<button class="choice" data-pick="${e(c.key)}">${c.label}</button>`)
    .join('');
  const group = labelledBy == null ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  return (
    `<div class="choices" data-choice="${e(id)}"${group}>${buttons}</div>` +
    `<div class="feedback" id="${e(id)}-feedback" role="status" aria-live="polite" tabindex="-1"></div>`
  );
}

/** Throw a TypeError naming question `id`. */
const fail = (id, msg) => {
  throw new TypeError(`choice "${String(id)}": ${msg}`);
};

/**
 * Wire question `id` (rendered by choiceHtml into ctx.ovBody) and focus its first choice.
 * A wrong pick: ctx.mistake(), marked `wrong` and disabled, "Not quite. <why>", focus to
 * the next enabled choice (wrapping), else the feedback. The right pick: marked
 * `correct`, every choice disabled, "Right. <why>", then onRight() is called once and
 * must return the element to focus next, one that passes canFocus (lib/widgets/focus.mjs),
 * e.g. Next or Finish; anything else (nothing, false, a disabled, detached or plain
 * element) focuses the feedback instead. A disabled choice ignores clicks.
 * Throws TypeError (naming `id`) unless `id` is a plain-token string, `choices` is an
 * array of objects with unique non-empty string keys and a string `why`, exactly one is
 * right, and the rendered buttons match the choices' keys one for one.
 */
export function mountChoice(ctx, choices, { id, onRight }) {
  if (typeof id !== 'string') fail(id, 'id must be a string');
  if (!ID.test(id)) fail(id, 'id must be a plain token');
  if (!Array.isArray(choices)) fail(id, 'choices must be an array');
  choices.forEach((c, i) => {
    if (c === null || typeof c !== 'object') fail(id, `choice ${i} is not an object`);
  });
  const keys = choices.map((c) => c.key);
  if (!keys.every((k) => typeof k === 'string' && k !== '')) fail(id, 'choice keys must be non-empty strings');
  if (new Set(keys).size !== keys.length) fail(id, 'choice keys must be unique');
  const noWhy = choices.find((c) => typeof c.why !== 'string');
  if (noWhy) fail(id, `choice "${noWhy.key}" needs a string why`);
  const rights = choices.filter((c) => c.right).length;
  if (rights !== 1) fail(id, `needs exactly one right answer, has ${rights}`);
  const box = ctx.ovBody.querySelector(`[data-choice="${id}"]`);
  const fb = ctx.ovBody.querySelector(`#${id}-feedback`);
  if (!box || !fb) fail(id, 'not rendered (use choiceHtml with the same id)');
  const buttons = [...box.querySelectorAll('[data-pick]')];
  const rendered = buttons.map((b) => b.dataset.pick).sort();
  const wanted = [...keys].sort();
  if (rendered.length !== wanted.length || rendered.some((k, i) => k !== wanted[i])) {
    fail(id, 'the rendered buttons do not match the choices (render and mount the same list)');
  }
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };
  buttons.forEach((b, i) => {
    const c = choices.find((x) => x.key === b.dataset.pick);
    b.onclick = () => {
      if (b.disabled) return;
      if (c.right) {
        b.classList.add('correct');
        for (const x of buttons) x.disabled = true;
        say('good', `Right. ${c.why}`);
        const target = onRight();
        (canFocus(target) ? target : fb).focus();
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
