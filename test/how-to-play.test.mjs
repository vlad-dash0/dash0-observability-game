// lib/how-to-play.mjs: the per-widget help copy and the view of it for one level (#199 P2).
// Data only: no UI reads this yet. The copy states penalties through each widget's own
// PENALTY (identity-tested), so the card cannot drift from the code that charges them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOW_TO, NOT_SCORED, NO_HINTS, PAR, REPLAY, howToView } from '../lib/how-to-play.mjs';
import { LADDER_RUNGS, PENALTY as BUILD_PENALTY } from '../lib/widgets/help-ladder.mjs';
import { PENALTY as CHOICE_PENALTY } from '../lib/widgets/choice.mjs';
import { PENALTY as SORT_PENALTY } from '../lib/widgets/sort-it-view.mjs';
import { PENALTY as SPOT_PENALTY } from '../lib/widgets/spot-it-view.mjs';
import { PENALTY as INCIDENT_PENALTY } from '../lib/widgets/incident-view.mjs';
import { PENALTY as TRADEOFF_PENALTY } from '../lib/widgets/trade-off-view.mjs';
import { PENALTY as QUERY_PENALTY } from '../lib/widgets/query-it-view.mjs';
import { PENALTY as CONFIGURE_PENALTY } from '../lib/widgets/configure-it-view.mjs';
import { STEP_TYPES } from '../lib/play.mjs';
import { WIDGETS } from '../lib/registry.mjs';
import { liveRegistry } from '../app.mjs';

const PENALTIES = {
  choice: CHOICE_PENALTY,
  sort: SORT_PENALTY,
  build: BUILD_PENALTY,
  spot: SPOT_PENALTY,
  incident: INCIDENT_PENALTY,
  tradeoff: TRADEOFF_PENALTY,
  query: QUERY_PENALTY,
  configure: CONFIGURE_PENALTY,
};

const level = (extra = {}) => ({ widgets: ['choice', 'sort'], scored: true, scoring: { parMs: null }, ...extra });

test('one entry per widget, nothing else', () => {
  assert.deepEqual(Object.keys(HOW_TO).sort(), [...WIDGETS].sort());
  assert.deepEqual(Object.keys(STEP_TYPES).sort(), [...WIDGETS].sort());
});

test("each entry's penalty is its widget's PENALTY object, never retyped", () => {
  assert.deepEqual(Object.keys(PENALTIES).sort(), [...WIDGETS].sort());
  for (const w of WIDGETS) assert.strictEqual(HOW_TO[w].penalty, PENALTIES[w], w);
});

test('every PENALTY is frozen text: costs non-empty, free a string', () => {
  for (const [w, p] of Object.entries(PENALTIES)) {
    assert.equal(Object.isFrozen(p), true, w);
    assert.equal(typeof p.costs, 'string', w);
    assert.ok(p.costs.length > 0, w);
    assert.equal(typeof p.free, 'string', w);
  }
});

const everyString = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) everyString(x, out);
  return out;
};

test('help copy is plain text', () => {
  const reg = liveRegistry();
  const strings = everyString(HOW_TO);
  for (const id of reg.order) strings.push(...everyString(howToView(reg.levels[id])));
  strings.push(PAR, NOT_SCORED, REPLAY);
  assert.ok(strings.length > 50);
  for (const s of strings) assert.ok(!/[<&]/.test(s), `markup in ${JSON.stringify(s)}`);
});

const part = (topic, label) => topic.parts.find((p) => p.label === label);
const labels = (topic) => topic.parts.map((p) => p.label);

test('howToView: topics in play order, deduped, each laid out as labelled parts', () => {
  const v = howToView(level({ widgets: ['choice', 'sort', 'choice'] }));
  assert.deepEqual(v.topics.map((t) => t.key), ['choice', 'sort']);
  assert.deepEqual(Object.keys(v), ['topics'], 'no level-wide footer: each guide carries its own parts');
  const sort = v.topics[1];
  assert.equal(sort.title, HOW_TO.sort.title);
  assert.deepEqual(labels(sort), ['How it works', 'What costs a star', 'Hints', 'Your stars']);
  assert.deepEqual(part(sort, 'How it works').items, HOW_TO.sort.play);
  assert.equal(part(sort, 'Hints').text, HOW_TO.sort.hints);
  assert.deepEqual(howToView(level({ widgets: [] })), { topics: [] });
});

test('a one-sentence how it works is text, several are a list', () => {
  const [spot, choice] = howToView(level({ widgets: ['spot', 'choice'] })).topics;
  assert.equal(HOW_TO.spot.play.length, 1);
  assert.equal(part(spot, 'How it works').text, HOW_TO.spot.play[0]);
  assert.deepEqual(part(spot, 'How it works').items, []);
  assert.ok(HOW_TO.choice.play.length > 1);
  assert.equal(part(choice, 'How it works').text, '');
});

