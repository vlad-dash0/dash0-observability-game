// lib/widgets/incident-view.mjs on the kit (#143): the incident board (alert panel, a budget
// meter in minutes counting down, tiles, Spent on, the evidence log, the clue counter, the lock
// line, the causes, the side column), its penalties and its focus. Spec: docs/M1-DESIGN.md
// §4.3; the RED spec V1-V14. The fixture is 20 minutes (100% at 5%/min) with view costs
// 3/4/6/2, unlike any boss. Strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import {
  alertTitle, budget, card, cards, causeState, clues, cluesOn, fire, hinted, locked, lockLine, minutesShown, region, spentOn, tally, text,
} from './helpers/incident-board.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { frac, incidentScenario, rightLast, slow, threeClues, tight, zero } from './fixtures/incident-scenario.mjs';
import { budgetLeft, newIncident, openView } from '../lib/widgets/incident.mjs';
import { boardStars, starsLabel } from '../lib/widgets/help-ladder.mjs';
import { incidentOrder, mountIncident, renderIncident } from '../lib/widgets/incident-view.mjs';
import { withGuide } from './helpers/guide-ctx.mjs';

const ID = 'checkout-slow';

/**
 * Render and mount `s`. `shuffle` is ctx.shuffle (identity unless a test needs another order;
 * the tests below select tiles and causes by id). `order` is incidentOrder's result, passed to
 * both renderIncident and mountIncident, as a level would.
 */
function setup(s = incidentScenario(), { shuffle = (a) => [...a], order } = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, hints: 0, done: 0 };
  const ctx = {
    ovBody: dom.body,
    ovActions: dom.actions,
    escapeHtml,
    reduceMotion: true,
    signal: new AbortController().signal,
    shuffle,
    mistake() { counts.mistakes += 1; },
    hint() { counts.hints += 1; },
  };
  dom.body.innerHTML = renderIncident(s, newIncident(s), order ?? {});
  dom.actions.innerHTML = '<button id="next" disabled>Next</button>';
  const onComplete = () => {
    counts.done += 1;
    const next = dom.actions.querySelector('#next');
    next.disabled = false;
    return next;
  };
  mountIncident(ctx, s, { onComplete, swirl: () => {}, ...order });
  return { counts, focus, s };
}

const open = (id) => click(`[data-view="${id}"]`);
const pick = (id) => click(`[data-hypothesis="${id}"]`);
const tile = (id) => q(`[data-view="${id}"]`);
const cause = (id) => q(`[data-hypothesis="${id}"]`);
const status = () => region(ID, 'status');
const feedback = () => region(ID, 'feedback');
const group = () => cause('slow-query').closest('[role="group"]');

// ---- V1 render ---------------------------------------------------------------------------

test('V1 render: alert panel, the meter in minutes with minutes left as the headline, the three steps, causes locked but focusable', () => {
  setup();
  assert.equal(alertTitle(ID), 'Checkout latency is burning the error budget');
  assert.equal(q(`[data-incident="${ID}"] .ui-panel--alert`).innerHTML.includes('<b>4s</b>'), true, 'the alert html is kept');
  const b = budget(ID);
  assert.equal(b.left, '20 min left.', 'the headline: minutes left');
  assert.equal(b.spent, '0 of 20 min spent', 'spent is the secondary line');
  assert.deepEqual(b.cells, { total: 20, spent: 0, over: 0, preview: 0, left: 20 });
  assert.equal(b.look, null);
  assert.equal(qa('meter').length, 0, 'no native meter');
  const heads = qa(`[data-incident="${ID}"] h3`).map((h) => h.textContent.replace(/\s+/g, ' ').trim());
  const at = ['Investigate', 'Unlock the causes', 'Name the cause'].map((t) => heads.findIndex((h) => h.endsWith(t)));
  assert.equal(at.every((i) => i >= 0), true, heads.join(' | '));
  assert.deepEqual([...at].sort((x, y) => x - y), at, 'the steps in order');
  for (const v of incidentScenario().views) {
    const t = tile(v.id).textContent.replace(/\s+/g, ' ');
    assert.equal(t.includes(v.label) && t.includes(`${v.costMin} min`), true, t);
    assert.equal(tile(v.id).disabled, false);
  }
  assert.equal(locked(ID), 'true,true,true');
  for (const h of ['slow-query', 'bad-deploy', 'network']) {
    assert.equal(causeState(ID, h), 'locked');
    assert.equal(cause(h).disabled, false, `${h} stays focusable`);
  }
  assert.equal(qa(`[id="${ID}-hint"]`).length, 1, 'the hint button');
  assert.deepEqual(cards(ID), [], 'no evidence yet');
});

