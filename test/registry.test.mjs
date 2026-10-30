// lib/registry.mjs: validate and build the level registry and the card deck.
// Spec: docs/FOUNDATION.md §2.1-2.4, §3 registry and §6 F3 registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RegistryError,
  buildRegistry,
  nodeLitBy,
  validateDeck,
  validateRegistry,
} from '../lib/registry.mjs';

const L = (id, no, extra = {}) => ({
  id,
  no,
  name: `Level ${id}`,
  icon: '*',
  rewardTitle: `Title ${id}`,
  mechanics: ['query'],
  run() {},
  ...extra,
});

function baseline() {
  const x = L('x', '0.1');
  const y = L('y', '0.2');
  const bx = L('bx', null);
  const z = L('z', '1.1');
  return [
    { id: 'a0', no: 0, levels: [x, y], boss: bx },
    { id: 'a1', no: 1, levels: [z], boss: null },
  ];
}

const REFS = { cardIds: ['c1'], nodeIds: ['n1'] };
const card = (id, extra = {}) => ({
  id,
  front: `Front ${id}`,
  back: `Back ${id}`,
  specUrl: 'https://opentelemetry.io/docs/',
  dash0Angle: null,
  ...extra,
});
const DECK = [card('c1')];

/** Assert the acts are invalid and some error contains `fragment`. */
function rejects(acts, fragment, refs = REFS) {
  const { ok, errors } = validateRegistry(acts, refs);
  assert.equal(ok, false, `expected invalid for "${fragment}"`);
  assert.ok(
    errors.some((e) => e.includes(fragment)),
    `no error mentions ${fragment}: ${JSON.stringify(errors)}`,
  );
  return errors;
}

// Mutate one level of a fresh baseline: f(acts) edits it in place.
function withEdit(f) {
  const acts = baseline();
  f(acts);
  return acts;
}

test('the baseline is valid and builds into ordered, defaulted, typed levels', () => {
  assert.deepEqual(validateRegistry(baseline(), REFS), { ok: true, errors: [] });
  const reg = buildRegistry(baseline(), { deck: DECK, nodeIds: ['n1'] });
  assert.deepEqual(reg.order, ['x', 'y', 'bx', 'z']);
  assert.deepEqual(reg.acts, [
    { id: 'a0', no: 0, name: '', sub: '', levelIds: ['x', 'y'], bossId: 'bx' },
    { id: 'a1', no: 1, name: '', sub: '', levelIds: ['z'], bossId: null },
  ]);
  assert.equal(reg.levels.bx.kind, 'boss');
  assert.equal(reg.levels.bx.actId, 'a0');
  assert.equal(reg.levels.z.kind, 'level');
  assert.equal(reg.levels.z.actId, 'a1');
  assert.equal(reg.levels.x.scored, true);
  assert.deepEqual(reg.levels.x.cards, []);
  assert.deepEqual(reg.levels.x.lights, []);
  assert.equal(reg.levels.x.sub, '');
  assert.deepEqual(reg.levels.x.scoring, { parMs: null });
  assert.equal(typeof reg.levels.x.run, 'function');
  assert.deepEqual(reg.cardIds, ['c1']);
});

test('act name and sub are carried through', () => {
  const acts = baseline();
  acts[0].name = 'Resources';
  acts[0].sub = 'Who is talking?';
  const reg = buildRegistry(acts, { deck: DECK, nodeIds: ['n1'] });
  assert.equal(reg.acts[0].name, 'Resources');
  assert.equal(reg.acts[0].sub, 'Who is talking?');
});

test('the built registry is deep-frozen with a null-prototype level map', () => {
  const reg = buildRegistry(baseline(), { deck: DECK, nodeIds: ['n1'] });
  assert.equal(Object.getPrototypeOf(reg.levels), null);
  for (const v of [reg, reg.acts, reg.acts[0], reg.acts[0].levelIds, reg.levels, reg.order]) {
    assert.ok(Object.isFrozen(v));
  }
  for (const v of [reg.cardIds, reg.levels.x, reg.levels.x.cards, reg.levels.x.scoring]) {
    assert.ok(Object.isFrozen(v));
  }
  assert.equal(reg.levels.constructor, undefined);
});

test('building copies: the source level modules are neither frozen nor annotated', () => {
  const acts = baseline();
  buildRegistry(acts, { deck: DECK, nodeIds: ['n1'] });
  const x = acts[0].levels[0];
  assert.equal(Object.isFrozen(x), false);
  assert.equal('actId' in x, false);
  assert.equal('kind' in x, false);
});