test('what costs a star is built from the widget\'s own PENALTY: its costs, then what is free', () => {
  for (const w of WIDGETS) {
    const [t] = howToView(level({ widgets: [w] })).topics;
    const p = part(t, 'What costs a star');
    if (PENALTIES[w].free === '') assert.ok(p.text.endsWith('penalty.') || p.text.endsWith(' hint.'), `${w}: nothing free, nothing said`);
    else assert.ok(p.text.endsWith(` ${PENALTIES[w].free}`), w);
    assert.equal(p.text.includes('undefined'), false, w);
  }
  assert.equal(part(howToView(level({ widgets: ['choice'] })).topics[0], 'What costs a star').text, 'A wrong pick costs one penalty.');
  const text = (w) => part(howToView(level({ widgets: [w] })).topics[0], 'What costs a star').text;
  assert.equal(text('sort'), 'Each of these costs one penalty: a wrong placement and a hint. Retrying is free.');
  assert.equal(text('build'), 'Each of these costs one penalty: a wrong drop, a failed Check, a wrong pick and a hint. Retrying is free.');
  assert.ok(text('tradeoff').startsWith('Each of these costs one penalty: a failed Check (over the cap, or a need dropped) and a hint. '), 'a comma inside parentheses is not a split');
});

test('Your stars lists the ladder rung by rung, then the par sentence (with a par time) and REPLAY', () => {
  const [t] = howToView(level({ widgets: ['sort'], scoring: { parMs: null } })).topics;
  const p = part(t, 'Your stars');
  assert.equal(p.items.length, LADDER_RUNGS.length);
  assert.equal(p.items[0], `No penalties: ${LADDER_RUNGS[0].stars} stars`);
  assert.equal(p.items[1], `1 penalty: ${LADDER_RUNGS[1].stars} stars`);
  assert.match(p.items.at(-1), /^\d+ or more penalties: 1 star$/);
  assert.equal(p.note, REPLAY);
  assert.equal(part(howToView(level({ widgets: ['sort'], scoring: { parMs: 60000 } })).topics[0], 'Your stars').note, `${PAR} ${REPLAY}`);
});

test('a level that gives no stars says so and has no cost part', () => {
  const [t] = howToView(level({ widgets: ['sort'], scored: false, scoring: { parMs: 60000 } })).topics;
  assert.deepEqual(labels(t), ['How it works', 'Hints', 'Your stars']);
  assert.equal(part(t, 'Your stars').text, NOT_SCORED);
  assert.deepEqual(part(t, 'Your stars').items, []);
});

test('howToView refuses a widget it has no copy for', () => {
  assert.throws(() => howToView(level({ widgets: ['quiz'] })), /quiz/);
});

test('a widget in the level\'s hintless list says no hints; the others keep their own hint line', () => {
  const v = howToView(level({ widgets: ['sort', 'build', 'choice'], hintless: ['sort'] }));
  assert.deepEqual(v.topics.map((t) => part(t, 'Hints').text), [NO_HINTS, HOW_TO.build.hints, HOW_TO.choice.hints]);
  assert.notEqual(HOW_TO.sort.hints, NO_HINTS);
  assert.equal(part(howToView(level({ widgets: ['sort'] })).topics[0], 'Hints').text, HOW_TO.sort.hints, 'no hintless list: the entry\'s line');
});

test('the hint lines are plain sentences about one penalty per hint', () => {
  assert.equal(NO_HINTS, 'This step has no Hint button.');
  assert.equal(HOW_TO.sort.hints, 'Each hint costs one penalty. The Hint button shows what the next one costs.');
  assert.equal(HOW_TO.query.hints, 'A hint costs one penalty. Some steps have no Hint button.');
  assert.equal(HOW_TO.configure.hints, HOW_TO.query.hints);
});

test('copy reads as sentences: full stops, "Not quite" in quotes, no em dash, no terse fragments', () => {
  const lines = [];
  for (const [w, e] of Object.entries(HOW_TO)) {
    assert.ok(Array.isArray(e.play) && e.play.length >= 1, w);
    lines.push(...e.play, e.hints);
  }
  lines.push(NO_HINTS, PAR, REPLAY, NOT_SCORED);
  for (const l of lines) {
    assert.match(l, /^[A-Z].*\.$/s, l);
    assert.equal(l.includes('\u2014'), false, l);
    if (l.includes('Not quite')) assert.ok(l.includes('"Not quite"'), l);
  }
  assert.equal(HOW_TO.choice.play.join(' ').includes('Not quite'), true);
  assert.equal(HOW_TO.sort.play.join(' ').includes('Not quite'), true);
  assert.equal(lines.some((l) => /^No hints\.$/.test(l)), false);
});

test('the Query it guide says a repeated query is free', () => {
  assert.ok(HOW_TO.query.play.join(' ').includes('and that is free'));
});
