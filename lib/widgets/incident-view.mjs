// Incident engine view (docs/M1-DESIGN.md §4.3): markup for a Scenario and IncidentState,
// and mountIncident, the only home of the incident penalties (I1): first open of a herring,
// the open that exhausts the budget, and a wrong hypothesis each cost one mistake; a repeat
// open or answer is free. Labels, alert and view html are trusted authored HTML; ids are
// escaped. The budget is formatted only from `budgetLeft`. DOM-free at import time.

import { canFocus } from './focus.mjs';
import { answer, budgetLeft, canAnswer, newIncident, openView, validateScenario } from './incident.mjs';

/** The alert, the budget meter and text, view buttons, opened panels and hypothesis buttons. */
function boardHtml(s, st, e) {
  const left = budgetLeft(s, st);
  const views = s.views
    .map((v) => `<button class="incident-view" data-view="${e(v.id)}"${st.solved ? ' disabled' : ''}>${v.label} (${v.costMin} min)</button>`)
    .join('');
  const panels = s.views
    .filter((v) => st.opened.includes(v.id))
    .map((v) => `<section class="incident-panel" data-panel="${e(v.id)}"><h4 tabindex="-1" data-heading="${e(v.id)}">${v.label}</h4>${v.html}</section>`)
    .join('');
  const answerable = canAnswer(s, st);
  const hyps = s.hypotheses
    .map((h) => `<button class="incident-hypothesis" data-hypothesis="${e(h.id)}"${answerable && !st.wrong.includes(h.id) ? '' : ' disabled'}>${h.label}</button>`)
    .join('');
  return (
    `<div class="incident-alert"><h3>${s.alert.title}</h3>${s.alert.html}</div>` +
    `<div class="incident-budget"><meter min="0" max="100" value="${left}"></meter>` +
    `<p data-budget-text>Error budget: ${left}% left (${st.minutes} min in).</p></div>` +
    `<div class="incident-views">${views}</div><div class="incident-panels">${panels}</div>` +
    `<div class="incident-hypotheses">${hyps}</div>`
  );
}

/**
 * Markup for Scenario `s` in state `st`: the alert, `<meter min=0 max=100 value=…>` with
 * `Error budget: N% left (M min in).`, view buttons `Label (N min)`, opened panels with
 * `tabindex="-1"` headings, hypothesis buttons (disabled until canAnswer), then the
 * `#<id>-feedback` status region.
 */
export function renderIncident(s, st, { escapeHtml: e } = {}) {
  return (
    `<div class="incident" data-incident="${e(s.id)}">` +
    `<div class="incident-board" data-incident-board>${boardHtml(s, st, e)}</div>` +
    `<div class="feedback" id="${e(s.id)}-feedback" role="status" aria-live="polite" tabindex="-1"></div>` +
    `</div>`
  );
}

/**
 * Wire Scenario `s` (rendered by renderIncident into ctx.ovBody) from a fresh state.
 * Opening a view shows its panel and focuses its heading. A herring's first open and the
 * open that spends the last of the budget each cost ctx.mistake(); a wrong hypothesis
 * costs one and is disabled; the right one explains, closes the board, and calls
 * onComplete() once, focusing its return if it passes canFocus, else the feedback.
 * Throws TypeError (naming the scenario id) for an invalid scenario, a missing
 * onComplete, or a scenario that is not rendered.
 */
export function mountIncident(ctx, s, { onComplete } = {}) {
  const problems = validateScenario(s);
  const fail = (msg) => {
    throw new TypeError(`incident "${String(s?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid scenario: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-incident="${s.id}"]`);
  const board = box?.querySelector('[data-incident-board]');
  const fb = box?.querySelector(`[id="${s.id}-feedback"]`);
  if (!board || !fb) fail('not rendered (use renderIncident with the same scenario)');

  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };
  let st = newIncident(s);

  function open(id) {
    const r = openView(s, st, id);
    st = r.state;
    if (r.herring) ctx.mistake();
    if (r.exhaustedNow) ctx.mistake();
    const view = s.views.find((v) => v.id === id);
    if (r.herring) say('info', `${view.label} was a red herring: it does not explain the alert.`);
    else if (r.exhaustedNow) say('info', 'The error budget is spent. You can keep investigating, but the clock has run out.');
    else if (r.outcome === 'opened') say('info', `Opened ${view.label}.`);
    else if (r.outcome === 'repeat') say('info', `${view.label} is already open.`);
    if (r.herring && r.exhaustedNow) say('info', `${view.label} was a red herring, and the error budget is spent.`);
    draw();
    focusOn(board.querySelector(`[data-heading="${id}"]`));
  }

  function guess(id) {
    const r = answer(s, st, id);
    st = r.state;
    const h = s.hypotheses.find((x) => x.id === id);
    if (r.outcome === 'right') {
      say('good', `Right. ${h.label}. ${h.why}`);
      draw();
      focusOn(onComplete());
      return;
    }
    if (r.outcome === 'wrong') {
      ctx.mistake();
      say('info', `Not quite. ${h.label} is not the cause. ${h.why}`);
    }
    draw();
    const at = s.hypotheses.findIndex((x) => x.id === id);
    const order = [...s.hypotheses.slice(at + 1), ...s.hypotheses.slice(0, at + 1)];
    const next = order.map((x) => board.querySelector(`[data-hypothesis="${x.id}"]`)).find((b) => b && !b.disabled);
    focusOn(next ?? board.querySelector('[data-view]'));
  }

  function draw() {
    board.innerHTML = boardHtml(s, st, ctx.escapeHtml);
    for (const b of board.querySelectorAll('[data-view]')) {
      b.onclick = () => {
        if (!b.disabled) open(b.dataset.view);
      };
    }
    for (const b of board.querySelectorAll('[data-hypothesis]')) {
      b.onclick = () => {
        if (!b.disabled) guess(b.dataset.hypothesis);
      };
    }
  }

  draw();
  focusOn(board.querySelector('[data-view]'));
}
