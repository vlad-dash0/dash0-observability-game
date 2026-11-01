// lib/widgets/incident.mjs: the Incident engine core (budget arithmetic, outcomes, I7).
// Spec: docs/M1-DESIGN.md §4.3, §7 P10. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incidentScenario } from './fixtures/incident-scenario.mjs';
import { answer, budgetLeft, canAnswer, newIncident, openView, validateScenario } from '../lib/widgets/incident.mjs';

const S = incidentScenario;
const open = (s, st, ...ids) => ids.reduce((cur, id) => openView(s, cur, id).state, st);

test('the fixture is valid and deterministic', () => {
  assert.deepEqual(validateScenario(S()), []);
  assert.equal(JSON.stringify(S()), JSON.stringify(S()));
});

test('validateScenario reports every problem', () => {
  const has = (mut, text) => {
    const s = S();
    mut(s);
    assert.ok(validateScenario(s).some((p) => p.includes(text)), text);
  };
  assert.deepEqual(validateScenario(null), ['scenario: not an object']);
  has((s) => { s.views[1].id = 'traces'; }, 'duplicate view id "traces"');
  has((s) => { s.hypotheses[1].id = 'slow-query'; }, 'duplicate hypothesis id "slow-query"');
  has((s) => { s.hypotheses[1].right = true; }, 'exactly one hypothesis must be right, found 2');
  has((s) => { s.hypotheses[0].right = false; }, 'exactly one hypothesis must be right, found 0');
  has((s) => { s.budget.burnPctPerMin = 0; }, 'burnPctPerMin');
  has((s) => { s.budget.startPct = 101; }, 'startPct');
  has((s) => { s.views[0].kind = 'bogus'; }, 'kind');
  has((s) => { s.views[0].costMin = -1; }, 'costMin');
  has((s) => { s.budget.burnPctPerMin = 20; }, 'clues cost 7 min');
  has((s) => { s.answerAfterViews = 3; }, 'answerAfterViews');
  has((s) => { s.views = s.views.filter((v) => v.kind !== 'clue'); s.answerAfterViews = 0; }, 'at least one clue');
});

test('budgetLeft is start minus minutes times burn, clamped at 0', () => {
  const s = S();
  assert.equal(budgetLeft(s, newIncident(s)), 100);
  assert.equal(budgetLeft(s, { ...newIncident(s), minutes: 7 }), 65);
  assert.equal(budgetLeft(s, { ...newIncident(s), minutes: 20 }), 0);
  assert.equal(budgetLeft(s, { ...newIncident(s), minutes: 99 }), 0);
});

test('openView: first open costs time, a repeat is free', () => {
  const s = S();
  const a = openView(s, newIncident(s), 'traces');
  assert.equal(a.outcome, 'opened');
  assert.equal(a.state.minutes, 3);
  assert.equal(budgetLeft(s, a.state), 85);
  assert.equal(a.herring, false);
  const b = openView(s, a.state, 'traces');
  assert.equal(b.outcome, 'repeat');
  assert.equal(b.state.minutes, 3);
  assert.equal(b.herring, false);
  assert.equal(openView(s, a.state, 'nope').outcome, 'unknown');
});

test('openView flags a herring on its first open only, and never mutates', () => {
  const s = S();
  const st = newIncident(s);
  const frozen = JSON.stringify(st);
  const a = openView(s, st, 'deploys');
  assert.equal(JSON.stringify(st), frozen);
  assert.equal(a.herring, true);
  assert.equal(openView(s, a.state, 'deploys').herring, false);
  assert.equal(openView(s, st, 'status-page').herring, false);
});

test('exhaustedNow is true exactly once, on the open that reaches 0', () => {
  const s = S();
  s.budget = { startPct: 10, burnPctPerMin: 5 };
  s.views = [{ id: 'a', label: 'A', costMin: 1, html: 'a', kind: 'clue' }, { id: 'b', label: 'B', costMin: 1, html: 'b', kind: 'neutral' }, { id: 'c', label: 'C', costMin: 1, html: 'c', kind: 'neutral' }];
  s.answerAfterViews = 1;
  const a = openView(s, newIncident(s), 'a');
  assert.equal(a.exhaustedNow, false);
  const b = openView(s, a.state, 'b');
  assert.equal(b.exhaustedNow, true);
  assert.equal(budgetLeft(s, b.state), 0);
  const c = openView(s, b.state, 'c');
  assert.equal(c.exhaustedNow, false);
  assert.equal(openView(s, c.state, 'b').exhaustedNow, false);
});

test('canAnswer waits for answerAfterViews clue views and ends when solved', () => {
  const s = S();
  assert.equal(canAnswer(s, newIncident(s)), false);
  assert.equal(canAnswer(s, open(s, newIncident(s), 'traces')), false);
  assert.equal(canAnswer(s, open(s, newIncident(s), 'traces', 'traces')), false);
  const ready = open(s, newIncident(s), 'traces', 'db-metrics');
  assert.equal(canAnswer(s, ready), true);
  assert.equal(canAnswer(s, answer(s, ready, 'slow-query').state), false);
});

test('canAnswer counts only clue views: neutral and herring opens, however many, never unlock', () => {
  const s = S();
  const filler = open(s, newIncident(s), 'status-page', 'deploys');
  assert.equal(filler.opened.length, s.answerAfterViews);
  assert.equal(canAnswer(s, filler), false);
  assert.equal(answer(s, filler, 'slow-query').outcome, 'locked');
  const oneClue = open(s, filler, 'traces');
  assert.equal(canAnswer(s, oneClue), false);
  assert.equal(answer(s, oneClue, 'slow-query').outcome, 'locked');
  assert.equal(canAnswer(s, open(s, oneClue, 'traces', 'status-page')), false);
  const ready = open(s, oneClue, 'db-metrics');
  assert.equal(canAnswer(s, ready), true);
  assert.equal(answer(s, ready, 'slow-query').outcome, 'right');
});

test('answer outcomes: locked, unknown, wrong, repeat, right, closed', () => {
  const s = S();
  assert.equal(answer(s, newIncident(s), 'slow-query').outcome, 'locked');
  const ready = open(s, newIncident(s), 'traces', 'db-metrics');
  assert.equal(answer(s, ready, 'nope').outcome, 'unknown');
  const w = answer(s, ready, 'bad-deploy');
  assert.equal(w.outcome, 'wrong');
  assert.equal(w.state.wrong.join(), 'bad-deploy');
  assert.equal(ready.wrong.length, 0);
  const rep = answer(s, w.state, 'bad-deploy');
  assert.equal(rep.outcome, 'repeat');
  assert.equal(rep.state.wrong.length, 1);
  const r = answer(s, w.state, 'slow-query');
  assert.equal(r.outcome, 'right');
  assert.equal(r.state.solved, true);
  assert.equal(answer(s, r.state, 'network').outcome, 'closed');
  assert.equal(openView(s, r.state, 'status-page').outcome, 'closed');
});

test('I7: the reference path (all clues, then the right answer) solves within budget', () => {
  const s = S();
  const clues = s.views.filter((v) => v.kind === 'clue').map((v) => v.id);
  const st = open(s, newIncident(s), ...clues);
  assert.ok(budgetLeft(s, st) > 0);
  assert.equal(answer(s, st, s.hypotheses.find((h) => h.right).id).outcome, 'right');
});
