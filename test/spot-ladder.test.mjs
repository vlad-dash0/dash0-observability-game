// The Spot it help ladder per level (#160): every Spot it step declares its helps explicitly,
// and the six Spot levels follow the default ladder: hints on in act 3 (3.2, 3.5, 3.6) and off
// later (5.2, 5.5, 6.2). A step with no helps key would have hints off (spotHelps), but the
// ladder is a decision, so it is written down on each step. The specs are read from each
// level's `play` and its CONTENT export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { newSpotState } from '../lib/widgets/spot-it.mjs';
import { renderSpot } from '../lib/widgets/spot-it-view.mjs';
import { spotHelps, validateSpotHelps } from '../lib/widgets/spot-it-help.mjs';
import { makeDom, qa } from './helpers/dom.mjs';

const LADDER = {
  '3.2': true,
  '3.5': true,
  '3.6': true,
  '5.2': false,
  '5.5': false,
  '6.2': false,
};

const LEVELS = join(dirname(fileURLToPath(import.meta.url)), '..', 'levels');

/** Every level file with at least one spot step: {no, file, specs}. Specs deduplicated by id. */
async function spotLevels() {
  const out = [];
  for (const file of readdirSync(LEVELS).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs').sort()) {
    const mod = await import(pathToFileURL(join(LEVELS, file)).href);
    const steps = [...(mod.default?.play?.steps ?? []), ...(mod.CONTENT?.steps ?? [])];
    const byId = new Map();
    for (const s of steps) if (s?.spot) byId.set(s.spot.id, s.spot);
    if (byId.size) out.push({ no: mod.default.no, file, specs: [...byId.values()] });
  }
  return out;
}

test('the Spot levels are exactly the six on the ladder', async () => {
  const found = (await spotLevels()).map((l) => l.no).sort();
  assert.deepEqual(found, Object.keys(LADDER).sort());
});

test('each Spot it step declares its helps, and they match the ladder', async () => {
  const got = {};
  const want = {};
  for (const { no, file, specs } of await spotLevels()) {
    for (const spec of specs) {
      assert.equal(Object.hasOwn(spec, 'helps'), true, `${file} ${spec.id}: declares helps`);
      assert.deepEqual(validateSpotHelps(spec), [], `${file} ${spec.id}`);
      got[`${no} ${spec.id}`] = spotHelps(spec).hints;
      want[`${no} ${spec.id}`] = LADDER[no];
    }
  }
  assert.deepEqual(got, want);
  assert.equal(Object.values(got).filter(Boolean).length >= 3, true, 'at least the three act 3 steps have hints');
});

test('the board renders the ladder: a Hint button exactly where hints are on', async () => {
  for (const { no, file, specs } of await spotLevels()) {
    for (const spec of specs) {
      const dom = makeDom();
      dom.body.innerHTML = renderSpot(spec, newSpotState(spec), { escapeHtml });
      assert.equal(qa(`[id="${spec.id}-hint"]`).length, LADDER[no] ? 1 : 0, `${file} ${spec.id}`);
    }
  }
});
