// lib/widgets/incident-view.mjs: the Incident view and mount (render, penalties, one
// budget source, focus). Spec: docs/M1-DESIGN.md §4.3, §7 P10. Strings/numbers/booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { incidentScenario } from './fixtures/incident-scenario.mjs';
import { budgetLeft, newIncident, openView } from '../lib/widgets/incident.mjs';
import { mountIncident, renderIncident } from '../lib/widgets/incident-view.mjs';

function setup(s = incidentScenario()) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, done: 0 };
  const ctx = { ovBody: dom.body, ovActions: dom.actions, escapeHtml, mistake() { counts.mistakes += 1; } };
  dom.body.innerHTML = renderIncident(s, newIncident(s), { escapeHtml });
  dom.actions.innerHTML = '<button id="finish" disabled>Finish</button>';
  const onComplete = () => {
    counts.done += 1;
    const fin = dom.actions.querySelector('#finish');
    fin.disabled = false;
    return fin;
  };
  mountIncident(ctx, s, { onComplete });
  return { counts, focus };
}

const meterValue = () => q('meter').getAttribute('value');
const budgetText = () => q('[data-budget-text]').textContent;
const feedback = () => q('#checkout-slow-feedback').textContent;
const hypDisabled = () => qa('[data-hypothesis]').map((b) => b.disabled);
const openIds = () => qa('[data-panel]').map((p) => p.dataset.panel).join();

test('render: alert, meter, labelled view buttons, locked hypotheses', () => {
  setup();
  assert.ok(q('.incident-alert').textContent.includes('Checkout latency is burning the error budget'));
  assert.ok(q('.incident-alert').innerHTML.includes('<b>4s</b>'));
  assert.equal(q('meter').getAttribute('min'), '0');
  assert.equal(q('meter').getAttribute('max'), '100');
  assert.equal(meterValue(), '100');
  assert.equal(q('meter').getAttribute('aria-label'), 'Error budget');
  assert.equal(budgetText(), 'Error budget: 100% left (0 min in).');
  assert.equal(qa('[data-view]').map((b) => b.textContent).join('|'), 'Traces (3 min)|Database metrics (4 min)|Deploy log (6 min)|Status page (2 min)');
  assert.equal(hypDisabled().join(), 'true,true,true');
  assert.equal(openIds(), '');
});

test('meter value and text are both formatted from budgetLeft', () => {
  const s = incidentScenario();
  setup(s);
  let st = newIncident(s);
  for (const id of ['traces', 'deploys', 'status-page']) {
    click(`[data-view="${id}"]`);
    st = openView(s, st, id).state;
    assert.equal(meterValue(), String(budgetLeft(s, st)));
    assert.equal(budgetText(), `Error budget: ${budgetLeft(s, st)}% left (${st.minutes} min in).`);
  }
});

test('opening a view shows a tabindex=-1 heading panel and focuses it; repeat is free', () => {
  const { counts, focus } = setup();
  click('[data-view="traces"]');
  assert.equal(openIds(), 'traces');
  assert.equal(q('[data-panel="traces"] h4').getAttribute('tabindex'), '-1');
  assert.equal(focus.last(), 'heading:traces');
  assert.equal(budgetText(), 'Error budget: 85% left (3 min in).');
  click('[data-view="traces"]');
  assert.equal(budgetText(), 'Error budget: 85% left (3 min in).');
  assert.equal(counts.mistakes, 0);
  assert.equal(focus.last(), 'heading:traces');
  assert.equal(focus.unfocusable().length, 0);
});

test('a herring costs one mistake on first open only', () => {
  const { counts } = setup();
  click('[data-view="deploys"]');
  assert.equal(counts.mistakes, 1);
  assert.ok(feedback().includes('red herring'));
  click('[data-view="deploys"]');
  assert.equal(counts.mistakes, 1);
  click('[data-view="status-page"]');
  click('[data-view="traces"]');
  assert.equal(counts.mistakes, 1);
});

test('exhausting the budget costs one mistake, once', () => {
  const s = incidentScenario();
  s.budget = { startPct: 10, burnPctPerMin: 5 };
  s.views = [
    { id: 'a', label: 'A', costMin: 1, html: 'a', kind: 'clue' },
    { id: 'b', label: 'B', costMin: 1, html: 'b', kind: 'neutral' },
    { id: 'c', label: 'C', costMin: 1, html: 'c', kind: 'neutral' },
  ];
  s.answerAfterViews = 1;
  const { counts } = setup(s);
  click('[data-view="a"]');
  assert.equal(counts.mistakes, 0);
  click('[data-view="b"]');
  assert.equal(counts.mistakes, 1);
  assert.equal(budgetText(), 'Error budget: 0% left (2 min in).');
  assert.ok(feedback().includes('budget is spent'));
  click('[data-view="c"]');
  click('[data-view="b"]');
  assert.equal(counts.mistakes, 1);
  assert.equal(budgetText(), 'Error budget: 0% left (3 min in).');
});