// ---- V2 budget from budgetLeft -----------------------------------------------------------

test('V2 the headline and spent line come from budgetLeft in minutes, and count down with each look', () => {
  const s = incidentScenario();
  setup(s);
  let st = newIncident(s);
  for (const [id, left, spent] of [['traces', 17, 3], ['deploys', 11, 9], ['status-page', 9, 11]]) {
    open(id);
    st = openView(s, st, id).state;
    assert.equal(budgetLeft(s, st) / s.budget.burnPctPerMin, left);
    const b = budget(ID);
    assert.equal(b.left, `${left} min left.`, id);
    assert.equal(b.spent, `${spent} of 20 min spent`, id);
    assert.deepEqual(b.cells, { total: 20, spent, over: 0, preview: 0, left: 20 - spent }, id);
  }
});

test('V2 spent exactly to 0 is over: every cell over and "Budget spent."', () => {
  setup(tight());
  open('a');
  assert.equal(budget(ID).left, '1 min left.');
  assert.deepEqual(budget(ID).cells, { total: 2, spent: 1, over: 0, preview: 0, left: 1 });
  open('b');
  assert.equal(budget(ID).left, 'Budget spent.');
  assert.equal(budget(ID).spent, '2 of 2 min spent');
  assert.deepEqual(budget(ID).cells, { total: 2, spent: 0, over: 2, preview: 0, left: 0 }, 'at exactly 0, not only past it');
});

test('V2 a look past the budget never shows more spent than the total, and left stays 0', () => {
  const s = tight();
  setup(s);
  open('a');
  open('b');
  open('c');
  const st = ['a', 'b', 'c'].reduce((acc, id) => openView(s, acc, id).state, newIncident(s));
  assert.equal(st.minutes, 3, 'the engine count stays honest');
  const b = budget(ID);
  assert.equal(b.spent, '2 of 2 min spent');
  assert.equal(b.left, 'Budget spent.');
  assert.deepEqual(b.cells, { total: 2, spent: 0, over: 2, preview: 0, left: 0 });
});

test('V2 a fractional rate shows clean minutes (one decimal) and rounds the cells up', () => {
  const s = frac();
  setup(s);
  assert.equal(budget(ID).left, '43.5 min left.');
  open('a');
  const st = openView(s, newIncident(s), 'a').state;
  assert.equal(minutesShown(budgetLeft(s, st) / s.budget.burnPctPerMin), 29.5);
  assert.equal(budget(ID).left, '29.5 min left.');
  assert.equal(budget(ID).spent, '14 of 43.5 min spent');
  assert.equal(budget(ID).cells.total, 44);
});

test('V2 a long budget draws at most 100 cells', () => {
  setup(slow());
  assert.equal(budget(ID).left, '200 min left.');
  assert.equal(budget(ID).spent, '0 of 200 min spent');
  assert.equal(budget(ID).cells.total, 100);
});

// ---- V3 preview --------------------------------------------------------------------------

test('V3 focus or hover on a tile previews its cost; blur ends it; an opened tile previews nothing; the preview stops at the end', () => {
  setup();
  fire(tile('traces'), 'focus');
  assert.equal(budget(ID).cells.preview, 3);
  assert.equal(budget(ID).look, 'This look: 3 min.');
  assert.equal(budget(ID).left, '20 min left.', 'a preview spends nothing');
  fire(tile('traces'), 'blur');
  assert.equal(budget(ID).cells.preview, 0);
  assert.equal(budget(ID).look, null);
  fire(tile('deploys'), 'pointerenter');
  assert.equal(budget(ID).cells.preview, 6);
  assert.equal(budget(ID).look, 'This look: 6 min.');
  fire(tile('deploys'), 'pointerleave');
  assert.equal(budget(ID).cells.preview, 0);
  open('traces');
  fire(tile('traces'), 'focus');
  assert.equal(budget(ID).cells.preview, 0, 'opening it again is free');
  assert.equal(budget(ID).look, null);

  setup(tight());
  open('b');
  fire(tile('a'), 'focus');
  assert.deepEqual(budget(ID).cells, { total: 2, spent: 1, over: 0, preview: 1, left: 0 });
  open('c');
  fire(tile('a'), 'focus');
  assert.equal(budget(ID).cells.preview, 0, 'nothing left to preview into');
  assert.equal(budget(ID).cells.total, 2);
});