test('declared cards, lights, scored and scoring survive the build', () => {
  const acts = withEdit((a) => {
    Object.assign(a[0].levels[0], {
      cards: ['c1'],
      lights: ['n1'],
      scored: false,
      scoring: { parMs: 90000 },
    });
  });
  const reg = buildRegistry(acts, { deck: DECK, nodeIds: ['n1'] });
  assert.deepEqual(reg.levels.x.cards, ['c1']);
  assert.deepEqual(reg.levels.x.lights, ['n1']);
  assert.equal(reg.levels.x.scored, false);
  assert.deepEqual(reg.levels.x.scoring, { parMs: 90000 });
});

test('a level id in two acts is a duplicate', () => {
  rejects(
    withEdit((a) => a[1].levels.push(L('x', '1.2'))),
    'duplicate level id "x"',
  );
});

test('the same module twice, or a boss also listed as a level, is a duplicate', () => {
  rejects(
    withEdit((a) => a[0].levels.push(a[0].levels[0])),
    'duplicate level id "x"',
  );
  const acts = baseline();
  const boss = L('b1', null);
  acts[1].boss = boss;
  acts[1].levels.push(boss);
  rejects(acts, 'duplicate level id "b1"');
});

test('an act without levels is rejected', () => {
  rejects(
    withEdit((a) => (a[0].levels = [])),
    'act "a0" has no levels',
  );
});

test('a boss must be a level or null', () => {
  rejects(
    withEdit((a) => delete a[1].boss),
    'act "a1": boss must be a level or null',
  );
});

test('card and node references must exist', () => {
  rejects(
    withEdit((a) => (a[0].levels[0].cards = ['c9'])),
    'unknown card "c9"',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].lights = ['n9'])),
    'unknown node "n9"',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].cards = ['c1', 'c1'])),
    'duplicate card "c1"',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].lights = ['n1', 'n1'])),
    'duplicate node "n1"',
  );
});

test('a level must not declare act, kind or actId', () => {
  for (const key of ['act', 'kind', 'actId']) {
    rejects(
      withEdit((a) => (a[0].levels[0][key] = 'a0')),
      `must not declare "${key}"`,
    );
  }
});

test('no must match the act, increase within it, and be null for a boss', () => {
  rejects(
    withEdit((a) => (a[1].levels[0].no = '2.1')),
    'level "z": no "2.1"',
  );
  rejects(
    withEdit((a) => (a[0].levels[1].no = '0.1')),
    'level "y": no "0.1"',
  );
  rejects(
    withEdit((a) => (a[0].boss.no = '0.3')),
    'level "bx": no',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].no = null)),
    'level "x": no',
  );
});

test('no ordering is numeric, not string: 0.9 then 0.10 is fine', () => {
  const acts = withEdit((a) => {
    a[0].levels[0].no = '0.9';
    a[0].levels[1].no = '0.10';
  });
  assert.equal(validateRegistry(acts, REFS).ok, true);
});

test('mechanics must be a non-empty list of known, unique mechanics', () => {
  rejects(
    withEdit((a) => (a[0].levels[0].mechanics = ['dance'])),
    'unknown mechanic "dance"',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].mechanics = [])),
    'level "x": mechanics',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].mechanics = ['query', 'query'])),
    'duplicate mechanic "query"',
  );
});

test('every required field is checked', () => {
  rejects(
    withEdit((a) => delete a[0].levels[0].run),
    'level "x": run must be a function',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].id = 'Bad_ID')),
    'invalid level id "Bad_ID"',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].id = 'a'.repeat(65))),
    'invalid level id',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].name = '')),
    'level "x": name',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].icon = '')),
    'level "x": icon',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].rewardTitle = '')),
    'level "x": rewardTitle',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].scored = 'yes')),
    'level "x": scored',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].scoring = { parMs: 0 })),
    'level "x": scoring.parMs',
  );
  rejects(
    withEdit((a) => (a[0].levels[0].scoring = { parMs: 1.5 })),
    'level "x": scoring.parMs',
  );
  rejects(
    withEdit((a) => (a[0].levels[0] = 'x')),
    'act "a0": level 0 is not an object',
  );
});

test('act ids are unique and act numbers strictly increase', () => {
  rejects(
    withEdit((a) => (a[1].id = 'a0')),
    'duplicate act id "a0"',
  );
  rejects(
    withEdit((a) => {
      a[1].no = 0;
      a[1].levels[0].no = '0.3';
    }),
    'act "a1": no 0',
  );
  rejects(
    withEdit((a) => (a[0].id = 'Act 0')),
    'invalid act id "Act 0"',
  );
});

