// The Spot it help ladder per level (#160): every Spot it step declares its helps explicitly,
// and the nine Spot levels follow the default ladder: hints on in act 3 (3.2, 3.5, 3.6) and off
// later (5.2, 5.5, 6.2, 7.1, 8.1, 8.2). A step with no helps key would have hints off (spotHelps), but the
// ladder is a decision, so it is written down on each step. The specs are read from each
// level's `play` and its CONTENT export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { checkSpot, newSpotState, toggleLine } from '../lib/widgets/spot-it.mjs';
import { renderSpot } from '../lib/widgets/spot-it-view.mjs';
import { hintFor, spotHelps, validateSpotHelps } from '../lib/widgets/spot-it-help.mjs';
import { makeDom, qa } from './helpers/dom.mjs';

const LADDER = {
  '3.2': true,
  '3.5': true,
  '3.6': true,
  '5.2': false,
  '5.5': false,
  '6.2': false,
  '7.1': false,
  '8.1': false,
  '8.2': false,
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

test('the Spot levels are exactly the nine on the ladder', async () => {
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

// Position bias (#160 review): tier 2 lists its pair in spec order, so if the answers sat at the
// top of a board, "the earlier outlined line" would be the answer and the hint would give it away.
// From an empty board, every (missing line, decoy) draw is enumerated through hintFor itself: the
// first shuffle call rotates the missing lines by i, the second the decoys by j.
test('tier 2 spreads its pair: on each hints-on board the earlier outlined line is the answer in 40% to 60% of draws', async () => {
  const shares = {};
  for (const { no, specs } of await spotLevels()) {
    if (!LADDER[no]) continue;
    for (const spec of specs) {
      const faults = new Set(spec.faults);
      const nMissing = spec.faults.length;
      const nDecoys = spec.lines.length - nMissing;
      let earlier = 0;
      let total = 0;
      const seen = new Set();
      for (let i = 0; i < nMissing; i += 1) {
        for (let j = 0; j < nDecoys; j += 1) {
          const turns = [i, j];
          let call = 0;
          const shuffle = (list) => {
            const k = turns[call++] % list.length;
            return [...list.slice(k), ...list.slice(0, k)];
          };
          const h = hintFor(spec, newSpotState(spec), 2, { shuffle, e: escapeHtml });
          assert.equal(h.hinted.length, 2, `${no} ${spec.id}: a pair`);
          assert.equal(h.hinted.filter((id) => faults.has(id)).length, 1, `${no} ${spec.id}: one answer, one decoy`);
          seen.add(h.hinted.join('+'));
          total += 1;
          if (faults.has(h.hinted[0])) earlier += 1;
        }
      }
      assert.equal(seen.size, nMissing * nDecoys, `${no} ${spec.id}: every pair is drawn once`);
      const share = earlier / total;
      shares[`${no} ${spec.id}`] = share;
      assert.ok(share >= 0.4 && share <= 0.6, `${no} ${spec.id}: the earlier line is the answer in ${share.toFixed(3)} of tier-2 pairs`);
    }
  }
  assert.deepEqual(Object.keys(shares).map((k) => k.split(' ')[0]).sort(), ['3.2', '3.5', '3.6'], JSON.stringify(shares));
});

// Answer layout (#160 review round 2): a player who has solved one Spot board must not solve
// another by its positions alone, and no position rule may solve a board without reading it.
// Layout = which lines are answers, as a pattern over the lines in authored order ('F' answer,
// '.' not). Every Spot step is checked, one per level today.
const layout = (spec) => spec.lines.map((l) => (spec.faults.includes(l.id) ? 'F' : '.')).join('');

/** Pick `ids` one by one through toggleLine, then Check through the real checkSpot. */
function solvedBy(spec, ids) {
  let state = newSpotState(spec);
  for (const id of ids) state = toggleLine(spec, state, id).state;
  return checkSpot(spec, state).state.solved;
}

// Position rules over the 1-based line numbers; k = the board's answer count.
const RULES = {
  'every odd line': (n) => n % 2 === 1,
  'every even line': (n) => n % 2 === 0,
  'the first k lines': (n, len, k) => n <= k,
  'the last k lines': (n, len, k) => n > len - k,
};

test('no two Spot boards share an answer layout', async () => {
  const byLayout = {};
  for (const { no, specs } of await spotLevels()) {
    for (const spec of specs) (byLayout[layout(spec)] ??= []).push(`${no} ${spec.id}`);
  }
  const shared = Object.entries(byLayout).filter(([, boards]) => boards.length > 1);
  assert.deepEqual(shared, [], JSON.stringify(byLayout));
  assert.equal(Object.values(byLayout).flat().length, 9, 'all nine Spot boards were compared');
});

test('no position rule (every odd or even line, the first or last k lines) solves any Spot board through checkSpot (#190)', async () => {
  const solving = {};
  let boards = 0;
  for (const { no, specs } of await spotLevels()) {
    for (const spec of specs) {
      boards += 1;
      const k = spec.faults.length;
      // The real answer does solve it, so a rule that "never solves" is a real result.
      assert.equal(solvedBy(spec, spec.faults), true, `${no} ${spec.id}: its own answer solves it`);
      for (const [name, rule] of Object.entries(RULES)) {
        const ids = spec.lines.filter((l, i) => rule(i + 1, spec.lines.length, k)).map((l) => l.id);
        if (solvedBy(spec, ids)) (solving[`${no} ${spec.id}`] ??= []).push(name);
      }
    }
  }
  assert.equal(boards, 9, 'all nine Spot boards were tried');
  assert.deepEqual(solving, {}, 'boards a position rule solves without reading them');
});
