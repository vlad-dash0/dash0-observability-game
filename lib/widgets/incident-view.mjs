// Incident board view (docs/M1-DESIGN.md §4.3; #143): the alert, the error budget in minutes
// (cells, a minutes-left headline, a preview of the tile in hand, a Spent-on row), Step 1
// Investigate (view tiles, a status bar), the evidence log (newest card on top, older cards
// folded), Step 2 Unlock the causes (clues found, the lock line) and Step 3 Name the cause,
// beside the kit's side column (score, hints, success card). Everything is built from the UI
// kit (lib/ui, #158) off ONE typed contract, `boardView(s, st, ui)`: the templates only render
// it, and nothing here repeats a rule of the engine (lib/widgets/incident.mjs: the budget is
// `budgetLeft`, a clue count is `cluesFound`, the unlock rule is `canAnswer`).
//
// mountIncident is the only home of the incident penalties (I1), all through the one
// `penalise(kind)` (ctx.mistake() and the tally the side column shows, so the two never
// disagree): the first open of a misleading view, the open that spends the last of the budget
// and a wrong pick each cost one; a repeat open, a repeat wrong pick and a pick while the
// causes are locked are free. Each hint tier costs one ctx.hint(). D7: an open says what
// happened in the status bar under the tiles (neutral; error when it costs a star; success
// when it unlocks the causes), a pick in the feedback under the causes (error when wrong).
// Labels, alert and view html are trusted authored HTML. No timers (I2): "time" is minutes
// the player's actions spend. DOM-free at import time.

import { escapeHtml } from '../lesson-kit.mjs';
import { canFocus } from './focus.mjs';
import { answer, budgetLeft, canAnswer, cluesFound, newIncident, openView, validateScenario } from './incident.mjs';
import { countClues, hintFor } from './incident-help.mjs';
import { HINT_TIERS, mountSide, ruleText } from './help-ladder.mjs';
import { playSwirl } from '../swirl-render.mjs';
import {
  chip, clearFeedback, dots, eyebrow, feedback, fold, meter, note, option, options, panel, prose, setFeedback, sideColumn, split, stepHead,
} from '../ui/index.mjs';

/** The most cells the kit meter draws; a longer budget scales to it. */
const MAX_CELLS = 100;
/** The one display formatting of a number of minutes: one decimal, no float noise. */
const shown = (n) => Number(n.toFixed(1));

