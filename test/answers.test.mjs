// The answer key of every declarative level, spelled out here a second time so a wrong key in
// a level file fails a test in another file (docs/DECLARATIVE-LEVELS.md §4). One line per step,
// in play order, in the format of test/helpers/step-drivers.mjs answerKey. Adding a play level:
// add its ANSWERS entry; the gap test fails until it exists (and for an id that is not a play level).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsOf } from './helpers/step-drivers.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { runPlay, validatePlay } from '../lib/play.mjs';
import { liveRegistry } from '../app.mjs';
import { playFixture, FIXTURE_CARD } from './fixtures/play-level.mjs';

const ANSWERS = {
  'auto-vs-manual': [
    'sort avm-sort: server=auto loyalty=manual redis=auto coupon=manual client=auto item-count=manual',
    'choice avm-why: two-setups',
    'choice avm-fix: keep-one',
  ],
  'play-fixture': [
    'choice fx-pick: trace',
    'sort fx-sort: server=auto loyalty=manual',
    'build fx-tree: aaaaaaaaaaaaaaa2.parent=aaaaaaaaaaaaaaa1',
    'incident checkout-slow: traces,db-metrics > slow-query',
    'spot fx-spot: user',
    'tradeoff fx-budget: sampling=tail attrs=tier',
  ],
};

const FX = buildRegistry(
  [{ id: 'a', no: 0, levels: [playFixture()], boss: null }],
  { deck: [FIXTURE_CARD], nodeIds: [], play: { validatePlay, runPlay } },
).levels;
const PLAY_LEVELS = [...Object.values(liveRegistry().levels).filter((l) => l.play), ...Object.values(FX)];

/** Play levels without an ANSWERS entry, and entries that are not play levels. */
function answerGaps(ids, answers) {
  const keys = Object.keys(answers);
  return { missing: ids.filter((id) => !Object.hasOwn(answers, id)), extra: keys.filter((id) => !ids.includes(id)) };
}

test('every play level has an answer key and every key is a play level', () => {
  assert.deepEqual(answerGaps(PLAY_LEVELS.map((l) => l.id), ANSWERS), { missing: [], extra: [] });
});

test('answerGaps catches a missing key and a key without a play level', () => {
  assert.deepEqual(answerGaps(['a', 'b'], { a: [], c: [] }), { missing: ['b'], extra: ['c'] });
  assert.deepEqual(answerGaps([], {}), { missing: [], extra: [] });
});

for (const level of PLAY_LEVELS) {
  test(`${level.id}: the level's answers are the pinned answers`, () => {
    assert.deepEqual(stepsOf(level).map(({ driver, spec }) => driver.answerKey(spec)), ANSWERS[level.id]);
  });
}