// ---- V4 Spent on -------------------------------------------------------------------------

test('V4 Spent on lists each opened view in the order opened, and its minutes add up to the spent line', () => {
  setup();
  assert.equal(spentOn(ID), null, 'absent before any look');
  open('status-page');
  open('traces');
  open('deploys');
  open('traces');
  const chips = spentOn(ID);
  assert.deepEqual(chips, [['Status page', 2], ['Traces', 3], ['Deploy log', 6]], 'open order, not scenario order; a repeat adds nothing');
  const sum = chips.reduce((n, [, m]) => n + m, 0);
  assert.equal(budget(ID).spent, `${sum} of 20 min spent`);
});

// ---- V5 evidence log ---------------------------------------------------------------------

test('V5 the evidence log: newest first, only the new card open, focus on its heading', () => {
  const { focus } = setup();
  open('status-page');
  assert.deepEqual(cards(ID), ['status-page:open']);
  assert.equal(focus.last(), 'heading:status-page');
  open('traces');
  assert.deepEqual(cards(ID), ['traces:open', 'status-page:closed']);
  assert.equal(focus.last(), 'heading:traces');
  assert.equal(q('[data-heading="traces"]').getAttribute('tabindex'), '-1');
  assert.deepEqual(focus.unfocusable(), []);
});

test('V5 a card the player opened stays open through a redraw that adds no card (a hint)', () => {
  setup();
  open('status-page');
  open('traces');
  card(ID, 'status-page').setAttribute('open', '');
  click(`[id="${ID}-hint"]`);
  assert.deepEqual(cards(ID), ['traces:open', 'status-page:open']);
});

test('V5 opening a view again reopens its card and focuses its heading, free, with a neutral line', () => {
  const { counts, focus } = setup();
  open('traces');
  open('status-page');
  assert.deepEqual(cards(ID), ['status-page:open', 'traces:closed']);
  const before = budget(ID).spent;
  open('traces');
  assert.deepEqual(cards(ID), ['status-page:open', 'traces:open'], 'reopened in place, not moved to the top');
  assert.equal(focus.last(), 'heading:traces');
  assert.equal(budget(ID).spent, before, 'no extra time');
  assert.equal(counts.mistakes, 0);
  assert.deepEqual(status(), { text: 'Traces is already open. No extra time.', tone: 'neutral', hidden: false });
});

// ---- V6 kinds ----------------------------------------------------------------------------

test('V6 only an opened herring is tagged misleading; clue and neutral tiles look the same; no data-kind', () => {
  setup();
  const misleading = (id) => [...tile(id).querySelectorAll('.ui-chip')].filter((c) => c.textContent.includes('misleading')).map((c) => c.getAttribute('data-tone'));
  assert.deepEqual(misleading('deploys'), [], 'not before it is opened');
  open('deploys');
  assert.deepEqual(misleading('deploys'), ['error']);
  open('traces');
  open('status-page');
  assert.deepEqual(misleading('traces'), []);
  assert.deepEqual(misleading('status-page'), []);
  const s = incidentScenario();
  const norm = (id) => {
    const v = s.views.find((x) => x.id === id);
    return tile(id).outerHTML.replaceAll(v.id, 'ID').replaceAll(v.label, 'LABEL').replace(new RegExp(`\\b${v.costMin}\\b`, 'g'), 'N');
  };
  assert.equal(norm('traces'), norm('status-page'), 'an opened clue and an opened neutral view are told apart by nothing');
  assert.equal(qa(`[data-incident="${ID}"] [data-kind]`).length, 0);
  assert.equal(q(`[data-incident="${ID}"]`).outerHTML.includes('clue"'), false, 'no kind in any attribute');
});

