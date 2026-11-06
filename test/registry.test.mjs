// lib/registry.mjs: validate and build the level registry and the card deck.
// Spec: docs/FOUNDATION.md §2.1-2.4, §3 registry and §6 F3 registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MECHANICS,
  RegistryError,
  WIDGETS,
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

test('act teaser is carried through; absent is \'\'; non-string is an error', () => {
  const acts = baseline();
  acts[0].teaser = 'Signals first.';
  assert.deepEqual(validateRegistry(acts, REFS), { ok: true, errors: [] });
  const reg = buildRegistry(acts, { deck: DECK, nodeIds: ['n1'] });
  assert.equal(reg.acts[0].teaser, 'Signals first.');
  assert.equal(reg.acts[1].teaser, '');
  const bad = baseline();
  bad[0].teaser = 7;
  rejects(bad, 'act "a0": teaser must be a string');
});

test('the baseline is valid and builds into ordered, defaulted, typed levels', () => {
  assert.deepEqual(validateRegistry(baseline(), REFS), { ok: true, errors: [] });
  const reg = buildRegistry(baseline(), { deck: DECK, nodeIds: ['n1'] });
  assert.deepEqual(reg.order, ['x', 'y', 'bx', 'z']);
  assert.deepEqual(reg.acts, [
    { id: 'a0', no: 0, name: '', sub: '', teaser: '', levelIds: ['x', 'y'], bossId: 'bx' },
    { id: 'a1', no: 1, name: '', sub: '', teaser: '', levelIds: ['z'], bossId: null },
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
  const acts = withEdit((a) => {
    Object.assign(a[0].levels[0], { cards: ['c1'], scoring: { parMs: 5000 } });
  });
  const reg = buildRegistry(acts, { deck: DECK, nodeIds: ['n1'] });
  const x = acts[0].levels[0];
  assert.equal(Object.isFrozen(x), false);
  assert.equal(Object.isFrozen(x.scoring), false, 'nested source object stays unfrozen');
  assert.equal(Object.isFrozen(x.cards), false);
  assert.equal(Object.isFrozen(x.mechanics), false);
  assert.equal(Object.isFrozen(acts[0]), false);
  assert.equal(Object.isFrozen(acts[0].levels), false);
  assert.ok(Object.isFrozen(reg.levels.x.scoring));
  assert.notEqual(reg.levels.x.scoring, x.scoring);
  assert.equal('actId' in x, false);
  assert.equal('kind' in x, false);
});

test('the built level holds exactly the §2.1 fields plus actId and kind', () => {
  const reg = buildRegistry(baseline(), { deck: DECK, nodeIds: ['n1'] });
  assert.deepEqual(Object.keys(reg.levels.x).sort(), [
    'actId', 'cards', 'hintless', 'icon', 'id', 'kind', 'lights', 'mechanics', 'name', 'no', 'play',
    'rewardTitle', 'run', 'scored', 'scoring', 'sub', 'widgets',
  ]);
});

test('widgets: declared on run levels, absent is none (not the mechanics)', () => {
  const built = (extra) => buildRegistry([{ id: 'a0', no: 0, levels: [L('x', '0.1', extra)], boss: null }], { deck: DECK, nodeIds: ['n1'] }).levels.x;
  assert.deepEqual([...built({ mechanics: ['sort'], widgets: ['choice', 'sort'] }).widgets], ['choice', 'sort']);
  assert.deepEqual([...built({ mechanics: ['sort'] }).widgets], []);
  assert.deepEqual([...built({ mechanics: ['sort'], widgets: [] }).widgets], []);
  const lv = (extra) => [{ id: 'a0', no: 0, levels: [L('x', '0.1', { mechanics: ['sort'], ...extra })], boss: null }];
  rejects(lv({ widgets: ['build'] }), 'level "x": widget "build" is not in mechanics');
  rejects(lv({ widgets: ['quiz'] }), 'level "x": unknown widget "quiz"');
  rejects(lv({ widgets: ['choice', 'choice'] }), 'level "x": duplicate widget "choice"');
  rejects(lv({ widgets: 'sort' }), 'level "x": widgets must be an array');
  assert.deepEqual(WIDGETS, ['choice', ...MECHANICS]);
});

test('hintless: declared on run levels (absent is none), a unique subset of its widgets', () => {
  const lvl = (extra) => [{ id: 'a0', no: 0, levels: [L('x', '0.1', { mechanics: ['sort'], widgets: ['choice', 'sort'], ...extra })], boss: null }];
  const built = (extra) => buildRegistry(lvl(extra), { deck: DECK, nodeIds: ['n1'] }).levels.x;
  assert.deepEqual([...built({ hintless: ['sort'] }).hintless], ['sort']);
  assert.deepEqual([...built({}).hintless], []);
  rejects(lvl({ hintless: ['build'] }), 'level "x": hintless widget "build" is not in widgets');
  rejects(lvl({ hintless: ['sort', 'sort'] }), 'level "x": duplicate hintless "sort"');
  rejects(lvl({ hintless: 'sort' }), 'level "x": hintless must be an array');
  rejects(lvl({ widgets: undefined, hintless: ['sort'] }), 'level "x": hintless widget "sort" is not in widgets');
});

test('unknown keys on levels, acts and cards are rejected, with a hint when close', () => {
  rejects(
    withEdit((a) => (a[0].levels[0].light = ['n1'])),
    'unknown key "light" on level "x" (did you mean "lights"?)',
  );
  rejects(
    withEdit((a) => (a[0].boss.concept = 'x')),
    'unknown key "concept" on level "bx"',
  );
  const far = validateRegistry(withEdit((a) => (a[0].levels[0].zzzzzz = 1)), REFS).errors;
  assert.deepEqual(far, ['unknown key "zzzzzz" on level "x"']);
  rejects(
    withEdit((a) => (a[1].bos = null)),
    'unknown key "bos" on act "a1" (did you mean "boss"?)',
  );
  const { errors } = validateDeck([card('c1', { fronts: 'x' })]);
  assert.deepEqual(errors, ['unknown key "fronts" on card "c1" (did you mean "front"?)']);
});

test('a declared act or kind gets its own message, not an unknown-key one', () => {
  const { errors } = validateRegistry(withEdit((a) => (a[0].levels[0].kind = 'boss')), REFS);
  assert.deepEqual(errors, ['level "x": must not declare "kind"']);
});

test('an id of exactly 64 characters and a 140-character front are accepted', () => {
  const long = 'a'.repeat(64);
  const acts = withEdit((a) => (a[0].levels[0].id = long));
  assert.deepEqual(validateRegistry(acts, REFS), { ok: true, errors: [] });
  const deck = [card(long, { front: 'x'.repeat(140) })];
  assert.deepEqual(validateDeck(deck), { ok: true, errors: [] });
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
    'level "y": no "0.1" must come after "0.1" (level "x")',
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

test('no is "<act>.<n>" with n >= 1 and no leading zeros', () => {
  rejects(
    withEdit((a) => (a[0].levels[0].no = '0.0')),
    'level "x": no "0.0" must be "0.<n>" with n >= 1 and no leading zeros',
  );
  rejects(
    withEdit((a) => (a[0].levels[1].no = '0.02')),
    'level "y": no "0.02" must be "0.<n>"',
  );
  rejects(
    withEdit((a) => (a[1].levels[0].no = '01.1')),
    'level "z": no "01.1" must be "1.<n>"',
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

test('holes in ACTS, in levels or in the deck are reported, never skipped', () => {
  const holeyLevels = withEdit((a) => (a[0].levels = [a[0].levels[0], , a[0].levels[1]]));
  rejects(holeyLevels, 'act "a0": level 1 is not an object');
  const [a0, a1] = baseline();
  rejects([a0, , a1], 'act 1 is not an object');
  const deck = [card('c1')];
  deck.length = 2;
  const res = validateDeck(deck);
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes('deck card 1 is not an object'), JSON.stringify(res.errors));
});

test('unquotable values (BigInt, circular, Symbol) are reported, not thrown', () => {
  const circ = {};
  circ.self = circ;
  const cases = [
    [(a) => (a[0].levels[0].no = 1n), 'level "x": no [object BigInt]'],
    [(a) => (a[0].levels[0].cards = [10n]), 'level "x": unknown card [object BigInt]'],
    [(a) => (a[0].levels[0].lights = [circ]), 'level "x": unknown node [object Object]'],
    [(a) => (a[0].levels[0].no = circ), 'level "x": no [object Object]'],
    [(a) => (a[0].id = Symbol('a0')), 'invalid act id [object Symbol]'],
    [(a) => (a[0].no = Symbol('n')), 'act "a0": no must be an integer from 0 to'],
    [(a) => (a[0].levels[0].id = 7n), 'act "a0": invalid level id [object BigInt]'],
  ];
  for (const [edit, fragment] of cases) rejects(withEdit(edit), fragment);
  assert.deepEqual(validateDeck([card('c1', { id: Symbol('c') })]).errors, [
    'invalid card id [object Symbol]',
  ]);
});

test('bad options are reported, not thrown', () => {
  assert.deepEqual(validateRegistry([], null), {
    ok: false,
    errors: ['options must be an object'],
  });
  assert.deepEqual(validateRegistry([], { nodeIds: 5 }), {
    ok: false,
    errors: ['nodeIds must be an array'],
  });
  assert.deepEqual(validateRegistry([], { cardIds: 'c1' }), {
    ok: false,
    errors: ['cardIds must be an array'],
  });
  assert.throws(() => buildRegistry([], null), RegistryError);
  assert.throws(() => buildRegistry([], { deck: [], nodeIds: 5 }), RegistryError);
});

test('cardIds and nodeIds entries must be ids; a caller object is never frozen', () => {
  const node = { id: 'n2' };
  assert.deepEqual(validateRegistry([], { nodeIds: ['n1', node], cardIds: ['c1', 7] }).errors, [
    'cardIds: invalid id 7',
    'nodeIds: invalid id {"id":"n2"}',
  ]);
  const acts = withEdit((a) => (a[0].levels[0].lights = [node]));
  assert.throws(() => buildRegistry(acts, { deck: DECK, nodeIds: ['n1', node] }), RegistryError);
  assert.equal(Object.isFrozen(node), false);
});

test('act numbers must be safe integers; no strings are compared as numbers', () => {
  rejects(
    withEdit((a) => {
      a[1].no = 1e21;
      a[1].levels[0].no = '1eee21.1';
    }),
    'act "a1": no must be an integer from 0 to 9007199254740991',
  );
  rejects(
    withEdit((a) => (a[1].levels[0].no = '1.1.1')),
    'level "z": no "1.1.1" must be "1.<n>"',
  );
});

test('a throwing getter is reported as unreadable, never thrown', () => {
  const trap = (obj, key) =>
    Object.defineProperty(obj, key, {
      enumerable: true,
      get() {
        throw new Error('trap');
      },
    });
  rejects(
    withEdit((a) => trap(a[0].levels[1], 'name')),
    'act "a0": level 1 could not be read',
  );
  rejects(
    withEdit((a) => trap(a[1], 'levels')),
    'act 1 could not be read',
  );
  const deck = [card('c1')];
  trap(deck[0], 'back');
  assert.deepEqual(validateDeck(deck).errors, ['deck card 0 could not be read']);
});

test('short unknown keys get no hint', () => {
  for (const key of ['', 'x', 'ui']) {
    const { errors } = validateRegistry(withEdit((a) => (a[0].levels[0][key] = 1)), REFS);
    assert.deepEqual(errors, [`unknown key "${key}" on level "x"`]);
  }
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

test('an id whose only fault is an uppercase letter is rejected', () => {
  // Lowercase twins pass, so the uppercase letter is the only reason for each rejection.
  assert.equal(validateRegistry(withEdit((a) => (a[0].levels[0].id = 'abc')), REFS).ok, true);
  assert.equal(validateRegistry(withEdit((a) => (a[0].id = 'a9')), REFS).ok, true);
  assert.equal(validateDeck([card('cx')]).ok, true);
  rejects(withEdit((a) => (a[0].levels[0].id = 'Abc')), 'invalid level id "Abc"');
  rejects(withEdit((a) => (a[0].id = 'A9')), 'invalid act id "A9"');
  const deck = validateDeck([card('Cx')]);
  assert.equal(deck.ok, false);
  assert.equal(deck.errors.some((e) => e.includes('invalid card id "Cx"')), true);
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