/** `list` (entries with an id) in the order of `ids`; entries `ids` omits keep their order, last. */
function inOrder(list, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return list;
  const at = (e) => {
    const i = ids.indexOf(e.id);
    return i === -1 ? ids.length : i;
  };
  return list.map((e, i) => [e, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([e]) => e);
}

/**
 * The display order of the tiles and of the causes, shuffled ONCE per board through
 * `ctx.shuffle` (the seam Choice uses) so authored order never gives the answer away. Pass the
 * result to both renderIncident and mountIncident so the board keeps one order for its life.
 * Returns `{viewOrder, causeOrder}` (id arrays); authored order when ctx has no shuffle.
 */
export function incidentOrder(ctx, s) {
  const mix = (list) => (typeof ctx?.shuffle === 'function' ? ctx.shuffle(list) : [...list]).map((e) => e.id);
  return { viewOrder: mix(s.views), causeOrder: mix(s.hypotheses) };
}

/** What costs a star on an incident board, and what does not. */
export const PENALTY = Object.freeze({
  costs: 'a misleading view, running out of budget, a wrong pick, a hint',
  free: 'Retrying is free.',
});

/** The score card's rule (the generic RULE in help-ladder.mjs names Build it's penalties). */
export const RULE = ruleText(PENALTY);

const LOCK_TEXT = {
  open: 'Unlocked. Pick the cause the evidence supports. A wrong pick costs a star.',
  solved: 'Solved.',
};
const CAUSE_MARK = { locked: 'locked', wrong: 'ruled out', correct: 'the cause' };

/**
 * The lesson card's body for an incident step: the boss's scenario line, then the generic
 * "How this board works" list, the same on every incident boss. It never says which views are
 * clues or what the cause is.
 */
export function incidentLesson(scenarioHtml) {
  return (
    `<p><strong>${scenarioHtml}</strong></p>` +
    `<ol aria-label="How this board works">` +
    `<li><b>Investigate.</b> Each evidence view costs minutes of error budget; the chip on each tile shows how many. ` +
    `Some views hold real clues, some show nothing useful, and a few will lead you astray.</li>` +
    `<li><b>Unlock the causes.</b> The possible causes stay locked until you have found enough real clues. The counter shows your progress.</li>` +
    `<li><b>Name the cause.</b> Pick the one the evidence supports.</li></ol>` +
    `<p>Misleading views, wrong picks and running out of budget each cost a star. Stuck? Hints on the right cost a star each.</p>`
  );
}

/**
 * The board as data. `ui` is what the player has done to the screen, not to the incident:
 * `preview` (the tile in hand), `fresh` (the view just opened), `hintViews` (tiles a hint
 * outlines), `hintCause` (the cause a hint outlines), `viewOrder` and `causeOrder` (id arrays:
 * the order tiles and causes are listed in; authored order when absent). Shape:
 *   id, alert {titleHtml, bodyHtml},
 *   budget {total, spent, left, over, cells, previewMin, previewCells, leftText, previewText},
 *   tiles [{id, labelHtml, costMin, opened, misleading, hinted, disabled}],
 *   spentOn [{id, labelHtml, costMin}], log [{id, labelHtml, costMin, misleading, bodyHtml, open, fresh}],
 *   clues {found, need} (null when no clue is needed first),
 *   lock {state: locked|open|solved, text},
 *   causes [{id, labelHtml, state: locked|wrong|correct|undefined, markHtml, hinted, disabled}].
 */
export function boardView(s, st, ui = {}) {
  const { preview = null, fresh = null, hintViews = [], hintCause = null, viewOrder = null, causeOrder = null } = ui;
  const hintSet = new Set(hintViews);
  const viewOf = (id) => s.views.find((v) => v.id === id);
  const burn = s.budget.burnPctPerMin;
  const total = s.budget.startPct / burn;
  const left = budgetLeft(s, st);
  const over = left === 0;
  const leftMin = shown(left / burn);
  const cells = Math.min(MAX_CELLS, Math.max(1, Math.ceil(total)));
  const previewMin = preview !== null && !st.opened.includes(preview) && !st.solved ? viewOf(preview)?.costMin ?? 0 : 0;
  const budget = {
    total: shown(total),
    spent: Math.min(shown(st.minutes), shown(total)),
    left: leftMin,
    over,
    cells,
    previewMin,
    previewCells: previewMin > 0 ? Math.max(1, Math.round((previewMin / total) * cells)) : 0,
    leftText: over ? 'Budget spent.' : `${leftMin} min left.`,
    previewText: previewMin > 0 ? `This look: ${shown(previewMin)} min.` : '',
  };
  const misleading = (v) => v.kind === 'herring' && st.opened.includes(v.id);
  const tiles = inOrder(s.views, viewOrder).map((v) => ({
    id: v.id,
    labelHtml: v.label,
    costMin: v.costMin,
    opened: st.opened.includes(v.id),
    misleading: misleading(v),
    hinted: hintSet.has(v.id) && !st.opened.includes(v.id) && !st.solved,
    disabled: st.solved,
  }));
  const spentOn = st.opened.map((id) => ({ id, labelHtml: viewOf(id).label, costMin: viewOf(id).costMin }));
  const log = [...st.opened].reverse().map((id) => {
    const v = viewOf(id);
    return { id, labelHtml: v.label, costMin: v.costMin, misleading: misleading(v), bodyHtml: v.html, open: id === fresh, fresh: id === fresh };
  });
  const need = s.answerAfterViews;
  const found = Math.min(cluesFound(s, st), need);
  const lockState = st.solved ? 'solved' : canAnswer(s, st) ? 'open' : 'locked';
  const lock = {
    state: lockState,
    text:
      lockState === 'locked'
        ? `Locked until you find ${countClues(need)} in Step 1 (${found} of ${need} so far). A clue is a view that helps explain the alert.`
        : LOCK_TEXT[lockState],
  };
  const causes = inOrder(s.hypotheses, causeOrder).map((h) => {
    const state = st.solved && h.right ? 'correct' : st.wrong.includes(h.id) ? 'wrong' : lockState === 'locked' ? 'locked' : undefined;
    return {
      id: h.id,
      labelHtml: h.label,
      state,
      markHtml: state === undefined ? undefined : CAUSE_MARK[state],
      hinted: hintCause === h.id && !st.solved,
      disabled: st.solved,
    };
  });
  return {
    id: s.id,
    alert: { titleHtml: s.alert.title, bodyHtml: s.alert.html },
    budget,
    tiles,
    spentOn,
    log,
    clues: need > 0 ? { found, need } : null,
    lock,
    causes,
  };
}

// ---- templates: each renders a piece of the contract, nothing else ----

function budgetHtml(v) {
  const b = v.budget;
  const preview = b.previewText === '' ? '' : ` <span data-preview-text>${b.previewText}</span>`;
  const spent = v.spentOn.length
    ? `<div data-spent-on>${note(`Spent on: ${v.spentOn.map((x) => chip({ text: `${x.labelHtml} ${x.costMin} min` })).join(' ')}`)}</div>`
    : '';
  return (
    note(`<strong data-budget-text>${b.leftText}</strong>${preview}`) +
    meter({ id: `${v.id}-meter`, label: 'Error budget', value: b.spent, max: b.total, cells: b.cells, unit: 'min spent', previewCells: b.previewCells, over: b.over }) +
    spent
  );
}

function tilesHtml(v) {
  const itemsHtml = v.tiles
    .map((t) => {
      const chips = [chip({ text: `${t.costMin} min` })];
      if (t.opened) chips.push(chip({ text: 'opened' }));
      if (t.misleading) chips.push(chip({ text: 'misleading', tone: 'error', dot: true }));
      return option({
        attr: 'view',
        value: t.id,
        labelHtml: t.labelHtml,
        metaHtml: chips.join(''),
        kind: 'tile',
        state: t.opened ? 'opened' : undefined,
        hinted: t.hinted,
        disabled: t.disabled,
      });
    })
    .join('');
  return options({ layout: 'grid', itemsHtml });
}

function logHtml(v) {
  if (v.log.length === 0) return note('Nothing opened yet. Pick a view in Step 1 and its evidence lands here.');
  return v.log
    .map((c) =>
      fold({
        value: c.id,
        titleHtml: c.labelHtml,
        metaHtml: chip({ text: `${c.costMin} min` }) + (c.misleading ? chip({ text: 'misleading', tone: 'error', dot: true }) : ''),
        bodyHtml: prose(c.bodyHtml),
        open: c.open,
        fresh: c.fresh,
      }),
    )
    .join('');
}

function unlockHtml(v) {
  const c = v.clues;
  const counter = c === null ? undefined : `<span data-clues>${dots({ total: c.need, on: c.found, decorative: true })} Clues found: ${c.found} of ${c.need}</span>`;
  return (
    stepHead({ step: 2, titleHtml: 'Unlock the causes', noteHtml: counter }) +
    note(`<span id="${v.id}-lock" data-lock="${v.lock.state}">${v.lock.text}</span>`)
  );
}

function causesHtml(v) {
  const itemsHtml = v.causes
    .map((c) =>
      option({
        attr: 'hypothesis',
        value: c.id,
        labelHtml: c.labelHtml,
        metaHtml: c.markHtml,
        kind: 'hypothesis',
        state: c.state,
        hinted: c.hinted,
        disabled: c.disabled,
      }),
    )
    .join('');
  return options({ layout: 'list', itemsHtml });
}

/**
 * Markup for Scenario `s` in state `st`, inside a wide step (a kit split: the board, then the
 * side column). The third argument carries `{viewOrder, causeOrder}` from incidentOrder. Regions the mount redraws are `[data-region]`; `#<id>-status` and
 * `#<id>-feedback` are the kit feedback regions; the causes group is described by `#<id>-lock`.
 */
export function renderIncident(s, st, { viewOrder, causeOrder } = {}) {
  const v = boardView(s, st, { viewOrder, causeOrder });
  const id = v.id;
  const alert = panel({
    id: `${id}-alert`,
    variant: 'alert',
    headHtml: `${eyebrow('Firing')}<h3>${v.alert.titleHtml}</h3>`,
    sections: [v.alert.bodyHtml],
  });
  const board = panel({
    sections: [
      `<div data-region="budget">${budgetHtml(v)}</div>`,
      stepHead({ step: 1, titleHtml: 'Investigate', noteHtml: 'Open evidence. Each look costs the minutes on its chip.' }) +
        `<div data-region="tiles">${tilesHtml(v)}</div>${feedback({ id: `${id}-status`, bar: true })}`,
      `${eyebrow('Evidence')}${note('Newest on top. Older cards fold; open any to compare.')}<div data-region="log">${logHtml(v)}</div>`,
      `<div data-region="unlock">${unlockHtml(v)}</div>`,
      stepHead({ step: 3, titleHtml: 'Name the cause' }) +
        `<div data-region="causes" role="group" aria-label="Causes" aria-describedby="${id}-lock">${causesHtml(v)}</div>` +
        feedback({ id: `${id}-feedback` }),
    ],
  });
  const side = sideColumn({
    id,
    titleHtml: 'Incident resolved',
    counts: [{ key: 'wrong', label: '' }, { key: 'misleading', label: 'misleading' }, { key: 'budget', label: 'ran out of budget' }],
    hints: true,
    ruleHtml: RULE,
  });
  return `<div data-incident="${escapeHtml(id)}">${split({ mainHtml: alert + board, sideHtml: side })}</div>`;
}

/**
 * Wire Scenario `s` (rendered by renderIncident into ctx.ovBody) from a fresh state and focus
 * its first tile. Opening a view puts its card on top of the evidence log, open, and focuses
 * its heading; hovering or focusing a tile previews its cost on the meter (property handlers,
 * CSP). A repeat open reopens the card and is free. A pick while the causes are locked says
 * why and is free; a wrong pick is ruled out (data-state=wrong) but stays clickable and free.
 * The right cause explains, closes the board, calls onComplete() once (it enables Finish) and
 * focuses the success card's heading. `swirl` replaces the success accent (tests). Throws
 * TypeError (naming the scenario id) for an invalid scenario, a missing onComplete, or a
 * scenario that is not rendered. `viewOrder`/`causeOrder` (from incidentOrder, the same ones
 * given to renderIncident) fix the list order; absent, mount shuffles its own once.
 */
export function mountIncident(ctx, s, { onComplete, swirl = playSwirl, viewOrder, causeOrder } = {}) {
  const problems = validateScenario(s);
  const fail = (msg) => {
    throw new TypeError(`incident "${String(s?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid scenario: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-incident="${s.id}"]`);
  const region = (name) => box?.querySelector(`[data-region="${name}"]`);
  const part = (name) => box?.querySelector(`[id="${s.id}-${name}"]`);
  const [budgetEl, tilesEl, logEl, unlockEl, causesEl] = ['budget', 'tiles', 'log', 'unlock', 'causes'].map(region);
  const statusEl = part('status');
  const fb = part('feedback');
  const hintBtn = part('hint');
  if (!budgetEl || !tilesEl || !logEl || !unlockEl || !causesEl || !statusEl || !fb || !hintBtn || !part('win')) {
    fail('not rendered (use renderIncident with the same scenario)');
  }

  const side = mountSide(ctx, box, s.id, { swirl });
  const focusOn = (el, fallback = statusEl) => (canFocus(el) ? el : fallback).focus();
  const viewOf = (id) => s.views.find((v) => v.id === id);
  const tellStatus = (tone, html) => setFeedback(statusEl, tone, html);
  const tellPick = (tone, html) => setFeedback(fb, tone, html);
  const scrollTo = (el) => {
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: ctx.reduceMotion ? 'auto' : 'smooth' });
  };

  let st = newIncident(s);
  const tally = { wrong: 0, misleading: 0, budget: 0 };
  let hintsUsed = 0;
  let tier = 0;
  const order = viewOrder && causeOrder ? { viewOrder, causeOrder } : incidentOrder(ctx, s);
  let ui = { preview: null, fresh: null, hintViews: [], hintCause: null, ...order };

  /** The one place a penalty is paid: ctx.mistake() and the tally the side column shows. */
  function penalise(kind) {
    ctx.mistake();
    tally[kind] += 1;
  }

  const view = () => boardView(s, st, ui);

  function drawBudget() {
    budgetEl.innerHTML = budgetHtml(view());
  }

  function setPreview(id) {
    if (ui.preview === id) return;
    ui = { ...ui, preview: id };
    drawBudget();
  }

  function drawTiles() {
    tilesEl.innerHTML = tilesHtml(view());
    for (const b of tilesEl.querySelectorAll('[data-view]')) {
      const id = b.dataset.view;
      b.onclick = () => open(id);
      b.onfocus = b.onpointerenter = () => setPreview(id);
      b.onblur = b.onpointerleave = () => setPreview(null);
    }
  }

  function drawCauses() {
    causesEl.innerHTML = causesHtml(view());
    for (const b of causesEl.querySelectorAll('[data-hypothesis]')) {
      const id = b.dataset.hypothesis;
      b.onclick = () => guess(id);
    }
  }

  /** The side column from the tally; returns the stars now. */
  function drawSide() {
    const n = side.score({
      wrong: tally.wrong,
      wrongLabel: tally.wrong === 1 ? 'wrong pick' : 'wrong picks',
      hints: hintsUsed,
      more: { misleading: tally.misleading, budget: tally.budget },
      done: st.solved,
    });
    const spent = st.solved || tier >= HINT_TIERS;
    side.hintUi({
      label: st.solved ? 'Solved' : spent ? 'No more hints' : `Hint ${tier + 1} of ${HINT_TIERS}`,
      disabled: spent,
      tierHtml: `${tier} of ${HINT_TIERS} used ${dots({ total: HINT_TIERS, on: tier, decorative: true, tone: 'hint' })}`,
    });
    return n;
  }

  /** Everything that changes with the state, except the evidence log (only an open changes that). */
  function draw() {
    ui = { ...ui, preview: null };
    drawBudget();
    drawTiles();
    unlockEl.innerHTML = unlockHtml(view());
    drawCauses();
    return drawSide();
  }

  function drawLog() {
    logEl.innerHTML = logHtml(view());
  }

  function open(id) {
    const r = openView(s, st, id);
    if (r.outcome === 'closed' || r.outcome === 'unknown') return;
    const name = `<b>${viewOf(id).label}</b>`;
    if (r.outcome === 'repeat') {
      tellStatus('neutral', `${name} is already open. No extra time.`);
      const card = logEl.querySelector(`[data-fold="${id}"]`);
      card.setAttribute('open', '');
      focusOn(card.querySelector('[data-heading]'));
      scrollTo(card);
      return;
    }
    const wasLocked = !canAnswer(s, st);
    st = r.state;
    const unlockedNow = wasLocked && canAnswer(s, st);
    if (unlockedNow) clearFeedback(fb); // the "Not yet" line from a locked pick is stale now
    if (r.herring) penalise('misleading');
    if (r.exhaustedNow) penalise('budget');
    if (r.herring && r.exhaustedNow) tellStatus('error', `${name} was misleading, and the error budget is spent. Each costs a star.`);
    else if (r.herring) tellStatus('error', `${name} was misleading: it does not explain the alert. That costs a star.`);
    else if (r.exhaustedNow) {
      tellStatus('error', `The error budget is spent, which costs a star.${unlockedNow ? ' The causes in Step 3 are now unlocked.' : ''} You can keep investigating.`);
    } else if (unlockedNow) {
      tellStatus('success', `Opened ${name}. That is ${countClues(s.answerAfterViews)}: the causes in Step 3 are unlocked below.`);
    } else tellStatus('neutral', `Opened ${name} (${shown(viewOf(id).costMin)} min). Its card is at the top of Evidence.`);
    ui = { ...ui, fresh: id };
    draw();
    drawLog();
    ui = { ...ui, fresh: null };
    const heading = logEl.querySelector(`[data-heading="${id}"]`);
    focusOn(heading);
    scrollTo(heading.closest('[data-fold]'));
  }

  function guess(id) {
    const r = answer(s, st, id);
    const h = s.hypotheses.find((x) => x.id === id);
    if (r.outcome === 'locked') {
      const need = s.answerAfterViews;
      tellPick('neutral', `Not yet. Find ${countClues(need)} in Step 1 first: you have ${Math.min(cluesFound(s, st), need)} of ${need}. Picking now costs nothing.`);
      return;
    }
    if (r.outcome === 'repeat') {
      tellPick('neutral', `${h.label} is already ruled out. No extra cost.`);
      return;
    }
    if (r.outcome === 'closed' || r.outcome === 'unknown') return;
    st = r.state;
    if (r.outcome === 'right') {
      ui = { ...ui, hintViews: [], hintCause: null };
      tellPick('success', `Right. ${h.label}. ${h.why}`);
      const n = draw();
      onComplete();
      const count = (k, one, many) => `${tally[k]} ${tally[k] === 1 ? one : many}`;
      side.succeed({
        line:
          `${n} of 5 stars: ${count('wrong', 'wrong pick', 'wrong picks')}, ${count('misleading', 'misleading view', 'misleading views')}, ` +
          `${hintsUsed} ${hintsUsed === 1 ? 'hint' : 'hints'}${tally.budget > 0 ? ', ran out of budget' : ''}. ${shown(st.minutes)} min used.`,
      });
      return;
    }
    penalise('wrong');
    if (ui.hintCause === id) ui = { ...ui, hintCause: null };
    tellPick('error', `Not quite. ${h.label} is not the cause. ${h.why}`);
    draw();
    const listed = view().causes;
    const at = listed.findIndex((x) => x.id === id);
    const after = [...listed.slice(at + 1), ...listed.slice(0, at)];
    const next = after.find((x) => !st.wrong.includes(x.id));
    focusOn(next && causesEl.querySelector(`[data-hypothesis="${next.id}"]`), fb);
  }

  hintBtn.onclick = () => {
    if (st.solved || tier >= HINT_TIERS) return;
    tier += 1;
    hintsUsed += 1;
    ctx.hint();
    const h = hintFor(s, st, tier);
    ui = { ...ui, hintViews: h.views, hintCause: h.hypothesis };
    draw();
    side.showHint(`<p><b>Hint ${tier} of ${HINT_TIERS}</b></p>${h.html}`);
  };

  draw();
  drawLog();
  focusOn(tilesEl.querySelector('[data-view]'));
  setPreview(null);
}