test('hypotheses enable after answerAfterViews; wrong costs one, then is disabled', () => {
  const { counts, focus } = setup();
  click('[data-view="traces"]');
  assert.equal(hypDisabled().join(), 'true,true,true');
  click('[data-view="db-metrics"]');
  assert.equal(hypDisabled().join(), 'false,false,false');
  click('[data-hypothesis="bad-deploy"]');
  assert.equal(counts.mistakes, 1);
  assert.ok(feedback().startsWith('Not quite. A bad deploy is not the cause.'));
  assert.equal(hypDisabled().join(), 'false,true,false');
  assert.equal(focus.last(), 'hypothesis:network');
  assert.equal(counts.done, 0);
});

test('neutral and herring opens do not enable the hypotheses; clue opens do', () => {
  const { counts } = setup();
  click('[data-view="status-page"]');
  click('[data-view="deploys"]');
  assert.equal(counts.mistakes, 1, 'only the herring costs');
  assert.equal(hypDisabled().join(), 'true,true,true');
  click('[data-view="traces"]');
  assert.equal(hypDisabled().join(), 'true,true,true');
  click('[data-view="db-metrics"]');
  assert.equal(hypDisabled().join(), 'false,false,false');
});

test('the right hypothesis explains, closes the board and hands focus to onComplete', () => {
  const { counts, focus } = setup();
  click('[data-view="traces"]');
  click('[data-view="db-metrics"]');
  click('[data-hypothesis="slow-query"]');
  assert.equal(counts.mistakes, 0);
  assert.equal(counts.done, 1);
  assert.ok(feedback().startsWith('Right. A slow database query. Every slow trace waits on it.'));
  assert.equal(hypDisabled().join(), 'true,true,true');
  assert.equal(qa('[data-view]').every((b) => b.disabled), true);
  assert.equal(focus.last(), '#finish');
  assert.equal(focus.unfocusable().length, 0);
});

test('mountIncident throws TypeError for an invalid scenario, missing onComplete or unrendered scenario', () => {
  const s = incidentScenario();
  const dom = makeDom();
  const ctx = { ovBody: dom.body, ovActions: dom.actions, escapeHtml, mistake() {} };
  assert.throws(() => mountIncident(ctx, { ...s, hypotheses: [] }, { onComplete() {} }), /invalid scenario/);
  dom.body.innerHTML = renderIncident(s, newIncident(s), { escapeHtml });
  assert.throws(() => mountIncident(ctx, s, {}), /onComplete/);
  dom.body.innerHTML = '';
  assert.throws(() => mountIncident(ctx, s, { onComplete() {} }), /not rendered/);
});

test('no timers and no Alpine attributes in the incident files (I2, I6)', () => {
  for (const f of ['incident.mjs', 'incident-view.mjs']) {
    const src = readFileSync(new URL(`../lib/widgets/${f}`, import.meta.url), 'utf8');
    assert.equal(/\b(?:setTimeout|setInterval|requestAnimationFrame)\b/.test(src.replace(/\/\/.*$/gm, '')), false, f);
  }
  setup();
  assert.equal(/\s(?:x-[\w.:-]+|@[\w.:-]+)=/.test(q('[data-incident]').outerHTML), false);
});

test('a fractional burn rate shows a clean, matching meter value and text', () => {
  const s = incidentScenario();
  s.budget = { startPct: 100, burnPctPerMin: 2.3 };
  s.views = [
    { id: 'a', label: 'A', costMin: 14, html: 'a', kind: 'clue' },
    { id: 'b', label: 'B', costMin: 1, html: 'b', kind: 'neutral' },
  ];
  s.answerAfterViews = 1;
  setup(s);
  click('[data-view="a"]');
  assert.equal(meterValue(), '67.8');
  assert.equal(budgetText(), 'Error budget: 67.8% left (14 min in).');
});

test('a herring that also exhausts the budget costs two mistakes and one combined line', () => {
  const s = incidentScenario();
  s.budget = { startPct: 10, burnPctPerMin: 5 };
  s.views = [
    { id: 'a', label: 'A', costMin: 1, html: 'a', kind: 'clue' },
    { id: 'h', label: 'Herring', costMin: 1, html: 'h', kind: 'herring' },
  ];
  s.answerAfterViews = 1;
  const { counts } = setup(s);
  click('[data-view="a"]');
  click('[data-view="h"]');
  assert.equal(counts.mistakes, 2);
  assert.equal(feedback(), 'Herring was a red herring, and the error budget is spent.');
});
