// lib/widgets/incident-help.mjs (#143 P2a): the incident board's three hint tiers, pure.
// hintFor(s, st, tier) -> {html, views, hypothesis}: `views` are the tiles to outline, and
// `hypothesis` the cause to outline (or null). Tier 1 is the scenario's authored hint, else a
// generic rule; tier 2 names two clue views, unopened first, and outlines only the unopened;
// tier 3 outlines the right cause and unlocks nothing. Everything derives from clueIds and
// the state: there is no second statement of which views are clues. Strings, arrays and
// booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incidentScenario, rightLast, threeClues } from './fixtures/incident-scenario.mjs';
import { answer, canAnswer, newIncident, openView } from '../lib/widgets/incident.mjs';
import { hintFor } from '../lib/widgets/incident-help.mjs';

const open = (s, st, ...ids) => ids.reduce((cur, id) => openView(s, cur, id).state, st);
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('H1 tier 1: the authored hint when the scenario has one, else one generic rule that names no view', () => {
  const s = incidentScenario();
  const generic = hintFor(s, newIncident(s), 1);
  assert.equal(typeof generic.html, 'string');
  assert.notEqual(plain(generic.html), '');
  assert.deepEqual(generic.views, []);
  assert.equal(generic.hypothesis, null);
  for (const v of s.views) assert.equal(plain(generic.html).includes(v.label), false, `the rule does not name ${v.label}`);
  for (const h of s.hypotheses) assert.equal(plain(generic.html).includes(h.label), false, `nor the cause ${h.label}`);
  const t = threeClues();
  assert.equal(hintFor(t, open(t, newIncident(t), 'traces'), 1).html, generic.html, 'the same rule on every board, in every state');
  const authored = { ...s, hint: 'Start where the latency is measured.' };
  const a = hintFor(authored, newIncident(authored), 1);
  assert.equal(a.html, 'Start where the latency is measured.');
  assert.deepEqual(a.views, []);
  assert.equal(a.hypothesis, null);
});

test('H2 tier 2: two clue views, unopened first; only the unopened are outlined', () => {
  const s = incidentScenario();
  const fresh = hintFor(s, newIncident(s), 2);
  assert.deepEqual(fresh.views, ['traces', 'db-metrics'], 'both unopened: both outlined, in scenario order');
  assert.equal(fresh.hypothesis, null);
  for (const l of ['Traces', 'Database metrics']) assert.equal(plain(fresh.html).includes(l), true, l);
  assert.equal(plain(fresh.html).includes('Deploy log'), false, 'never a herring');
  assert.equal(plain(fresh.html).includes('Status page'), false, 'never a neutral view');

  const one = hintFor(s, open(s, newIncident(s), 'traces'), 2);
  assert.deepEqual(one.views, ['db-metrics'], 'the opened clue is named but not outlined');
  const text = plain(one.html);
  assert.equal(text.includes('Traces') && text.includes('Database metrics'), true);
  assert.equal(text.indexOf('Database metrics') < text.indexOf('Traces'), true, 'the unopened clue comes first');

  const both = hintFor(s, open(s, newIncident(s), 'traces', 'db-metrics'), 2);
  assert.deepEqual(both.views, []);
  assert.equal(plain(both.html).includes('you have both open'), true, plain(both.html));

  const t = threeClues();
  const three = hintFor(t, open(t, newIncident(t), 'traces'), 2);
  assert.deepEqual(three.views, ['db-metrics', 'logs'], 'three clues, one open: the two unopened, not the opened one');
  assert.equal(plain(three.html).includes('Traces'), false, 'only two views are named');
});

test('H3 tier 3: outlines the right cause, says how to unlock only while locked, and changes nothing', () => {
  const s = incidentScenario();
  const st = newIncident(s);
  const frozen = JSON.stringify(st);
  const locked = hintFor(s, st, 3);
  assert.equal(locked.hypothesis, 'slow-query');
  assert.equal(plain(locked.html).includes('A slow database query'), true);
  assert.equal(JSON.stringify(st), frozen, 'st is not mutated');
  assert.equal(canAnswer(s, st), false, 'a hint unlocks nothing');

  const ready = open(s, newIncident(s), 'traces', 'db-metrics');
  const unlocked = hintFor(s, ready, 3);
  assert.equal(unlocked.hypothesis, 'slow-query');
  assert.equal(plain(unlocked.html).includes('A slow database query'), true);
  assert.equal(plain(locked.html).length > plain(unlocked.html).length, true, 'the locked text carries the unlock clause');
  assert.notEqual(locked.html, unlocked.html);

  const w = answer(s, ready, 'bad-deploy').state;
  assert.equal(hintFor(s, w, 3).html, unlocked.html, 'a wrong pick does not change tier 3');

  const r = rightLast();
  assert.equal(hintFor(r, newIncident(r), 3).hypothesis, 'slow-query', 'the right cause, not the first');
  assert.equal(r.hypotheses[0].id, 'bad-deploy');
});
