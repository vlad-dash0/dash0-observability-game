// Incident engine core (docs/M1-DESIGN.md §4.3): validate a Scenario, open views, answer
// hypotheses, track the error budget. Pure and DOM-free; "time" is simulated minutes that
// actions advance (I2), state is never mutated. The view and its penalties live in
// `incident-view.mjs` (`mountIncident`, I1).
//
// Scenario = { id, alert: {title, html}, budget: {startPct 1..100, burnPctPerMin > 0},
//   views: [{id, label, costMin, html, kind: clue|herring|neutral}],
//   hypotheses: [{id, label, right, why}], answerAfterViews (clue views to open first) }
// IncidentState = { opened: viewId[], minutes, wrong: hypothesisId[], solved }
// Plain data on purpose: a declarative level format can carry it unchanged.

import { isId } from '../registry.mjs';

export const VIEW_KINDS = ['clue', 'herring', 'neutral'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const show = (v) => (typeof v === 'string' ? `"${v}"` : String(v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function checkEntries(list, kind, problems) {
  if (!Array.isArray(list) || list.length === 0) {
    problems.push(`${kind}s: not a non-empty list`);
    return [];
  }
  const seen = new Set();
  list.forEach((e, i) => {
    if (!isObject(e)) return problems.push(`${kind} ${i}: not an object`);
    if (!isId(e.id)) problems.push(`${kind} id ${show(e.id)} is not kebab-case`);
    else if (seen.has(e.id)) problems.push(`duplicate ${kind} id ${show(e.id)}`);
    seen.add(e.id);
    if (!isText(e.label)) problems.push(`${kind} ${show(e.id)}: label is not non-empty text`);
  });
  return list.filter(isObject);
}

/** Every problem with `s` (empty when valid). Never throws, never stops at the first. */
export function validateScenario(s) {
  const problems = [];
  if (!isObject(s)) return ['scenario: not an object'];
  if (!isId(s.id)) problems.push(`scenario id ${show(s.id)} is not kebab-case`);
  if (!isObject(s.alert) || !isText(s.alert.title) || !isText(s.alert.html)) {
    problems.push('alert: needs non-empty title and html');
  }
  const b = isObject(s.budget) ? s.budget : {};
  const budgetOk = isNum(b.startPct) && b.startPct >= 1 && b.startPct <= 100 && isNum(b.burnPctPerMin) && b.burnPctPerMin > 0;
  if (!isNum(b.startPct) || b.startPct < 1 || b.startPct > 100) problems.push('budget: startPct must be 1..100');
  if (!isNum(b.burnPctPerMin) || b.burnPctPerMin <= 0) problems.push('budget: burnPctPerMin must be > 0');
  const views = checkEntries(s.views, 'view', problems);
  for (const v of views) {
    const name = `view ${show(v.id)}`;
    if (!isNum(v.costMin) || v.costMin < 0) problems.push(`${name}: costMin must be a number >= 0`);
    if (!VIEW_KINDS.includes(v.kind)) problems.push(`${name}: kind must be one of ${VIEW_KINDS.join('|')}`);
    if (!isText(v.html)) problems.push(`${name}: html is not non-empty text`);
  }
  const hyps = checkEntries(s.hypotheses, 'hypothesis', problems);
  for (const h of hyps) {
    if (typeof h.right !== 'boolean') problems.push(`hypothesis ${show(h.id)}: right must be a boolean`);
    if (!isText(h.why)) problems.push(`hypothesis ${show(h.id)}: why is not non-empty text`);
  }
  const rights = hyps.filter((h) => h.right === true).length;
  if (rights !== 1) problems.push(`exactly one hypothesis must be right, found ${rights}`);
  const clues = views.filter((v) => v.kind === 'clue');
  if (clues.length === 0) problems.push('views: at least one clue is required');
  if (!Number.isInteger(s.answerAfterViews) || s.answerAfterViews < 0 || s.answerAfterViews > clues.length) {
    problems.push(`answerAfterViews must be an integer 0..${clues.length} (the number of clues)`);
  }
  const clueMin = clues.reduce((sum, v) => sum + (isNum(v.costMin) ? v.costMin : 0), 0);
  if (budgetOk && b.startPct - clueMin * b.burnPctPerMin <= 0) {
    problems.push(`budget: clues cost ${clueMin} min, which burns the whole budget (all clues must be affordable)`);
  }
  return problems;
}

/** A fresh state: nothing opened, no time passed. */
export function newIncident(_s) {
  return { opened: [], minutes: 0, wrong: [], solved: false };
}

/** Budget left, 0..startPct. The ONLY budget expression (meter value and text use it). */
export function budgetLeft(s, st) {
  return Math.max(0, s.budget.startPct - st.minutes * s.budget.burnPctPerMin);
}

/**
 * Open view `id`: `{state, outcome, herring, exhaustedNow}`. Outcome: 'closed' (already
 * solved), 'unknown', 'repeat' (already opened; free) or 'opened' (costs `costMin`).
 * `herring` is true only on the first open of a herring; `exhaustedNow` only on the open
 * that takes the budget from above 0 to 0. Never mutates `st`.
 */
export function openView(s, st, id) {
  const none = { state: st, herring: false, exhaustedNow: false };
  if (st.solved) return { ...none, outcome: 'closed' };
  const view = s.views.find((v) => v.id === id);
  if (!view) return { ...none, outcome: 'unknown' };
  if (st.opened.includes(id)) return { ...none, outcome: 'repeat' };
  const state = { ...st, opened: [...st.opened, id], minutes: st.minutes + view.costMin };
  return {
    state,
    outcome: 'opened',
    herring: view.kind === 'herring',
    exhaustedNow: budgetLeft(s, st) > 0 && budgetLeft(s, state) === 0,
  };
}

/**
 * True once at least `answerAfterViews` CLUE views are open and the incident is not solved.
 * The ONE statement of the unlock rule: neutral and herring opens never count.
 */
export function canAnswer(s, st) {
  const clues = st.opened.filter((id) => s.views.find((v) => v.id === id)?.kind === 'clue').length;
  return !st.solved && clues >= s.answerAfterViews;
}

/**
 * Answer with hypothesis `id`: `{state, outcome}`. Outcome: 'closed' (already solved),
 * 'locked' (not yet answerable), 'unknown', 'repeat' (already wrong; free), 'right', 'wrong'.
 */
export function answer(s, st, id) {
  if (st.solved) return { state: st, outcome: 'closed' };
  if (!canAnswer(s, st)) return { state: st, outcome: 'locked' };
  const h = s.hypotheses.find((x) => x.id === id);
  if (!h) return { state: st, outcome: 'unknown' };
  if (st.wrong.includes(id)) return { state: st, outcome: 'repeat' };
  if (h.right) return { state: { ...st, solved: true }, outcome: 'right' };
  return { state: { ...st, wrong: [...st.wrong, id] }, outcome: 'wrong' };
}
