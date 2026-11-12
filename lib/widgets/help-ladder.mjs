// The help ladder and the right column a widget shows beside its board (#146; Sort it adopts
// it in #156): which helps a step declares (validated here, named by the widget) and the
// behaviour of the column rendered by the kit's sideColumn (lib/ui/side.mjs, #158; the chips
// row is its helpChips): top to bottom, the success card (hidden until success; its heading
// takes focus; the decorative swirl plays once), the score card (the widget's wrong count,
// hints used, five stars from this board's own counts, the rule) and the hint tools (a
// button, its cost from the star rule, the tier line and the hint text). The widget owns what
// a help does and what a hint says; this module owns how they are shown. DOM-free at import.

import { escapeFromHint } from './focus.mjs';
import { MAX_STARS, scoreStars } from '../scoring.mjs';
import { dots, hintHead, stars } from '../ui/index.mjs';

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

/** What a hint costs now: always one penalty; says when that penalty loses no star (not yet, or never at the 1 star floor). */
export function hintCost(now, after) {
  if (now !== after) return 'costs 1 penalty';
  return now <= 1 ? 'costs 1 penalty, no star left to lose' : 'costs 1 penalty, no star yet';
}

const LADDER_MARGIN = 100; // penalties the stars must hold still for before the last rung is called "more"
const LADDER_CAP = 5000; // a rule still changing here is not a ladder

/** The words for one rung of `from` to `to` penalties. */
const rungWho = ({ from, to }) => (from === to ? String(from) : to - from === 1 ? `${from} or ${to}` : `${from} to ${to}`);

/**
 * The star ladder as rungs, from `starsFor(penalties) -> stars`: consecutive penalty counts with
 * the same stars are one rung `{from, to, stars}` (the last one runs to the end of the scan, so
 * it reads as "from and more"). The scan runs until the stars have held still for LADDER_MARGIN
 * penalties, so a rung up to that wide is read in full; a rung wider than the margin is read as
 * the last rung, so a rule with a rung that wide must raise the margin; a rule still changing
 * at the cap throws.
 */
export function ladderRungs(starsFor) {
  const rungs = [];
  for (let p = 0; ; p++) {
    const stars = starsFor(p);
    const last = rungs.at(-1);
    if (last && last.stars === stars) last.to = p;
    else rungs.push({ from: p, to: p, stars });
    if (p - rungs.at(-1).from >= LADDER_MARGIN) break;
    if (p >= LADDER_CAP) throw new RangeError(`ladderText: the stars were still changing at ${LADDER_CAP} penalties`);
  }
  return rungs;
}

/**
 * The star ladder in words, read from `starsFor(penalties) -> stars` (consecutive penalty
 * counts with the same stars are one rung: one count reads "2", two "3 or 4", three or more
 * "3 to 5"; the last rung is "more"; a rule that never changes is "any number"; the scan is
 * ladderRungs'). Pure; LADDER is this over the one rule in
 * lib/scoring.mjs, so no text restates the numbers.
 */
export function ladderText(starsFor) {
  const rungs = ladderRungs(starsFor);
  if (rungs.length === 1) return `any number of penalties give ${rungs[0].stars} stars.`;
  const parts = rungs.map((r, i) => {
    const tail = i === rungs.length - 1;
    const who = tail ? 'more' : rungWho(r);
    const noun = i === 0 && !tail ? ' penalties' : '';
    const plural = tail || noun !== '' || r.from !== r.to;
    const got = `${who}${noun} ${plural ? 'give' : 'gives'} ${r.stars}`;
    return i === 0 ? `${got} stars` : got;
  });
  return `${parts.join(', ')}.`;
}

/** The star ladder, from the one star rule: no penalty is the best board, and so on. */
export const LADDER = ladderText((p) => boardStars(p, 0));

/** The same ladder as rungs, for a list. */
export const LADDER_RUNGS = Object.freeze(ladderRungs((p) => boardStars(p, 0)).map((r) => Object.freeze(r)));

/**
 * What costs a star on the Build it board, and what does not (the generic board; the other side-column
 * widgets export their own PENALTY beside the mount that charges it).
 */
export const PENALTY = Object.freeze({
  costs: 'a wrong drop, a failed Check, a wrong pick, a hint',
  free: 'Retrying is free.',
});

/** The score card's rule for a widget's `penalty`: its costs, the ladder, what is free. */
export const ruleText = ({ costs, free }) => `Stars count this board only: ${costs}. ${LADDER} ${free}`;

/** The score card's rule, as the kit sideColumn's ruleHtml. */
export const RULE = ruleText(PENALTY);

/**
 * Wire the column rendered by the kit's sideColumn({id, counts: [{key: 'wrong', ...}]})
 * inside `box` (its ids: #<id>-wrong, -wrong-label, -hints, -stars, -hint, -hint-cost,
 * -hint-tier, -hint-text, -win, -win-title, -win-stars, -win-closing). `swirl(host, {reduced, signal})`
 * draws the success accent; it is called at most once, and a throw or a rejection is
 * ignored (the card's text is the feedback). Returns:
 *   score({wrong, wrongLabel, hints, more, done}) -> this board's stars now (boardStars); `more`
 *     is {key: count} for the other penalty counts the column shows (the incident board's
 *     misleading views and budget run out, `#<id>-<key>`), each one more penalty in the stars
 *   hintsShown(h)                              h plus the guide questions answered here (ctx.onGuideHint), for the success line
 *   hintUi({label, disabled, tierHtml})       the button, its cost and the tier line
 *   showHint(html, {focus})                    the hint text (authored HTML), focused unless focus is false;
 *                                              Escape on it goes to the hint button, else to `fallback()` (a control or list)
 *   succeed({line, closing})                   show the card, focus its heading, swirl once
 */
