// The help ladder and the right column a widget shows beside its board (#146; Sort it adopts
// it in #156): which helps a step declares (validated here, named by the widget) and the
// behaviour of the column rendered by the kit's sideColumn (lib/ui/side.mjs, #158; the chips
// row is its helpChips): top to bottom, the success card (hidden until success; its heading
// takes focus; the decorative swirl plays once), the score card (the widget's wrong count,
// hints used, five stars from this board's own counts, the rule) and the hint tools (a
// button, its cost from the star rule, the tier line and the hint text). The widget owns what
// a help does and what a hint says; this module owns how they are shown. DOM-free at import.

import { MAX_STARS, scoreStars } from '../scoring.mjs';
import { stars } from '../ui/index.mjs';

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

/**
 * The stars this board alone would give: its wrong drops or failed Checks plus its hints, by
 * the one rule in lib/scoring.mjs (no par). `extra` more penalties. The level's own result
 * is still ctx.finish; a board never shows another step's penalties.
 */
export const boardStars = (wrong, hints, extra = 0) =>
  scoreStars({ mistakes: wrong, hintsUsed: hints + extra, elapsedMs: 0 }, { scored: true, scoring: { parMs: null } });

/** "N of 5 stars still possible" before success, "N of 5 stars" after. */
export const starsLabel = (n, done) => `${n} of ${MAX_STARS} stars${done ? '' : ' still possible'}`;

/** What one more penalty costs now, from the stars now and after it. */
export function hintCost(now, after) {
  const d = now - after;
  if (d === 0) return 'costs no star now';
  return `costs ${d} star${d === 1 ? '' : 's'}`;
}

/** The score card's rule, as the kit sideColumn's ruleHtml. */
export const RULE =
  'Stars count this board only: a wrong drop, a failed Check, a wrong pick, a hint. ' +
  '0 penalties give 5 stars, 1 gives 4, 2 gives 3, 3 or 4 give 2, more give 1. Retrying is free.';

/**
 * Wire the column rendered by the kit's sideColumn({id, counts: [{key: 'wrong', ...}]})
 * inside `box` (its ids: #<id>-wrong, -wrong-label, -hints, -stars, -hint, -hint-cost,
 * -hint-tier, -hint-text, -win, -win-title, -win-stars, -win-closing). `swirl(host, {reduced, signal})`
 * draws the success accent; it is called at most once, and a throw or a rejection is
 * ignored (the card's text is the feedback). Returns:
 *   score({wrong, wrongLabel, hints, done}) -> this board's stars now (boardStars)
 *   hintUi({label, disabled, tierHtml})       the button, its cost and the tier line
 *   showHint(html, {focus})                    the hint text (authored HTML), focused unless focus is false
 *   succeed({line, closing})                   show the card, focus its heading, swirl once
 */
export function mountSide(ctx, box, id, { swirl } = {}) {
  const el = (part) => box.querySelector(`[id="${id}-${part}"]`);
  let played = false;
  let counts = { wrong: 0, hints: 0 };
  return {
    score({ wrong, wrongLabel, hints, done }) {
      counts = { wrong, hints };
      const n = boardStars(wrong, hints);
      el('wrong').textContent = String(wrong);
      el('wrong-label').textContent = wrongLabel;
      el('hints').textContent = String(hints);
      el('stars').setAttribute('aria-label', starsLabel(n, done));
      el('stars').innerHTML = stars(n, done);
      return n;
    },
    hintUi({ label, disabled, tierHtml }) {
      const btn = el('hint');
      if (!btn) return;
      btn.textContent = label;
      btn.disabled = disabled;
      const cost = el('hint-cost');
      cost.textContent = disabled ? '' : hintCost(boardStars(counts.wrong, counts.hints), boardStars(counts.wrong, counts.hints, 1));
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
