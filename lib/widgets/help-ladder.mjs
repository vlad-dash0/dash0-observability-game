// The help ladder and the right column a widget shows beside its board (#146; Sort it adopts
// it in #156): which helps a step declares (validated here, named by the widget), the chips
// row that says which are on, and a column with, top to bottom, the success card (hidden
// until success; its heading takes focus; the decorative swirl plays once), the score card
// (the widget's wrong count, hints used, five stars from ctx.peekStars, the rule) and the
// hint tools (a button, its cost from the star rule, the tier line and the hint text). The
// widget owns what a help does and what a hint says; this module owns how they are shown.
// DOM-free at import time; ids are escaped by the caller.

import { MAX_STARS } from '../scoring.mjs';

export const HINT_TIERS = 3;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Problems with `helps` (undefined is fine): an object of `keys`, each true or false. */
export function validateHelps(helps, keys) {
  if (helps === undefined) return [];
  if (!isObject(helps)) return ['helps: not an object'];
  const problems = [];
  for (const [k, v] of Object.entries(helps)) {
    if (!keys.includes(k)) problems.push(`helps: "${k}" is not one of ${keys.join(', ')}`);
    else if (typeof v !== 'boolean') problems.push(`helps: "${k}" is not true or false`);
  }
  return problems;
}

/** The chips row `#<id>-helps`: one chip per help, "<label> on" or "<label> off" in words. */
export function chipsHtml(id, rows) {
  const chips = rows.map(
    ({ key, label, on }) =>
      `<span class="help-chip" data-help="${key}" data-on="${on}"><i aria-hidden="true"></i>${label} ${on ? 'on' : 'off'}</span>`,
  );
  return `<p class="help-chips" id="${id}-helps"><span class="help-chips-title">Helps:</span> ${chips.join(' ')}</p>`;
}

/** "N of 5 stars still possible" before success, "N of 5 stars" after. */
export const starsLabel = (n, done) => `${n} of ${MAX_STARS} stars${done ? '' : ' still possible'}`;

/** What one more penalty costs now, from the stars now and after it. */
export function hintCost(now, after) {
  const d = now - after;
  if (d === 0) return 'costs no star now';
  return `costs ${d} star${d === 1 ? '' : 's'}`;
}

const STAR =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.2 10 5.6l4.8.5-3.6 3.2 1 4.7L8 11.6 3.8 14l1-4.7L1.2 6.1 6 5.6Z"></path></svg>';

/** Five stars: the first `n` "possible" (muted outlines) before success and "earned" (filled) after; the rest "lost". */
function starsHtml(n, done) {
  return Array.from({ length: MAX_STARS }, (_, i) => `<span class="help-star" data-star="${i >= n ? 'lost' : done ? 'earned' : 'possible'}">${STAR}</span>`).join('');
}

const RULE =
  'Every penalty in the level counts: a wrong drop, a failed Check, a wrong pick, a hint. ' +
  '0 penalties give 5 stars, 1 gives 4, 2 gives 3, 3 or 4 give 2, more give 1. Retrying is free.';

/**
 * The right column for widget `id`: `#<id>-win` (hidden; `[data-swirl]`, `#<id>-win-title`
 * with `title`, `#<id>-win-stars`, `#<id>-win-closing`), the score card (`#<id>-wrong`,
 * `#<id>-wrong-label`, `#<id>-hints`, `#<id>-stars`) and, with `hints`, `#<id>-hint`,
 * `#<id>-hint-cost`, `#<id>-hint-tier` and `#<id>-hint-text`; without, the tier line says
 * there are none.
 */
export function sideHtml(id, { hints, title }) {
  const tools = hints
    ? `<div class="help-hint-row"><button type="button" class="help-btn" id="${id}-hint">Hint</button>` +
      `<span class="help-cost" id="${id}-hint-cost"></span></div>` +
      `<p class="help-tier" id="${id}-hint-tier"></p>` +
      `<div class="help-hint-text" id="${id}-hint-text" tabindex="-1"></div>`
    : `<p class="help-tier" id="${id}-hint-tier">No hints on this level.</p>`;
  return (
    `<aside class="help-side" aria-label="Result, score and hints">` +
    `<section class="help-win" id="${id}-win" aria-labelledby="${id}-win-title" hidden>` +
    `<div class="help-swirl" data-swirl aria-hidden="true"></div>` +
    `<div class="help-win-text"><h3 class="help-win-title" id="${id}-win-title" tabindex="-1">${title}</h3>` +
    `<p class="help-win-stars" id="${id}-win-stars"></p><p class="help-win-closing" id="${id}-win-closing"></p></div>` +
    `</section>` +
    `<div class="help-score">` +
    `<p class="help-counts"><span class="help-count"><b id="${id}-wrong">0</b> <span id="${id}-wrong-label"></span></span>` +
    `<span class="help-count"><b id="${id}-hints">0</b> hints</span></p>` +
    `<p class="help-stars" id="${id}-stars" role="img" aria-label=""></p>` +
    `<p class="help-rule">${RULE}</p>` +
    `</div>` +
    `<h3 class="help-h">Hints</h3>${tools}` +
    `</aside>`
  );
}

/**
 * Wire the column rendered by sideHtml(id) inside `box`. `swirl(host, {reduced, signal})`
 * draws the success accent; it is called at most once, and a throw or a rejection is
 * ignored (the card's text is the feedback). Returns:
 *   score({wrong, wrongLabel, hints, done}) -> stars now (ctx.peekStars())
 *   hintUi({label, disabled, tierHtml})       the button, its cost and the tier line
 *   showHint(html, {focus})                    the hint text (authored HTML), focused unless focus is false
 *   succeed({line, closing})                   show the card, focus its heading, swirl once
 */
export function mountSide(ctx, box, id, { swirl } = {}) {
  const el = (part) => box.querySelector(`[id="${id}-${part}"]`);
  let played = false;
  return {
    score({ wrong, wrongLabel, hints, done }) {
      const n = ctx.peekStars();
      el('wrong').textContent = String(wrong);
      el('wrong-label').textContent = wrongLabel;
      el('hints').textContent = String(hints);
      el('stars').setAttribute('aria-label', starsLabel(n, done));
      el('stars').innerHTML = starsHtml(n, done);
      return n;
    },
    hintUi({ label, disabled, tierHtml }) {
      const btn = el('hint');
      if (!btn) return;
      btn.textContent = label;
      btn.disabled = disabled;
      const cost = el('hint-cost');
      cost.textContent = disabled ? '' : hintCost(ctx.peekStars(), ctx.peekStars(1));
      cost.hidden = disabled;
      el('hint-tier').innerHTML = tierHtml;
    },
    showHint(html, { focus = true } = {}) {
      const text = el('hint-text');
      text.innerHTML = html;
      if (focus) text.focus();
    },
    succeed({ line, closing = '' }) {
      el('win-stars').textContent = line;
      el('win-closing').innerHTML = closing;
      el('win').hidden = false;
      el('win-title').focus();
      if (played || typeof swirl !== 'function') return;
      played = true;
      try {
        const run = swirl(box.querySelector('[data-swirl]'), { reduced: !!ctx.reduceMotion, signal: ctx.signal });
        if (run && typeof run.catch === 'function') run.catch(() => {});
      } catch {
        // decorative only: the card already says it
      }
    },
  };
}
