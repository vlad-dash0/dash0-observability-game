// lib/widgets/trade-off.mjs: the Trade-off widget core (validate, pick, price, check).
// Spec: docs/M1-DESIGN.md §4.5. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allPlans,
  checkTradeoff,
  evaluatePlan,
  formatAmount,
  newTradeoffState,
  pickOption,
  validateTradeoffSpec,
} from '../lib/widgets/trade-off.mjs';
import { spec } from './fixtures/trade-off-spec.mjs';

const deepFreeze = (v) => {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
};

const problems = (edit) => {
  const s = spec();
  edit(s);
  return validateTradeoffSpec(s);
};
const picked = (st, ...pairs) => pairs.reduce((acc, [k, o]) => pickOption(spec(), acc, k, o).state, st);

test('a well-formed spec has no problems, and the reference plan passes its own checker (I7)', () => {
  assert.deepEqual(validateTradeoffSpec(spec()), []);
  const s = spec();
  const st = { ...newTradeoffState(s), picks: s.answer };
  assert.equal(checkTradeoff(s, st).outcome, 'right');
});

test('validate names each problem and never throws', () => {
  const cases = [
    [(s) => { s.id = 'Bad Id'; }, /spec id "Bad Id" is not kebab-case/],
    [(s) => { s.unit = ' '; }, /unit is not non-empty text/],
    [(s) => { s.cap = 0; }, /cap 0 is not a number > 0/],
    [(s) => { s.cap = 1.005; }, /cap 1.005 is not a number > 0 with at most 2 decimals/],
    [(s) => { s.explain = ''; }, /explain is not non-empty text/],
    [(s) => { s.knobs = []; }, /knobs: 0, expected 1\.\.5/],
    [(s) => { s.needs = []; }, /needs: 0, expected 1\.\.4/],
    [(s) => { s.knobs[0].options.length = 1; }, /knob "sampling" options: 1, expected 2\.\.5/],
    [(s) => { s.knobs[1].id = 'sampling'; }, /duplicate knob id "sampling"/],
    [(s) => { s.knobs[0].options[1].id = 'head'; }, /duplicate option of knob "sampling" id "head"/],
    [(s) => { s.needs[1].id = 'errors'; }, /duplicate need id "errors"/],
    [(s) => { s.knobs[0].options[0].cost = -1; }, /option "head" of knob "sampling": cost -1 is not a number >= 0/],
    [(s) => { s.knobs[0].options[0].cost = '2'; }, /cost "2" is not a number/],
    [(s) => { s.knobs[0].options[0].cost = 0.123; }, /cost 0.123 is not a number/],
    [(s) => { s.knobs[0].options[1].keeps = ['nope']; }, /keeps unknown need "nope"/],
    [(s) => { s.knobs[0].options[1].keeps = 'errors'; }, /keeps is not a list/],
    [(s) => { s.knobs[0].label = ''; }, /knob "sampling": label is not non-empty text/],
    [(s) => { s.knobs[0].options[0] = 7; }, /knob "sampling" option 0: not an object/],
    [(s) => { s.answer = { sampling: 'tail' }; }, /answer: knob "attrs" has no pick/],
    [(s) => { s.answer.extra = 'x'; }, /answer: unknown knob "extra"/],
    [(s) => { s.answer.attrs = 'ghost'; }, /answer: unknown option "ghost" for knob "attrs"/],
    [(s) => { s.answer = 3; }, /answer is not an object/],
    [(s) => { s.answer = { sampling: 'all', attrs: 'user' }; }, /answer: the reference plan is over the cap by 15/],
    [(s) => { s.answer = { sampling: 'head', attrs: 'none' }; }, /answer: the reference plan drops "errors", "per-user"/],
    [(s) => { s.whyNot['attrs:ghost'] = 'x'; }, /whyNot: unknown option "attrs:ghost"/],
    [(s) => { s.whyNot['sampling:tail'] = 'x'; }, /whyNot: option "sampling:tail" is in the answer/],
    [(s) => { s.whyNot['attrs:none'] = ''; }, /whyNot "attrs:none" is not non-empty text/],
    [(s) => { s.whyNot = 'x'; }, /whyNot is not an object/],
  ];
  for (const [edit, want] of cases) assert.match(problems(edit).join('\n'), want, String(edit));
  for (const bad of [null, 3, [], 'x', undefined]) assert.deepEqual(validateTradeoffSpec(bad), ['spec: not an object']);
});

test('validate reports several problems at once', () => {
  assert.equal(problems((s) => { s.unit = ''; s.explain = ''; s.cap = -1; }).length, 3);
});

test('a spec that is not a real trade-off is refused (I7)', () => {
  // A huge cap: the cap never bites.
  assert.match(problems((s) => { s.cap = 100; }).join('\n'), /every plan that keeps every need fits the cap, so the cap never bites/);
  // Every option keeps everything: no signal is at stake.
  assert.match(
    problems((s) => { for (const k of s.knobs) for (const o of k.options) o.keeps = ['errors', 'per-user']; }).join('\n'),
    /every plan within the cap keeps every need, so no signal is ever at stake/,
  );
});

test('the fixture really is a trade-off: an under-cap plan drops a need, a need-keeping plan is over the cap', () => {
  const s = spec();
  const rs = allPlans(s).map((p) => evaluatePlan(s, p));
  assert.equal(rs.length, 9);
  assert.equal(rs.some((r) => r.over === 0 && r.lost.length > 0), true);
  assert.equal(rs.some((r) => r.over > 0 && r.lost.length === 0), true);
});

