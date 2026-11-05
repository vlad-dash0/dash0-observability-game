// The Sort it help ladder per level (#156): every Sort it step
// declares its helps explicitly, and the eleven Sort levels follow the default ladder. Hints are on
// in the first lessons (0.1, 0.2, 0.3, 1.1, 2.3) and off later (2.5, 2.7, 3.1, 4.1, 5.6, 9.1). A step
// with no helps key would have hints off (sortHelps), but the ladder is a decision, so it is
// written down on each step. The specs are read from each level's `play` and its CONTENT export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';
import { renderSort } from '../lib/widgets/sort-it-view.mjs';
import { sortHelps, validateSortHelps } from '../lib/widgets/sort-it-help.mjs';
import { makeDom, qa } from './helpers/dom.mjs';

const LADDER = {
  '0.1': true,
  '0.2': true,
  '0.3': true,
  '1.1': true,
  '2.3': true,
  '2.5': false,
  '2.7': false,
  '3.1': false,
  '4.1': false,
  '5.6': false,
  '9.1': false,
};

const LEVELS = join(dirname(fileURLToPath(import.meta.url)), '..', 'levels');

/** Every level file with at least one sort step: {no, file, specs}. Specs deduplicated by id. */
async function sortLevels() {
  const out = [];
  for (const file of readdirSync(LEVELS).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs').sort()) {
    const mod = await import(pathToFileURL(join(LEVELS, file)).href);
    const steps = [...(mod.default?.play?.steps ?? []), ...(mod.CONTENT?.steps ?? [])];
    const byId = new Map();
    for (const s of steps) if (s?.sort) byId.set(s.sort.id, s.sort);
    if (byId.size) out.push({ no: mod.default.no, file, specs: [...byId.values()] });
  }
  return out;
}

test('the Sort levels are exactly the eleven on the ladder', async () => {
  const found = (await sortLevels()).map((l) => l.no).sort();
  assert.deepEqual(found, Object.keys(LADDER).sort());
});

test('each Sort it step declares its helps, and they match the ladder', async () => {
  const got = {};
  for (const { no, file, specs } of await sortLevels()) {
    for (const spec of specs) {
      assert.equal(Object.hasOwn(spec, 'helps'), true, `${file} ${spec.id}: declares helps`);
      assert.deepEqual(validateSortHelps(spec), [], `${file} ${spec.id}`);
      got[`${no} ${spec.id}`] = sortHelps(spec).hints;
    }
  }
  const want = {};
  for (const { no, specs } of await sortLevels()) for (const spec of specs) want[`${no} ${spec.id}`] = LADDER[no];
  assert.deepEqual(got, want);
});

test('the board renders the ladder: a Hint button exactly where hints are on', async () => {
  for (const { no, file, specs } of await sortLevels()) {
    for (const spec of specs) {
      const dom = makeDom();
      dom.body.innerHTML = renderSort(spec, newSortState(spec), { escapeHtml });
      assert.equal(qa(`[id="${spec.id}-hint"]`).length, LADDER[no] ? 1 : 0, `${file} ${spec.id}`);
    }
  }
});