// ---- V7 clue counter ---------------------------------------------------------------------

test('V7 Clues found F of N stops at N, with F dots on', () => {
  setup(threeClues());
  assert.equal(clues(ID), 'Clues found: 0 of 2');
  assert.equal(cluesOn(ID), 0);
  open('status-page');
  open('deploys');
  assert.equal(clues(ID), 'Clues found: 0 of 2', 'neutral and herring do not count');
  open('logs');
  assert.equal(clues(ID), 'Clues found: 1 of 2');
  assert.equal(cluesOn(ID), 1);
  open('traces');
  open('db-metrics');
  assert.equal(clues(ID), 'Clues found: 2 of 2', 'capped at the number needed, though three are open');
  assert.equal(cluesOn(ID), 2);
  assert.equal(qa('[data-clues] [data-on]').length, 2);
});

test('V7 a board that needs no clue has no counter, and its causes are open from the start', () => {
  setup(zero());
  assert.equal(clues(ID), null);
  assert.equal(locked(ID), 'false,false,false');
  assert.equal(causeState(ID, 'slow-query'), null);
});

// ---- V8 lock line ------------------------------------------------------------------------

const LOCKED = (n, need) => `Locked until you find ${need} clue${need === 1 ? '' : 's'} in Step 1 (${n} of ${need} so far). A clue is a view that helps explain the alert.`;
const UNLOCKED = 'Unlocked. Pick the cause the evidence supports. A wrong pick counts as one penalty.';

test('V8 the lock line counts clues only, describes the causes group, and is not a live region', () => {
  setup();
  assert.equal(lockLine(ID), LOCKED(0, 2));
  open('status-page');
  open('deploys');
  assert.equal(lockLine(ID), LOCKED(0, 2), 'two opens, no clue: still 0');
  open('traces');
  assert.equal(lockLine(ID), LOCKED(1, 2));
  assert.equal(locked(ID), 'true,true,true');
  open('db-metrics');
  assert.equal(lockLine(ID), UNLOCKED);
  assert.equal(locked(ID), 'false,false,false');
  assert.equal(group().getAttribute('role'), 'group');
  assert.equal(group().getAttribute('aria-describedby'), `${ID}-lock`);
  const lock = q(`[id="${ID}-lock"]`);
  assert.equal(lock.getAttribute('aria-live'), null);
  assert.equal(lock.getAttribute('role'), null);
  pick('slow-query');
  assert.equal(lockLine(ID), 'Solved.');
});

test('V8 one clue needed: singular', () => {
  setup(tight());
  assert.equal(lockLine(ID), LOCKED(0, 1));
});

// ---- V9 locked causes --------------------------------------------------------------------

test('V9 a locked cause is focusable; picking it explains, free, and keeps focus; once unlocked a wrong pick costs', () => {
  const { counts, focus } = setup();
  open('traces');
  const seen = focus.names().length;
  pick('bad-deploy');
  assert.equal(counts.mistakes, 0);
  assert.deepEqual(feedback(), { text: 'Not yet. Find 2 clues in Step 1 first: you have 1 of 2. Picking now costs nothing.', tone: 'neutral', hidden: false });
  assert.equal(focus.names().length, seen, 'focus stays on the cause');
  assert.equal(causeState(ID, 'bad-deploy'), 'locked');
  assert.equal(tally(ID).wrong, 0);
  open('db-metrics');
  pick('bad-deploy');
  assert.equal(counts.mistakes, 1);
  assert.equal(causeState(ID, 'bad-deploy'), 'wrong');
});

test('V9 the unlocking open clears the stale "Not yet" pick line', () => {
  setup();
  open('traces');
  pick('bad-deploy');
  assert.equal(feedback().hidden, false);
  open('db-metrics');
  assert.deepEqual(feedback(), { text: '', tone: null, hidden: true });
});