test('act number gaps are allowed', () => {
  const acts = withEdit((a) => {
    a[1].no = 5;
    a[1].levels[0].no = '5.1';
  });
  assert.equal(validateRegistry(acts, REFS).ok, true);
});

test('reward titles are unique across levels and bosses', () => {
  rejects(
    withEdit((a) => (a[0].boss.rewardTitle = 'Title x')),
    'duplicate reward title "Title x"',
  );
});

test('every problem is reported at once', () => {
  const acts = withEdit((a) => {
    a[0].levels[0].cards = ['c9'];
    a[1].levels[0].lights = ['n9'];
  });
  const { ok, errors } = validateRegistry(acts, REFS);
  assert.equal(ok, false);
  assert.equal(errors.length, 2, JSON.stringify(errors));
});

test('buildRegistry throws one RegistryError naming every problem', () => {
  const acts = withEdit((a) => {
    a[0].levels[0].cards = ['c9'];
    a[1].levels[0].lights = ['n9'];
  });
  assert.throws(
    () => buildRegistry(acts, { deck: DECK, nodeIds: ['n1'] }),
    (err) => {
      assert.ok(err instanceof RegistryError);
      assert.equal(err.errors.length, 2);
      assert.ok(err.message.includes('unknown card "c9"'));
      assert.ok(err.message.includes('unknown node "n9"'));
      return true;
    },
  );
});

test('buildRegistry also reports deck problems', () => {
  assert.throws(
    () =>
      buildRegistry(baseline(), {
        deck: [card('c1', { specUrl: 'http://x' })],
        nodeIds: ['n1'],
      }),
    (err) => err instanceof RegistryError && err.message.includes('card "c1": specUrl'),
  );
});

test('validateRegistry never throws, even on garbage', () => {
  for (const acts of [null, 'x', {}, [null], [{ id: 'a0', no: 0, levels: 'x', boss: null }]]) {
    const res = validateRegistry(acts, REFS);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length >= 1);
  }
  const usesC1 = withEdit((a) => (a[0].levels[0].cards = ['c1']));
  assert.equal(validateRegistry(usesC1, {}).ok, false, 'missing refs count as empty sets');
});

test('an empty ACTS is valid and builds an empty registry', () => {
  assert.deepEqual(validateRegistry([], { cardIds: [], nodeIds: [] }), { ok: true, errors: [] });
  const reg = buildRegistry([], { deck: [], nodeIds: [] });
  assert.deepEqual(reg.order, []);
  assert.deepEqual(reg.acts, []);
  assert.deepEqual(Object.keys(reg.levels), []);
});

test('validateDeck accepts a good deck and sorts nothing away', () => {
  assert.deepEqual(validateDeck([card('c2'), card('c1', { dash0Angle: 'Dash0 shows it' })]), {
    ok: true,
    errors: [],
  });
  assert.deepEqual(
    buildRegistry([], { deck: [card('c2'), card('c1')], nodeIds: [] }).cardIds,
    ['c1', 'c2'],
  );
});

test('validateDeck rejects each bad card field', () => {
  const bad = (deck, fragment) => {
    const { ok, errors } = validateDeck(deck);
    assert.equal(ok, false);
    assert.ok(
      errors.some((e) => e.includes(fragment)),
      `${fragment}: ${JSON.stringify(errors)}`,
    );
  };
  bad([card('c1'), card('c1')], 'duplicate card id "c1"');
  bad([card('c1', { specUrl: 'http://x' })], 'card "c1": specUrl');
  bad([card('c1', { front: '' })], 'card "c1": front');
  bad([card('c1', { front: 'x'.repeat(141) })], 'card "c1": front');
  bad([card('c1', { back: '' })], 'card "c1": back');
  bad([card('c1', { dash0Angle: '' })], 'card "c1": dash0Angle');
  bad([card('C 1')], 'invalid card id "C 1"');
  bad('nope', 'deck must be an array');
});

test('nodeLitBy lists the levels that light a node, in play order', () => {
  const acts = withEdit((a) => {
    a[0].levels[0].lights = ['n1'];
    a[1].levels[0].lights = ['n1'];
  });
  const reg = buildRegistry(acts, { deck: DECK, nodeIds: ['n1', 'n2'] });
  assert.deepEqual(nodeLitBy(reg, 'n1'), ['x', 'z']);
  assert.deepEqual(nodeLitBy(reg, 'n2'), []);
});
