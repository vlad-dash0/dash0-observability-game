// Blind strategies must not win any Spot it board (#190). A rule below ignores what the lines
// say and uses only how long they are; if it solves a board through the real checkSpot, the
// player can earn 5 stars without reading. (Position rules: test/spot-ladder.test.mjs.) Specs
// come from the live registry, so a new Spot board is covered without editing this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';
import { checkSpot, newSpotState, toggleLine } from '../lib/widgets/spot-it.mjs';

/** Every Spot it spec, as { no, spec }, from declarative (play.steps) and hand-written (CONTENT.steps) levels. */
async function allSpotSpecs() {
  const out = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const byId = new Map();
      for (const s of [...(mod.default.play?.steps ?? []), ...(mod.CONTENT?.steps ?? [])]) if (s?.spot) byId.set(s.spot.id, s.spot);
      for (const spec of byId.values()) out.push({ no: mod.default.no, spec });
    }
  }
  return out;
}

/** Pick `ids` one by one through toggleLine, then Check through the real checkSpot. */
function solvedBy(spec, ids) {
  let state = newSpotState(spec);
  for (const id of ids) state = toggleLine(spec, state, id).state;
  return checkSpot(spec, state).state.solved;
}

/** Every way to choose `n` of `list`. */
function choose(list, n) {
  if (n === 0) return [[]];
  if (list.length < n) return [];
  const [head, ...rest] = list;
  return [...choose(rest, n - 1).map((c) => [head, ...c]), ...choose(rest, n)];
}

/**
 * Every pick of the k longest (dir = -1) or shortest (dir = 1) lines, ties broken every way:
 * the lines strictly past the k-th length, plus each choice of the lines tied at it.
 */
function extremePicks(spec, k, dir) {
  const len = (l) => l.text.length;
  const ranked = [...spec.lines].sort((a, b) => dir * (len(a) - len(b)));
  const edge = len(ranked[k - 1]);
  const past = spec.lines.filter((l) => dir * (len(l) - edge) < 0).map((l) => l.id);
  const tied = spec.lines.filter((l) => len(l) === edge).map((l) => l.id);
  return choose(tied, k - past.length).map((c) => [...past, ...c]);
}

test('the length rules see every Spot board, and each board is solved by its own answer', async () => {
  const specs = await allSpotSpecs();
  assert.equal(specs.length, 6, 'all six Spot boards');
  for (const { no, spec } of specs) {
    assert.equal(solvedBy(spec, spec.faults), true, `${no} ${spec.id}: its own answer solves it`);
    // The enumeration is exact: on a board with a tie at the edge it yields more than one pick.
    for (const dir of [-1, 1]) {
      for (const pick of extremePicks(spec, spec.faults.length, dir)) assert.equal(new Set(pick).size, spec.faults.length);
    }
  }
});

test('picking the k longest or the k shortest lines (k = the answer count, ties broken every way) solves no Spot board (#190)', async () => {
  const solving = {};
  for (const { no, spec } of await allSpotSpecs()) {
    const k = spec.faults.length;
    for (const [name, dir] of [['the k longest lines', -1], ['the k shortest lines', 1]]) {
      if (extremePicks(spec, k, dir).some((ids) => solvedBy(spec, ids))) (solving[`${no} ${spec.id}`] ??= []).push(name);
    }
  }
  assert.deepEqual(solving, {}, 'boards a length rule solves without reading them');
});