test('V9 an unlocking open that also spends the budget clears the pick line and says the causes are unlocked', () => {
  const s = tight();
  s.budget = { startPct: 15, burnPctPerMin: 5 }; // 3 min: the two clues fit, a neutral look eats the slack
  s.answerAfterViews = 2;
  s.views = [
    { id: 'a', label: 'A', costMin: 1, html: 'a', kind: 'clue' },
    { id: 'n', label: 'N', costMin: 1, html: 'n', kind: 'neutral' },
    { id: 'b', label: 'B', costMin: 1, html: 'b', kind: 'clue' },
  ];
  setup(s);
  open('a');
  pick('bad-deploy');
  open('n');
  assert.equal(feedback().hidden, false, 'a neutral look leaves the pick line');
  open('b');
  assert.deepEqual(feedback(), { text: '', tone: null, hidden: true });
  assert.deepEqual(status(), { text: 'The error budget is spent, which counts as one penalty. The causes in Step 3 are now unlocked. You can keep investigating.', tone: 'error', hidden: false });
});

// ---- V10 penalties, once each ------------------------------------------------------------

test('V10 a herring that also spends the budget costs two, in one combined error line, tallied apart', () => {
  const { counts } = setup(tight());
  open('a');
  open('h');
  assert.equal(counts.mistakes, 2);
  assert.deepEqual(status(), { text: 'Herring was misleading, and the error budget is spent. Each counts as one penalty.', tone: 'error', hidden: false });
  assert.deepEqual(tally(ID), { wrong: 0, misleading: 1, budget: 1, hints: 0 });
  open('h');
  open('b');
  assert.equal(counts.mistakes, 2, 'a repeat and a look past the end cost nothing more');
  assert.deepEqual(tally(ID), { wrong: 0, misleading: 1, budget: 1, hints: 0 });
});

test('V10 a wrong pick costs one, stays clickable as ruled out; picking it again is free', () => {
  const { counts, focus } = setup();
  open('traces');
  open('db-metrics');
  pick('bad-deploy');
  assert.equal(counts.mistakes, 1);
  assert.equal(causeState(ID, 'bad-deploy'), 'wrong');
  assert.equal(cause('bad-deploy').disabled, false);
  assert.equal(feedback().tone, 'error');
  assert.equal(feedback().text.startsWith('Not quite. A bad deploy is not the cause. No deploy happened.'), true, feedback().text);
  assert.equal(focus.last(), 'hypothesis:network');
  pick('bad-deploy');
  assert.equal(counts.mistakes, 1);
  assert.equal(feedback().tone, 'neutral');
  assert.match(feedback().text, /already ruled/);
  assert.deepEqual(tally(ID), { wrong: 1, misleading: 0, budget: 0, hints: 0 });
});

test('V10 each hint is exactly one ctx.hint; the side counts always equal ctx mistakes and the stars follow boardStars', () => {
  const { counts } = setup();
  open('deploys');
  click(`[id="${ID}-hint"]`);
  assert.equal(counts.hints, 1);
  open('traces');
  open('db-metrics');
  pick('network');
  click(`[id="${ID}-hint"]`);
  assert.equal(counts.hints, 2);
  const t = tally(ID);
  assert.deepEqual(t, { wrong: 1, misleading: 1, budget: 0, hints: 2 });
  assert.equal(t.wrong + t.misleading + t.budget, counts.mistakes);
  assert.equal(q(`[id="${ID}-misleading-label"]`).textContent, 'misleading', 'the label reads right after any count: "1 misleading"');
  const stars = q(`[id="${ID}-stars"]`).getAttribute('aria-label');
  assert.equal(stars, starsLabel(boardStars(t.wrong, t.hints, t.misleading + t.budget), false));
  assert.equal(stars, '2 of 5 stars still possible', 'four penalties (a wrong pick, a herring, two hints) give 2');
});

// ---- V11 tones ---------------------------------------------------------------------------

test('V11 D7 tones: opens speak in the status bar, picks in the feedback; error only for what costs a star', () => {
  setup();
  open('status-page');
  assert.deepEqual([status().tone, status().text], ['neutral', 'Opened Status page (2 min). Its card is at the top of Evidence.']);
  assert.equal(feedback().hidden, true, 'an open says nothing in the pick feedback');
  open('status-page');
  assert.equal(status().tone, 'neutral');
  open('deploys');
  assert.deepEqual([status().tone, status().text], ['error', 'Deploy log was misleading: it does not explain the alert. That counts as one penalty.']);
  pick('network');
  assert.equal(feedback().tone, 'neutral', 'a locked pick is free');
  assert.equal(status().text.startsWith('Deploy log'), true, 'a pick leaves the status bar alone');
  open('traces');
  open('db-metrics');
  pick('network');
  assert.equal(feedback().tone, 'error');
  pick('slow-query');
  assert.equal(feedback().tone, 'success');
});

