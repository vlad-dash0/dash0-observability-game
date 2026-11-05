// Readers for the incident board on the kit (#143; lib/widgets/incident-view.mjs), shared by
// test/incident-view.test.mjs and the six boss tests, so a selector lives in one place. Each
// returns strings, numbers, booleans or arrays of them, never a node (comparing nodes makes
// node inspect linkedom's whole graph). `id` is the scenario id.
//
// The board, as these readers see it:
//   [data-incident="<id>"]             the board root
//   .ui-panel--alert h3                the alert title (kit panel, alert variant)
//   .ui-meter                          the budget meter: .ui-meter-value "S of T min spent",
//                                      [data-cell] spent|over|preview|left; the headline
//                                      "N min left." (or "Budget spent.") is a text line of its own
//   [data-view="<view>"]               a tile (kit option, tile kind), data-hinted when outlined
//   "Spent on" row                     one kit chip per opened view, "<label> <N> min"
//   details [data-heading="<view>"]    an evidence card (kit fold) and its focusable heading
//   [data-clues]                       "Clues found: F of N" with kit dots (absent when N is 0)
//   #<id>-lock                         the lock line; the causes group is described by it
//   [data-hypothesis="<cause>"]        a cause (kit option, hypothesis kind), data-state
//   #<id>-status, #<id>-feedback       kit feedback regions: opens, then picks (D7 tones)
//   #<id>-hint, -hint-text, -win, -win-title, -wrong, -misleading, -budget, -hints, -stars
//                                      the kit side column
import { q, qa } from './dom.mjs';

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const root = (id) => q(`[data-incident="${id}"]`);
/** Trimmed text of `sel`, or null when it is absent. */
export const text = (sel) => {
  const el = q(sel);
  return el ? squash(el.textContent) : null;
};

/** The alert panel's title. */
export const alertTitle = (id) => text(`[data-incident="${id}"] .ui-panel--alert h3`);

/** The deepest element under `el` whose own text matches `re`, as text, or null. */
function line(el, re) {
  const hits = [...el.querySelectorAll('*')].filter((n) => re.test(squash(n.textContent)));
  const leaf = hits.find((n) => !hits.some((m) => m !== n && n.contains(m)));
  return leaf ? squash(leaf.textContent) : null;
}

/** The budget meter: the headline, the spent line, the preview line and the cells by kind. */
export function budget(id) {
  const box = root(id);
  const m = box.querySelector('.ui-meter');
  const cells = [...m.querySelectorAll('[data-cell]')].map((c) => c.getAttribute('data-cell'));
  const count = (k) => cells.filter((c) => c === k).length;
  return {
    left: line(box, /^(?:[\d.]+ min left\.|Budget spent\.)$/),
    spent: squash(m.querySelector('.ui-meter-value').textContent),
    look: line(box, /^This look: [\d.]+ min\.$/),
    cells: { total: cells.length, spent: count('spent'), over: count('over'), preview: count('preview'), left: count('left') },
  };
}

/** The "Spent on" chips as [label, minutes] in the order shown, or null when the row is absent. */
export function spentOn(id) {
  const box = root(id);
  const row = [...box.querySelectorAll('*')].find((n) => /^Spent on/.test(squash(n.textContent)) && n.querySelector('.ui-chip'));
  if (!row) return null;
  return [...row.querySelectorAll('.ui-chip')].map((c) => {
    const m = /^(.*?)\s+([\d.]+)\s*min$/.exec(squash(c.textContent));
    return m ? [m[1], Number(m[2])] : [squash(c.textContent), Number.NaN];
  });
}

/** The evidence cards, newest first: `<view>:open` or `<view>:closed`. */
export const cards = (id) =>
  [...root(id).querySelectorAll('details')].map((d) => `${d.querySelector('[data-heading]').getAttribute('data-heading')}:${d.hasAttribute('open') ? 'open' : 'closed'}`);

/** The evidence card of `view` (for toggling it as a player would). */
export const card = (id, view) => root(id).querySelector(`[data-heading="${view}"]`).closest('details');

/** Each cause's aria-disabled, joined: 'true,true,...' while locked. */
export const locked = (id) => qa(`[data-incident="${id}"] [data-hypothesis]`).map((b) => String(b.getAttribute('aria-disabled') === 'true')).join();

/** A cause's data-state (locked, wrong, correct), or null. */
export const causeState = (id, cause) => q(`[data-incident="${id}"] [data-hypothesis="${cause}"]`).getAttribute('data-state');

/** The clue counter's text, or null when the board needs no clue. */
export const clues = (id) => text(`[data-incident="${id}"] [data-clues]`);

/** The clue counter's filled dots. */
export const cluesOn = (id) => qa(`[data-incident="${id}"] [data-clues] [data-on="true"]`).length;

/** The lock line's text, or null. */
export const lockLine = (id) => text(`[id="${id}-lock"]`);

/** A kit feedback region (`status` or `feedback`): its text and tone. */
export function region(id, part) {
  const el = q(`[id="${id}-${part}"]`);
  return { text: squash(el.querySelector('[data-feedback-text]').textContent), tone: el.getAttribute('data-tone'), hidden: el.hasAttribute('hidden') };
}

/** The side column's counts. */
export const tally = (id) =>
  Object.fromEntries(['wrong', 'misleading', 'budget', 'hints'].map((k) => [k, Number(text(`[id="${id}-${k}"]`))]));

/** The views and causes outlined by a hint, as `view:<id>` and `cause:<id>`. */
export const hinted = (id) => [
  ...qa(`[data-incident="${id}"] [data-view][data-hinted]`).map((b) => `view:${b.getAttribute('data-view')}`),
  ...qa(`[data-incident="${id}"] [data-hypothesis][data-hinted]`).map((b) => `cause:${b.getAttribute('data-hypothesis')}`),
];

/**
 * Fire `type` on `el` as a browser would: its `on<type>` handler if it has one, else a
 * dispatched event (and the bubbling twin a delegated listener would hear).
 */
export function fire(el, type) {
  if (typeof el[`on${type}`] === 'function') return void el[`on${type}`]({ type, currentTarget: el, target: el });
  const twin = { focus: 'focusin', blur: 'focusout', pointerenter: 'pointerover', pointerleave: 'pointerout' }[type];
  const { Event } = globalThis.window;
  el.dispatchEvent(new Event(type, { bubbles: false }));
  if (twin) el.dispatchEvent(new Event(twin, { bubbles: true }));
}

/** Minutes left from the engine's one budget expression, the way the board shows it (one decimal). */
export const minutesShown = (n) => Number(n.toFixed(1));

/** The text of `view`'s evidence card (its body as well as its summary), or null before it is opened. */
export function cardText(id, view) {
  const h = root(id).querySelector(`[data-heading="${view}"]`);
  return h ? squash(h.closest('details').textContent) : null;
}