export function mountSide(ctx, box, id, { swirl, fallback } = {}) {
  const el = (part) => box.querySelector(`[id="${id}-${part}"]`);
  let played = false;
  let counts = { wrong: 0, hints: 0, extra: 0 };
  // Answered guide questions on this step: each one a penalty like a hint (ctx.askedGuide),
  // kept across score() and counted in the stars, the hints shown and the hint cost.
  let guided = 0;
  let lastScore = null;
  let lastHintUi = null;
  let stopListening = null; // the board's own asks only: dropped once solved, so a later ask never repaints a finished card
  const api = {
    score(args) {
      lastScore = args;
      const { wrong, wrongLabel, hints, more = {}, done } = args;
      const extra = Object.values(more).reduce((sum, n) => sum + n, 0);
      counts = { wrong, hints: hints + guided, extra };
      const n = boardStars(wrong, hints + guided, extra);
      for (const [key, count] of Object.entries(more)) {
        const b = el(key);
        if (b) b.textContent = String(count);
      }
      el('wrong').textContent = String(wrong);
      el('wrong-label').textContent = wrongLabel;
      el('hints').textContent = String(hints + guided);
      const hintsLabel = el('hints-label');
      if (hintsLabel) hintsLabel.textContent = hints + guided === 1 ? 'hint' : 'hints';
      el('stars').setAttribute('aria-label', starsLabel(n, done));
      el('stars').innerHTML = stars(n, done);
      return n;
    },
    /** The hints a success line states: the widget's own plus the answered guide questions. */
    hintsShown: (hints) => hints + guided,
    hintUi(args) {
      lastHintUi = args;
      const { label, disabled, tierHtml } = args;
      const btn = el('hint');
      if (!btn) return;
      btn.textContent = label;
      btn.disabled = disabled;
      const cost = el('hint-cost');
      const { wrong, hints, extra } = counts;
      cost.textContent = disabled ? '' : hintCost(boardStars(wrong, hints, extra), boardStars(wrong, hints, extra + 1));
      cost.hidden = disabled;
      el('hint-tier').innerHTML = tierHtml;
    },
    showHint(html, { focus = true } = {}) {
      const text = el('hint-text');
      escapeFromHint(text, el('hint'), fallback);
      text.innerHTML = html;
      if (focus) text.focus();
    },
    succeed({ line, closing = '' }) {
      stopListening?.();
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
  // A guide answer arrives between the widget's own redraws: count it and repaint the card.
  stopListening = ctx.onGuideHint?.(() => {
    guided += 1;
    if (lastScore) api.score(lastScore);
    if (lastHintUi) api.hintUi(lastHintUi);
  });
  return api;
}

/**
 * The score card, the Hint button and the success card of an editor widget (Query it, Configure it),
 * over mountSide: the counts, the three-tier Hint click and what a wrong or right check draws.
 * `wrongNouns` is [one, many] for the wrong count ("failed Check", "failed Checks"); `hint(tier)`
 * gives {html, apply?}; a tier with `apply` goes to `fill(text)`, which puts it in the input and
 * runs the widget's check with {hinted: true}. One ctx.hint() per click; Escape routing is
 * mountSide's, with `fallback`. Returns:
 *   done              true after complete()
 *   complete()        mark the board done (call before drawing the right answer)
 *   miss()            ctx.mistake(), one more wrong, redraw the card and the hint tools
 *   succeed()         mark done (idempotent), redraw, then show the success card with this board's stars and counts
 */
export function mountHintLadder(ctx, box, id, { swirl, fallback, wrongNouns, hint, fill }) {
  const side = mountSide(ctx, box, id, { swirl, fallback });
  const hintBtn = box.querySelector(`[id="${id}-hint"]`);
  const noun = (n) => wrongNouns[n === 1 ? 0 : 1];
  let wrong = 0;
  let hintsUsed = 0;
  let done = false;

  const drawSide = () => side.score({ wrong, wrongLabel: noun(wrong), hints: hintsUsed, done });

  function drawHint() {
    if (!hintBtn) return;
    const pips = dots({ total: HINT_TIERS, on: hintsUsed, decorative: true, tone: 'hint' });
    side.hintUi({
      label: done ? 'Hint' : hintsUsed >= HINT_TIERS ? 'No more hints' : `Hint ${hintsUsed + 1} of ${HINT_TIERS}`,
      disabled: done || hintsUsed >= HINT_TIERS,
      tierHtml: done ? 'Nothing to hint right now.' : `${hintsUsed} of ${HINT_TIERS} used ${pips}`,
    });
  }

  const draw = () => {
    drawSide();
    drawHint();
  };

  if (hintBtn) {
    hintBtn.onclick = () => {
      if (hintBtn.disabled || done || hintsUsed >= HINT_TIERS) return;
      const tier = hintsUsed + 1;
      ctx.hint();
      hintsUsed = tier;
      const h = hint(tier);
      const html = `${hintHead(`Hint ${tier} of ${HINT_TIERS}`)}${h.html}`;
      if (h.apply === undefined) {
        draw();
        side.showHint(html);
        return;
      }
      fill(h.apply);
      if (done) side.showHint(html, { focus: false });
      else {
        draw();
        side.showHint(html);
      }
    };
  }

  draw();
  return {
    get done() {
      return done;
    },
    complete() {
      done = true;
    },
    miss() {
      ctx.mistake();
      wrong += 1;
      draw();
    },
    succeed() {
      done = true;
      drawHint();
      const n = drawSide();
      const shownHints = side.hintsShown(hintsUsed);
      side.succeed({
        line: `${n} of ${MAX_STARS} stars: ${wrong} ${noun(wrong)}, ${shownHints} hint${shownHints === 1 ? '' : 's'}.`,
      });
    },
  };
}