test('V11 the open that unlocks the causes says so in success; an open after that, or on a board that is never locked, is neutral', () => {
  setup();
  open('traces');
  assert.deepEqual(status(), { text: 'Opened Traces (3 min). Its card is at the top of Evidence.', tone: 'neutral', hidden: false }, 'one clue of two: still locked');
  open('db-metrics');
  assert.deepEqual(status(), { text: 'Opened Database metrics. That is 2 clues: the causes in Step 3 are unlocked below.', tone: 'success', hidden: false });
  open('status-page');
  assert.deepEqual(status(), { text: 'Opened Status page (2 min). Its card is at the top of Evidence.', tone: 'neutral', hidden: false }, 'already unlocked: no second unlock line');

  setup(zero());
  open('traces');
  assert.deepEqual(status(), { text: 'Opened Traces (3 min). Its card is at the top of Evidence.', tone: 'neutral', hidden: false }, 'never locked, so a clue unlocks nothing');
});

// ---- V12 hints ---------------------------------------------------------------------------

test('V12 three hint tiers: the rule, then two clue tiles outlined, then the right cause outlined while locked', () => {
  setup(rightLast());
  const hint = () => q(`[id="${ID}-hint"]`);
  const hintText = () => q(`[id="${ID}-hint-text"]`).textContent.trim();
  assert.equal(hint().textContent.trim(), 'Hint 1 of 3');
  click(hint());
  assert.notEqual(hintText(), '');
  assert.deepEqual(hinted(ID), []);
  assert.equal(hint().textContent.trim(), 'Hint 2 of 3');
  click(hint());
  assert.deepEqual(hinted(ID), ['view:traces', 'view:db-metrics']);
  open('traces');
  assert.deepEqual(hinted(ID), ['view:db-metrics'], 'opening a tile removes its outline');
  click(hint());
  assert.equal(hinted(ID).includes('cause:slow-query'), true, 'the right cause, which is third');
  assert.equal(hinted(ID).includes('cause:bad-deploy'), false);
  assert.equal(causeState(ID, 'slow-query'), 'locked', 'a hint unlocks nothing');
  assert.equal(hint().textContent.trim(), 'No more hints');
  assert.equal(hint().disabled, true);
  open('db-metrics');
  pick('slow-query');
  assert.deepEqual(hinted(ID), [], 'solving clears every outline');
});

// ---- V13 solved --------------------------------------------------------------------------

test('V13 the right cause: done once, the board closes, the win card shows and takes focus', () => {
  const { counts, focus } = setup();
  open('traces');
  open('db-metrics');
  pick('slow-query');
  assert.equal(counts.done, 1);
  assert.equal(counts.mistakes, 0);
  assert.equal(causeState(ID, 'slow-query'), 'correct');
  assert.deepEqual(qa('[data-view]').map((b) => b.disabled), [true, true, true, true]);
  assert.deepEqual(qa('[data-hypothesis]').map((b) => b.disabled), [true, true, true]);
  assert.equal(feedback().tone, 'success');
  assert.equal(feedback().text.startsWith('Right. A slow database query. Every slow trace waits on it.'), true, feedback().text);
  assert.equal(q(`[id="${ID}-win"]`).hidden, false);
  assert.equal(focus.last(), `#${ID}-win-title`);
  assert.equal(q(`[id="${ID}-hint"]`).disabled, true);
  assert.equal(q(`[id="${ID}-stars"]`).getAttribute('aria-label'), '5 of 5 stars');
  assert.deepEqual(focus.unfocusable(), []);
});

const winLine = () => text(`[id="${ID}-win-stars"]`);

test('V13 the win card sums up the run: stars, wrong picks, misleading views, hints, minutes used; "ran out of budget" only when it did', () => {
  setup();
  open('traces');
  open('db-metrics');
  pick('slow-query');
  assert.equal(winLine(), '5 of 5 stars: 0 wrong picks, 0 misleading views, 0 hints. 7 min used.');

  setup(tight());
  open('a');
  open('h');
  click(`[id="${ID}-hint"]`);
  pick('bad-deploy');
  pick('slow-query');
  assert.equal(winLine(), '2 of 5 stars: 1 wrong pick, 1 misleading view, 1 hint, ran out of budget. 2 min used.', 'four penalties; the singulars');
});