test('evaluatePlan sums costs, reports the overshoot and the lost needs in spec order', () => {
  const s = spec();
  assert.deepEqual(evaluatePlan(s, { sampling: 'tail', attrs: 'tier' }), { complete: true, total: 11, over: 0, lost: [] });
  assert.deepEqual(evaluatePlan(s, { sampling: 'tail', attrs: 'user' }), { complete: true, total: 17, over: 5, lost: [] });
  assert.deepEqual(evaluatePlan(s, { sampling: 'head', attrs: 'none' }), { complete: true, total: 3, over: 0, lost: ['errors', 'per-user'] });
  assert.deepEqual(evaluatePlan(s, { sampling: 'head' }), { complete: false, total: 2, over: 0, lost: ['errors', 'per-user'] });
  assert.equal(evaluatePlan(s, { sampling: 'ghost' }).total, 0);
});

test('exactly at the cap passes; one cent over does not; cents add without float drift', () => {
  const s = spec();
  s.cap = 11;
  assert.equal(checkTradeoff(s, { ...newTradeoffState(s), picks: s.answer }).outcome, 'right');
  s.cap = 10.99;
  assert.equal(checkTradeoff(s, { ...newTradeoffState(s), picks: s.answer }).over, 0.01);
  s.knobs[0].options[1].cost = 0.1;
  s.knobs[1].options[1].cost = 0.2;
  assert.equal(evaluatePlan(s, s.answer).total, 0.3);
});

test('formatAmount: grouping and at most two decimals, the same everywhere', () => {
  assert.equal(formatAmount(0), '0');
  assert.equal(formatAmount(12), '12');
  assert.equal(formatAmount(1250.5), '1,250.5');
  assert.equal(formatAmount(1234567.891), '1,234,567.89');
  assert.equal(formatAmount(0.1 + 0.2), '0.3');
});

test('pickOption sets one option per knob, replaces it, and never mutates', () => {
  const s = deepFreeze(spec());
  const st0 = deepFreeze(newTradeoffState(s));
  const a = pickOption(s, st0, 'sampling', 'head');
  assert.equal(a.outcome, 'picked');
  assert.equal(JSON.stringify(a.state.picks), '{"sampling":"head"}');
  const b = pickOption(s, a.state, 'sampling', 'tail');
  assert.equal(JSON.stringify(b.state.picks), '{"sampling":"tail"}');
  assert.equal(JSON.stringify(st0.picks), '{}');
});

test('pickOption: an unknown knob or option changes nothing; a solved state is locked', () => {
  const s = spec();
  const st = newTradeoffState(s);
  for (const [k, o] of [['ghost', 'head'], ['sampling', 'ghost'], ['sampling', 'none'], ['constructor', 'x']]) {
    const r = pickOption(s, st, k, o);
    assert.equal(r.outcome, 'unknown', `${k}:${o}`);
    assert.equal(r.state === st, true);
  }
  const done = { ...st, picks: s.answer, solved: true };
  const r = pickOption(s, done, 'sampling', 'head');
  assert.equal(r.outcome, 'solved');
  assert.equal(r.state === done, true);
});

test('check: a plan with an unpicked knob is incomplete, free, and not remembered', () => {
  const s = spec();
  const st = picked(newTradeoffState(s), ['sampling', 'tail']);
  const r = checkTradeoff(s, st);
  assert.equal(r.outcome, 'incomplete');
  assert.equal(r.state === st, true);
  assert.equal(checkTradeoff(s, newTradeoffState(s)).outcome, 'incomplete');
});

test('check: an over-cap plan is wrong and reports how far over, with nothing lost', () => {
  const s = spec();
  const r = checkTradeoff(s, picked(newTradeoffState(s), ['sampling', 'tail'], ['attrs', 'user']));
  assert.deepEqual([r.outcome, r.total, r.over, r.lost.join()], ['wrong', 17, 5, '']);
  assert.equal(r.state.tried.join('|'), 'tail,user');
  assert.equal(r.state.solved, false);
});

test('check: an under-cap plan that drops a need is wrong even though it is cheap', () => {
  const s = spec();
  const r = checkTradeoff(s, picked(newTradeoffState(s), ['sampling', 'head'], ['attrs', 'tier']));
  assert.deepEqual([r.outcome, r.total, r.over, r.lost.join()], ['wrong', 5, 0, 'errors']);
});

test('check: over the cap and dropping a need reports both', () => {
  const s = spec();
  s.knobs[0].options[0].cost = 11;
  const r = checkTradeoff(s, picked(newTradeoffState(s), ['sampling', 'head'], ['attrs', 'user']));
  assert.deepEqual([r.outcome, r.over, r.lost.join()], ['wrong', 8, 'errors']);
});

test('check: the same failing plan again is a repeat, a changed plan is wrong again', () => {
  const s = spec();
  let st = picked(newTradeoffState(s), ['sampling', 'tail'], ['attrs', 'user']);
  st = checkTradeoff(s, st).state;
  const again = checkTradeoff(s, st);
  assert.equal(again.outcome, 'repeat');
  assert.equal(again.state === st, true);
  const other = checkTradeoff(s, picked(st, ['attrs', 'none']));
  assert.equal(other.outcome, 'wrong');
  assert.equal(other.state.tried.length, 2);
});

test('check: the reference plan is right, solves the state, and is "solved" afterwards', () => {
  const s = spec();
  const r = checkTradeoff(s, picked(newTradeoffState(s), ['sampling', 'tail'], ['attrs', 'tier']));
  assert.deepEqual([r.outcome, r.total, r.over, r.lost.join(), r.state.solved], ['right', 11, 0, '', true]);
  assert.equal(checkTradeoff(s, r.state).outcome, 'solved');
});

test('check never mutates its input state', () => {
  const s = deepFreeze(spec());
  const st = deepFreeze({ ...newTradeoffState(s), picks: { sampling: 'head', attrs: 'none' } });
  assert.equal(checkTradeoff(s, st).outcome, 'wrong');
});
