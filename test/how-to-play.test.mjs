// lib/how-to-play.mjs: the per-widget help copy and the view of it for one level (#199 P2).
// Data only: no UI reads this yet. The copy states penalties through each widget's own
// PENALTY (identity-tested), so the card cannot drift from the code that charges them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOW_TO, NOT_SCORED, NO_HINTS, PAR, REPLAY, howToView } from '../lib/how-to-play.mjs';
import { LADDER, PENALTY as BUILD_PENALTY } from '../lib/widgets/help-ladder.mjs';
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

test('howToView: topics in play order, deduped; scored, par and unscored footers', () => {
  const v = howToView(level({ widgets: ['choice', 'sort', 'choice'] }));
  assert.deepEqual(v.topics.map((t) => t.key), ['choice', 'sort']);
  assert.ok(v.footer.includes(LADDER));
  assert.ok(v.footer.includes(REPLAY));
  assert.equal(v.footer.includes(PAR), false);
  const sort = v.topics[1];
  assert.equal(sort.title, HOW_TO.sort.title);
  assert.equal(sort.play, HOW_TO.sort.play);
  assert.equal(sort.hints, HOW_TO.sort.hints);
  assert.ok(sort.stars.includes(SORT_PENALTY.costs));
  assert.ok(sort.stars.includes(SORT_PENALTY.free));

  assert.ok(howToView(level({ scoring: { parMs: 60000 } })).footer.includes(PAR));
  assert.equal(howToView(level({ scoring: { parMs: null } })).footer.includes(PAR), false);

  const off = howToView(level({ scored: false, scoring: { parMs: 60000 } }));
  assert.deepEqual(off.topics.map((t) => t.stars), ['', '']);
  assert.equal(off.footer, NOT_SCORED);
  assert.deepEqual(howToView(level({ widgets: [] })), { topics: [], footer: '' });
});

test('howToView refuses a widget it has no copy for', () => {
  assert.throws(() => howToView(level({ widgets: ['quiz'] })), /quiz/);
});

test('a widget with nothing free has no free sentence', () => {
  // choice costs "a wrong pick" and frees nothing: the free sentence is absent.
  const [choice] = howToView(level({ widgets: ['choice'] })).topics;
  assert.ok(choice.stars.includes('a wrong pick'));
  assert.equal(choice.stars.includes('undefined'), false);
  assert.equal(choice.stars.endsWith(' '), false);
});

test('a widget in the level\'s hintless list says no hints; the others keep their own hint line', () => {
  const v = howToView(level({ widgets: ['sort', 'build', 'choice'], hintless: ['sort'] }));
  assert.deepEqual(v.topics.map((t) => t.hints), [NO_HINTS, HOW_TO.build.hints, HOW_TO.choice.hints]);
  assert.notEqual(HOW_TO.sort.hints, NO_HINTS);
  assert.equal(howToView(level({ widgets: ['sort'] })).topics[0].hints, HOW_TO.sort.hints, 'no hintless list: the entry\'s line');
});

test('the hint lines state the cost as one penalty and the Hint button as pricing on that board\'s score card', () => {
  assert.equal(HOW_TO.sort.hints, "Each hint counts as one penalty. Where the board has hints, the Hint button shows what the next one costs on that board's score card.");
  assert.equal(HOW_TO.query.hints, 'Show a hint costs one penalty. Some steps have no hint.');
  assert.equal(HOW_TO.configure.hints, HOW_TO.query.hints);
});

test('the star line names the level, not the board, and the play lines name what the screen says', () => {
  const [choice] = howToView(level({ widgets: ['choice'] })).topics;
  assert.equal(choice.stars, "Penalties count against the level's stars: a wrong pick.");
  assert.ok(HOW_TO.choice.play.includes('Not quite'));
  assert.ok(HOW_TO.sort.play.includes('Not quite'));
  assert.ok(HOW_TO.query.play.startsWith('Write a PromQL query and press Run. A new query that runs shows its result; running one you already tried shows its result again and costs nothing.'));
});