test('V13 a solved board previews no cost: hovering a tile after the win leaves the meter alone', () => {
  setup();
  open('traces');
  open('db-metrics');
  pick('slow-query');
  fire(tile('deploys'), 'pointerenter');
  assert.equal(budget(ID).look, null);
  assert.equal(budget(ID).cells.preview, 0);
  assert.equal(budget(ID).left, '13 min left.');
});

// ---- V15 shuffled order -------------------------------------------------------------------

const tileOrder = () => qa(`[data-incident="${ID}"] [data-view]`).map((b) => b.getAttribute('data-view'));
const causeOrder = () => qa(`[data-incident="${ID}"] [data-hypothesis]`).map((b) => b.getAttribute('data-hypothesis'));
const REVERSED_TILES = ['status-page', 'deploys', 'db-metrics', 'traces'];
const REVERSED_CAUSES = ['network', 'bad-deploy', 'slow-query'];

/** A non-identity ctx.shuffle (reverse) that counts its calls. */
function reversing() {
  const calls = [];
  const shuffle = (a) => {
    calls.push(a.map((e) => e.id).join());
    return [...a].reverse();
  };
  return { shuffle, calls };
}

test('V15 incidentOrder shuffles the views and the causes once each through ctx.shuffle; authored order without one', () => {
  const s = incidentScenario();
  const r = reversing();
  assert.deepEqual(incidentOrder({ shuffle: r.shuffle }, s), { viewOrder: REVERSED_TILES, causeOrder: REVERSED_CAUSES });
  assert.deepEqual(r.calls, ['traces,db-metrics,deploys,status-page', 'slow-query,bad-deploy,network']);
  assert.deepEqual(incidentOrder({}, s), {
    viewOrder: ['traces', 'db-metrics', 'deploys', 'status-page'],
    causeOrder: ['slow-query', 'bad-deploy', 'network'],
  });
  assert.equal(s.views[0].id, 'traces', 'the scenario is not reordered');
});

test('V15 the mounted board lists tiles and causes in the shuffled order, shuffled once, and keeps it through an open, a hint and a pick', () => {
  const r = reversing();
  const { focus } = setup(incidentScenario(), { shuffle: r.shuffle });
  assert.deepEqual(tileOrder(), REVERSED_TILES);
  assert.deepEqual(causeOrder(), REVERSED_CAUSES);
  assert.equal(r.calls.length, 2, 'one shuffle per list per mount');
  open('status-page');
  assert.deepEqual([tileOrder(), causeOrder()], [REVERSED_TILES, REVERSED_CAUSES], 'after an open');
  click(`[id="${ID}-hint"]`);
  click(`[id="${ID}-hint"]`);
  assert.deepEqual([tileOrder(), causeOrder()], [REVERSED_TILES, REVERSED_CAUSES], 'after the hints');
  assert.deepEqual(hinted(ID), ['view:db-metrics', 'view:traces'], 'outlines follow the shown order');
  open('traces');
  open('db-metrics');
  pick('network');
  assert.deepEqual([tileOrder(), causeOrder()], [REVERSED_TILES, REVERSED_CAUSES], 'after a wrong pick');
  assert.equal(focus.last(), 'hypothesis:bad-deploy', 'focus moves to the next cause as listed, not as authored');
  assert.equal(r.calls.length, 2, 'redraws never reshuffle');
  assert.deepEqual(cards(ID), ['db-metrics:open', 'traces:closed', 'status-page:closed'], 'the evidence log stays in open order, newest first');
  assert.deepEqual(spentOn(ID), [['Status page', 2], ['Traces', 3], ['Database metrics', 4]], 'Spent on stays in open order');
  pick('slow-query');
  assert.deepEqual([tileOrder(), causeOrder()], [REVERSED_TILES, REVERSED_CAUSES], 'after the win');
});

test('V15 an order from incidentOrder, given to render and mount, is the one order of the board: the first paint matches and mount does not reshuffle', () => {
  const s = incidentScenario();
  const r = reversing();
  const order = incidentOrder({ shuffle: r.shuffle }, s);
  const again = reversing();
  setup(s, { shuffle: again.shuffle, order });
  assert.deepEqual(again.calls, [], 'mount uses the order it is given');
  assert.deepEqual(tileOrder(), REVERSED_TILES);
  assert.deepEqual(causeOrder(), REVERSED_CAUSES);
  const dom = makeDom();
  dom.body.innerHTML = renderIncident(s, newIncident(s), order);
  assert.deepEqual([tileOrder(), causeOrder()], [REVERSED_TILES, REVERSED_CAUSES], 'the rendered markup, before any mount');
});

// ---- V14 contract ------------------------------------------------------------------------

test('V14 mountIncident throws TypeError for an invalid scenario, missing onComplete or unrendered scenario', () => {
  const s = incidentScenario();
  const dom = makeDom();
  const ctx = { ovBody: dom.body, ovActions: dom.actions, escapeHtml, mistake() {}, hint() {} };
  assert.throws(() => mountIncident(ctx, { ...s, hypotheses: [] }, { onComplete() {} }), (e) => e instanceof TypeError && /invalid scenario/.test(e.message));
  dom.body.innerHTML = renderIncident(s, newIncident(s), { escapeHtml });
  assert.throws(() => mountIncident(ctx, s, {}), (e) => e instanceof TypeError && /onComplete/.test(e.message));
  dom.body.innerHTML = '';
  assert.throws(() => mountIncident(ctx, s, { onComplete() {} }), (e) => e instanceof TypeError && /not rendered/.test(e.message));
});

const src = (f) => readFileSync(new URL(`../lib/widgets/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('V14 no timers and no Alpine attributes in the incident files (I2, I6)', () => {
  for (const f of ['incident.mjs', 'incident-view.mjs', 'incident-help.mjs']) {
    assert.equal(/\b(?:setTimeout|setInterval|requestAnimationFrame)\b/.test(src(f)), false, f);
  }
  setup();
  assert.equal(/\s(?:x-[\w.:-]+|@[\w.:-]+)=/.test(q('[data-incident]').outerHTML), false);
});

test('V14 the view and the help never read a kind as "clue" (clueIds is the one place)', () => {
  for (const f of ['incident-view.mjs', 'incident-help.mjs']) {
    assert.equal(/['"`]clue['"`]/.test(src(f)), false, `${f} names the clue kind`);
  }
});

test('Escape on a shown hint is handled, focuses the hint button and leaves the level open (#178)', () => {
  const { focus } = setup();
  click(`[id="${ID}-hint"]`);
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q(`[id="${ID}-hint-text"]`).onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), `#${ID}-hint`);
});

test('Escape on the hint after the last tier (button spent) falls back to a cause to pick, and is handled (#178)', () => {
  const { focus } = setup(rightLast());
  for (let i = 0; i < 3; i += 1) click(q(`[id="${ID}-hint"]`));
  assert.equal(q(`[id="${ID}-hint"]`).disabled, true);
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q(`[id="${ID}-hint-text"]`).onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last().startsWith('hypothesis:'), true, focus.last());
  assert.deepEqual(focus.unfocusable(), []);
});

test('#17 P3 the win card counts a guide question as a hint, in the stars too', () => {
  const s = incidentScenario();
  const dom = makeDom();
  const hints = [];
  const ctx = withGuide({
    ovBody: dom.body, ovActions: dom.actions, escapeHtml, reduceMotion: true, signal: new AbortController().signal,
    shuffle: (a) => [...a], mistake() {}, hint() { hints.push(1); },
  });
  dom.body.innerHTML = renderIncident(s, newIncident(s), {});
  dom.actions.innerHTML = '<button id="next" disabled>Next</button>';
  mountIncident(ctx, s, { onComplete() {}, swirl: () => {} });
  ctx.askedGuide();
  assert.equal(text(`[id="${ID}-hints"]`), '1');
  open('traces');
  open('db-metrics');
  pick('slow-query');
  assert.equal(hints.length, 1);
  assert.equal(winLine(), '4 of 5 stars: 0 wrong picks, 0 misleading views, 1 hint. 7 min used.');
});
